// tests/test_mcp_server.js
// Complete automated test suite for RoundOne AI MCP Server

import assert from 'assert';
import http from 'http';
import { server } from '../mcp/server.js';
import { startHttpBridge } from '../mcp/httpServer.js';

console.log('=== RoundOne AI: MCP Server Comprehensive Test Suite ===\n');

async function runTests() {
  const tools = server._registeredTools;
  const prompts = server._registeredPrompts;
  const resources = server._registeredResources;

  // 1. Verify Registration Counts
  console.log('1. Checking Tool, Prompt & Resource Registrations...');
  assert.ok(Object.keys(tools).length >= 13, `Expected at least 13 tools, found ${Object.keys(tools).length}`);
  assert.ok(Object.keys(prompts).length >= 3, `Expected at least 3 prompts, found ${Object.keys(prompts).length}`);
  assert.ok(Object.keys(resources).length >= 3, `Expected at least 3 resources, found ${Object.keys(resources).length}`);
  console.log(`   ✓ Found ${Object.keys(tools).length} tools, ${Object.keys(prompts).length} prompts, and ${Object.keys(resources).length} resources registered.`);

  // 2. Test search_leetcode_problems
  console.log('\n2. Testing Tool: search_leetcode_problems...');
  const searchRes = await tools.search_leetcode_problems.handler({ query: 'two sum', limit: 5 });
  assert.ok(searchRes && searchRes.content && searchRes.content[0].text);
  assert.ok(searchRes.content[0].text.includes('Two Sum'), 'Search output must mention Two Sum');
  console.log('   ✓ search_leetcode_problems returned matching problems correctly');

  // 3. Test get_leetcode_problem
  console.log('\n3. Testing Tool: get_leetcode_problem...');
  const probRes = await tools.get_leetcode_problem.handler({ problem_id_or_slug: '1', language: 'python' });
  assert.ok(probRes && probRes.content && probRes.content[0].text);
  assert.ok(probRes.content[0].text.includes('Two Sum'), 'Problem output must contain Two Sum title');
  assert.ok(probRes.content[0].text.includes('def twoSum') || probRes.content[0].text.includes('def two_sum'), 'Problem output must contain Python snippet');
  console.log('   ✓ get_leetcode_problem returned full description and starter code template');

  // 4. Test list_leetcode_topics
  console.log('\n4. Testing Tool: list_leetcode_topics...');
  const topicsRes = await tools.list_leetcode_topics.handler({});
  assert.ok(topicsRes.content[0].text.includes('Array') || topicsRes.content[0].text.includes('Dynamic Programming'));
  console.log('   ✓ list_leetcode_topics returned catalog of topics');

  // 5. Test judge_code_solution
  console.log('\n5. Testing Tool: judge_code_solution (JavaScript)...');
  const judgeRes = await tools.judge_code_solution.handler({
    problem_id: '1',
    code: 'function twoSum(nums, target) { const m = new Map(); for (let i = 0; i < nums.length; i++) { if (m.has(target - nums[i])) return [m.get(target - nums[i]), i]; m.set(nums[i], i); } return []; }',
    language: 'javascript'
  });
  assert.ok(judgeRes.content[0].text.includes('ACCEPTED'), 'Judge result must be ACCEPTED for valid Two Sum solution');
  assert.ok(judgeRes.content[0].text.includes('100/100'), 'Score must be 100/100');
  console.log('   ✓ judge_code_solution executed and graded solution correctly (ACCEPTED, 100/100)');

  // 6. Test list_interviews & get_interview_details
  console.log('\n6. Testing Tool: list_interviews & get_interview_details...');
  const listJobsRes = await tools.list_interviews.handler({ limit: 5 });
  assert.ok(listJobsRes.content[0].text.includes('Configured Technical Screening Rounds'));

  const jobDetailsRes = await tools.get_interview_details.handler({ job_id: 'job_fullstack_starter' });
  assert.ok(jobDetailsRes.content[0].text.includes('Fullstack Software Engineer'));
  console.log('   ✓ list_interviews and get_interview_details retrieved configurations cleanly');

  // 7. Test create_interview
  console.log('\n7. Testing Tool: create_interview...');
  const createJobRes = await tools.create_interview.handler({
    title: 'MCP Unit Test AI Architect',
    skills: 'Node.js, TypeScript, MCP Protocol, LLM System Architecture',
    duration_mins: 45,
    leetcode_problem_id: '20'
  });
  assert.ok(createJobRes.content[0].text.includes('Technical Interview Round Created Successfully'));
  console.log('   ✓ create_interview generated new interview round and candidate share link');

  // 8. Test invite_candidate & get_candidate_report
  console.log('\n8. Testing Tool: invite_candidate & get_candidate_report...');
  const inviteRes = await tools.invite_candidate.handler({
    job_id: 'job_fullstack_starter',
    candidate_name: 'Ananya Sharma',
    candidate_email: 'ananya.mcp@example.com'
  });
  assert.ok(inviteRes.content[0].text.includes('Candidate Interview Invitation Created'));
  assert.ok(inviteRes.content[0].text.includes('http://localhost:3001/interview.html?token='));

  const candidateIdMatch = inviteRes.content[0].text.match(/`cand_[a-z0-9\-]+`/);
  assert.ok(candidateIdMatch, 'Candidate ID must be present in output');
  const candId = candidateIdMatch[0].replace(/`/g, '');

  const reportRes = await tools.get_candidate_report.handler({ candidate_id_or_interview_id: candId });
  assert.ok(reportRes.content[0].text.includes('Ananya Sharma'));
  console.log('   ✓ invite_candidate created candidate session and get_candidate_report retrieved dossier');

  // 9. Test evaluate_candidate_response
  console.log('\n9. Testing Tool: evaluate_candidate_response...');
  const evalRes = await tools.evaluate_candidate_response.handler({
    question: 'How do you optimize lookup time in Two Sum from O(n^2) to O(n)?',
    candidate_answer: 'We can iterate through the array once and store each number in a Hash Map. For each element x, we check if target - x is already in the map. Hash map lookup is O(1) on average, reducing total time complexity to O(n) linear time with O(n) space complexity. We must also handle edge cases like empty arrays and duplicate elements.',
    expected_skills: 'Hash Map, Big-O time and space complexity, edge case handling'
  });
  assert.ok(evalRes.content[0].text.includes('Objective Evaluation'));
  assert.ok(evalRes.content[0].text.includes('Rubric Breakdown'));
  console.log('   ✓ evaluate_candidate_response scored candidate answer with 4-dimension rubric');

  // 10. Test get_platform_stats & get_billing_and_credits
  console.log('\n10. Testing Tool: get_platform_stats & get_billing_and_credits...');
  const statsRes = await tools.get_platform_stats.handler({});
  assert.ok(statsRes.content[0].text.includes('All Systems Operational'));

  const billingRes = await tools.get_billing_and_credits.handler({});
  assert.ok(billingRes.content[0].text.includes('Credits'));
  console.log('   ✓ get_platform_stats and get_billing_and_credits returned operational telemetry');

  // 10b. Test Codebase Tools
  console.log('\n10b. Testing Codebase Tools (read_project_file, list_project_files, run_project_command)...');
  const readRes = await tools.read_project_file.handler({ file_path: 'package.json' });
  assert.ok(readRes.content[0].text.includes('roundone-ai'));

  const listRes = await tools.list_project_files.handler({ directory: 'backend/src' });
  assert.ok(listRes.content[0].text.includes('server.js'));

  const cmdRes = await tools.run_project_command.handler({ command: 'node -v' });
  assert.ok(cmdRes.content[0].text.includes('v'));
  console.log('   ✓ Codebase tools executed and read project files & commands successfully');

  // 11. Test Prompts
  console.log('\n11. Testing MCP Prompts...');
  const promptScreening = await (prompts['conduct-technical-screening'].callback || prompts['conduct-technical-screening'].handler)({ role: 'Lead ML Engineer' });
  assert.ok(promptScreening.messages[0].content.text.includes('Lead ML Engineer'));

  const promptRubric = await (prompts['generate-interview-rubric'].callback || prompts['generate-interview-rubric'].handler)({ job_title: 'Fullstack Dev', tech_stack: 'React, Node' });
  assert.ok(promptRubric.messages[0].content.text.includes('React, Node'));
  console.log('   ✓ All MCP Prompts generated prompt messages properly');

  // 12. Test Resources
  console.log('\n12. Testing MCP Resources...');
  const resTopicHandler = resources['roundone://catalog/topics'] || resources['catalog-topics'];
  const resTopics = await (resTopicHandler.readCallback || resTopicHandler.read)(new URL('roundone://catalog/topics'));
  assert.ok(resTopics.contents[0].text.includes('total_problems'));

  const resHealthHandler = resources['roundone://system/health'] || resources['system-health'];
  const resHealth = await (resHealthHandler.readCallback || resHealthHandler.read)(new URL('roundone://system/health'));
  assert.ok(resHealth.contents[0].text.includes('healthy'));
  console.log('   ✓ All MCP Resources resolved and returned valid JSON context');

  // 13. Test HTTP / SSE / OpenAPI Bridge Server
  console.log('\n13. Testing HTTP Bridge Server on port 3009...');
  const testHttpPort = 3009;
  const httpServer = startHttpBridge(server, testHttpPort);

  await new Promise(r => setTimeout(r, 400));

  // Test GET /health
  const healthData = await new Promise((resolve, reject) => {
    http.get(`http://localhost:${testHttpPort}/health`, (res) => {
      let body = '';
      res.on('data', chunk => body += chunk);
      res.on('end', () => resolve(JSON.parse(body)));
    }).on('error', reject);
  });
  assert.strictEqual(healthData.status, 'ok');

  // Test GET /tools
  const toolsData = await new Promise((resolve, reject) => {
    http.get(`http://localhost:${testHttpPort}/tools`, (res) => {
      let body = '';
      res.on('data', chunk => body += chunk);
      res.on('end', () => resolve(JSON.parse(body)));
    }).on('error', reject);
  });
  assert.ok(toolsData.total_tools >= 13);

  // Test GET /openapi.json (OpenAPI 3.0 spec for ChatGPT Actions)
  const openApiData = await new Promise((resolve, reject) => {
    http.get(`http://localhost:${testHttpPort}/openapi.json`, (res) => {
      let body = '';
      res.on('data', chunk => body += chunk);
      res.on('end', () => resolve(JSON.parse(body)));
    }).on('error', reject);
  });
  assert.strictEqual(openApiData.openapi, '3.0.1');
  assert.ok(openApiData.paths['/call/search_leetcode_problems']);
  assert.ok(openApiData.paths['/call/judge_code_solution']);
  assert.ok(openApiData.paths['/call/get_candidate_report']);

  // Test POST /call/search_leetcode_problems (Direct REST tool execution)
  const postCallData = await new Promise((resolve, reject) => {
    const postReq = http.request(`http://localhost:${testHttpPort}/call/search_leetcode_problems`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' }
    }, (res) => {
      let body = '';
      res.on('data', chunk => body += chunk);
      res.on('end', () => resolve(JSON.parse(body)));
    });
    postReq.on('error', reject);
    postReq.write(JSON.stringify({ query: 'two sum' }));
    postReq.end();
  });
  assert.strictEqual(postCallData.success, true);
  assert.strictEqual(postCallData.tool, 'search_leetcode_problems');
  assert.ok(postCallData.result.content[0].text.includes('Two Sum'));

  // Close HTTP test server
  httpServer.close();
  console.log('   ✓ HTTP Server: /health, /tools, /openapi.json, and REST /call/:tool verified!');

  console.log('\n====================================================');
  console.log('🎉 ALL MCP SERVER UNIT & INTEGRATION TESTS PASSED!');
  console.log('====================================================\n');
}

runTests().catch(err => {
  console.error('\n❌ Test failed with error:', err);
  process.exit(1);
});
