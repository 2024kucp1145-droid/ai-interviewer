import { db } from '../db/database.js';
import { getPostgresPool } from '../db/postgres.js';

let syncInterval = null;
let isSyncing = false;

/**
 * Pulls admin changes from Supabase PostgreSQL into SQLite.
 * This allows you to manage the entire backend from the Supabase Dashboard:
 *  - Approving / rejecting recruiters (users.approval_status)
 *  - Upgrading / changing interview credits (organizations.included_interviews, plan)
 *  - Changing platform settings (platform_settings)
 *  - Adding / updating job roles (jobs)
 */
export async function pullFromSupabase() {
  if (!process.env.DATABASE_URL) return;
  const pool = getPostgresPool();

  try {
    // 1. Pull user approval statuses, roles & verifications
    const pgUsers = await pool.query(
      'SELECT id, full_name, email, role, is_verified, approval_status FROM users'
    );
    const updateUserStmt = db.prepare(`
      UPDATE users SET 
        role = COALESCE(?, role),
        is_verified = COALESCE(?, is_verified),
        approval_status = COALESCE(?, approval_status)
      WHERE id = ?
    `);
    db.transaction(() => {
      for (const u of pgUsers.rows) {
        updateUserStmt.run(u.role, u.is_verified, u.approval_status, u.id);
      }
    })();

    // 2. Pull organization plans and interview credits
    const pgOrgs = await pool.query(
      'SELECT id, name, plan, included_interviews FROM organizations'
    );
    const updateOrgStmt = db.prepare(`
      UPDATE organizations SET 
        plan = COALESCE(?, plan),
        included_interviews = COALESCE(?, included_interviews)
      WHERE id = ?
    `);
    db.transaction(() => {
      for (const o of pgOrgs.rows) {
        updateOrgStmt.run(o.plan, o.included_interviews, o.id);
      }
    })();

    // 3. Pull platform settings overrides
    const pgSettings = await pool.query('SELECT key, value FROM platform_settings');
    const updateSettingStmt = db.prepare(`
      INSERT INTO platform_settings (key, value, updated_at)
      VALUES (?, ?, CURRENT_TIMESTAMP)
      ON CONFLICT(key) DO UPDATE SET
        value = EXCLUDED.value,
        updated_at = CURRENT_TIMESTAMP
    `);
    db.transaction(() => {
      for (const s of pgSettings.rows) {
        updateSettingStmt.run(s.key, s.value);
      }
    })();

    // 4. Pull custom jobs
    const pgJobs = await pool.query('SELECT id, org_id, title, jd_text, skills, level, max_minutes, max_questions, category, selected_threshold, borderline_threshold FROM jobs');
    const updateJobStmt = db.prepare(`
      INSERT INTO jobs (id, org_id, title, jd_text, skills, level, max_minutes, max_questions, category, selected_threshold, borderline_threshold)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(id) DO UPDATE SET
        title = COALESCE(excluded.title, jobs.title),
        skills = COALESCE(excluded.skills, jobs.skills),
        level = COALESCE(excluded.level, jobs.level),
        max_minutes = COALESCE(excluded.max_minutes, jobs.max_minutes),
        max_questions = COALESCE(excluded.max_questions, jobs.max_questions),
        category = COALESCE(excluded.category, jobs.category),
        selected_threshold = COALESCE(excluded.selected_threshold, jobs.selected_threshold),
        borderline_threshold = COALESCE(excluded.borderline_threshold, jobs.borderline_threshold)
    `);
    db.transaction(() => {
      for (const j of pgJobs.rows) {
        updateJobStmt.run(
          j.id, j.org_id || 'org_default', j.title || 'Technical Role', j.jd_text || '',
          j.skills || '', j.level || 'junior', j.max_minutes || 15, j.max_questions || 6,
          j.category || 'Software & Tech', j.selected_threshold || 70, j.borderline_threshold || 50
        );
      }
    })();

    // 5. Pull candidates
    const pgCandidates = await pool.query(
      'SELECT id, org_id, name, email, phone, source, resume_text, created_at FROM candidates'
    );
    const updateCandStmt = db.prepare(`
      INSERT INTO candidates (id, org_id, name, email, phone, source, resume_text, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(id) DO UPDATE SET
        name = COALESCE(excluded.name, candidates.name),
        email = COALESCE(excluded.email, candidates.email),
        phone = COALESCE(excluded.phone, candidates.phone),
        resume_text = COALESCE(excluded.resume_text, candidates.resume_text)
    `);
    db.transaction(() => {
      for (const c of pgCandidates.rows) {
        updateCandStmt.run(
          c.id, c.org_id || 'org_default', c.name || 'Candidate', c.email || '',
          c.phone || null, c.source || 'direct', c.resume_text || '',
          c.created_at || new Date().toISOString()
        );
      }
    })();

    // 6. Pull interviews
    const pgInterviews = await pool.query(
      `SELECT id, job_id, candidate_id, token_hash, state, started_at, ended_at, expires_at,
              link_timer_minutes, show_timer, auto_submit_timer, proctor_warnings, disqualified_reason,
              proctor_logs, dispatch_status, dispatch_channel, source, dsa_result, code_draft, code_lang, code_history
       FROM interviews`
    );
    const updateIvStmt = db.prepare(`
      INSERT INTO interviews (
        id, job_id, candidate_id, token_hash, state, started_at, ended_at, expires_at,
        link_timer_minutes, show_timer, auto_submit_timer, proctor_warnings, disqualified_reason,
        proctor_logs, dispatch_status, dispatch_channel, source, dsa_result, code_draft, code_lang, code_history
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(id) DO UPDATE SET
        state = COALESCE(excluded.state, interviews.state),
        started_at = COALESCE(excluded.started_at, interviews.started_at),
        ended_at = COALESCE(excluded.ended_at, interviews.ended_at),
        expires_at = COALESCE(excluded.expires_at, interviews.expires_at),
        proctor_warnings = COALESCE(excluded.proctor_warnings, interviews.proctor_warnings),
        disqualified_reason = COALESCE(excluded.disqualified_reason, interviews.disqualified_reason),
        proctor_logs = COALESCE(excluded.proctor_logs, interviews.proctor_logs),
        dsa_result = COALESCE(excluded.dsa_result, interviews.dsa_result),
        code_draft = COALESCE(excluded.code_draft, interviews.code_draft),
        code_lang = COALESCE(excluded.code_lang, interviews.code_lang),
        code_history = COALESCE(excluded.code_history, interviews.code_history)
    `);
    db.transaction(() => {
      for (const i of pgInterviews.rows) {
        updateIvStmt.run(
          i.id, i.job_id, i.candidate_id, i.token_hash || '', i.state || 'created',
          i.started_at, i.ended_at, i.expires_at,
          i.link_timer_minutes || 60, i.show_timer ?? 1, i.auto_submit_timer ?? 1,
          i.proctor_warnings || 0, i.disqualified_reason,
          typeof i.proctor_logs === 'object' ? JSON.stringify(i.proctor_logs) : i.proctor_logs,
          i.dispatch_status || 'created', i.dispatch_channel || 'link',
          i.source || 'direct',
          typeof i.dsa_result === 'object' ? JSON.stringify(i.dsa_result) : i.dsa_result,
          i.code_draft, i.code_lang,
          typeof i.code_history === 'object' ? JSON.stringify(i.code_history) : i.code_history
        );
      }
    })();

    // 7. Pull reports
    const pgReports = await pool.query(
      'SELECT id, interview_id, json, model, reviewed_by, reviewer_note, manual_decision, created_at FROM reports'
    );
    const updateRepStmt = db.prepare(`
      INSERT INTO reports (id, interview_id, json, model, reviewed_by, reviewer_note, manual_decision, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(id) DO UPDATE SET
        json = COALESCE(excluded.json, reports.json),
        model = COALESCE(excluded.model, reports.model),
        reviewed_by = COALESCE(excluded.reviewed_by, reports.reviewed_by),
        reviewer_note = COALESCE(excluded.reviewer_note, reports.reviewer_note),
        manual_decision = COALESCE(excluded.manual_decision, reports.manual_decision)
    `);
    db.transaction(() => {
      for (const r of pgReports.rows) {
        updateRepStmt.run(
          r.id, r.interview_id,
          typeof r.json === 'object' ? JSON.stringify(r.json) : r.json,
          r.model || 'gemini-1.5-flash',
          r.reviewed_by, r.reviewer_note, r.manual_decision,
          r.created_at || new Date().toISOString()
        );
      }
    })();

    // 8. Pull turns
    const pgTurns = await pool.query(
      'SELECT interview_id, idx, role, text, skill, created_at FROM turns'
    );
    const updateTurnStmt = db.prepare(`
      INSERT OR IGNORE INTO turns (interview_id, idx, role, text, skill, created_at)
      VALUES (?, ?, ?, ?, ?, ?)
    `);
    db.transaction(() => {
      for (const t of pgTurns.rows) {
        updateTurnStmt.run(t.interview_id, t.idx, t.role, t.text, t.skill, t.created_at);
      }
    })();

    return {
      success: true,
      pulled: {
        users: pgUsers.rowCount,
        orgs: pgOrgs.rowCount,
        settings: pgSettings.rowCount,
        jobs: pgJobs.rowCount,
        candidates: pgCandidates.rowCount,
        interviews: pgInterviews.rowCount,
        reports: pgReports.rowCount
      }
    };
  } catch (err) {
    console.warn('⚠️ Supabase Pull Sync Notice:', err.message);
    return { success: false, error: err.message };
  }
}

