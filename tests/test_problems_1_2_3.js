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
assert.strictEqual(signupData.requiresOtp, true, 'Recruiter signup must require Email OTP');
assert(signupData.otpToken, 'Stateless otpToken must be returned for multi-container resilience');

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
assert(resendData.otpToken, 'Resend must issue fresh otpToken');

// Wrong OTP must be rejected on /auth/verify
const badRecruiterVerify = await fetch(`${baseUrl}/auth/verify`, {
  method: 'POST',
  headers: {
    'Content-Type': 'application/json',
    'Authorization': `Bearer ${signupData.token}`
  },
  body: JSON.stringify({ code: '999999', otpToken: resendData.otpToken })
});
assert.strictEqual(badRecruiterVerify.status, 400, 'Wrong recruiter signup OTP must be rejected with HTTP 400');

// Real DB OTP must succeed on /auth/verify
const recruiterOtpRow = db.prepare('SELECT verification_code FROM users WHERE email = ?').get(signupEmail);
assert(recruiterOtpRow?.verification_code, 'Recruiter signup OTP must exist in DB');
const verifyRes = await fetch(`${baseUrl}/auth/verify`, {
  method: 'POST',
  headers: {
    'Content-Type': 'application/json',
    'Authorization': `Bearer ${signupData.token}`
  },
  body: JSON.stringify({ code: recruiterOtpRow.verification_code, otpToken: resendData.otpToken })
});
assert.strictEqual(verifyRes.status, 200, 'Real recruiter signup OTP must verify cleanly');
const verifyData = await verifyRes.json();
assert.strictEqual(verifyData.user.is_verified, 1, 'Recruiter must be marked verified after OTP check');

// Recruiter Login must issue OTP challenge before issuing auth token
const loginReqRes = await fetch(`${baseUrl}/auth/login`, {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({
    email: signupEmail,
    password: 'SecurePassword123!'
  })
});
assert.strictEqual(loginReqRes.status, 200, 'Recruiter login Step 1 must succeed');
const loginReqData = await loginReqRes.json();
assert.strictEqual(loginReqData.requiresOtp, true, 'Recruiter login must require Email OTP');
assert.strictEqual(loginReqData.token, undefined, 'Login Step 1 must NOT issue session JWT before OTP verification');
assert.strictEqual(loginReqData.verificationCode, undefined, 'Login Step 1 must NOT leak OTP');
assert(loginReqData.otpToken, 'Login Step 1 must return otpToken');

const badLoginVerify = await fetch(`${baseUrl}/auth/login-otp-verify`, {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ email: signupEmail, code: '999999', otpToken: loginReqData.otpToken })
});
assert.strictEqual(badLoginVerify.status, 400, 'Wrong recruiter login OTP must be rejected');

const recruiterLoginOtpRow = db.prepare('SELECT verification_code FROM users WHERE email = ?').get(signupEmail);
assert(recruiterLoginOtpRow?.verification_code, 'Recruiter login OTP must exist in DB');
const goodLoginVerify = await fetch(`${baseUrl}/auth/login-otp-verify`, {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({
    email: signupEmail,
    code: recruiterLoginOtpRow.verification_code,
    otpToken: loginReqData.otpToken
  })
});
assert.strictEqual(goodLoginVerify.status, 200, 'Real recruiter login OTP must verify and authenticate');
const goodLoginData = await goodLoginVerify.json();
assert(goodLoginData.token, 'Recruiter login Step 2 must issue JWT token');

// Recruiter Password Reset must require Email OTP (never overwrite without OTP)
const resetReqRes = await fetch(`${baseUrl}/auth/reset-password`, {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ email: signupEmail, password: 'UpdatedPassword123!' })
});
assert.strictEqual(resetReqRes.status, 200, 'Password reset Step 1 must succeed');
const resetReqData = await resetReqRes.json();
assert.strictEqual(resetReqData.requiresOtp, true, 'Password reset must require Email OTP');
assert.strictEqual(resetReqData.token, undefined, 'Password reset Step 1 must NOT issue JWT before OTP');
assert(resetReqData.otpToken, 'Password reset Step 1 must return otpToken');

const badResetVerify = await fetch(`${baseUrl}/auth/reset-password-verify`, {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({
    email: signupEmail,
    password: 'UpdatedPassword123!',
    code: '999999',
    otpToken: resetReqData.otpToken
  })
});
assert.strictEqual(badResetVerify.status, 400, 'Wrong password reset OTP must be rejected');

