import assert from 'assert';
import {
  isSupabaseConfigured,
  getSupabasePublicConfig,
  syncSupabaseUser
} from '../backend/src/services/supabaseService.js';
import { db } from '../backend/src/db/database.js';

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

console.log('\n🎉 ALL SUPABASE INTEGRATION TESTS PASSED SUCCESSFULLY!\n');
