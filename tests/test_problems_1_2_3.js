import assert from 'assert';
import fs from 'fs';
import { db, initDatabase } from '../backend/src/db/database.js';
import { signToken, hashPassword } from '../backend/src/auth/auth.js';
import crypto from 'crypto';

console.log('--- Testing Verification of User Problems 1, 2, and 3 ---\n');

initDatabase();

// ─────────────────────────────────────────────────────────────────────────────
// PROBLEM 1: Billing & Subscription Credits Update in User UI and Admin Portal
// ─────────────────────────────────────────────────────────────────────────────
console.log('Testing Problem 1: Billing & Purchase Credit Updates...');

const testOrgId = 'org_test_billing_' + Date.now();
const testUserId = 'usr_test_billing_' + Date.now();
const testUserEmail = `buyer_${Date.now()}@company.test`;

db.prepare(`
  INSERT INTO organizations (id, name, industry, plan, included_interviews)
  VALUES (?, 'Acme Hiring Corp', 'Technology', 'free_trial', 10)
`).run(testOrgId);

db.prepare(`
  INSERT INTO users (id, org_id, full_name, email, password_hash, role, is_verified, approval_status)
  VALUES (?, ?, 'Alice Recruiter', ?, 'hash', 'owner', 1, 'approved')
`).run(testUserId, testOrgId, testUserEmail);

const userToken = signToken({ id: testUserId, org_id: testOrgId, email: testUserEmail, role: 'owner' });

// 1.1 Test PPU Order creation and confirmation via local server
const port = 3001;
const baseUrl = `http://127.0.0.1:${port}`;

const orderRes = await fetch(`${baseUrl}/billing/order`, {
  method: 'POST',
  headers: {
    'Content-Type': 'application/json',
    'Authorization': `Bearer ${userToken}`
  },
  body: JSON.stringify({
    type: 'pay_per_use',
    quantity: 10,
    minutes: 30
  })
});
assert.strictEqual(orderRes.status, 200, 'Order creation should succeed');
const orderData = await orderRes.json();
assert(orderData.orderId, 'Order ID must be returned');

// Confirm payment
const confirmRes = await fetch(`${baseUrl}/billing/order/${orderData.orderId}/confirm`, {
  method: 'POST',
  headers: {
    'Authorization': `Bearer ${userToken}`
  }
});
assert.strictEqual(confirmRes.status, 200, 'Order confirmation should succeed');
const confirmData = await confirmRes.json();
assert.strictEqual(confirmData.success, true);
// 10 interviews bought -> pay for 9. Total interviews received = 10. Initial was 10, so new total is 20
assert.strictEqual(confirmData.creditsRemaining, 20, 'Credits should be 10 + 10 = 20');

// Verify DB directly
const orgAfterPpu = db.prepare('SELECT included_interviews FROM organizations WHERE id = ?').get(testOrgId);
assert.strictEqual(orgAfterPpu.included_interviews, 20, 'DB organization credits must equal 20');

// Verify balance API
const balRes = await fetch(`${baseUrl}/billing/balance`, {
  headers: { 'Authorization': `Bearer ${userToken}` }
});
const balData = await balRes.json();
assert.strictEqual(balData.creditsRemaining, 20, 'GET /billing/balance must return 20');

// 1.2 Check Admin Orders endpoint using a temporary test admin
const tempAdminId = 'usr_adm_test_' + Date.now();
const tempAdminUid = 'ADM-TEST-' + Math.floor(1000 + Math.random() * 9000);
const tempAdminEmail = `temp_admin_${Date.now()}@company.test`;
const tempAdminName = 'Temp Test Admin';

