import assert from 'assert';
import { encryptApiKey, decryptApiKey } from '../backend/src/keys/vault.js';
import { validateEvidenceQuotes } from '../backend/src/reports/generator.js';
import { GeminiProvider } from '../backend/src/ai/gemini.js';
import { initDatabase, db } from '../backend/src/db/database.js';

console.log('--- Running AI Interviewer Automated Test Suite ---\n');

// Test 1: AES-256-GCM Key Encryption Round-Trip
console.log('1. Testing AES-256-GCM Vault Key Encryption / Decryption...');
const testKey = 'AIzaSy_TEST_KEY_123456789_abcdef';
const encrypted = encryptApiKey(testKey);
assert(encrypted.includes(':'), 'Encrypted payload must contain iv:authTag:cipher');
const decrypted = decryptApiKey(encrypted);
assert.strictEqual(decrypted, testKey, 'Decrypted key must match original test key');
console.log('   ✓ AES-256-GCM encryption round-trip PASSED\n');

// Test 2: Database Initialization & Tables
console.log('2. Testing Database Schema Initialization...');
initDatabase();
const tableCount = db.prepare("SELECT count(*) as count FROM sqlite_master WHERE type='table'").get().count;
assert(tableCount >= 10, 'Must have at least 10 tables initialized');
console.log(`   ✓ Found ${tableCount} tables in SQLite database\n`);

// Test 3: Evidence-Quote Verification in Report (Anti-Hallucination)
console.log('3. Testing Evidence-Quote Verification (Section 6.3 Anti-Hallucination)...');
const mockTranscript = [
  { idx: 1, role: 'ai', text: 'Tell me about tuples.' },
  { idx: 2, role: 'candidate', text: 'Lists are mutable while tuples are immutable in Python.' }
];

const mockReport = {
  skills: [
    {
      skill: 'Python Basics',
      score: 4,
      evidence: [
        { quote: 'tuples are immutable in Python', turn: 2 },
        { quote: 'I built a distributed Kafka cluster with 10 nodes', turn: 99 } // Fabricated quote
      ]
    }
  ]
};

const validated = validateEvidenceQuotes(mockReport, mockTranscript);
const verifiedEvidence = validated.skills[0].evidence;
assert.strictEqual(verifiedEvidence[0].verified_in_transcript, true, 'Real quote should be marked verified');
assert.strictEqual(verifiedEvidence[1].verified_in_transcript, false, 'Fabricated quote must be caught');
assert.strictEqual(validated.skills[0].confidence, 'low', 'Confidence should drop to low when hallucination is detected');
console.log('   ✓ Evidence quote validator detected hallucination and lowered confidence correctly\n');

// Test 4: Gemini Provider Fallback / Simulator
console.log('4. Testing Gemini Provider Adapter & Fallback Engine...');
const provider = new GeminiProvider();
const simTurn = await provider.generate({
  systemPrompt: 'You are a technical interviewer',
  messages: [{ role: 'candidate', text: 'Hello, ready for interview.' }]
});
assert(simTurn.text, 'Provider should return valid response even without live API key');
console.log(`   ✓ Provider returned response using model: ${simTurn.model}\n`);

console.log('====================================================');
console.log('✅ ALL TEST SUITES PASSED SUCCESSFULLY!');
console.log('====================================================\n');
