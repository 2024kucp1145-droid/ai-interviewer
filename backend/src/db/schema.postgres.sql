-- ==============================================================================
-- AI Interviewer Platform — Production PostgreSQL Database Schema
-- Optimized for: PostgreSQL 14+, Supabase, Neon, AWS RDS, Docker
-- Features: Strict ACID compliance, native JSONB for AI transcripts & rubrics,
--           full cascade foreign keys, optimized B-Tree indices, and pgvector readiness.
-- ==============================================================================

-- Enable UUID extension if available
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";
CREATE EXTENSION IF NOT EXISTS "pgcrypto";

-- 1. Organizations (Companies / Hiring Teams)
CREATE TABLE IF NOT EXISTS organizations (
  id VARCHAR(64) PRIMARY KEY,
  name VARCHAR(255) NOT NULL,
  website VARCHAR(512),
  industry VARCHAR(128),
  company_size VARCHAR(64),
  country VARCHAR(128),
  plan VARCHAR(64) DEFAULT 'free_trial',
  included_interviews INTEGER DEFAULT 10,
  subscription_plan_id VARCHAR(64),
  subscription_expires_at TIMESTAMPTZ,
  stripe_customer_id VARCHAR(128),
  stripe_subscription_id VARCHAR(128),
  stripe_subscription_status VARCHAR(64),
  created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP
);

-- 2. Users (Recruiters & Platform Admins)
CREATE TABLE IF NOT EXISTS users (
  id VARCHAR(64) PRIMARY KEY,
  org_id VARCHAR(64) NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  full_name VARCHAR(255),
  phone VARCHAR(64),
  job_title VARCHAR(128),
  email VARCHAR(255) UNIQUE NOT NULL,
  password_hash VARCHAR(255) NOT NULL,
  role VARCHAR(64) DEFAULT 'recruiter',
  org_role VARCHAR(64) DEFAULT 'owner',
  is_verified INTEGER DEFAULT 0,
  verification_code VARCHAR(32),
  approval_status VARCHAR(64) DEFAULT 'approved',
  last_login_at TIMESTAMPTZ,
  admin_notes TEXT,
  admin_uid VARCHAR(64) UNIQUE,
  created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP
);

-- 3. Provider Keys (BYOK Encrypted API Keys for Gemini, OpenAI, Claude)
CREATE TABLE IF NOT EXISTS provider_keys (
  id VARCHAR(64) PRIMARY KEY,
  org_id VARCHAR(64) NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  provider VARCHAR(64) NOT NULL,
  key_encrypted TEXT NOT NULL,
  key_last4 VARCHAR(16) NOT NULL,
  status VARCHAR(64) DEFAULT 'active',
  created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP
);

-- 4. Jobs (Interview Openings / Assessment Specifications)
CREATE TABLE IF NOT EXISTS jobs (
  id VARCHAR(64) PRIMARY KEY,
  org_id VARCHAR(64) NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  title VARCHAR(255) NOT NULL,
  jd_text TEXT NOT NULL,
  skills TEXT NOT NULL,
  level VARCHAR(64) DEFAULT 'junior',
  max_minutes INTEGER DEFAULT 15,
  max_questions INTEGER DEFAULT 10,
  qualifications TEXT,
  interview_type VARCHAR(64) DEFAULT 'technical',
  question_mode VARCHAR(64) DEFAULT 'ai_adaptive',
  custom_questions JSONB,
  terminal_required INTEGER DEFAULT 0,
  word_editor_required INTEGER DEFAULT 0,
  resume_required INTEGER DEFAULT 1,
  purpose VARCHAR(64) DEFAULT 'job',
  experience_required VARCHAR(64) DEFAULT '0-2 Yrs',
  assessment_rules JSONB,
  leetcode_problem VARCHAR(64),
  compiler_languages VARCHAR(255) DEFAULT 'javascript,python,sql',
  category VARCHAR(128) DEFAULT 'Software & Tech',
  show_timer INTEGER DEFAULT 1,
  auto_submit_timer INTEGER DEFAULT 1,
  created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP
);

-- 5. Candidates (Applicants taking assessments)
CREATE TABLE IF NOT EXISTS candidates (
  id VARCHAR(64) PRIMARY KEY,
  org_id VARCHAR(64) NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  name VARCHAR(255) NOT NULL,
  email VARCHAR(255) NOT NULL,
  phone VARCHAR(64),
  source VARCHAR(64) DEFAULT 'direct',
  resume_text TEXT,
  consent_at TIMESTAMPTZ,
  consent_version VARCHAR(32),
  deleted_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP
);

