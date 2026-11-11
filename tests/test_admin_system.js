import assert from 'assert';
import { db, initDatabase } from '../backend/src/db/database.js';
import { generateAndSendAdminOtp, verifyAdminOtp } from '../backend/src/services/adminOtpService.js';
import { logActivity, getActivities } from '../backend/src/services/activityService.js';

console.log('--- Testing Platform Super Admin & Activity Logging System ---\n');

initDatabase();

// 1. Verify 3 Seeded Unique Admin Invite Hash Codes
console.log('1. Verifying Seeded Admin Invite Hash Codes (Strict 2-3 Admins)...');
const invites = db.prepare('SELECT * FROM admin_invites').all();
assert.strictEqual(invites.length, 3, 'Must have exactly 3 initial admin invite codes');
assert(invites.some(i => i.code_hash === 'ADM-ALPHA-9821-X7'), 'Must contain Admin #1 code');
assert(invites.some(i => i.code_hash === 'ADM-BETA-4432-Y2'), 'Must contain Admin #2 code');
assert(invites.some(i => i.code_hash === 'ADM-GAMMA-6119-Z9'), 'Must contain Admin #3 code');
console.log('   ✓ Found all 3 unique admin invite hash codes in vault\n');

// 2. Test Admin OTP Generation & Verification
console.log('2. Testing Admin Email OTP Generation & Verification...');
const testEmail = 'admin.test@platform.internal';
const otpResult = await generateAndSendAdminOtp(testEmail, 'signup_verify', 'Chief Admin');
assert(otpResult.success, 'OTP generation must succeed');

// Retrieve OTP code from DB or devOtp
const otpRow = db.prepare('SELECT otp_code FROM admin_otps WHERE email = ? AND is_used = 0 ORDER BY created_at DESC LIMIT 1').get(testEmail);
const activeCode = otpResult.devOtp || otpRow?.otp_code;
assert(activeCode, 'Active OTP must exist in database or response');
assert.strictEqual(activeCode.length, 6, 'OTP must be 6 digits');

// Test wrong OTP
const wrongVerify = verifyAdminOtp(testEmail, '000000', 'signup_verify');
assert.strictEqual(wrongVerify.valid, false, 'Wrong OTP must be rejected');

// Test correct OTP
const correctVerify = verifyAdminOtp(testEmail, activeCode, 'signup_verify');
assert.strictEqual(correctVerify.valid, true, 'Correct OTP must be accepted');

// Test re-using same OTP (must fail)
const reuseVerify = verifyAdminOtp(testEmail, otpResult.devOtp, 'signup_verify');
assert.strictEqual(reuseVerify.valid, false, 'Used OTP must not be accepted again');
console.log('   ✓ Admin OTP lifecycle (generation, delivery, verification, single-use) PASSED\n');

// 3. Test Activity Logging
console.log('3. Testing Real-Time Platform Activity Logging...');
const actId = logActivity({
  action: 'USER_SIGNUP',
  actorType: 'user',
  actorId: 'usr_test_123',
  actorEmail: 'recruiter@techcorp.com',
  actorName: 'Jane Recruiter',
  orgId: 'org_test_123',
  details: { companyName: 'TechCorp Global', plan: 'free_trial' }
});
assert(actId, 'Activity must be recorded with generated ID');

const stream = getActivities({ limit: 10 });
assert(stream.total > 0, 'Activity stream must contain events');
const logged = stream.activities.find(a => a.id === actId);
assert(logged, 'Newly logged activity must be found in stream');
assert.strictEqual(logged.actor_email, 'recruiter@techcorp.com');
assert.strictEqual(logged.details.companyName, 'TechCorp Global');
console.log('   ✓ Real-time activity logging and JSON details hydration PASSED\n');

// 4. Test Platform Settings
console.log('4. Testing Platform Settings & Approval Toggle...');
const approvalSetting = db.prepare("SELECT value FROM platform_settings WHERE key = 'require_admin_approval'").get();
assert(approvalSetting, 'Setting require_admin_approval must exist');
console.log(`   ✓ require_admin_approval is currently: "${approvalSetting.value}"\n`);

console.log('====================================================');
console.log('✅ ALL ADMIN SYSTEM UNIT TESTS PASSED!');
console.log('====================================================\n');
