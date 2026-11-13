// tests/test_bolt_landing_and_auth.js
// Verification of Bolt.new inspired landing showcase, free trial callout, and no annoying auth popup

import assert from 'assert';
import fs from 'fs';
import path from 'path';
import http from 'http';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

console.log('=== RoundOne AI: Bolt.new Landing & Auth Modal Verification ===\n');

// 1. Inspect index.html contents
console.log('1. Checking frontend/public/index.html structure...');
const indexHtml = fs.readFileSync(path.join(__dirname, '../frontend/public/index.html'), 'utf8');

assert.ok(indexHtml.includes('id="bolt-hero-showcase"'), 'index.html must include #bolt-hero-showcase');
assert.ok(indexHtml.includes('id="btn-header-trial"'), 'index.html must include #btn-header-trial in header');
assert.ok(indexHtml.includes('id="bolt-prompt-input"'), 'index.html must include #bolt-prompt-input');
assert.ok(indexHtml.includes('id="sandbox-code-editor"'), 'index.html must include #sandbox-code-editor');
assert.ok(indexHtml.includes('id="btn-run-sandbox"'), 'index.html must include #btn-run-sandbox');
assert.ok(indexHtml.includes('id="sandbox-output-console"'), 'index.html must include #sandbox-output-console');
assert.ok(indexHtml.includes('Claim 10 Free AI Interviews'), 'index.html must highlight 10 Free AI Interviews');
assert.ok(indexHtml.includes('4,111+ LeetCode DSA Bank'), 'index.html must highlight 4,111+ LeetCode DSA Bank');
console.log('   ✓ index.html contains all Bolt.new showcase components and free trial callouts');

// 2. Inspect dashboard.js for no annoying popup on open and dismissible auth modal
console.log('\n2. Checking frontend/public/js/dashboard.js auth modal behavior...');
const dashboardJs = fs.readFileSync(path.join(__dirname, '../frontend/public/js/dashboard.js'), 'utf8');

// Ensure checkAuthSession does NOT call openAuthModal when !authToken
const checkAuthMatch = dashboardJs.match(/async function checkAuthSession\(\)\s*\{([\s\S]*?)try\s*\{/);
assert.ok(checkAuthMatch, 'checkAuthSession must exist');
const initialBlock = checkAuthMatch[1];
assert.ok(!initialBlock.includes('openAuthModal()'), 'checkAuthSession must NOT call openAuthModal() when !authToken');
assert.ok(initialBlock.includes('updateVisitorUiState(false)'), 'checkAuthSession must update visitor state to false');
console.log('   ✓ checkAuthSession() never opens auth modal automatically on page open');

// Ensure closeAuthModal does not trap or block users
const closeAuthMatch = dashboardJs.match(/window\.closeAuthModal\s*=\s*function\(\)\s*\{([\s\S]*?)\};/);
assert.ok(closeAuthMatch, 'closeAuthModal must exist');
assert.ok(!closeAuthMatch[1].includes('alert('), 'closeAuthModal must NOT trigger a blocking alert');
assert.ok(closeAuthMatch[1].includes("display = 'none'"), 'closeAuthModal must close modal cleanly');
console.log('   ✓ closeAuthModal() allows instant dismissal with no blocking alert trap');

// 3. Verify handlers exist in dashboard.js
assert.ok(dashboardJs.includes('window.updateVisitorUiState ='), 'updateVisitorUiState handler exists');
assert.ok(dashboardJs.includes('window.handleStartTrialClick ='), 'handleStartTrialClick handler exists');
assert.ok(dashboardJs.includes('window.handleBoltChipClick ='), 'handleBoltChipClick handler exists');
assert.ok(dashboardJs.includes('window.handleBoltPromptSubmit ='), 'handleBoltPromptSubmit handler exists');
assert.ok(dashboardJs.includes('window.runDemoSandboxCode ='), 'runDemoSandboxCode handler exists');
assert.ok(dashboardJs.includes('window.resetSandboxCode ='), 'resetSandboxCode handler exists');
console.log('   ✓ All Bolt.new interaction handlers and code runner sandbox handlers are wired');

// 4. Test live HTTP response on server (port 3001)
console.log('\n3. Testing live HTTP endpoint GET http://localhost:3001/ ...');
const req = http.get('http://localhost:3001/', (res) => {
  assert.strictEqual(res.statusCode, 200, 'GET / must return 200 OK');
  let data = '';
  res.on('data', chunk => data += chunk);
  res.on('end', () => {
    assert.ok(data.includes('bolt-hero-showcase'), 'Live server serves bolt-hero-showcase');
    assert.ok(data.includes('btn-header-trial'), 'Live server serves Free Trial header button');
    assert.ok(data.includes('Interactive Live Interview &amp; Code Sandbox'), 'Live server serves interactive sandbox');
    console.log('   ✓ Live server http://localhost:3001/ serves Bolt.new landing showcase cleanly');

    console.log('\n====================================================');
    console.log('🎉 ALL BOLT.NEW LANDING & AUTH TESTS PASSED!');
    console.log('====================================================\n');
    process.exit(0);
  });
});

req.on('error', (err) => {
  console.error('HTTP Request failed:', err);
  process.exit(1);
});
