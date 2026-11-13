/**
 * MCP Tools: Code Execution & Test Harness Judge
 * 
 * Runs candidate code submissions in sandboxed environments (JavaScript, Python, C++, SQL),
 * enforcing time and memory limits, testing against test cases, and returning pass/fail verdicts.
 */

import { z } from 'zod';
import { judgeLeetCodeSolution } from '../../backend/src/services/leetcodeJudge.js';
import { getLeetCodeProblem } from '../../backend/src/services/leetcodeCatalogService.js';

export function registerJudgeTools(server) {
  server.tool(
    'judge_code_solution',
    'Run and grade candidate source code against official test cases for a LeetCode or DSA problem in JavaScript, Python, C++, or SQL. Enforces runtime limits and returns pass/fail verdict, runtime latency, memory usage, and test case breakdown.',
    {
      problem_id: z.string().describe('LeetCode problem ID (e.g. "1" for Two Sum, "20" for Valid Parentheses, "53" for Max Subarray)'),
      code: z.string().describe('The candidate source code to execute and grade'),
      language: z.enum(['javascript', 'python', 'cpp', 'sql']).default('javascript').describe('Programming language of the solution'),
      time_limit_ms: z.number().int().min(100).max(10000).optional().default(2000).describe('Execution timeout limit in milliseconds (default 2000ms)'),
      memory_limit_mb: z.number().int().min(16).max(1024).optional().default(256).describe('Memory limit in MB (default 256MB)')
    },
    async ({ problem_id, code, language = 'javascript', time_limit_ms = 2000, memory_limit_mb = 256 }) => {
      try {
        const problem = getLeetCodeProblem(problem_id);
        const title = problem ? `LeetCode #${problem.frontend_id}: ${problem.title}` : `Problem #${problem_id}`;

        const result = await judgeLeetCodeSolution(
          problem_id,
          language,
          code,
          null,
          { timeLimitMs: time_limit_ms, memoryLimitMb: memory_limit_mb }
        );

        let verdictEmoji = '❌';
        if (result.verdict === 'ACCEPTED') verdictEmoji = '✅';
        else if (result.verdict === 'WRONG_ANSWER') verdictEmoji = '⚠️';
        else if (result.verdict === 'TIME_LIMIT_EXCEEDED') verdictEmoji = '⏱️';
        else if (result.verdict === 'MEMORY_LIMIT_EXCEEDED') verdictEmoji = '💾';
        else if (result.verdict === 'COMPILE_ERROR') verdictEmoji = '🔨';

        let output = `## ${verdictEmoji} Judge Verdict: ${result.verdict} (${result.status || result.verdict})\n\n`;
        output += `* **Problem:** ${title}\n`;
        output += `* **Language:** \`${language.toUpperCase()}\`\n`;
        output += `* **Score:** **${result.score ?? (result.verdict === 'ACCEPTED' ? 100 : Math.round((result.passedCount / Math.max(1, result.totalCount)) * 100))}/100**\n`;
        output += `* **Test Cases Passed:** ${result.passedCount || 0} / ${result.totalCount || 0}\n`;
        output += `* **Execution Time:** ${result.runtimeMs || 0}ms (Limit: ${result.timeLimitMs || time_limit_ms}ms)\n`;
        output += `* **Memory Usage:** ${result.memoryMb || 'N/A'} MB (Limit: ${result.memoryLimitMb || memory_limit_mb}MB)\n\n`;

        if (result.error) {
          output += `### ⚠️ Error Log\n\`\`\`\n${result.error}\n\`\`\`\n\n`;
        }

        if (result.cases && result.cases.length > 0) {
          output += `### 🧪 Test Case Execution Details\n\n`;
          output += `| # | Type | Input | Expected Output | Actual Output | Runtime | Status |\n`;
          output += `|---|---|---|---|---|---|---|\n`;

          result.cases.forEach((tc) => {
            const passStr = tc.passed ? '✅ Pass' : '❌ Fail';
            const inStr = typeof tc.input === 'object' ? JSON.stringify(tc.input) : String(tc.input);
            const expStr = typeof tc.expected === 'object' ? JSON.stringify(tc.expected) : String(tc.expected);
            const actStr = typeof tc.actual === 'object' ? JSON.stringify(tc.actual) : String(tc.actual || tc.error || 'N/A');
            const latencyStr = tc.runtimeMs !== undefined ? `${tc.runtimeMs}ms` : '-';

            // Truncate long strings for cleaner markdown
            const trunc = (s, max = 35) => s && s.length > max ? s.substring(0, max) + '...' : s;

            output += `| ${tc.id || 1} | ${tc.type || 'Test'} | \`${trunc(inStr)}\` | \`${trunc(expStr)}\` | \`${trunc(actStr)}\` | ${latencyStr} | ${passStr} |\n`;
          });
        }

        output += `\n💡 **AI Evaluation Hint:** `;
        if (result.verdict === 'ACCEPTED') {
          output += `Candidate's code passed all test cases within the required time and memory bounds. Verify their verbal explanation and time/space complexity tradeoffs.`;
        } else if (result.verdict === 'WRONG_ANSWER') {
          output += `Candidate's logic failed on edge or hidden cases. Prompt the candidate: "Consider edge cases or boundary inputs; where might the logic differ from the expected output?"`;
        } else if (result.verdict === 'TIME_LIMIT_EXCEEDED') {
          output += `The solution exceeded the ${time_limit_ms}ms timeout. Probe the candidate for a more optimal algorithm (e.g. moving from O(n²) to O(n log n) or O(n)).`;
        } else {
          output += `A compilation or runtime error occurred. Guide the candidate to inspect syntax, variable names, or unhandled exceptions.`;
        }

        return { content: [{ type: 'text', text: output }] };
      } catch (err) {
        return {
          content: [{
            type: 'text',
            text: `❌ Error judging code solution: ${err.message}`
          }],
          isError: true
        };
      }
    }
  );
}