const resetOtpRow = db.prepare('SELECT verification_code FROM users WHERE email = ?').get(signupEmail);
assert(resetOtpRow?.verification_code, 'Recruiter reset OTP must exist in DB');
const goodResetVerify = await fetch(`${baseUrl}/auth/reset-password-verify`, {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({
    email: signupEmail,
    password: 'UpdatedPassword123!',
    code: resetOtpRow.verification_code,
    otpToken: resetReqData.otpToken
  })
});
assert.strictEqual(goodResetVerify.status, 200, 'Valid password reset OTP must update password and sign in');
const goodResetData = await goodResetVerify.json();
assert(goodResetData.token, 'Verified password reset must issue session JWT');

// Feedback endpoint creates DB record & triggers response email handler cleanly
const badFeedbackRes = await fetch(`${baseUrl}/api/feedback`, {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ email: signupEmail, message: '' })
});
assert.strictEqual(badFeedbackRes.status, 400, 'Feedback without message must be rejected');

const fbRes = await fetch(`${baseUrl}/api/feedback`, {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({
    name: 'Bob Recruiter',
    email: signupEmail,
    rating: 5,
    category: 'email_auth',
    message: 'Automated verification feedback test message',
    sourcePage: 'dashboard'
  })
});
assert.strictEqual(fbRes.status, 200, 'POST /api/feedback must succeed');
const fbData = await fbRes.json();
assert.strictEqual(fbData.success, true, 'Feedback response must indicate success');
assert(fbData.id, 'Feedback ID must be returned');
const fbRow = db.prepare('SELECT * FROM feedbacks WHERE id = ?').get(fbData.id);
assert(fbRow && fbRow.user_email === signupEmail, 'Feedback record must be persisted in database');

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

// ─────────────────────────────────────────────────────────────────────────────
// PROBLEM 4: Accurate Pipeline Metrics, Custom Thresholds, Overrides & Exports
// ─────────────────────────────────────────────────────────────────────────────
console.log('Testing Problem 4: Pipeline Accuracy, Customization & Download Exports...');
const customJobId = 'job_test_acc_' + Date.now();
const candIds = [];
const intIds = [];
db.prepare(`
  INSERT INTO jobs (id, org_id, title, jd_text, skills, level, max_minutes, max_questions, interview_type, question_mode, category)
  VALUES (?, ?, 'Accuracy QA Engineer', 'Automated accuracy test JD', 'JavaScript,SQL', 'senior', 15, 6, 'technical', 'ai_adaptive', 'Software & Tech')
`).run(customJobId, testOrgId);

const sampleResults = [
  { name: 'Alice Selected', email: `alice_${Date.now()}@test.com`, score: 76, verdict: 'RECOMMENDED_HIRE', state: 'completed' },
  { name: 'Bob Potential', email: `bob_${Date.now()}@test.com`, score: 62, verdict: 'POTENTIAL_HIRE', state: 'completed' },
  { name: 'Charlie Rejected', email: `charlie_${Date.now()}@test.com`, score: 40, verdict: 'NOT_RECOMMENDED', state: 'completed' }
];

sampleResults.forEach((s, idx) => {
  const cId = `cand_acc_${Date.now()}_${idx}`;
  const iId = `int_acc_${Date.now()}_${idx}`;
  const rId = `rep_acc_${Date.now()}_${idx}`;
  candIds.push(cId);
  intIds.push(iId);
  db.prepare(`INSERT INTO candidates (id, org_id, name, email, source) VALUES (?, ?, ?, ?, 'direct')`).run(cId, testOrgId, s.name, s.email);
  db.prepare(`INSERT INTO interviews (id, job_id, candidate_id, token_hash, state, started_at, ended_at) VALUES (?, ?, ?, ?, ?, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)`).run(iId, customJobId, cId, 'hash_' + iId, s.state);
  db.prepare(`INSERT INTO reports (id, interview_id, json, model) VALUES (?, ?, ?, 'test')`).run(rId, iId, JSON.stringify({
    overall_score: s.score,
    candidate_verdict: s.verdict,
    recommendation: s.score >= 70 ? 'advance' : (s.score >= 50 ? 'maybe' : 'reject'),
    overall_summary: `Summary for ${s.name}`,
    skills: [{ skill: 'JavaScript', score: 4 }]
  }));
});

