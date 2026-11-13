/**
 * MCP Prompts: Technical Screening & Evaluation Templates
 * 
 * Pre-configured prompt templates for AI agents to conduct structured technical interviews,
 * generate custom rubrics, and draft executive hiring manager debriefs.
 */

import { z } from 'zod';

export function registerPrompts(server) {
  // 1. conduct-technical-screening
  server.prompt(
    'conduct-technical-screening',
    'Template for an AI interviewer to conduct an adaptive, friendly, and rigorous technical interview round.',
    {
      role: z.string().describe('Target job role (e.g. "Senior Backend Python Engineer")'),
      candidate_name: z.string().optional().default('Candidate').describe('Candidate name'),
      duration_minutes: z.string().optional().default('30').describe('Interview duration in minutes')
    },
    async ({ role, candidate_name = 'Candidate', duration_minutes = '30' }) => {
      return {
        messages: [
          {
            role: 'user',
            content: {
              type: 'text',
              text: `You are acting as the autonomous AI Technical Interviewer (Alex) for RoundOne AI, conducting a ${duration_minutes}-minute technical screening for the role of "${role}" with candidate "${candidate_name}".

Follow this structured protocol:
1. **Welcome & Rapport (1-2 mins):** Greet ${candidate_name} warmly, briefly describe the structure of the interview (conceptual questions + one live DSA coding challenge), and ask them to briefly summarize their recent projects.
2. **Deep Conceptual Probing (10-15 mins):** Ask 2-3 focused technical questions on architectural tradeoffs, concurrency, data structures, and failure modes relevant to ${role}. Follow up on vague answers by asking "Why?" and "What tradeoffs did you consider?".
3. **Live Coding Challenge (10-15 mins):** Present an algorithmic problem (e.g. from the LeetCode question bank). Ask the candidate to explain their high-level strategy and time/space complexity before writing code.
4. **Candidate Code Evaluation:** Run \`judge_code_solution\` to verify test cases. If bugs or sub-optimal complexity occur, provide progressive Socratic hints without giving away the answer.
5. **Anti-Hallucination & Fairness:** Stick strictly to objective rubrics, never invent candidate facts, and evaluate based on evidence.
6. **Closing (2 mins):** Thank the candidate and invite any questions they have about the team or tech stack.

Begin by warmly introducing yourself to ${candidate_name} and starting the screening.`
            }
          }
        ]
      };
    }
  );

  // 2. generate-interview-rubric
  server.prompt(
    'generate-interview-rubric',
    'Generate a customized 0-100 objective evaluation rubric tailored to a specific job description and tech stack.',
    {
      job_title: z.string().describe('Role title (e.g. "Lead DevOps / Platform Architect")'),
      tech_stack: z.string().describe('Primary technologies (e.g. "Kubernetes, Terraform, AWS, Go, CI/CD")'),
      seniority_level: z.string().optional().default('Senior').describe('Seniority level (e.g. "Junior", "Mid", "Senior", "Staff")')
    },
    async ({ job_title, tech_stack, seniority_level = 'Senior' }) => {
      return {
        messages: [
          {
            role: 'user',
            content: {
              type: 'text',
              text: `Generate a comprehensive 0-100 objective evaluation rubric for interviewing candidates for the role:
Role: ${job_title} (${seniority_level} Level)
Tech Stack: ${tech_stack}

The rubric must include 4 weighted dimensions totaling 100 points:
1. **Core Domain & Technical Correctness (30 Points):** Mastery of ${tech_stack}, architectural patterns, and production reliability.
2. **Algorithmic Problem Solving & Code Quality (30 Points):** Data structure selection, time/space efficiency (Big-O), testability, and edge cases.
3. **Systems Architecture & Tradeoffs (20 Points):** Scalability, failure modes, security, distributed system pitfalls.
4. **Communication & Collaboration (20 Points):** Clarity of thought, ability to receive feedback, and structured explanations.

Provide benchmark behaviors for:
- Strong Hire (85 - 100)
- Hire (70 - 84)
- Consider / Borderline (50 - 69)
- Reject (< 50)

Include 3 sample probing questions specifically designed to test these criteria.`
            }
          }
        ]
      };
    }
  );

  // 3. candidate-debrief
  server.prompt(
    'candidate-debrief',
    'Synthesize a candidate evaluation debrief and hiring recommendation from interview transcripts, code judge results, and proctoring telemetry.',
    {
      candidate_id_or_interview_id: z.string().describe('The Candidate ID or Interview Session ID to review')
    },
    async ({ candidate_id_or_interview_id }) => {
      return {
        messages: [
          {
            role: 'user',
            content: {
              type: 'text',
              text: `Please generate an executive hiring debrief for candidate session "${candidate_id_or_interview_id}".

First, call the MCP tool:
\`get_candidate_report({ candidate_id_or_interview_id: "${candidate_id_or_interview_id}" })\`

Then synthesize an executive hiring memo with:
1. **Candidate Profile & Overall Score (0-100)**
2. **Clear Recommendation:** Strong Hire / Hire / Consider / Reject
3. **Top 3 Strengths (with verbatim quotes as evidence)**
4. **Key Gaps or Red Flags (including anti-cheat proctoring warnings if any)**
5. **Coding & Algorithmic Performance Summary:** Test cases passed, time/space complexity, clean code conventions.
6. **Suggested Next Stage:** Recommended follow-up questions for the on-site team or final decision.`
            }
          }
        ]
      };
    }
  );
}