/**
 * Pushes new local backend records to Supabase PostgreSQL.
 * Ensures all candidates, interviews, reports, and activities are always live in Supabase.
 */
export async function pushToSupabase() {
  if (!process.env.DATABASE_URL) return;
  const pool = getPostgresPool();

  try {
    // 1. Push new candidates
    const sqliteCandidates = db.prepare('SELECT * FROM candidates').all();
    for (const c of sqliteCandidates) {
      await pool.query(`
        INSERT INTO candidates (id, org_id, name, email, phone, source, resume_text, created_at)
        VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
        ON CONFLICT (id) DO UPDATE SET
          name = EXCLUDED.name,
          email = EXCLUDED.email
      `, [c.id, c.org_id, c.name, c.email, c.phone, c.source || 'direct', c.resume_text, c.created_at]);
    }

    // 2. Push new interviews
    const sqliteInterviews = db.prepare('SELECT * FROM interviews').all();
    for (const i of sqliteInterviews) {
      // Ensure job exists
      await pool.query(
        'INSERT INTO jobs (id, org_id, title, jd_text, skills, qualifications) VALUES ($1, $2, $3, $4, $5, $6) ON CONFLICT (id) DO NOTHING',
        [i.job_id, 'org_default', 'Interview Role', 'Technical interview position description', 'General', 'Relevant experience']
      );
      // Ensure candidate exists
      await pool.query(
        'INSERT INTO candidates (id, org_id, name, email) VALUES ($1, $2, $3, $4) ON CONFLICT (id) DO NOTHING',
        [i.candidate_id, 'org_default', 'Candidate', 'candidate@auto.internal']
      );
      await pool.query(`
        INSERT INTO interviews (
          id, job_id, candidate_id, token_hash, state, started_at, ended_at, expires_at,
          link_timer_minutes, show_timer, auto_submit_timer, proctor_warnings, disqualified_reason,
          proctor_logs, dispatch_status, dispatch_channel, source, dsa_result, code_draft, code_lang, code_history
        ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18, $19, $20, $21)
        ON CONFLICT (id) DO UPDATE SET
          state = EXCLUDED.state,
          started_at = EXCLUDED.started_at,
          ended_at = EXCLUDED.ended_at,
          proctor_warnings = EXCLUDED.proctor_warnings,
          disqualified_reason = EXCLUDED.disqualified_reason
      `, [
        i.id, i.job_id, i.candidate_id, i.token_hash, i.state, i.started_at, i.ended_at, i.expires_at,
        i.link_timer_minutes, i.show_timer, i.auto_submit_timer, i.proctor_warnings, i.disqualified_reason,
        safeJson(i.proctor_logs), i.dispatch_status, i.dispatch_channel, i.source, safeJson(i.dsa_result),
        i.code_draft, i.code_lang, safeJson(i.code_history)
      ]);
    }

    // 3. Push new reports
    const sqliteReports = db.prepare('SELECT * FROM reports').all();
    for (const r of sqliteReports) {
      // Verify interview exists in Supabase
      const iv = await pool.query('SELECT id FROM interviews WHERE id = $1', [r.interview_id]);
      if (iv.rows.length === 0) continue;

      await pool.query(`
        INSERT INTO reports (id, interview_id, json, model, created_at)
        VALUES ($1, $2, $3, $4, $5)
        ON CONFLICT (id) DO NOTHING
      `, [
        r.id, r.interview_id, safeJson(r.raw_json || r.json), r.model || 'gemini-1.5-pro', r.created_at
      ]);
    }

    return { success: true };
  } catch (err) {
    console.warn('⚠️ Supabase Push Sync Notice:', err.message);
    return { success: false, error: err.message };
  }
}

/**
 * Runs a complete two-way sync between backend and Supabase
 */
export async function syncSupabase() {
  if (isSyncing) return;
  isSyncing = true;
  try {
    await pullFromSupabase();
    await pushToSupabase();
  } finally {
    isSyncing = false;
  }
}

/**
 * Starts continuous live sync every N milliseconds (default: 20 seconds)
 */
export function startSupabaseLiveSync(intervalMs = 20000) {
  if (!process.env.DATABASE_URL) return;
  console.log(`📡 Supabase Live Sync activated (polling changes every ${intervalMs / 1000}s)`);
  
  // Initial sync on boot
  syncSupabase().catch(err => console.warn('Initial Supabase sync error:', err.message));

  if (syncInterval) clearInterval(syncInterval);
  syncInterval = setInterval(() => {
    syncSupabase().catch(err => console.warn('Supabase sync tick error:', err.message));
  }, intervalMs);

  return syncInterval;
}

function safeJson(val) {
  if (val === null || val === undefined || val === '') return null;
  if (typeof val === 'object') return val;
  try { return JSON.parse(val); } catch (_) { return val; }
}