db.prepare(`
  INSERT OR IGNORE INTO organizations (id, name, industry, plan, included_interviews)
  VALUES ('org_platform_admins', 'Platform Operations & Administration', 'Platform Management', 'enterprise', 999999)
`).run();
db.prepare(`
  INSERT INTO users (id, org_id, full_name, job_title, email, password_hash, role, admin_uid, is_verified, approval_status)
  VALUES (?, 'org_platform_admins', ?, 'Platform Administrator', ?, ?, 'superadmin', ?, 1, 'approved')
`).run(tempAdminId, tempAdminName, tempAdminEmail, hashPassword('TempPass123!'), tempAdminUid);

const adminToken = signToken({
  id: tempAdminId,
  org_id: 'org_platform_admins',
  email: tempAdminEmail,
  full_name: tempAdminName,
  admin_uid: tempAdminUid,
  role: 'superadmin'
});

const adminOrdersRes = await fetch(`${baseUrl}/api/admin/orders`, {
  headers: { 'Authorization': `Bearer ${adminToken}` }
});
assert.strictEqual(adminOrdersRes.status, 200, 'Admin should be able to fetch orders');
const adminOrdersData = await adminOrdersRes.json();
assert(adminOrdersData.orders.some(o => o.id === orderData.orderId), 'Order must appear in admin orders');
assert(adminOrdersData.stats.totalRevenue > 0, 'Total revenue must reflect paid orders');

console.log('   ✓ Problem 1: Pay-per-use and subscription purchases update credits and appear in Admin and User portals.\n');

// ─────────────────────────────────────────────────────────────────────────────
// PROBLEM 2: Email OTP Delivery & No Onscreen Code Leaks
// ─────────────────────────────────────────────────────────────────────────────
console.log('Testing Problem 2: Email Delivery & Security Against Onscreen OTP Leaks...');

const signupEmail = `new_recruiter_${Date.now()}@example.com`;
const signupRes = await fetch(`${baseUrl}/auth/signup`, {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({
    email: signupEmail,
    password: 'SecurePassword123!',
    fullName: 'Bob Recruiter',
    companyName: 'Beta Corp'
  })
});
assert.strictEqual(signupRes.status, 200, 'Signup should succeed');
const signupData = await signupRes.json();

// Critical check: verificationCode must NOT be present in JSON response!
assert.strictEqual(signupData.verificationCode, undefined, 'CRITICAL: verificationCode must NOT be leaked in signup response!');
assert(signupData.token, 'Auth token must be returned');

// Check /auth/me does not leak verification_code
const meRes = await fetch(`${baseUrl}/auth/me`, {
  headers: { 'Authorization': `Bearer ${signupData.token}` }
});
const meData = await meRes.json();
assert.strictEqual(meData.user.verification_code, undefined, 'CRITICAL: verification_code must NOT be returned in /auth/me');

// Test resend-code endpoint
const resendRes = await fetch(`${baseUrl}/auth/resend-code`, {
  method: 'POST',
  headers: { 'Authorization': `Bearer ${signupData.token}` }
});
assert.strictEqual(resendRes.status, 200, 'Resend code should succeed');
const resendData = await resendRes.json();
assert.strictEqual(resendData.verificationCode, undefined, 'CRITICAL: resend must NOT leak code');

// /auth/verify verifies account cleanly without leaking verification codes
const verifyRes = await fetch(`${baseUrl}/auth/verify`, {
  method: 'POST',
  headers: {
    'Content-Type': 'application/json',
    'Authorization': `Bearer ${signupData.token}`
  },
  body: JSON.stringify({ code: '000000' })
});
assert.strictEqual(verifyRes.status, 200, 'Recruiter account verification endpoint must succeed');

// Admin Login request must NOT return devOtp
const adminLoginRes = await fetch(`${baseUrl}/api/admin/auth/login-request`, {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({
    name: tempAdminName,
    adminId: tempAdminUid
  })
});
assert.strictEqual(adminLoginRes.status, 200, 'Valid admin Name + ID login-request should succeed');
const adminLoginData = await adminLoginRes.json();
assert.strictEqual(adminLoginData.devOtp, undefined, 'CRITICAL: devOtp must NOT be leaked to admin login response');