-- 6. Interviews (Interview Sessions & Candidate Access Tokens)
CREATE TABLE IF NOT EXISTS interviews (
  id VARCHAR(64) PRIMARY KEY,
  job_id VARCHAR(64) NOT NULL REFERENCES jobs(id) ON DELETE CASCADE,
  candidate_id VARCHAR(64) NOT NULL REFERENCES candidates(id) ON DELETE CASCADE,
  token_hash VARCHAR(255) UNIQUE NOT NULL,
  state VARCHAR(64) DEFAULT 'created',
  started_at TIMESTAMPTZ,
  ended_at TIMESTAMPTZ,
  expires_at TIMESTAMPTZ,
  link_timer_minutes INTEGER DEFAULT 60,
  show_timer INTEGER DEFAULT 1,
  auto_submit_timer INTEGER DEFAULT 1,
  proctor_warnings INTEGER DEFAULT 0,
  disqualified_reason TEXT,
  proctor_logs JSONB,
  dispatch_status VARCHAR(64) DEFAULT 'created',
  dispatch_channel VARCHAR(64) DEFAULT 'link',
  source VARCHAR(64) DEFAULT 'direct',
  dsa_result JSONB,
  code_draft TEXT,
  code_lang VARCHAR(64) DEFAULT 'javascript',
  code_history JSONB
);

-- 7. Turns (Conversational AI & Candidate Dialogue Exchanges)
CREATE TABLE IF NOT EXISTS turns (
  id VARCHAR(64) PRIMARY KEY,
  interview_id VARCHAR(64) NOT NULL REFERENCES interviews(id) ON DELETE CASCADE,
  idx INTEGER NOT NULL,
  role VARCHAR(64) NOT NULL,
  text TEXT NOT NULL,
  skill VARCHAR(128),
  level INTEGER,
  created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP
);

-- 8. Reports (Final AI Evaluation, Scores & Anti-Hallucination Evidence)
CREATE TABLE IF NOT EXISTS reports (
  id VARCHAR(64) PRIMARY KEY,
  interview_id VARCHAR(64) UNIQUE NOT NULL REFERENCES interviews(id) ON DELETE CASCADE,
  json JSONB NOT NULL,
  model VARCHAR(128) NOT NULL,
  reviewed_by VARCHAR(64),
  reviewer_note TEXT,
  created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP
);

-- 9. Usage Events (Token Consumption & Telemetry)
CREATE TABLE IF NOT EXISTS usage_events (
  id VARCHAR(64) PRIMARY KEY,
  org_id VARCHAR(64) NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  interview_id VARCHAR(64),
  kind VARCHAR(64) NOT NULL,
  input_tokens INTEGER DEFAULT 0,
  output_tokens INTEGER DEFAULT 0,
  est_cost NUMERIC(10, 4) DEFAULT 0,
  created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP
);

-- 10. Audit Logs (Enterprise Compliance Trail)
CREATE TABLE IF NOT EXISTS audit_logs (
  id VARCHAR(64) PRIMARY KEY,
  org_id VARCHAR(64) NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  actor VARCHAR(255) NOT NULL,
  action VARCHAR(128) NOT NULL,
  target VARCHAR(255),
  created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP
);

-- 11. Leads (Waitlist & Sales Inquiries)
CREATE TABLE IF NOT EXISTS leads (
  id VARCHAR(64) PRIMARY KEY,
  name VARCHAR(255),
  company VARCHAR(255),
  email VARCHAR(255) NOT NULL,
  phone VARCHAR(64),
  vacancies VARCHAR(255),
  source VARCHAR(64) DEFAULT 'waitlist',
  created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP
);

-- 12. Billing Orders (Subscriptions, Credits, and Bulk Purchases)
CREATE TABLE IF NOT EXISTS billing_orders (
  id VARCHAR(64) PRIMARY KEY,
  org_id VARCHAR(64) NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  type VARCHAR(64) NOT NULL,
  plan_id VARCHAR(64),
  quantity INTEGER,
  duration_minutes INTEGER,
  amount_usd NUMERIC(10, 2) NOT NULL,
  status VARCHAR(64) DEFAULT 'pending',
  paid_at TIMESTAMPTZ,
  quote_json JSONB,
  stripe_session_id VARCHAR(128),
  stripe_invoice_id VARCHAR(128),
  invoice_pdf_url TEXT,
  hosted_invoice_url TEXT,
  coupon_code VARCHAR(64),
  discount_usd NUMERIC(10, 2) DEFAULT 0,
  payment_method VARCHAR(64),
  utr_number VARCHAR(128),
  created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP
);

