import Database from 'better-sqlite3';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const dbPath = path.resolve(__dirname, '../../../ai_interviewer.db');

export const db = new Database(dbPath);
db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');

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

    CREATE INDEX IF NOT EXISTS idx_interviews_token ON interviews(token_hash);
    CREATE INDEX IF NOT EXISTS idx_turns_interview ON turns(interview_id);
    CREATE INDEX IF NOT EXISTS idx_candidates_org ON candidates(org_id);
    CREATE INDEX IF NOT EXISTS idx_billing_orders_org ON billing_orders(org_id);
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
  addColumn('interviews', 'link_timer_minutes', 'INTEGER DEFAULT 60');

  // AI Proctoring & Anti-Cheating
  addColumn('interviews', 'proctor_warnings', 'INTEGER DEFAULT 0');
  addColumn('interviews', 'disqualified_reason', 'TEXT');
  addColumn('interviews', 'proctor_logs', 'TEXT');

  console.log('✓ SQLite database initialized and migrated with interview customization options');
}
