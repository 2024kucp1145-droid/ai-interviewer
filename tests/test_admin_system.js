import assert from 'assert';
import { db, initDatabase } from '../backend/src/db/database.js';
import { generateAndSendAdminOtp, verifyAdminOtp } from '../backend/src/services/adminOtpService.js';
import { logActivity, getActivities } from '../backend/src/services/activityService.js';
import { signToken } from '../backend/src/auth/auth.js';
import { requireAdmin } from '../backend/src/admin/adminRoutes.js';

console.log('--- Testing Unlimited Multi-Admin Auth & Unique ID System ---\n');

initDatabase();

const createdEmails = [];
const createdUserIds = [];
const createdActivityIds = [];
const port = 3001;
const baseUrl = `http://127.0.0.1:${port}`;

try {
  // 1. Verify Clean Database State (No hardcoded seeded admins, unlimited seats)
  console.log('1. Verifying clean database state & unlimited admin setting...');
  const maxSeatsSetting = db.prepare("SELECT value FROM platform_settings WHERE key = 'max_admin_seats'").get();
  assert.strictEqual(maxSeatsSetting?.value, 'unlimited', 'max_admin_seats must be unlimited');
  const invites = db.prepare('SELECT * FROM admin_invites').all();
  assert.strictEqual(invites.length, 0, 'Must not pre-seed any hardcoded admin invite codes');
  const seededOldAdmin = db.prepare("SELECT id FROM users WHERE email = 'adityavyamawar@gmail.com'").get();
  assert.strictEqual(seededOldAdmin, undefined, 'Must not auto-seed adityavyamawar@gmail.com');
  console.log('   ✓ Clean DB initialization & unlimited admin setting PASSED\n');

  // 2. Test Admin OTP Generation & Verification
  console.log('2. Testing Admin Email OTP Generation & Verification...');
  const testEmail = `otp_unit_${Date.now()}@platform.internal`;
  createdEmails.push(testEmail);
  const otpResult = await generateAndSendAdminOtp(testEmail, 'signup_verify', 'Chief Admin');
  assert(otpResult.success, 'OTP generation must succeed');

  const otpRow = db.prepare('SELECT otp_code FROM admin_otps WHERE email = ? AND is_used = 0 ORDER BY created_at DESC LIMIT 1').get(testEmail);
  const activeCode = otpRow?.otp_code || otpResult.devOtp;
  assert(activeCode, 'Active OTP must exist in database');
  assert.strictEqual(activeCode.length, 6, 'OTP must be 6 digits');

  assert.strictEqual(verifyAdminOtp(testEmail, '000000', 'signup_verify').valid, false, 'Wrong OTP must be rejected');
  assert.strictEqual(verifyAdminOtp(testEmail, activeCode, 'signup_verify').valid, true, 'Correct OTP must be accepted');
  assert.strictEqual(verifyAdminOtp(testEmail, activeCode, 'signup_verify').valid, false, 'Used OTP must not be accepted again');
  console.log('   ✓ Admin OTP lifecycle (generation, verification, single-use) PASSED\n');

  // 3. Test Unlimited Admin Signup (>3 admins), Readable Unique ID, and Name+ID Login via HTTP
  console.log('3. Testing Unlimited Admin Signups (4 admins) & Name + ID Login Flow...');
  const statusRes = await fetch(`${baseUrl}/api/admin/auth/status`);
  assert.strictEqual(statusRes.status, 200);
  const statusData = await statusRes.json();
  assert.strictEqual(statusData.unlimited, true, 'Auth status must report unlimited admins');

  const registeredAdmins = [];
  for (let i = 1; i <= 4; i++) {
    const email = `admin_multi_${i}_${Date.now()}@platform.internal`;
    const fullName = `Admin Tester ${i}`;
    const password = 'StrongPassword123!';
    createdEmails.push(email);

    const reqRes = await fetch(`${baseUrl}/api/admin/auth/register-request`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ fullName, email, password })
    });
    assert.strictEqual(reqRes.status, 200, `Signup request #${i} must succeed without 3-seat cap`);

    const regOtp = db.prepare("SELECT otp_code FROM admin_otps WHERE email = ? AND purpose = 'signup_verify' AND is_used = 0 ORDER BY created_at DESC LIMIT 1").get(email);
    assert(regOtp?.otp_code, `Signup OTP for admin #${i} must exist`);

    const verRes = await fetch(`${baseUrl}/api/admin/auth/register-verify`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ fullName, email, password, otp: regOtp.otp_code })
    });
    assert.strictEqual(verRes.status, 200, `Signup verify #${i} must succeed`);
    const verData = await verRes.json();
    assert(verData.token, 'JWT token must be issued');
    assert(verData.adminUid && verData.adminUid.startsWith('ADM-'), `Readable Unique ID must be generated (got ${verData.adminUid})`);
    assert.strictEqual(verData.user.role, 'superadmin');

    createdUserIds.push(verData.user.id);
    registeredAdmins.push({ ...verData.user, fullName, email, adminUid: verData.adminUid, token: verData.token });
  }
  console.log(`   ✓ Registered 4 admins cleanly (Sample ID: ${registeredAdmins[0].adminUid})\n`);

  // Verify wrong Name with valid Unique ID fails
  const targetAdmin = registeredAdmins[0];
  const badNameRes = await fetch(`${baseUrl}/api/admin/auth/login-request`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ name: 'Wrong Person', adminId: targetAdmin.adminUid })
  });
  assert.strictEqual(badNameRes.status, 401, 'Mismatched Name must fail login-request');

  // Verify valid Name + Unique ID sends OTP to linked email
  const loginReqRes = await fetch(`${baseUrl}/api/admin/auth/login-request`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ name: targetAdmin.fullName, adminId: targetAdmin.adminUid })
  });
  assert.strictEqual(loginReqRes.status, 200, 'Valid Name + Unique ID must succeed');
  const loginReqData = await loginReqRes.json();
  assert.strictEqual(loginReqData.devOtp, undefined, 'devOtp must never leak in login response');
  assert(loginReqData.emailHint && loginReqData.emailHint.includes('@'), 'Masked emailHint must be returned');

  const loginOtpRow = db.prepare("SELECT otp_code FROM admin_otps WHERE email = ? AND purpose = 'login_verify' AND is_used = 0 ORDER BY created_at DESC LIMIT 1").get(targetAdmin.email);
  assert(loginOtpRow?.otp_code, 'Login OTP must be stored for the admin linked email');

  const loginVerRes = await fetch(`${baseUrl}/api/admin/auth/login-verify`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ adminId: targetAdmin.adminUid, otp: loginOtpRow.otp_code })
  });
  assert.strictEqual(loginVerRes.status, 200, 'Valid OTP verify must return admin session token');
  const loginVerData = await loginVerRes.json();
  assert(loginVerData.token, 'Login verify must return token');
  assert.strictEqual(loginVerData.user.admin_uid, targetAdmin.adminUid);

  // Verify all signed-up admins can access admin portal endpoints
  for (const adm of registeredAdmins) {
    const meRes = await fetch(`${baseUrl}/api/admin/auth/me`, {
      headers: { 'Authorization': `Bearer ${adm.token}` }
    });
    assert.strictEqual(meRes.status, 200, `Admin ${adm.adminUid} must access /auth/me`);
    const teamRes = await fetch(`${baseUrl}/api/admin/team`, {
      headers: { 'Authorization': `Bearer ${adm.token}` }
    });
    assert.strictEqual(teamRes.status, 200, `Admin ${adm.adminUid} must access /team`);
    const teamData = await teamRes.json();
    assert(teamData.admins.length >= 4, 'All registered admins must appear in team list');
  }

  const treeRes = await fetch(`${baseUrl}/api/admin/activity-tree`, {
    headers: { 'Authorization': `Bearer ${registeredAdmins[0].token}` }
  });
  assert.strictEqual(treeRes.status, 200, 'GET /api/admin/activity-tree must return 200');
  const treeData = await treeRes.json();
  assert.strictEqual(treeData.success, true, 'activity-tree response must have success: true');
  assert(Array.isArray(treeData.organizations), 'activity-tree must include organizations array');
  assert(Array.isArray(treeData.directActivities), 'activity-tree must include directActivities array');
  assert(Array.isArray(treeData.feedbacks), 'activity-tree must include feedbacks array');

  console.log('   ✓ Name + Unique ID -> linked Email OTP, /activity-tree & multi-admin portal access PASSED\n');

  // 4. Test Self-Healing requireAdmin on Ephemeral Vercel Restarts & Activity Logging
  console.log('4. Testing Ephemeral Session Persistence & Activity Logging...');
  const prevVercel = process.env.VERCEL;
  process.env.VERCEL = '1';
  try {
    const ephemeralId = 'usr_adm_ephem_' + Date.now();
    const ephemeralEmail = `ephem_${Date.now()}@platform.internal`;
    const ephemeralUid = `ADM-EPHEM-${Math.floor(1000 + Math.random() * 9000)}`;
    createdEmails.push(ephemeralEmail);
    createdUserIds.push(ephemeralId);

    const ephemToken = signToken({
      id: ephemeralId,
      org_id: 'org_platform_admins',
      email: ephemeralEmail,
      full_name: 'Ephemeral Admin',
      admin_uid: ephemeralUid,
      role: 'superadmin'
    });

    let nextCalled = false;
    const mockReq = { headers: { authorization: `Bearer ${ephemToken}` } };
    const mockRes = { status: (c) => ({ json: (b) => { throw new Error(`Unexpected ${c}: ${JSON.stringify(b)}`); } }) };
    requireAdmin(mockReq, mockRes, () => { nextCalled = true; });
    assert.strictEqual(nextCalled, true, 'requireAdmin must rehydrate valid JWT on Vercel cold start instead of logging out');
    assert.strictEqual(mockReq.admin.admin_uid, ephemeralUid);
  } finally {
    if (prevVercel === undefined) delete process.env.VERCEL;
    else process.env.VERCEL = prevVercel;
  }

  const actId = logActivity({
    action: 'USER_SIGNUP',
    actorType: 'user',
    actorId: 'usr_test_123',
    actorEmail: 'recruiter@techcorp.com',
    actorName: 'Jane Recruiter',
    orgId: 'org_test_123',
    details: { companyName: 'TechCorp Global', plan: 'free_trial' }
  });
  createdActivityIds.push(actId);
  assert(actId, 'Activity must be recorded with generated ID');

  const stream = getActivities({ limit: 10 });
  const logged = stream.activities.find(a => a.id === actId);
  assert(logged, 'Newly logged activity must be found in stream');
  assert.strictEqual(logged.details.companyName, 'TechCorp Global');

  const approvalSetting = db.prepare("SELECT value FROM platform_settings WHERE key = 'require_admin_approval'").get();
  assert(approvalSetting, 'Setting require_admin_approval must exist');
  console.log('   ✓ Ephemeral session persistence, activity logging, & settings PASSED\n');

  console.log('====================================================');
  console.log('✅ ALL ADMIN SYSTEM UNIT & HTTP TESTS PASSED!');
  console.log('====================================================\n');
} finally {
  // Clean up synthetic test records so DB stays clean
  for (const id of createdUserIds) {
    db.prepare('DELETE FROM users WHERE id = ?').run(id);
    db.prepare('DELETE FROM platform_activities WHERE actor_id = ? OR entity_id = ?').run(id, id);
  }
  for (const email of createdEmails) {
    db.prepare('DELETE FROM admin_otps WHERE email = ?').run(email);
    db.prepare('DELETE FROM platform_activities WHERE actor_email = ?').run(email);
  }
  for (const actId of createdActivityIds) {
    db.prepare('DELETE FROM platform_activities WHERE id = ?').run(actId);
  }
  db.prepare("DELETE FROM platform_activities WHERE actor_name LIKE 'Admin Tester %'").run();
}