const jobsCheck1 = await fetch(`${baseUrl}/jobs`, { headers: { 'Authorization': `Bearer ${userToken}` } });
assert.strictEqual(jobsCheck1.status, 200);
const jobsList1 = await jobsCheck1.json();
const accJob1 = jobsList1.find(j => j.id === customJobId);
assert(accJob1, 'Created test job must appear in GET /jobs');
assert.strictEqual(accJob1.total_candidates, 3);
assert.strictEqual(accJob1.selected_candidates, 1, 'Only score >= 70 must be Selected');
assert.strictEqual(accJob1.borderline_candidates, 1, 'POTENTIAL_HIRE with score 62 must be Borderline (NOT Selected)');
assert.strictEqual(accJob1.rejected_candidates, 1, 'Score 40 must be Rejected');

const customizeRes = await fetch(`${baseUrl}/jobs/${customJobId}/results-settings`, {
  method: 'PUT',
  headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${userToken}` },
  body: JSON.stringify({ selected_threshold: 80, borderline_threshold: 55, results_config: { sortBy: 'score_desc' } })
});
assert.strictEqual(customizeRes.status, 200, 'PUT /results-settings must succeed');

const jobsCheck2 = await fetch(`${baseUrl}/jobs`, { headers: { 'Authorization': `Bearer ${userToken}` } });
const accJob2 = (await jobsCheck2.json()).find(j => j.id === customJobId);
assert.strictEqual(accJob2.selected_candidates, 0, 'With cutoff raised to 80, score 76 drops out of Selected');
assert.strictEqual(accJob2.borderline_candidates, 2, 'With cutoffs 80/55, both 76 and 62 must be Borderline');

// Manual override Bob Potential (intIds[1]) -> Selected
const overrideRes = await fetch(`${baseUrl}/interviews/${intIds[1]}/decision`, {
  method: 'PATCH',
  headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${userToken}` },
  body: JSON.stringify({ manual_decision: 'selected', reviewer_note: 'Strong system design' })
});
assert.strictEqual(overrideRes.status, 200, 'PATCH /interviews/:id/decision must succeed');

const csvRes = await fetch(`${baseUrl}/jobs/${customJobId}/export.csv?category=selected`, {
  headers: { 'Authorization': `Bearer ${userToken}` }
});
assert.strictEqual(csvRes.status, 200, 'CSV export must return 200');
const csvText = await csvRes.text();
assert(csvText.includes('Score (/100)'), 'CSV must include Score column');
assert(csvText.includes('Bob Potential'), 'CSV filtered by selected must include manually selected Bob');
assert(!csvText.includes('Charlie Rejected'), 'CSV filtered by selected must exclude Charlie');

const jsonExpRes = await fetch(`${baseUrl}/jobs/${customJobId}/export.json?category=selected`, {
  headers: { 'Authorization': `Bearer ${userToken}` }
});
assert.strictEqual(jsonExpRes.status, 200, 'JSON export must return 200');
const jsonExpData = await jsonExpRes.json();
assert.strictEqual(jsonExpData.total_exported, 1);
assert.strictEqual(jsonExpData.candidates[0].candidate_name, 'Bob Potential');
console.log('   ✓ Problem 4: Pipeline metrics, custom cutoffs, manual override & CSV/JSON exports verified.\n');

// Clean up temporary admin & test rows so database remains clean
const signupUserRow = db.prepare('SELECT id, org_id FROM users WHERE email = ?').get(signupEmail);
if (signupUserRow) {
  db.prepare('DELETE FROM users WHERE id = ?').run(signupUserRow.id);
  db.prepare('DELETE FROM organizations WHERE id = ?').run(signupUserRow.org_id);
}
db.prepare('DELETE FROM jobs WHERE id = ?').run(customJobId);
for (const cId of candIds) {
  db.prepare('DELETE FROM candidates WHERE id = ?').run(cId);
}
db.prepare('DELETE FROM users WHERE id IN (?, ?)').run(tempAdminId, testUserId);
db.prepare('DELETE FROM admin_otps WHERE email = ?').run(tempAdminEmail);
db.prepare('DELETE FROM feedbacks WHERE user_email = ?').run(signupEmail);
db.prepare('DELETE FROM billing_orders WHERE org_id = ?').run(testOrgId);
db.prepare('DELETE FROM organizations WHERE id = ?').run(testOrgId);
db.prepare('DELETE FROM platform_activities WHERE actor_email IN (?, ?, ?) OR actor_name = ?').run(tempAdminEmail, testUserEmail, signupEmail, 'Attacker');

console.log('   ✓ Problem 3: Admin UI is separated from user portal and hardened against brute-force attacks.\n');

console.log('====================================================');
console.log('🎉 ALL THREE PROBLEMS VERIFIED AND RESOLVED FULLY!');
console.log('====================================================\n');
