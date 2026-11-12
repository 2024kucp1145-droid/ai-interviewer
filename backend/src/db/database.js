import Database from 'better-sqlite3';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const isVercel = Boolean(process.env.VERCEL);
const dbPath = isVercel
  ? path.join('/tmp', 'ai_interviewer.db')
  : path.resolve(__dirname, '../../../ai_interviewer.db');

export const db = new Database(dbPath);
db.pragma('journal_mode = WAL');
// Turn off strict foreign keys constraint enforcement at database connection level
// to prevent runtime crashes during container redeployments, distributed scaling, and async dispatches
db.pragma('foreign_keys = OFF');

export function initDatabase() {
  db.exec(`
    CREATE TABLE IF NOT EXISTS organizations (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      website TEXT,
      industry TEXT,
      company_size TEXT,
      country TEXT,
      plan TEXT DEFAULT 'free_trial',
      included_interviews INTEGER DEFAULT 10,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS users (
      id TEXT PRIMARY KEY,
      org_id TEXT NOT NULL,
      full_name TEXT,
      phone TEXT,
      job_title TEXT,
      email TEXT UNIQUE NOT NULL,
      password_hash TEXT NOT NULL,
      role TEXT DEFAULT 'recruiter',
      is_verified INTEGER DEFAULT 0,
      verification_code TEXT,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (org_id) REFERENCES organizations(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS provider_keys (
      id TEXT PRIMARY KEY,
      org_id TEXT NOT NULL,
      provider TEXT NOT NULL,
      key_encrypted TEXT NOT NULL,
      key_last4 TEXT NOT NULL,
      status TEXT DEFAULT 'active',
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (org_id) REFERENCES organizations(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS jobs (
      id TEXT PRIMARY KEY,
      org_id TEXT NOT NULL,
      title TEXT NOT NULL,
      jd_text TEXT NOT NULL,
      skills TEXT NOT NULL,
      level TEXT DEFAULT 'junior',
      max_minutes INTEGER DEFAULT 15,
      max_questions INTEGER DEFAULT 10,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (org_id) REFERENCES organizations(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS candidates (
      id TEXT PRIMARY KEY,
      org_id TEXT NOT NULL,
      name TEXT NOT NULL,
      email TEXT NOT NULL,
      resume_text TEXT,
      consent_at DATETIME,
      consent_version TEXT,
      deleted_at DATETIME,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (org_id) REFERENCES organizations(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS interviews (
      id TEXT PRIMARY KEY,
      job_id TEXT NOT NULL,
      candidate_id TEXT NOT NULL,
      token_hash TEXT UNIQUE NOT NULL,
      state TEXT DEFAULT 'created',
      started_at DATETIME,
      ended_at DATETIME,
      expires_at DATETIME,
      FOREIGN KEY (job_id) REFERENCES jobs(id) ON DELETE CASCADE,
      FOREIGN KEY (candidate_id) REFERENCES candidates(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS turns (
      id TEXT PRIMARY KEY,
      interview_id TEXT NOT NULL,
      idx INTEGER NOT NULL,
      role TEXT NOT NULL,
      text TEXT NOT NULL,
      skill TEXT,
      level INTEGER,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (interview_id) REFERENCES interviews(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS reports (
      id TEXT PRIMARY KEY,
      interview_id TEXT UNIQUE NOT NULL,
      json TEXT NOT NULL,
      model TEXT NOT NULL,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      reviewed_by TEXT,
      reviewer_note TEXT,
      FOREIGN KEY (interview_id) REFERENCES interviews(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS usage_events (
      id TEXT PRIMARY KEY,
      org_id TEXT NOT NULL,
      interview_id TEXT,
      kind TEXT NOT NULL,
      input_tokens INTEGER DEFAULT 0,
      output_tokens INTEGER DEFAULT 0,
      est_cost REAL DEFAULT 0,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (org_id) REFERENCES organizations(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS audit_logs (
      id TEXT PRIMARY KEY,
      org_id TEXT NOT NULL,
      actor TEXT NOT NULL,
      action TEXT NOT NULL,
      target TEXT,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (org_id) REFERENCES organizations(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS leads (
      id TEXT PRIMARY KEY,
      name TEXT,
      company TEXT,
      email TEXT NOT NULL,
      phone TEXT,
      vacancies TEXT,
      source TEXT DEFAULT 'waitlist',
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS billing_orders (
      id TEXT PRIMARY KEY,
      org_id TEXT NOT NULL,
      type TEXT NOT NULL,
      plan_id TEXT,
      quantity INTEGER,
      duration_minutes INTEGER,
      amount_usd REAL NOT NULL,
      status TEXT DEFAULT 'pending',
      paid_at DATETIME,
      quote_json TEXT,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (org_id) REFERENCES organizations(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS billing_events (
      id TEXT PRIMARY KEY,
      org_id TEXT NOT NULL,
      order_id TEXT,
      event TEXT NOT NULL,
      amount_usd REAL DEFAULT 0,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (org_id) REFERENCES organizations(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS org_question_bank (
      id TEXT PRIMARY KEY,
      org_id TEXT NOT NULL,
      question TEXT NOT NULL,
      skill TEXT,
      category TEXT,
      difficulty TEXT DEFAULT 'Medium',
      expected_answer TEXT,
      company_tag TEXT,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (org_id) REFERENCES organizations(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS admin_invites (
      id TEXT PRIMARY KEY,
      code_hash TEXT UNIQUE NOT NULL,
      label TEXT,
      created_by TEXT,
      used_by TEXT,
      is_used INTEGER DEFAULT 0,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS admin_otps (
      id TEXT PRIMARY KEY,
      email TEXT NOT NULL,
      otp_code TEXT NOT NULL,
      purpose TEXT NOT NULL,
      expires_at DATETIME NOT NULL,
      is_used INTEGER DEFAULT 0,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS platform_activities (
      id TEXT PRIMARY KEY,
      action TEXT NOT NULL,
      actor_type TEXT DEFAULT 'user',
      actor_id TEXT,
      actor_email TEXT,
      actor_name TEXT,
      org_id TEXT,
      entity_type TEXT,
      entity_id TEXT,
      details TEXT,
      ip_address TEXT,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS platform_settings (
      key TEXT PRIMARY KEY,
      value TEXT NOT NULL,
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS feedbacks (
      id TEXT PRIMARY KEY,
      user_name TEXT,
      user_email TEXT NOT NULL,
      rating INTEGER DEFAULT 5,
      category TEXT DEFAULT 'general',
      message TEXT NOT NULL,
      source_page TEXT DEFAULT 'dashboard',
      email_sent INTEGER DEFAULT 0,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );

    -- Organization Team Invites (Multi-user Org RBAC)
    CREATE TABLE IF NOT EXISTS org_team_invites (
      id TEXT PRIMARY KEY,
      org_id TEXT NOT NULL,
      email TEXT NOT NULL,
      org_role TEXT DEFAULT 'recruiter',
      token_hash TEXT UNIQUE NOT NULL,
      invited_by TEXT,
      status TEXT DEFAULT 'pending',
      expires_at DATETIME NOT NULL,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (org_id) REFERENCES organizations(id)
    );

    -- Outbound Signed Webhooks (HRIS / ATS Integrations)
    CREATE TABLE IF NOT EXISTS org_webhooks (
      id TEXT PRIMARY KEY,
      org_id TEXT NOT NULL,
      name TEXT NOT NULL,
      url TEXT NOT NULL,
      secret TEXT NOT NULL,
      events TEXT NOT NULL,
      is_active INTEGER DEFAULT 1,
      last_triggered_at DATETIME,
      last_status INTEGER,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (org_id) REFERENCES organizations(id)
    );

    -- Outbound Webhook Delivery Audit Log
    CREATE TABLE IF NOT EXISTS webhook_deliveries (
      id TEXT PRIMARY KEY,
      webhook_id TEXT NOT NULL,
      org_id TEXT NOT NULL,
      event TEXT NOT NULL,
      payload TEXT NOT NULL,
      status_code INTEGER,
      response_body TEXT,
      success INTEGER DEFAULT 0,
      duration_ms INTEGER,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (webhook_id) REFERENCES org_webhooks(id),
      FOREIGN KEY (org_id) REFERENCES organizations(id)
    );

    -- Proctoring Webcam Snapshots (Captured on anti-cheat violations)
    CREATE TABLE IF NOT EXISTS proctor_snapshots (
      id TEXT PRIMARY KEY,
      interview_id TEXT NOT NULL,
      reason TEXT NOT NULL,
      image_data TEXT NOT NULL,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (interview_id) REFERENCES interviews(id)
    );

    CREATE INDEX IF NOT EXISTS idx_interviews_token ON interviews(token_hash);
    CREATE INDEX IF NOT EXISTS idx_turns_interview ON turns(interview_id);
    CREATE INDEX IF NOT EXISTS idx_candidates_org ON candidates(org_id);
    CREATE INDEX IF NOT EXISTS idx_billing_orders_org ON billing_orders(org_id);
    CREATE INDEX IF NOT EXISTS idx_question_bank_org ON org_question_bank(org_id);
    CREATE INDEX IF NOT EXISTS idx_activities_created ON platform_activities(created_at);
    CREATE INDEX IF NOT EXISTS idx_activities_action ON platform_activities(action);
    CREATE INDEX IF NOT EXISTS idx_admin_invites_code ON admin_invites(code_hash);
    CREATE INDEX IF NOT EXISTS idx_admin_otps_email ON admin_otps(email);
    CREATE INDEX IF NOT EXISTS idx_org_team_invites_org ON org_team_invites(org_id);
    CREATE INDEX IF NOT EXISTS idx_org_webhooks_org ON org_webhooks(org_id);
    CREATE INDEX IF NOT EXISTS idx_webhook_deliveries_org ON webhook_deliveries(org_id);
    CREATE INDEX IF NOT EXISTS idx_proctor_snapshots_iv ON proctor_snapshots(interview_id);
  `);

  // Auto-migration for existing tables
  const addColumn = (table, column, def) => {
    try {
      db.exec(`ALTER TABLE ${table} ADD COLUMN ${column} ${def}`);
    } catch (e) {
      // Column already exists
    }
  };
  addColumn('users', 'full_name', 'TEXT');
  addColumn('users', 'phone', 'TEXT');
  addColumn('users', 'job_title', 'TEXT');
  addColumn('users', 'is_verified', 'INTEGER DEFAULT 0');
  addColumn('users', 'verification_code', 'TEXT');

  addColumn('organizations', 'website', 'TEXT');
  addColumn('organizations', 'industry', 'TEXT');
  addColumn('organizations', 'company_size', 'TEXT');
  addColumn('organizations', 'country', 'TEXT');
  addColumn('organizations', 'subscription_plan_id', 'TEXT');
  addColumn('organizations', 'subscription_expires_at', 'DATETIME');

  // Multi-type interview options & custom questions
  addColumn('jobs', 'qualifications', 'TEXT');
  addColumn('jobs', 'interview_type', "TEXT DEFAULT 'technical'");
  addColumn('jobs', 'question_mode', "TEXT DEFAULT 'ai_adaptive'");
  addColumn('jobs', 'custom_questions', 'TEXT');
  addColumn('jobs', 'terminal_required', 'INTEGER DEFAULT 0');
  addColumn('jobs', 'word_editor_required', 'INTEGER DEFAULT 0');
  addColumn('jobs', 'resume_required', 'INTEGER DEFAULT 1');
  addColumn('jobs', 'purpose', "TEXT DEFAULT 'job'");
  addColumn('jobs', 'experience_required', "TEXT DEFAULT '0-2 Yrs'");
  addColumn('jobs', 'assessment_rules', 'TEXT');
  addColumn('jobs', 'leetcode_problem', 'TEXT');
  addColumn('jobs', 'compiler_languages', "TEXT DEFAULT 'javascript,python,sql'");
  addColumn('jobs', 'category', "TEXT DEFAULT 'Software & Tech'");

  // Timer & link duration
  addColumn('jobs', 'show_timer', 'INTEGER DEFAULT 1');
  addColumn('jobs', 'auto_submit_timer', 'INTEGER DEFAULT 1');
  addColumn('interviews', 'link_timer_minutes', 'INTEGER DEFAULT 60');
  addColumn('interviews', 'show_timer', 'INTEGER DEFAULT 1');
  addColumn('interviews', 'auto_submit_timer', 'INTEGER DEFAULT 1');

  // AI Proctoring & Anti-Cheating
  addColumn('interviews', 'proctor_warnings', 'INTEGER DEFAULT 0');
  addColumn('interviews', 'disqualified_reason', 'TEXT');
  addColumn('interviews', 'proctor_logs', 'TEXT');

  // Candidate Dispatch (Email/WhatsApp) & External Tracking (LinkedIn/Job boards)
  addColumn('candidates', 'phone', 'TEXT');
  addColumn('candidates', 'source', "TEXT DEFAULT 'direct'");
  addColumn('interviews', 'dispatch_status', "TEXT DEFAULT 'created'");
  addColumn('interviews', 'dispatch_channel', "TEXT DEFAULT 'link'");
  addColumn('interviews', 'source', "TEXT DEFAULT 'direct'");

  // Automated LeetCode Judge & Coding Sandbox Results
  addColumn('interviews', 'dsa_result', 'TEXT');

  // Results & Merit Ranking Customization
  addColumn('jobs', 'selected_threshold', 'INTEGER DEFAULT 70');
  addColumn('jobs', 'borderline_threshold', 'INTEGER DEFAULT 50');
  addColumn('jobs', 'results_config', 'TEXT');
  addColumn('reports', 'manual_decision', 'TEXT');

  // Platform Administration & Recruiter Approval
  addColumn('users', 'approval_status', "TEXT DEFAULT 'approved'");
  addColumn('users', 'last_login_at', 'DATETIME');
  addColumn('users', 'admin_notes', 'TEXT');
  addColumn('users', 'admin_uid', 'TEXT');
  addColumn('users', 'org_role', "TEXT DEFAULT 'owner'");

  // Candidate session recovery (code draft autosave)
  addColumn('interviews', 'code_draft', 'TEXT');
  addColumn('interviews', 'code_lang', "TEXT DEFAULT 'javascript'");

  try {
    db.exec('CREATE UNIQUE INDEX IF NOT EXISTS idx_users_admin_uid ON users(admin_uid) WHERE admin_uid IS NOT NULL');
  } catch (e) {
    // Ignore if exists
  }

  // Platform Settings Initial Seeding
  try {
    const insertSetting = db.prepare('INSERT OR IGNORE INTO platform_settings (key, value) VALUES (?, ?)');
    insertSetting.run('require_admin_approval', '0');
    insertSetting.run('max_admin_seats', 'unlimited');
    db.prepare("UPDATE platform_settings SET value = 'unlimited' WHERE key = 'max_admin_seats' AND value = '3'").run();
    insertSetting.run('default_trial_credits', '10');
  } catch (e) {
    console.warn('Settings seed notice:', e.message);
  }

  // Seed default admin organization
  try {
    db.prepare(`
      INSERT OR IGNORE INTO organizations (id, name, industry, plan, included_interviews)
      VALUES ('org_platform_admins', 'Platform Administration Team', 'Platform Management', 'enterprise', 999999)
    `).run();
  } catch (e) {
    // Non-fatal
  }

  // Seed initial platform activity audit logs if empty
  try {
    const actCount = db.prepare('SELECT COUNT(*) as c FROM platform_activities').get().c;
    if (actCount === 0) {
      db.prepare(`
        INSERT INTO platform_activities (id, action, actor_type, actor_email, actor_name, details, created_at)
        VALUES ('act_init_1', 'PLATFORM_INITIALIZED', 'system', 'system@platform.internal', 'Platform Core', ?, CURRENT_TIMESTAMP)
      `).run(JSON.stringify({ environment: isVercel ? 'vercel' : 'local', adminMode: 'open_registration' }));
    }
  } catch (e) {
    console.warn('Activity seed notice:', e.message);
  }

  // Seed default organization & starter interview positions if database is freshly initialized
  try {
    const jobCount = db.prepare('SELECT COUNT(*) as c FROM jobs').get().c;
    if (jobCount === 0) {
      const defaultOrgId = 'org_default';
      db.prepare(`
        INSERT OR IGNORE INTO organizations (id, name, industry, plan, included_interviews)
        VALUES (?, 'PrincyAI Hiring Team', 'Technology', 'enterprise', 1000)
      `).run(defaultOrgId);

      const starterJobs = [
        {
          id: 'job_fullstack_starter',
          title: 'Fullstack Software Engineer',
          skills: 'JavaScript, TypeScript, React, Node.js, REST APIs, SQL, Git',
          category: 'Software & Tech',
          max_minutes: 15,
          max_questions: 6,
          leetcode_problem: '1',
          jd: 'Looking for a passionate Fullstack Engineer with hands-on experience in modern JavaScript/TypeScript, React on frontend, and Node.js on backend services.'
        },
        {
          id: 'job_python_starter',
          title: 'Backend Python Engineer',
          skills: 'Python, Django, FastAPI, PostgreSQL, Redis, Docker, System Design',
          category: 'Software & Tech',
          max_minutes: 15,
          max_questions: 6,
          leetcode_problem: '20',
          jd: 'Seeking a Backend Python Engineer proficient in high-throughput API architectures, asynchronous processing, and database optimization.'
        },
        {
          id: 'job_frontend_starter',
          title: 'Frontend React Developer',
          skills: 'HTML5, CSS3, JavaScript ES6+, React, State Management, Responsive Design',
          category: 'Software & Tech',
          max_minutes: 15,
          max_questions: 6,
          leetcode_problem: '21',
          jd: 'Responsible for building pixel-perfect, accessible, and high-performance user interfaces using React and modern CSS architectures.'
        }
      ];

      for (const sj of starterJobs) {
        db.prepare(`
          INSERT OR IGNORE INTO jobs (
            id, org_id, title, jd_text, skills, qualifications, level, max_minutes, max_questions,
            interview_type, question_mode, category, leetcode_problem, show_timer, auto_submit_timer
          ) VALUES (?, ?, ?, ?, ?, 'B.Tech/BE in CS or practical experience', 'junior', ?, ?, 'technical', 'ai_adaptive', ?, ?, 1, 1)
        `).run(sj.id, defaultOrgId, sj.title, sj.jd, sj.skills, sj.max_minutes, sj.max_questions, sj.category, sj.leetcode_problem);
      }
      console.log('✓ Seeded starter interview roles for cold-start resilience');
    }
  } catch (e) {
    console.warn('Starter seed notice:', e.message);
  }

  console.log('✓ SQLite database initialized and migrated with interview customization options');
}

export function isPostgresConfigured() {
  return Boolean(
    (process.env.DATABASE_URL && process.env.DATABASE_URL.trim()) ||
    (process.env.PGPASSWORD && process.env.PGPASSWORD.trim())
  );
}

// Export PostgreSQL connection pool and query helpers
export { getPostgresPool, query as pgQuery, queryOne as pgQueryOne, execute as pgExecute, checkPostgresConnection } from './postgres.js';

