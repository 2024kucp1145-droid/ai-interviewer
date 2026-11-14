import 'dotenv/config';
import bcrypt from 'bcryptjs';
import Database from 'better-sqlite3';
import pg from 'pg';

const { Client } = pg;
const sqlite = new Database('ai_interviewer.db');

const email = 'fealyourfear99@gmail.com';
const fullName = 'Aditya';
const adminUid = 'ADM-ADITYA-1001';
const rawPassword = 'FEALYOURFEAR@99';
const passwordHash = bcrypt.hashSync(rawPassword, 10);
const orgId = 'org_platform_admins';
const userId = 'usr_adm_aditya_superadmin';

console.log('--- Creating Superadmin Account ---');

// 1. SQLite
sqlite.prepare(`
  INSERT OR IGNORE INTO organizations (id, name, industry, plan, included_interviews)
  VALUES (?, 'Platform Operations & Administration', 'Platform Management', 'enterprise', 999999)
`).run(orgId);

sqlite.prepare(`
  INSERT INTO users (
    id, org_id, full_name, job_title, email, password_hash, role, admin_uid, is_verified, approval_status, last_login_at
  ) VALUES (?, ?, ?, 'Platform Administrator', ?, ?, 'superadmin', ?, 1, 'approved', CURRENT_TIMESTAMP)
  ON CONFLICT(email) DO UPDATE SET
    role = 'superadmin',
    admin_uid = EXCLUDED.admin_uid,
    password_hash = EXCLUDED.password_hash,
    approval_status = 'approved',
    is_verified = 1
`).run(userId, orgId, fullName, email, passwordHash, adminUid);

const sqliteUser = sqlite.prepare('SELECT id, full_name, email, role, admin_uid FROM users WHERE email = ?').get(email);
console.log('✅ SQLite Admin Ready:', sqliteUser);

// 2. Supabase PostgreSQL
if (process.env.DATABASE_URL) {
  const pgClient = new Client({ connectionString: process.env.DATABASE_URL, ssl: { rejectUnauthorized: false } });
  await pgClient.connect();

  await pgClient.query(`
    INSERT INTO organizations (id, name, industry, plan, included_interviews)
    VALUES ($1, 'Platform Operations & Administration', 'Platform Management', 'enterprise', 999999)
    ON CONFLICT (id) DO NOTHING
  `, [orgId]);

  await pgClient.query(`
    INSERT INTO users (
      id, org_id, full_name, job_title, email, password_hash, role, admin_uid, is_verified, approval_status, last_login_at
    ) VALUES ($1, $2, $3, 'Platform Administrator', $4, $5, 'superadmin', $6, 1, 'approved', CURRENT_TIMESTAMP)
    ON CONFLICT (email) DO UPDATE SET
      role = 'superadmin',
      admin_uid = EXCLUDED.admin_uid,
      password_hash = EXCLUDED.password_hash,
      approval_status = 'approved',
      is_verified = 1
  `, [userId, orgId, fullName, email, passwordHash, adminUid]);

  const res = await pgClient.query('SELECT id, full_name, email, role, admin_uid FROM users WHERE email = $1', [email]);
  console.log('✅ Supabase PostgreSQL Admin Ready:', res.rows[0]);
  await pgClient.end();
}

console.log('\n🎉 Superadmin account is ready in both SQLite and Supabase PostgreSQL!');
console.log('Login credentials:');
console.log(' - Name:            ', fullName);
console.log(' - Unique Admin ID: ', adminUid);
console.log(' - Email:           ', email);
console.log(' - Password:        ', rawPassword);