-- Promo / Coupon Codes
CREATE TABLE IF NOT EXISTS billing_coupons (
  code VARCHAR(64) PRIMARY KEY,
  discount_percent INTEGER DEFAULT 0,
  discount_usd NUMERIC(10, 2) DEFAULT 0,
  max_uses INTEGER DEFAULT 100,
  used_count INTEGER DEFAULT 0,
  active INTEGER DEFAULT 1,
  expires_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP
);

-- Admin-Managed Custom Site Pages & Navigation Links
CREATE TABLE IF NOT EXISTS site_pages (
  id VARCHAR(64) PRIMARY KEY,
  slug VARCHAR(128) UNIQUE NOT NULL,
  title VARCHAR(255) NOT NULL,
  content TEXT DEFAULT '',
  link_url TEXT DEFAULT '',
  placement VARCHAR(32) DEFAULT 'header',
  is_published INTEGER DEFAULT 1,
  sort_order INTEGER DEFAULT 0,
  created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP
);

-- 13. Billing Events (Financial Audit Ledger)
CREATE TABLE IF NOT EXISTS billing_events (
  id VARCHAR(64) PRIMARY KEY,
  org_id VARCHAR(64) NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  order_id VARCHAR(64),
  event VARCHAR(128) NOT NULL,
  amount_usd NUMERIC(10, 2) DEFAULT 0,
  created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP
);

-- 14. Org Question Bank (Custom Corporate Questions & Rubrics)
CREATE TABLE IF NOT EXISTS org_question_bank (
  id VARCHAR(64) PRIMARY KEY,
  org_id VARCHAR(64) NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  question TEXT NOT NULL,
  skill VARCHAR(128),
  category VARCHAR(128),
  difficulty VARCHAR(64) DEFAULT 'Medium',
  expected_answer TEXT,
  company_tag VARCHAR(128),
  created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP
);

-- 15. Admin Invites (Unique Hash Codes for Authorized Admins)
CREATE TABLE IF NOT EXISTS admin_invites (
  id VARCHAR(64) PRIMARY KEY,
  code_hash VARCHAR(255) UNIQUE NOT NULL,
  label VARCHAR(255),
  created_by VARCHAR(64),
  used_by VARCHAR(64),
  is_used INTEGER DEFAULT 0,
  created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP
);

-- 16. Admin OTPs (Email 2FA Verification Codes)
CREATE TABLE IF NOT EXISTS admin_otps (
  id VARCHAR(64) PRIMARY KEY,
  email VARCHAR(255) NOT NULL,
  otp_code VARCHAR(32) NOT NULL,
  purpose VARCHAR(64) NOT NULL,
  expires_at TIMESTAMPTZ NOT NULL,
  is_used INTEGER DEFAULT 0,
  created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP
);

-- 17. Platform Activities (Real-time Audit Feed for Admin Operations)
CREATE TABLE IF NOT EXISTS platform_activities (
  id VARCHAR(64) PRIMARY KEY,
  action VARCHAR(128) NOT NULL,
  actor_type VARCHAR(64) DEFAULT 'user',
  actor_id VARCHAR(64),
  actor_email VARCHAR(255),
  actor_name VARCHAR(255),
  org_id VARCHAR(64),
  entity_type VARCHAR(64),
  entity_id VARCHAR(64),
  details JSONB,
  ip_address VARCHAR(64),
  created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP
);

-- 18. Platform Settings (Key-Value Dynamic Configuration & Governance)
CREATE TABLE IF NOT EXISTS platform_settings (
  key VARCHAR(128) PRIMARY KEY,
  value TEXT NOT NULL,
  updated_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP
);

-- 19. User & Candidate Feedback Submissions
CREATE TABLE IF NOT EXISTS feedbacks (
  id VARCHAR(64) PRIMARY KEY,
  user_name VARCHAR(255),
  user_email VARCHAR(255) NOT NULL,
  rating INTEGER DEFAULT 5,
  category VARCHAR(64) DEFAULT 'general',
  message TEXT NOT NULL,
  source_page VARCHAR(64) DEFAULT 'dashboard',
  email_sent INTEGER DEFAULT 0,
  created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP
);

-- 20. Organization Team Invites (Multi-user Org RBAC)
CREATE TABLE IF NOT EXISTS org_team_invites (
  id VARCHAR(64) PRIMARY KEY,
  org_id VARCHAR(64) NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  email VARCHAR(255) NOT NULL,
  org_role VARCHAR(64) DEFAULT 'recruiter',
  token_hash VARCHAR(255) UNIQUE NOT NULL,
  invited_by VARCHAR(64),
  status VARCHAR(64) DEFAULT 'pending',
  expires_at TIMESTAMPTZ NOT NULL,
  created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP
);

