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

    CREATE TABLE IF NOT EXISTS billing_coupons (
      code TEXT PRIMARY KEY,
      discount_percent INTEGER DEFAULT 0,
      discount_usd REAL DEFAULT 0,
      max_uses INTEGER DEFAULT 100,
      used_count INTEGER DEFAULT 0,
      active INTEGER DEFAULT 1,
      expires_at DATETIME,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
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

    CREATE TABLE IF NOT EXISTS site_pages (
      id TEXT PRIMARY KEY,
      slug TEXT UNIQUE NOT NULL,
      title TEXT NOT NULL,
      content TEXT DEFAULT '',
      link_url TEXT DEFAULT '',
      placement TEXT DEFAULT 'header',
      is_published INTEGER DEFAULT 1,
      sort_order INTEGER DEFAULT 0,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );

    -- Editorial Blog & Resources CMS
    CREATE TABLE IF NOT EXISTS resources (
      id TEXT PRIMARY KEY,
      slug TEXT UNIQUE NOT NULL,
      title TEXT NOT NULL,
      summary TEXT DEFAULT '',
      content TEXT DEFAULT '',
      category TEXT DEFAULT 'Guides',
      author_name TEXT DEFAULT 'RoundOne Team',
      author_role TEXT DEFAULT 'Technical Recruitment',
      read_time TEXT DEFAULT '5 min read',
      cover_image TEXT DEFAULT '',
      tags TEXT DEFAULT '',
      is_published INTEGER DEFAULT 1,
      views_count INTEGER DEFAULT 0,
      sort_order INTEGER DEFAULT 0,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
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

    -- Expiring Shareable Candidate Scorecard Links
    CREATE TABLE IF NOT EXISTS report_shares (
      id TEXT PRIMARY KEY,
      interview_id TEXT NOT NULL,
      org_id TEXT NOT NULL,
      token_hash TEXT UNIQUE NOT NULL,
      hide_pii INTEGER DEFAULT 1,
      expires_at DATETIME NOT NULL,
      created_by TEXT,
      view_count INTEGER DEFAULT 0,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (interview_id) REFERENCES interviews(id),
      FOREIGN KEY (org_id) REFERENCES organizations(id)
    );

    -- Custom Organization Coding & SQL Problems
    CREATE TABLE IF NOT EXISTS org_custom_problems (
      id TEXT PRIMARY KEY,
      org_id TEXT NOT NULL,
      title TEXT NOT NULL,
      difficulty TEXT DEFAULT 'Medium',
      description TEXT NOT NULL,
      function_name_js TEXT DEFAULT 'solve',
      function_name_py TEXT DEFAULT 'solve',
      starter_js TEXT,
      starter_py TEXT,
      starter_sql TEXT,
      test_cases_json TEXT NOT NULL,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (org_id) REFERENCES organizations(id)
    );

    -- LeetCode Coding Bank (Topic-tagged, NO hints, NO company tags)
    CREATE TABLE IF NOT EXISTS leetcode_problems (
      id TEXT PRIMARY KEY,
      frontend_id INTEGER NOT NULL,
      slug TEXT UNIQUE NOT NULL,
      title TEXT NOT NULL,
      difficulty TEXT DEFAULT 'Medium',
      topics_json TEXT DEFAULT '[]',
      category TEXT DEFAULT 'Algorithms',
      description TEXT NOT NULL,
      constraints TEXT DEFAULT '',
      examples_json TEXT DEFAULT '[]',
      starter_json TEXT DEFAULT '{}',
      buggy_starter_json TEXT DEFAULT '{}',
      test_cases_json TEXT DEFAULT '[]',
      function_name_json TEXT DEFAULT '{}',
      time_limit_ms INTEGER DEFAULT 2000,
      memory_limit_mb INTEGER DEFAULT 256,
      source TEXT DEFAULT 'builtin',
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
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
    CREATE INDEX IF NOT EXISTS idx_report_shares_token ON report_shares(token_hash);
    CREATE INDEX IF NOT EXISTS idx_org_custom_problems_org ON org_custom_problems(org_id);
    CREATE INDEX IF NOT EXISTS idx_leetcode_frontend_id ON leetcode_problems(frontend_id);
    CREATE INDEX IF NOT EXISTS idx_leetcode_difficulty ON leetcode_problems(difficulty);
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
  addColumn('organizations', 'stripe_customer_id', 'TEXT');
  addColumn('organizations', 'stripe_subscription_id', 'TEXT');
  addColumn('organizations', 'stripe_subscription_status', 'TEXT');

  addColumn('billing_orders', 'stripe_session_id', 'TEXT');
  addColumn('billing_orders', 'stripe_invoice_id', 'TEXT');
  addColumn('billing_orders', 'invoice_pdf_url', 'TEXT');
  addColumn('billing_orders', 'hosted_invoice_url', 'TEXT');
  addColumn('billing_orders', 'coupon_code', 'TEXT');
  addColumn('billing_orders', 'discount_usd', 'REAL DEFAULT 0');
  addColumn('billing_orders', 'payment_method', 'TEXT');
  addColumn('billing_orders', 'utr_number', 'TEXT');

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
  addColumn('jobs', 'dsa_time_limit_ms', 'INTEGER DEFAULT 2000');
  addColumn('jobs', 'dsa_memory_limit_mb', 'INTEGER DEFAULT 256');
  addColumn('jobs', 'dsa_question_mode', "TEXT DEFAULT 'solve'");
  addColumn('jobs', 'dsa_questions_count', 'INTEGER DEFAULT 1');
  addColumn('jobs', 'dsa_blind_mode', 'INTEGER DEFAULT 1');

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

  // Candidate session recovery & keystroke replay
  addColumn('interviews', 'code_draft', 'TEXT');
  addColumn('interviews', 'code_lang', "TEXT DEFAULT 'javascript'");
  addColumn('interviews', 'code_history', 'TEXT');

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

    // Seed starter blog & editorial resources for SEO & immediate customer discovery
    const resourceCount = db.prepare('SELECT COUNT(*) as c FROM resources').get()?.c || 0;
    if (resourceCount === 0) {
      const sampleArticles = [
        {
          id: 'res_cheat_prevention_2026',
          slug: 'how-ai-video-proctoring-stops-cheating-2026',
          title: 'How AI Video Proctoring & Real-Time Code Analysis Eliminate Proxy Hiring in 2026',
          summary: 'A deep dive into multi-modal vision neural networks, continuous camera heartbeat verification, clipboard burst auditing, and browser integrity locks.',
          category: 'Guides',
          author_name: 'Dr. Sarah Lin',
          author_role: 'Head of AI Trust & Safety',
          read_time: '6 min read',
          cover_image: 'https://images.unsplash.com/photo-1526374965328-7f61d4dc18c5?w=1200&q=80',
          tags: 'AI Proctoring, Anti-Cheat, Technical Screening, Vision Models',
          is_published: 1,
          sort_order: 1,
          content: `## The Modern Proxy Problem in Remote Hiring

Over the past three years, technical hiring teams have reported a dramatic 340% increase in candidate proxy attempts, dual-monitor screen mirroring, and stealth LLM copy-pasting during remote technical screens.

For engineering leaders, reviewing candidate submissions is no longer just about correctness—it is about **verifying authenticity without destroying candidate experience**.

\`\`\`
Traditional Interview: Candidate -> Audio/Video Screen -> Recruiter Manual Guesswork
Modern AI Proctoring: Candidate -> Vision Neural Engine -> Keystroke Audit -> Verified Integrity Score
\`\`\`

---

## 3 Core Pillars of Modern Anti-Cheat Defense

### 1. Vision AI & Multi-Face Neural Detection
Lightweight edge-based neural networks (such as MobileNet V2 and COCO-SSD) run directly in the candidate's browser sandbox at 1.3-second intervals. Key markers evaluated include:
- **Secondary Device Detection:** Spotting smartphone bezels or electronic devices in the candidate's lower camera frame.
- **Multi-Person Presence:** Detecting coaching or whispering by third parties.
- **Seat Abandonment:** Flagging absence if a candidate steps away from the camera.

### 2. Continuous Integrity Heartbeat Snapshots
Instead of only capturing photos when a violation triggers, enterprise engines capture periodic **integrity heartbeat snapshots every 60–75 seconds**. This gives the recruiter a verified visual audit trail across minute 1, minute 5, and minute 12 of the session.

### 3. Keystroke Rhythm & External Paste Auditing
Real developers type with progressive cadence. When an editor detects a **sudden burst of 150+ characters pasted within 12 milliseconds**, the engine immediately flags the event, logs the exact character count, and triggers a webcam verification capture.

---

## The Verdict for Technical Recruiters

By combining continuous proctoring with automated LeetCode testcase execution, teams can confidently screen hundreds of applicants while ensuring that only genuine engineering talent advances to the onsite round.`
        },
        {
          id: 'res_roundone_vs_hackerrank',
          slug: 'roundone-ai-vs-hackerrank-technical-interview-comparison',
          title: 'RoundOne AI vs HackerRank: Technical Hiring Platform Comparison for High-Growth Startups',
          summary: 'Comparing pricing models, automated multi-turn voice interviews, live anti-cheat proctoring, and recruiter time-to-hire across leading assessment tools.',
          category: 'Comparisons',
          author_name: 'Aditya Verma',
          author_role: 'VP of Engineering',
          read_time: '7 min read',
          cover_image: 'https://images.unsplash.com/photo-1551288049-bebda4e38f71?w=1200&q=80',
          tags: 'Comparisons, HackerRank, Pricing, Technical Hiring',
          is_published: 1,
          sort_order: 2,
          content: `## Choosing the Right Engineering Assessment Platform

When choosing a technical hiring platform, startup founders and engineering managers are often torn between legacy assessment tools (like HackerRank or Codility) and modern conversational AI platforms like **RoundOne AI**.

Let's break down the tangible differences across costs, candidate engagement, and evaluation depth.

| Feature | Legacy Code Testing (HackerRank/Codility) | RoundOne AI Interactive Screening |
| :--- | :--- | :--- |
| **Pricing Model** | $3,500 – $8,000 / year upfront license | Pay-as-you-go ($0.50 / ₹42 per interview) |
| **Interview Mode** | Static text quiz & unit test suite | Conversational AI Voice + Monaco Code Studio |
| **Deep Follow-ups** | ❌ No conversational follow-up questions | ✅ Asks candidate why they chose O(N) vs O(N log N) |
| **Anti-Cheat Audit** | Basic browser tab exit tracking | Full video snapshots + periodic heartbeats |
| **Setup Time** | Hours configuring complex test suites | 30 seconds (paste JD or pick starter role) |

---

## Why Conversational Follow-up Questions Matter

A static automated test can verify that a candidate's code passes 5 test cases. However, it cannot tell you:
1. Did the candidate genuinely understand the memory trade-offs?
2. Can they explain edge cases to another developer?
3. What would they change if the data stream scaled to 10 million events per second?

With RoundOne AI, the conversational AI interviewer listens to candidate explanations in real-time and asks dynamic technical probes—replicating a senior staff engineer's evaluation for less than the cost of a coffee.`
        },
        {
          id: 'res_scaling_tech_hiring_2026',
          slug: 'complete-guide-screening-200-engineers-without-burnout',
          title: 'The 2026 Guide to Screening 200+ Full-Stack Developers Without Engineering Burnout',
          summary: 'How fast-growing companies replace 40 hours of manual technical screening calls with automated AI first rounds while improving candidate satisfaction.',
          category: 'Tech Hiring',
          author_name: 'Priya Sharma',
          author_role: 'Talent Acquisition Partner',
          read_time: '5 min read',
          cover_image: 'https://images.unsplash.com/photo-1522071820081-009f0129c71c?w=1200&q=80',
          tags: 'Tech Hiring, Engineering Management, Scaling Teams, HR Automation',
          is_published: 1,
          sort_order: 3,
          content: `## The Hidden Cost of Engineering First Rounds

For every open Senior Backend or Full-Stack position, a typical tech startup receives between **250 and 600 applications**. 

If your senior engineers spend 45 minutes on just 20 first-round screens, that equals **15 hours of lost sprint development time** every single week.

\`\`\`
Applicant Funnel Bottleneck:
300 Applicants -> 40 Resume Matches -> 25 Phone Screens (18 Hours Dev Time) -> 4 Onsites
\`\`\`

---

## The 3-Step Automated Evaluation Blueprint

Leading talent teams have restructured their pipeline into an asynchronous first-round model:

1. **Self-Service Candidate Booking:** Candidates receive a secure, one-time link to take their 15-minute technical screen whenever they are ready.
2. **Standardized AI Technical Evaluation:** Every candidate is asked identical baseline questions tailored to their job description, ensuring zero unconscious interviewer bias.
3. **Structured Scorecard Delivery:** Instead of vague interviewer notes, hiring managers receive:
   - Overall competency score (0-100)
   - Verified code replay with keystroke timeline
   - Proctored camera integrity proof
   - Timestamped transcripts with hallucination-checked evidence quotes

---

## Candidate Response: Fairness & Transparency

Contrary to initial assumptions, engineers consistently prefer on-demand AI screening over awkward phone screenings:
- No scheduling friction across timezones.
- Full access to a professional VS Code Monaco editor.
- Immediate clarity on test execution and requirements.`
        }
      ];

      for (const a of sampleArticles) {
        db.prepare(`
          INSERT INTO resources (
            id, slug, title, summary, content, category, author_name, author_role,
            read_time, cover_image, tags, is_published, views_count, sort_order
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 42, ?)
        `).run(
          a.id, a.slug, a.title, a.summary, a.content, a.category, a.author_name,
          a.author_role, a.read_time, a.cover_image, a.tags, a.is_published, a.sort_order
        );
      }
      console.log('✓ Seeded starter editorial & blog resources for public discovery');
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

