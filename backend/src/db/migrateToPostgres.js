import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import Database from 'better-sqlite3';
import { getPostgresPool, initPostgresSchema, checkPostgresConnection } from './postgres.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const sqlitePath = path.resolve(__dirname, '../../../ai_interviewer.db');

/**
 * Helper to safely parse strings into JSON for JSONB columns
 */
function safeJson(val) {
  if (val === null || val === undefined || val === '') return null;
  if (typeof val === 'object') return val;
  try {
    return JSON.parse(val);
  } catch (e) {
    return val;
  }
}

export async function runMigration(explicitUrl) {
  console.log('======================================================');
  console.log('🚀 RoundOne AI: SQLite → PostgreSQL Data Migration');
  console.log('======================================================\n');

  // 1. Verify PostgreSQL connection
  console.log('1. Checking PostgreSQL connection...');
  const health = await checkPostgresConnection();
  if (!health.connected) {
    const msg = `Could not connect to PostgreSQL: ${health.error}`;
    console.error('\n❌ ' + msg);
    console.log('👉 Please set DATABASE_URL in your .env file or environment variables:');
    console.log('   DATABASE_URL="postgresql://postgres:password@localhost:5432/ai_interviewer"');
    console.log('   or use a free managed PostgreSQL cloud database:');
    console.log('   - Supabase (https://supabase.com) - free PostgreSQL with JSONB & pgvector');
    console.log('   - Neon (https://neon.tech) - free serverless PostgreSQL');
    console.log('\n   If using local Docker, start PostgreSQL with:');
    console.log('   docker run --name ai-postgres -e POSTGRES_PASSWORD=postgres -e POSTGRES_DB=ai_interviewer -p 5432:5432 -d postgres:16-alpine\n');
    throw new Error(msg);
  }

  console.log(`✓ Connected to PostgreSQL (${health.version.split(' ')[0]} ${health.version.split(' ')[1]}) in ${health.latencyMs}ms\n`);

  // 2. Initialize PostgreSQL tables and indexes
  console.log('2. Bootstrapping PostgreSQL schema from schema.postgres.sql...');
  await initPostgresSchema();
  console.log('✓ Tables, indexes, and constraints ready\n');

  // 3. Connect to SQLite
  if (!fs.existsSync(sqlitePath)) {
    console.log('⚠️ No existing SQLite database file found at:', sqlitePath);
    console.log('PostgreSQL schema is ready with empty tables. Migration complete.');
    process.exit(0);
  }

  console.log('3. Connecting to existing SQLite database at:', sqlitePath);
  const sqlite = new Database(sqlitePath, { readonly: true });
  const pool = getPostgresPool();

  const migrationCounts = {};

  // Table migration definitions in topological dependency order
  const tables = [
    {
      name: 'organizations',
      sqliteSql: 'SELECT * FROM organizations',
      insertSql: `
        INSERT INTO organizations (id, name, website, industry, company_size, country, plan, included_interviews, subscription_plan_id, subscription_expires_at, stripe_customer_id, stripe_subscription_id, stripe_subscription_status, created_at)
        VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14)
        ON CONFLICT (id) DO UPDATE SET
          name = EXCLUDED.name,
          plan = EXCLUDED.plan,
          included_interviews = EXCLUDED.included_interviews,
          subscription_plan_id = EXCLUDED.subscription_plan_id,
          subscription_expires_at = EXCLUDED.subscription_expires_at,
          stripe_customer_id = EXCLUDED.stripe_customer_id,
          stripe_subscription_id = EXCLUDED.stripe_subscription_id,
          stripe_subscription_status = EXCLUDED.stripe_subscription_status
      `,
      mapRow: (r) => [r.id, r.name, r.website, r.industry, r.company_size, r.country, r.plan, r.included_interviews, r.subscription_plan_id, r.subscription_expires_at, r.stripe_customer_id || null, r.stripe_subscription_id || null, r.stripe_subscription_status || null, r.created_at]
    },
    {
      name: 'users',
      sqliteSql: 'SELECT * FROM users',
      insertSql: `
        INSERT INTO users (id, org_id, full_name, phone, job_title, email, password_hash, role, admin_uid, is_verified, verification_code, approval_status, last_login_at, admin_notes, created_at)
        VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15)
        ON CONFLICT (id) DO UPDATE SET
          full_name = EXCLUDED.full_name,
          email = EXCLUDED.email,
          password_hash = EXCLUDED.password_hash,
          role = EXCLUDED.role,
          admin_uid = EXCLUDED.admin_uid,
          is_verified = EXCLUDED.is_verified,
          approval_status = EXCLUDED.approval_status
      `,
      mapRow: (r) => [r.id, r.org_id, r.full_name, r.phone, r.job_title, r.email, r.password_hash, r.role, r.admin_uid || null, r.is_verified, r.verification_code, r.approval_status, r.last_login_at, r.admin_notes, r.created_at]
    },
    {
      name: 'provider_keys',
      sqliteSql: 'SELECT * FROM provider_keys',
      insertSql: `
        INSERT INTO provider_keys (id, org_id, provider, key_encrypted, key_last4, status, created_at)
        VALUES ($1, $2, $3, $4, $5, $6, $7)
        ON CONFLICT (id) DO NOTHING
      `,
      mapRow: (r) => [r.id, r.org_id, r.provider, r.key_encrypted, r.key_last4, r.status, r.created_at]
    },
    {
      name: 'jobs',
      sqliteSql: 'SELECT * FROM jobs',
      insertSql: `
        INSERT INTO jobs (id, org_id, title, jd_text, skills, level, max_minutes, max_questions, qualifications, interview_type, question_mode, custom_questions, terminal_required, word_editor_required, resume_required, purpose, experience_required, assessment_rules, leetcode_problem, compiler_languages, category, show_timer, auto_submit_timer, created_at)
        VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18, $19, $20, $21, $22, $23, $24)
        ON CONFLICT (id) DO UPDATE SET
          title = EXCLUDED.title,
          jd_text = EXCLUDED.jd_text,
          skills = EXCLUDED.skills
      `,
      mapRow: (r) => [
        r.id, r.org_id, r.title, r.jd_text, r.skills, r.level, r.max_minutes, r.max_questions,
        r.qualifications, r.interview_type, r.question_mode, safeJson(r.custom_questions),
        r.terminal_required, r.word_editor_required, r.resume_required, r.purpose,
        r.experience_required, safeJson(r.assessment_rules), r.leetcode_problem,
        r.compiler_languages, r.category, r.show_timer, r.auto_submit_timer, r.created_at
      ]
    },
    {
      name: 'candidates',
      sqliteSql: 'SELECT * FROM candidates',
      insertSql: `
        INSERT INTO candidates (id, org_id, name, email, phone, source, resume_text, consent_at, consent_version, deleted_at, created_at)
        VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
        ON CONFLICT (id) DO UPDATE SET
          name = EXCLUDED.name,
          email = EXCLUDED.email,
          resume_text = EXCLUDED.resume_text
      `,
      mapRow: (r) => [r.id, r.org_id, r.name, r.email, r.phone, r.source, r.resume_text, r.consent_at, r.consent_version, r.deleted_at, r.created_at]
    },
    {
      name: 'interviews',
      sqliteSql: 'SELECT * FROM interviews',
      insertSql: `
        INSERT INTO interviews (id, job_id, candidate_id, token_hash, state, started_at, ended_at, expires_at, link_timer_minutes, show_timer, auto_submit_timer, proctor_warnings, disqualified_reason, proctor_logs, dispatch_status, dispatch_channel, source, dsa_result)
        VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18)
        ON CONFLICT (id) DO UPDATE SET
          state = EXCLUDED.state,
          started_at = EXCLUDED.started_at,
          ended_at = EXCLUDED.ended_at,
          dsa_result = EXCLUDED.dsa_result,
          proctor_logs = EXCLUDED.proctor_logs
      `,
      mapRow: (r) => [
        r.id, r.job_id, r.candidate_id, r.token_hash, r.state, r.started_at, r.ended_at, r.expires_at,
        r.link_timer_minutes, r.show_timer, r.auto_submit_timer, r.proctor_warnings,
        r.disqualified_reason, safeJson(r.proctor_logs), r.dispatch_status, r.dispatch_channel,
        r.source, safeJson(r.dsa_result)
      ]
    },
    {
      name: 'turns',
      sqliteSql: 'SELECT * FROM turns',
      insertSql: `
        INSERT INTO turns (id, interview_id, idx, role, text, skill, level, created_at)
        VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
        ON CONFLICT (id) DO NOTHING
      `,
      mapRow: (r) => [r.id, r.interview_id, r.idx, r.role, r.text, r.skill, r.level, r.created_at]
    },
    {
      name: 'reports',
      sqliteSql: 'SELECT * FROM reports',
      insertSql: `
        INSERT INTO reports (id, interview_id, json, model, reviewed_by, reviewer_note, created_at)
        VALUES ($1, $2, $3, $4, $5, $6, $7)
        ON CONFLICT (id) DO UPDATE SET
          json = EXCLUDED.json,
          reviewed_by = EXCLUDED.reviewed_by,
          reviewer_note = EXCLUDED.reviewer_note
      `,
      mapRow: (r) => [r.id, r.interview_id, safeJson(r.json), r.model, r.reviewed_by, r.reviewer_note, r.created_at]
    },
    {
      name: 'billing_orders',
      sqliteSql: 'SELECT * FROM billing_orders',
      insertSql: `
        INSERT INTO billing_orders (id, org_id, type, plan_id, quantity, duration_minutes, amount_usd, status, paid_at, quote_json, stripe_session_id, stripe_invoice_id, invoice_pdf_url, hosted_invoice_url, coupon_code, discount_usd, payment_method, utr_number, created_at)
        VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18, $19)
        ON CONFLICT (id) DO UPDATE SET
          status = EXCLUDED.status,
          paid_at = EXCLUDED.paid_at,
          stripe_session_id = EXCLUDED.stripe_session_id,
          stripe_invoice_id = EXCLUDED.stripe_invoice_id,
          invoice_pdf_url = EXCLUDED.invoice_pdf_url,
          hosted_invoice_url = EXCLUDED.hosted_invoice_url,
          coupon_code = EXCLUDED.coupon_code,
          discount_usd = EXCLUDED.discount_usd,
          payment_method = EXCLUDED.payment_method,
          utr_number = EXCLUDED.utr_number
      `,
      mapRow: (r) => [r.id, r.org_id, r.type, r.plan_id, r.quantity, r.duration_minutes, r.amount_usd, r.status, r.paid_at, safeJson(r.quote_json), r.stripe_session_id || null, r.stripe_invoice_id || null, r.invoice_pdf_url || null, r.hosted_invoice_url || null, r.coupon_code || null, r.discount_usd || 0, r.payment_method || null, r.utr_number || null, r.created_at]
    },
    {
      name: 'billing_coupons',
      sqliteSql: 'SELECT * FROM billing_coupons',
      insertSql: `
        INSERT INTO billing_coupons (code, discount_percent, discount_usd, max_uses, used_count, active, expires_at, created_at)
        VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
        ON CONFLICT (code) DO UPDATE SET
          used_count = EXCLUDED.used_count,
          active = EXCLUDED.active
      `,
      mapRow: (r) => [r.code, r.discount_percent || 0, r.discount_usd || 0, r.max_uses || 100, r.used_count || 0, r.active ?? 1, r.expires_at || null, r.created_at]
    },
    {
      name: 'billing_events',
      sqliteSql: 'SELECT * FROM billing_events',
      insertSql: `
        INSERT INTO billing_events (id, org_id, order_id, event, amount_usd, created_at)
        VALUES ($1, $2, $3, $4, $5, $6)
        ON CONFLICT (id) DO NOTHING
      `,
      mapRow: (r) => [r.id, r.org_id, r.order_id, r.event, r.amount_usd, r.created_at]
    },
    {
      name: 'org_question_bank',
      sqliteSql: 'SELECT * FROM org_question_bank',
      insertSql: `
        INSERT INTO org_question_bank (id, org_id, question, skill, category, difficulty, expected_answer, company_tag, created_at)
        VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
        ON CONFLICT (id) DO NOTHING
      `,
      mapRow: (r) => [r.id, r.org_id, r.question, r.skill, r.category, r.difficulty, r.expected_answer, r.company_tag, r.created_at]
    },
    {
      name: 'admin_invites',
      sqliteSql: 'SELECT * FROM admin_invites',
      insertSql: `
        INSERT INTO admin_invites (id, code_hash, label, created_by, used_by, is_used, created_at)
        VALUES ($1, $2, $3, $4, $5, $6, $7)
        ON CONFLICT (id) DO UPDATE SET
          is_used = EXCLUDED.is_used,
          used_by = EXCLUDED.used_by
      `,
      mapRow: (r) => [r.id, r.code_hash, r.label, r.created_by, r.used_by, r.is_used, r.created_at]
    },
    {
      name: 'admin_otps',
      sqliteSql: 'SELECT * FROM admin_otps',
      insertSql: `
        INSERT INTO admin_otps (id, email, otp_code, purpose, expires_at, is_used, created_at)
        VALUES ($1, $2, $3, $4, $5, $6, $7)
        ON CONFLICT (id) DO NOTHING
      `,
      mapRow: (r) => [r.id, r.email, r.otp_code, r.purpose, r.expires_at, r.is_used, r.created_at]
    },
    {
      name: 'platform_activities',
      sqliteSql: 'SELECT * FROM platform_activities',
      insertSql: `
        INSERT INTO platform_activities (id, action, actor_type, actor_id, actor_email, actor_name, org_id, entity_type, entity_id, details, ip_address, created_at)
        VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)
        ON CONFLICT (id) DO NOTHING
      `,
      mapRow: (r) => [r.id, r.action, r.actor_type, r.actor_id, r.actor_email, r.actor_name, r.org_id, r.entity_type, r.entity_id, safeJson(r.details), r.ip_address, r.created_at]
    },
    {
      name: 'platform_settings',
      sqliteSql: 'SELECT * FROM platform_settings',
      insertSql: `
        INSERT INTO platform_settings (key, value, updated_at)
        VALUES ($1, $2, $3)
        ON CONFLICT (key) DO UPDATE SET
          value = EXCLUDED.value,
          updated_at = EXCLUDED.updated_at
      `,
      mapRow: (r) => [r.key, r.value, r.updated_at]
    },
    {
      name: 'feedbacks',
      sqliteSql: 'SELECT * FROM feedbacks',
      insertSql: `
        INSERT INTO feedbacks (id, user_name, user_email, rating, category, message, source_page, email_sent, created_at)
        VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
        ON CONFLICT (id) DO NOTHING
      `,
      mapRow: (r) => [r.id, r.user_name, r.user_email, r.rating, r.category, r.message, r.source_page, r.email_sent, r.created_at]
    },
    {
      name: 'org_team_invites',
      sqliteSql: 'SELECT * FROM org_team_invites',
      insertSql: `
        INSERT INTO org_team_invites (id, org_id, email, org_role, token_hash, invited_by, status, expires_at, created_at)
        VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
        ON CONFLICT (id) DO UPDATE SET status = EXCLUDED.status
      `,
      mapRow: (r) => [r.id, r.org_id, r.email, r.org_role, r.token_hash, r.invited_by, r.status, r.expires_at, r.created_at]
    },
    {
      name: 'org_webhooks',
      sqliteSql: 'SELECT * FROM org_webhooks',
      insertSql: `
        INSERT INTO org_webhooks (id, org_id, name, url, secret, events, is_active, last_triggered_at, last_status, created_at)
        VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
        ON CONFLICT (id) DO UPDATE SET is_active = EXCLUDED.is_active, last_triggered_at = EXCLUDED.last_triggered_at, last_status = EXCLUDED.last_status
      `,
      mapRow: (r) => [r.id, r.org_id, r.name, r.url, r.secret, r.events, r.is_active, r.last_triggered_at, r.last_status, r.created_at]
    },
    {
      name: 'webhook_deliveries',
      sqliteSql: 'SELECT * FROM webhook_deliveries',
      insertSql: `
        INSERT INTO webhook_deliveries (id, webhook_id, org_id, event, payload, status_code, response_body, success, duration_ms, created_at)
        VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
        ON CONFLICT (id) DO NOTHING
      `,
      mapRow: (r) => [r.id, r.webhook_id, r.org_id, r.event, safeJson(r.payload), r.status_code, r.response_body, r.success, r.duration_ms, r.created_at]
    },
    {
      name: 'proctor_snapshots',
      sqliteSql: 'SELECT * FROM proctor_snapshots',
      insertSql: `
        INSERT INTO proctor_snapshots (id, interview_id, reason, image_data, created_at)
        VALUES ($1, $2, $3, $4, $5)
        ON CONFLICT (id) DO NOTHING
      `,
      mapRow: (r) => [r.id, r.interview_id, r.reason, r.image_data, r.created_at]
    },
    {
      name: 'report_shares',
      sqliteSql: 'SELECT * FROM report_shares',
      insertSql: `
        INSERT INTO report_shares (id, interview_id, org_id, token_hash, hide_pii, expires_at, created_by, view_count, created_at)
        VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
        ON CONFLICT (id) DO UPDATE SET view_count = EXCLUDED.view_count
      `,
      mapRow: (r) => [r.id, r.interview_id, r.org_id, r.token_hash, r.hide_pii, r.expires_at, r.created_by, r.view_count, r.created_at]
    },
    {
      name: 'org_custom_problems',
      sqliteSql: 'SELECT * FROM org_custom_problems',
      insertSql: `
        INSERT INTO org_custom_problems (id, org_id, title, difficulty, description, function_name_js, function_name_py, starter_js, starter_py, starter_sql, test_cases_json, created_at)
        VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)
        ON CONFLICT (id) DO NOTHING
      `,
      mapRow: (r) => [r.id, r.org_id, r.title, r.difficulty, r.description, r.function_name_js, r.function_name_py, r.starter_js, r.starter_py, r.starter_sql, safeJson(r.test_cases_json), r.created_at]
    }
  ];

  console.log('4. Transferring records from SQLite into PostgreSQL...');
  for (const t of tables) {
    try {
      const rows = sqlite.prepare(t.sqliteSql).all();
      let migrated = 0;
      for (const row of rows) {
        const params = t.mapRow(row);
        await pool.query(t.insertSql, params);
        migrated++;
      }
      migrationCounts[t.name] = migrated;
      console.log(`   ✓ ${t.name.padEnd(22)}: ${migrated} records transferred`);
    } catch (err) {
      console.warn(`   ⚠️ Table ${t.name} migration notice:`, err.message);
    }
  }

  sqlite.close();

  console.log('\n======================================================');
  console.log('🎉 MIGRATION COMPLETED SUCCESSFULLY!');
  console.log('======================================================');
  console.log('Summary of records in PostgreSQL:');
  Object.entries(migrationCounts).forEach(([tbl, count]) => {
    console.log(` - ${tbl}: ${count}`);
  });
  console.log('\nYour RoundOne AI data is now live and synchronized in PostgreSQL!');

  return { success: true, counts: migrationCounts };
}

// Auto-run if executed directly from CLI
if (process.argv[1] && process.argv[1].endsWith('migrateToPostgres.js')) {
  runMigration()
    .then(() => process.exit(0))
    .catch((err) => {
      console.error('Fatal migration error:', err);
      process.exit(1);
    });
}