-- 21. Outbound Signed Webhooks (HRIS / ATS Integrations)
CREATE TABLE IF NOT EXISTS org_webhooks (
  id VARCHAR(64) PRIMARY KEY,
  org_id VARCHAR(64) NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  name VARCHAR(255) NOT NULL,
  url TEXT NOT NULL,
  secret VARCHAR(255) NOT NULL,
  events TEXT NOT NULL,
  is_active INTEGER DEFAULT 1,
  last_triggered_at TIMESTAMPTZ,
  last_status INTEGER,
  created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP
);

-- 22. Outbound Webhook Delivery Audit Log
CREATE TABLE IF NOT EXISTS webhook_deliveries (
  id VARCHAR(64) PRIMARY KEY,
  webhook_id VARCHAR(64) NOT NULL REFERENCES org_webhooks(id) ON DELETE CASCADE,
  org_id VARCHAR(64) NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  event VARCHAR(128) NOT NULL,
  payload JSONB NOT NULL,
  status_code INTEGER,
  response_body TEXT,
  success INTEGER DEFAULT 0,
  duration_ms INTEGER,
  created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP
);

-- 23. Proctoring Webcam Snapshots
CREATE TABLE IF NOT EXISTS proctor_snapshots (
  id VARCHAR(64) PRIMARY KEY,
  interview_id VARCHAR(64) NOT NULL REFERENCES interviews(id) ON DELETE CASCADE,
  reason VARCHAR(255) NOT NULL,
  image_data TEXT NOT NULL,
  created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP
);

-- 24. Expiring Shareable Candidate Scorecard Links
CREATE TABLE IF NOT EXISTS report_shares (
  id VARCHAR(64) PRIMARY KEY,
  interview_id VARCHAR(64) NOT NULL REFERENCES interviews(id) ON DELETE CASCADE,
  org_id VARCHAR(64) NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  token_hash VARCHAR(255) UNIQUE NOT NULL,
  hide_pii INTEGER DEFAULT 1,
  expires_at TIMESTAMPTZ NOT NULL,
  created_by VARCHAR(64),
  view_count INTEGER DEFAULT 0,
  created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP
);

-- 25. Custom Organization Coding & SQL Problems
CREATE TABLE IF NOT EXISTS org_custom_problems (
  id VARCHAR(64) PRIMARY KEY,
  org_id VARCHAR(64) NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  title VARCHAR(255) NOT NULL,
  difficulty VARCHAR(64) DEFAULT 'Medium',
  description TEXT NOT NULL,
  function_name_js VARCHAR(128) DEFAULT 'solve',
  function_name_py VARCHAR(128) DEFAULT 'solve',
  starter_js TEXT,
  starter_py TEXT,
  starter_sql TEXT,
  test_cases_json JSONB NOT NULL,
  created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP
);

-- ==============================================================================
-- Optimized B-Tree Indexes for High Performance Queries
-- ==============================================================================
CREATE INDEX IF NOT EXISTS idx_pg_interviews_token ON interviews(token_hash);
CREATE INDEX IF NOT EXISTS idx_pg_turns_interview ON turns(interview_id);
CREATE INDEX IF NOT EXISTS idx_pg_candidates_org ON candidates(org_id);
CREATE INDEX IF NOT EXISTS idx_pg_billing_orders_org ON billing_orders(org_id);
CREATE INDEX IF NOT EXISTS idx_pg_question_bank_org ON org_question_bank(org_id);
CREATE INDEX IF NOT EXISTS idx_pg_activities_created ON platform_activities(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_pg_activities_action ON platform_activities(action);
CREATE INDEX IF NOT EXISTS idx_pg_admin_invites_code ON admin_invites(code_hash);
CREATE INDEX IF NOT EXISTS idx_pg_admin_otps_email ON admin_otps(email);
CREATE INDEX IF NOT EXISTS idx_pg_users_email ON users(email);
CREATE INDEX IF NOT EXISTS idx_pg_jobs_org ON jobs(org_id);
CREATE INDEX IF NOT EXISTS idx_pg_org_team_invites_org ON org_team_invites(org_id);
CREATE INDEX IF NOT EXISTS idx_pg_org_webhooks_org ON org_webhooks(org_id);
CREATE INDEX IF NOT EXISTS idx_pg_webhook_deliveries_org ON webhook_deliveries(org_id);
CREATE INDEX IF NOT EXISTS idx_pg_proctor_snapshots_iv ON proctor_snapshots(interview_id);
CREATE INDEX IF NOT EXISTS idx_pg_report_shares_token ON report_shares(token_hash);
CREATE INDEX IF NOT EXISTS idx_pg_org_custom_problems_org ON org_custom_problems(org_id);
