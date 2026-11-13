/**
 * MCP Tools: LeetCode DSA Question Bank (4,111+ Problems)
 * 
 * Enables LLMs (Claude, ChatGPT, etc.) to search, explore, and retrieve coding problems
 * with starter templates, time & memory limits, and topic tags.
 */

import { z } from 'zod';
import {
  listLeetCodeProblems,
  getLeetCodeProblem,
  getLeetCodeTopics,
  getTotalProblemCount
} from '../../backend/src/services/leetcodeCatalogService.js';

export function registerLeetCodeTools(server) {
  // 1. search_leetcode_problems
  server.tool(
    'search_leetcode_problems',
    'Search the 4,111+ LeetCode DSA coding question bank by keyword, topic, or difficulty. Returns matched problems with ID, difficulty, and topic tags.',
    {
      query: z.string().optional().describe('Keyword to search in problem title or description (e.g. "two sum", "lru cache", "binary tree", "knapsack")'),
      topic: z.string().optional().describe('Specific DSA topic filter (e.g. "Array", "Dynamic Programming", "Graph", "Tree", "String", "Binary Search", "Hash Table", "Backtracking", "Linked List")'),
      difficulty: z.enum(['Easy', 'Medium', 'Hard']).optional().describe('Difficulty level filter'),
      limit: z.number().int().min(1).max(50).default(10).describe('Number of results to return (default 10, max 50)'),
      page: z.number().int().min(1).default(1).describe('Page number for pagination (default 1)')
    },
    async ({ query, topic, difficulty, limit = 10, page = 1 }) => {
      try {
        const result = listLeetCodeProblems({
          page,
          limit,
          search: query || '',
          topic: topic || '',
          difficulty: difficulty || ''
        });

        const totalBank = getTotalProblemCount();
        const items = result.items || [];

        let output = `### 📚 LeetCode DSA Problems Search\n\n`;
        output += `* **Total In Question Bank:** ${totalBank.toLocaleString()} problems\n`;
        output += `* **Matching Results:** ${result.total.toLocaleString()} problems found\n`;
        output += `* **Page:** ${result.page} of ${result.totalPages} (Showing ${items.length} items)\n\n`;

        if (items.length === 0) {
          output += `_No problems matched your query._ Try broadening your search or exploring popular topics like \`Array\`, \`Dynamic Programming\`, or \`Tree\`.\n`;
          return { content: [{ type: 'text', text: output }] };
        }

        output += `| ID | Frontend # | Title | Difficulty | Topic Tags |\n`;
        output += `|---|---|---|---|---|\n`;

        for (const item of items) {
          const tags = (item.topics || []).slice(0, 3).join(', ') + ((item.topics || []).length > 3 ? '...' : '');
          output += `| \`${item.id}\` | #${item.frontend_id} | **${item.title}** | \`${item.difficulty}\` | ${tags || 'General'} |\n`;
        }

        output += `\n💡 **Tip for AI Agents:** Use \`get_leetcode_problem({ problem_id_or_slug: "<ID>" })\` to fetch the complete description, constraints, and starter code snippet.`;

        return { content: [{ type: 'text', text: output }] };
      } catch (err) {
        return {
          content: [{
            type: 'text',
            text: `❌ Error searching LeetCode problems: ${err.message}`
          }],
          isError: true
        };
      }
    }
  );

  // 2. get_leetcode_problem
  server.tool(
    'get_leetcode_problem',
    'Get full problem details for a LeetCode DSA problem including problem statement, examples, constraints, execution time/memory limits, and starter code snippets.',
    {
      problem_id_or_slug: z.string().describe('LeetCode problem ID (e.g. "1"), frontend number ("#1" or 1), or title slug (e.g. "two-sum")'),
      language: z.enum(['javascript', 'python', 'cpp', 'java', 'sql']).default('javascript').describe('Language for starter code snippet (default: javascript)'),
      mode: z.enum(['solve', 'buggy']).default('solve').describe('Mode: "solve" provides standard clean starter code, "buggy" provides starter code with intentional bugs for debugging rounds')
    },
    async ({ problem_id_or_slug, language = 'javascript', mode = 'solve' }) => {
      try {
        const problem = getLeetCodeProblem(problem_id_or_slug);
        if (!problem) {
          return {
            content: [{
              type: 'text',
              text: `❌ Problem "${problem_id_or_slug}" not found in LeetCode catalog. Tip: Use \`search_leetcode_problems\` to find the exact problem ID.`
            }],
            isError: true
          };
        }

        let snippet = '';
        if (mode === 'buggy' && problem.buggy_starter && problem.buggy_starter[language]) {
          snippet = problem.buggy_starter[language];
        } else if (problem.starter && problem.starter[language]) {
          snippet = problem.starter[language];
        } else if (problem.starter && problem.starter.javascript) {
          snippet = problem.starter.javascript;
        } else {
          snippet = `// Starter code for ${language}\nfunction solution() {\n  // Implementation here\n}`;
        }

        let output = `## 🧩 LeetCode #${problem.frontend_id}: ${problem.title}\n\n`;
        output += `* **Problem ID:** \`${problem.id}\`\n`;
        output += `* **Difficulty:** \`${problem.difficulty}\`\n`;
        output += `* **Category:** ${problem.category || 'Algorithms'}\n`;
        output += `* **Topics:** ${(problem.topics || []).map(t => `\`${t}\``).join(', ') || 'None'}\n`;
        output += `* **Execution Limits:** Time: ${problem.time_limit_ms}ms | Memory: ${problem.memory_limit_mb}MB\n`;
        output += `* **Function Name:** \`${problem.function_name?.[language] || problem.function_name?.js || 'solution'}\`\n\n`;

        output += `### Description\n${problem.description}\n\n`;

        if (problem.examples && problem.examples.length > 0) {
          output += `### Examples\n`;
          problem.examples.slice(0, 3).forEach((ex, idx) => {
            output += `**Example ${idx + 1}:**\n`;
            output += `* Input: \`${typeof ex.input === 'object' ? JSON.stringify(ex.input) : ex.input}\`\n`;
            output += `* Output: \`${typeof ex.output === 'object' ? JSON.stringify(ex.output) : ex.output}\`\n`;
            if (ex.explanation) output += `* Explanation: ${ex.explanation}\n`;
            output += `\n`;
          });
        }

        if (problem.constraints) {
          output += `### Constraints\n${problem.constraints}\n\n`;
        }

        output += `### Starter Code Template (${language.toUpperCase()} • Mode: ${mode.toUpperCase()})\n`;
        output += `\`\`\`${language}\n${snippet}\n\`\`\`\n\n`;

        output += `💡 **Next Step:** To test or judge a candidate's solution against this problem, call \`judge_code_solution({ problem_id: "${problem.id}", code: "...", language: "${language}" })\`.`;

        return { content: [{ type: 'text', text: output }] };
      } catch (err) {
        return {
          content: [{
            type: 'text',
            text: `❌ Error fetching problem details: ${err.message}`
          }],
          isError: true
        };
      }
    }
  );

  // 3. list_leetcode_topics
  server.tool(
    'list_leetcode_topics',
    'List all available DSA topics in the 4,111+ LeetCode question bank with problem counts and distribution.',
    {},
    async () => {
      try {
        const data = getLeetCodeTopics();
        const topicList = Array.isArray(data) ? data : (data.topics || []);
        const total = data.total || getTotalProblemCount();
        const diffs = data.difficulties || {};

        let output = `### 🏷️ LeetCode DSA Topics Catalog (${topicList.length} Topics • ${total.toLocaleString()} Problems)\n\n`;
        output += `* **Difficulty Distribution:** 🟢 Easy: ${diffs.Easy || 0} | 🟡 Medium: ${diffs.Medium || 0} | 🔴 Hard: ${diffs.Hard || 0}\n\n`;
        output += `| Topic Name | Available Questions |\n`;
        output += `|---|---|\n`;

        topicList.slice(0, 35).forEach(t => {
          output += `| **${t.name || t.topic}** | ${t.count} problems |\n`;
        });

        output += `\n💡 **Usage Tip:** Pass any of these topic names into \`search_leetcode_problems({ topic: "<Topic>" })\` to retrieve matching questions.`;

        return { content: [{ type: 'text', text: output }] };
      } catch (err) {
        return {
          content: [{
            type: 'text',
            text: `❌ Error fetching LeetCode topics: ${err.message}`
          }],
          isError: true
        };
      }
    }
  );
}
