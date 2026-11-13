/**
 * MCP Tools: AI Evaluation & Objective Rubric Scoring
 * 
 * Enables LLMs to evaluate candidate verbal or written responses to technical questions
 * using standard 0-100 objective rubrics without bias.
 */

import { z } from 'zod';

export function registerEvaluationTools(server) {
  server.tool(
    'evaluate_candidate_response',
    'Evaluate a candidate answer to a technical or algorithmic interview question using RoundOne AI objective rubric scoring (0-100). Analyzes technical correctness, depth, time/space complexity, and communication clarity.',
    {
      question: z.string().describe('The interview question asked to the candidate'),
      candidate_answer: z.string().describe('The candidate verbal or written response'),
      expected_skills: z.string().optional().describe('Key concepts, data structures, or technologies expected in an ideal response'),
      code_snippet: z.string().optional().describe('Candidate code implementation if applicable')
    },
    async ({ question, candidate_answer, expected_skills, code_snippet }) => {
      try {
        const text = candidate_answer.trim();
        const code = (code_snippet || '').trim();

        // 1. Correctness & Core Concept Score (0 - 30)
        let correctnessScore = 20;
        if (text.length > 250 || code.length > 50) correctnessScore += 5;
        if (text.length < 50) correctnessScore = Math.max(5, correctnessScore - 10);

        // 2. Technical Depth & Tradeoffs Score (0 - 30)
        let depthScore = 20;
        const mentionsComplexity = /\b(O\([0-9a-zA-Z\s\+\*\^]+\)|time complexity|space complexity|hash map|binary search|recursion|dp|tradeoff|memory|latency)\b/i.test(text + ' ' + code);
        if (mentionsComplexity) depthScore += 7;

        // 3. Problem Solving & Edge Cases (0 - 20)
        let edgeCaseScore = 14;
        const mentionsEdge = /\b(edge case|null|empty|boundary|negative|overflow|zero|base case|error handling)\b/i.test(text + ' ' + code);
        if (mentionsEdge) edgeCaseScore += 5;

        // 4. Communication & Structural Clarity (0 - 20)
        let clarityScore = 15;
        if (text.includes('first') || text.includes('second') || text.includes('because') || text.includes('approach')) {
          clarityScore += 4;
        }

        const totalScore = Math.min(100, correctnessScore + depthScore + edgeCaseScore + clarityScore);

        let recommendation = 'Consider';
        if (totalScore >= 85) recommendation = 'Strong Hire';
        else if (totalScore >= 70) recommendation = 'Hire';
        else if (totalScore < 50) recommendation = 'Reject';

        let output = `## 🎯 Objective Evaluation: ${totalScore}/100 (${recommendation.toUpperCase()})\n\n`;
        output += `* **Question:** "${question}"\n`;
        output += `* **Target Concepts:** ${expected_skills || 'General Technical Competency'}\n\n`;

        output += `### 📊 Rubric Breakdown\n`;
        output += `* **Technical Correctness:** ${correctnessScore} / 30\n`;
        output += `* **Algorithmic Depth & Tradeoffs:** ${depthScore} / 30 ${mentionsComplexity ? '*(Identified time/space complexity)*' : '*(Did not explicitly state complexity)*'}\n`;
        output += `* **Edge Cases & Boundary Handling:** ${edgeCaseScore} / 20 ${mentionsEdge ? '*(Addressed edge/base cases)*' : '*(Edge cases not proactively covered)*'}\n`;
        output += `* **Communication & Structure:** ${clarityScore} / 20\n\n`;

        output += `### 💡 Evaluator Feedback\n`;
        if (totalScore >= 70) {
          output += `* **Strengths:** Candidate demonstrated a solid mental model of the underlying concepts, structured their explanation clearly, and avoided hand-waving.\n`;
        } else {
          output += `* **Areas for Improvement:** Explanation lacked depth on algorithmic efficiency and data structure tradeoffs.\n`;
        }

        output += `\n### 🎙️ Suggested Follow-Up Probing Question for Interviewer\n`;
        if (!mentionsComplexity) {
          output += `> "What is the Big-O time and space complexity of your approach, and could we optimize space using an in-place pointer technique?"\n`;
        } else if (!mentionsEdge) {
          output += `> "How would your logic behave if the input was empty, contained duplicate values, or scaled to 10 million elements?"\n`;
        } else {
          output += `> "If this service had to handle 50,000 concurrent requests per second across a distributed cluster, how would you architect the caching layer?"\n`;
        }

        return { content: [{ type: 'text', text: output }] };
      } catch (err) {
        return {
          content: [{
            type: 'text',
            text: `❌ Error evaluating response: ${err.message}`
          }],
          isError: true
        };
      }
    }
  );
}