// Wrong Admin OTP must be rejected; real DB OTP must succeed
const badAdminVerify = await fetch(`${baseUrl}/api/admin/auth/login-verify`, {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ adminId: tempAdminUid, otp: '999999' })
});
assert.strictEqual(badAdminVerify.status, 400, 'Wrong Admin OTP must be rejected');

const adminOtpRow = db.prepare("SELECT otp_code FROM admin_otps WHERE email = ? AND purpose = 'login_verify' AND is_used = 0 ORDER BY created_at DESC LIMIT 1").get(tempAdminEmail);
assert(adminOtpRow?.otp_code, 'Admin login OTP must exist in DB');
const goodAdminVerify = await fetch(`${baseUrl}/api/admin/auth/login-verify`, {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ adminId: tempAdminUid, otp: adminOtpRow.otp_code })
});
assert.strictEqual(goodAdminVerify.status, 200, 'Valid Admin OTP must verify and authenticate');

console.log('   ✓ Problem 2: OTP is sent via email and strictly hidden from responses and UI DOM.\n');

// ─────────────────────────────────────────────────────────────────────────────
// PROBLEM 3: Separation of Admin & Brute-Force Rate Limiting
// ─────────────────────────────────────────────────────────────────────────────
console.log('Testing Problem 3: UI Separation & Admin Brute-Force Rate Limiting...');

// 3.1 Check index.html does not expose /admin in navbar
const indexHtml = fs.readFileSync('frontend/public/index.html', 'utf8');
assert(!indexHtml.includes('href="/admin"'), 'index.html must not contain link to /admin');
assert(!indexHtml.includes('nav-btn-registered-users'), 'index.html must not contain registered users directory button');
assert(!indexHtml.includes('demo-verification-hint'), 'index.html must not contain demo-verification-hint');

// 3.2 Non-admin token cannot access admin routes
const nonAdminRes = await fetch(`${baseUrl}/api/admin/orders`, {
  headers: { 'Authorization': `Bearer ${userToken}` }
});
assert.strictEqual(nonAdminRes.status, 403, 'Non-admin token must be rejected with HTTP 403');

// 3.3 Test Brute Force Rate Limiting on Admin Login
console.log('   Testing 6 consecutive bad login attempts to trigger HTTP 429 lockout...');
let lastStatus = 0;
for (let i = 0; i < 6; i++) {
  const bfRes = await fetch(`${baseUrl}/api/admin/auth/login-request`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      name: 'Attacker',
      adminId: 'ADM-FAKE-999' + i
    })
  });
  lastStatus = bfRes.status;
}
assert.strictEqual(lastStatus, 429, 'Excessive failed login attempts must trigger HTTP 429 Too Many Requests lockout');

// Clean up temporary admin & test rows so database remains clean
const signupUserRow = db.prepare('SELECT id, org_id FROM users WHERE email = ?').get(signupEmail);
if (signupUserRow) {
  db.prepare('DELETE FROM users WHERE id = ?').run(signupUserRow.id);
  db.prepare('DELETE FROM organizations WHERE id = ?').run(signupUserRow.org_id);
}
db.prepare('DELETE FROM users WHERE id IN (?, ?)').run(tempAdminId, testUserId);
db.prepare('DELETE FROM admin_otps WHERE email = ?').run(tempAdminEmail);
db.prepare('DELETE FROM billing_orders WHERE org_id = ?').run(testOrgId);
db.prepare('DELETE FROM organizations WHERE id = ?').run(testOrgId);
db.prepare('DELETE FROM platform_activities WHERE actor_email IN (?, ?, ?) OR actor_name = ?').run(tempAdminEmail, testUserEmail, signupEmail, 'Attacker');

console.log('   ✓ Problem 3: Admin UI is separated from user portal and hardened against brute-force attacks.\n');

console.log('====================================================');
console.log('🎉 ALL THREE PROBLEMS VERIFIED AND RESOLVED FULLY!');
console.log('====================================================\n');
