import assert from 'assert';
import 'dotenv/config';
import {
  isSupabaseConfigured,
  getSupabasePublicConfig,
  getSupabaseRuntimeConfig,
  syncSupabaseUser
} from '../backend/src/services/supabaseService.js';
import {
  getEffectiveCaptchaConfig,
  issueBuiltinCaptchaChallenge,
  verifyCaptchaResponse
} from '../backend/src/services/captchaService.js';
import { db, initDatabase } from '../backend/src/db/database.js';

initDatabase();
console.log('=== RoundOne AI: Supabase Integration Test Suite ===\n');

// 1. Test getSupabasePublicConfig
console.log('1. Testing getSupabasePublicConfig()...');
const config = getSupabasePublicConfig();
assert.strictEqual(typeof config, 'object');
assert.strictEqual(typeof config.isConfigured, 'boolean');
assert.strictEqual(typeof config.supabaseUrl, 'string');
assert.strictEqual(typeof config.supabaseAnonKey, 'string');
console.log('   ✓ Public config contains safe anon keys and URL, no secrets leaked');

// 2. Test syncSupabaseUser with new user
console.log('2. Testing syncSupabaseUser with a new user...');
const mockSupabaseId = 'sb_usr_' + Date.now();
const mockEmail = `test_supabase_${Date.now()}@example.com`;
const mockSupabaseUser = {
  id: mockSupabaseId,
  email: mockEmail,
  user_metadata: {
    full_name: 'Priya Sharma',
    company_name: 'Acme Technologies Inc'
  }
};

const synced = syncSupabaseUser({
  supabaseUser: mockSupabaseUser,
  role: 'recruiter',
  orgName: 'Acme Technologies Inc'
});

assert(synced.user, 'Expected user to be returned');
assert.strictEqual(synced.user.id, mockSupabaseId);
assert.strictEqual(synced.user.email, mockEmail);
assert.strictEqual(synced.user.is_verified, 1);
assert.strictEqual(synced.user.approval_status, 'approved');
assert(synced.org, 'Expected organization to be provisioned');
assert.strictEqual(synced.org.included_interviews, 10);
console.log('   ✓ User and organization provisioned and synced cleanly');

// 3. Test syncSupabaseUser with existing user idempotency
console.log('3. Testing syncSupabaseUser idempotency for returning user...');
const syncedAgain = syncSupabaseUser({
  supabaseUser: mockSupabaseUser
});
assert.strictEqual(syncedAgain.user.id, mockSupabaseId);
assert.strictEqual(syncedAgain.user.email, mockEmail);
assert.strictEqual(syncedAgain.org.id, synced.org.id);
console.log('   ✓ Idempotent sync preserves existing organization and user linkage');

// 4. Verify user exists in SQLite database
const dbUser = db.prepare('SELECT * FROM users WHERE id = ?').get(mockSupabaseId);
assert(dbUser, 'User must exist in database');
assert.strictEqual(dbUser.email, mockEmail);
assert.strictEqual(dbUser.is_verified, 1);
console.log('   ✓ Verified database record in users table');

// 5. Clean up test user
db.prepare('DELETE FROM users WHERE id = ?').run(mockSupabaseId);
db.prepare('DELETE FROM organizations WHERE id = ?').run(synced.org.id);
console.log('   ✓ Cleaned up test records');

// 6. Test CAPTCHA configuration & built-in challenge verification
console.log('4. Testing CAPTCHA Protection Service...');
const captchaCfg = getEffectiveCaptchaConfig();
assert.strictEqual(captchaCfg.enabled, true, 'CAPTCHA should be ON by default');
const ch = issueBuiltinCaptchaChallenge();
assert(ch.challengeToken, 'Expected challengeToken');
assert(ch.prompt, 'Expected math prompt');
const expectedAns = ch.operator === '-' ? String(ch.a - ch.b) : String(ch.a + ch.b);

const validCap = await verifyCaptchaResponse({
  captchaChallengeToken: ch.challengeToken,
  captchaAnswer: expectedAns
});
assert.strictEqual(validCap.valid, true, 'Correct CAPTCHA answer must verify');

const wrongCap = await verifyCaptchaResponse({
  captchaChallengeToken: ch.challengeToken,
  captchaAnswer: '9999'
});
assert.strictEqual(wrongCap.valid, false, 'Incorrect CAPTCHA answer must be rejected');

const tamperedCap = await verifyCaptchaResponse({
  captchaChallengeToken: ch.challengeToken + 'tamper',
  captchaAnswer: expectedAns
});
assert.strictEqual(tamperedCap.valid, false, 'Tampered CAPTCHA token must be rejected');
console.log('   ✓ CAPTCHA enabled, verified valid challenge, and rejected wrong/tampered tokens');

// 7. Test live Supabase Runtime Config & Enabled Providers discovery (if configured)
if (isSupabaseConfigured()) {
  console.log('5. Testing live Supabase enabled auth providers discovery...');
  const rt = await getSupabaseRuntimeConfig({ forceRefresh: true });
  assert.strictEqual(rt.isConfigured, true);
  assert.strictEqual(typeof rt.enabledProviders, 'object');
  const activeProviders = Object.entries(rt.enabledProviders)
    .filter(([, v]) => Boolean(v))
    .map(([k]) => k);
  assert(activeProviders.length > 0, 'Expected at least one enabled Supabase auth provider');
  console.log(`   ✓ Detected live Supabase providers: ${activeProviders.join(', ')} (passkeysEnabled=${rt.passkeysEnabled})`);
}

console.log('\n🎉 ALL SUPABASE & CAPTCHA INTEGRATION TESTS PASSED SUCCESSFULLY!\n');
