/**
 * MCP Tools: Interview Configuration & Technical Screening Rounds
 * 
 * Enables LLMs to list, inspect, create, and manage AI technical interview configurations.
 */

import { z } from 'zod';
import crypto from 'crypto';
import { db } from '../../backend/src/db/database.js';

export function registerInterviewTools(server) {
  // 1. list_interviews
  server.tool(
    'list_interviews',
    'List all configured technical screening interviews in RoundOne AI with job titles, categories, required skills, duration, attached LeetCode problem, and candidate counts.',
    {
      category: z.string().optional().describe('Filter by category (e.g. "Software & Tech", "Data, AI & Analytics", "Security & Networking")'),
      limit: z.number().int().min(1).max(50).default(20).describe('Max number of interviews to return (default 20)')
    },
    async ({ category, limit = 20 }) => {
      try {
        let sql = `
          SELECT 
            j.id, 
            j.title, 
            j.category, 
            j.level, 
            j.max_minutes, 
            j.max_questions, 
            j.skills, 
            j.leetcode_problem, 
            j.created_at,
            (SELECT COUNT(*) FROM interviews i WHERE i.job_id = j.id) as total_interviews,
            (SELECT COUNT(*) FROM interviews i WHERE i.job_id = j.id AND i.state = 'completed') as completed_interviews
          FROM jobs j
        `;
        const params = [];

        if (category) {
          sql += ` WHERE j.category = ? `;
          params.push(category);
        }

        sql += ` ORDER BY j.created_at DESC LIMIT ? `;
        params.push(limit);

        const rows = db.prepare(sql).all(...params);

        let output = `### 📋 Configured Technical Screening Rounds (${rows.length} rounds)\n\n`;

        if (rows.length === 0) {
          output += `_No interviews configured yet${category ? ` in category "${category}"` : ''}._\n`;
          output += `You can create one using the \`create_interview\` tool.\n`;
          return { content: [{ type: 'text', text: output }] };
        }

        output += `| Job ID | Title | Category | Duration | Skills | Coding Problem | Total Candidates |\n`;
        output += `|---|---|---|---|---|---|---|\n`;

        for (const r of rows) {
          const skillsShort = (r.skills || '').split(',').slice(0, 3).join(', ') + ((r.skills || '').split(',').length > 3 ? '...' : '');
          output += `| \`${r.id}\` | **${r.title}** | ${r.category || 'Tech'} | ${r.max_minutes || 15}m | ${skillsShort || 'General'} | LC #${r.leetcode_problem || '1'} | ${r.total_interviews} (${r.completed_interviews} finished) |\n`;
        }

        output += `\n💡 **Tip:** Use \`get_interview_details({ job_id: "<Job ID>" })\` to view the full question list and proctoring settings, or \`invite_candidate\` to generate candidate screening links.`;

        return { content: [{ type: 'text', text: output }] };
      } catch (err) {
        return {
          content: [{
            type: 'text',
            text: `❌ Error listing interviews: ${err.message}`
          }],
          isError: true
        };
      }
    }
  );

  // 2. get_interview_details
  server.tool(
    'get_interview_details',
    'Get full configuration for a specific interview round including custom questions, LeetCode problem, time limits, memory limits, and proctoring rules.',
    {
      job_id: z.string().describe('Interview Job ID (e.g. "job_fullstack_starter")')
    },
    async ({ job_id }) => {
      try {
        const job = db.prepare('SELECT * FROM jobs WHERE id = ?').get(job_id);
        if (!job) {
          return {
            content: [{
              type: 'text',
              text: `❌ Interview round with ID "${job_id}" not found. Tip: Use \`list_interviews\` to find valid IDs.`
            }],
            isError: true
          };
        }

        const candidateStats = db.prepare(`
          SELECT 
            COUNT(*) as total,
            SUM(CASE WHEN state = 'completed' THEN 1 ELSE 0 END) as completed,
            SUM(CASE WHEN state = 'in_progress' THEN 1 ELSE 0 END) as active
          FROM interviews WHERE job_id = ?
        `).get(job.id);

        let output = `## 🎯 Interview Round: ${job.title}\n\n`;
        output += `* **Job ID:** \`${job.id}\`\n`;
        output += `* **Category:** ${job.category || 'Software & Tech'}\n`;
        output += `* **Seniority Level:** \`${job.level || 'junior'}\`\n`;
        output += `* **Target Duration:** ${job.max_minutes || 15} minutes (Max Questions: ${job.max_questions || 6})\n`;
        output += `* **Required Skills:** ${job.skills || 'General Engineering'}\n`;
        output += `* **Created At:** ${job.created_at}\n\n`;

        output += `### 💻 Coding & DSA Configuration\n`;
        output += `* **Assigned LeetCode Problem:** #${job.leetcode_problem || '1'}\n`;
        output += `* **Compiler Languages:** \`${job.compiler_languages || 'javascript,python,sql'}\`\n`;
        output += `* **Execution Limits:** ${job.dsa_time_limit_ms || 2000}ms timeout • ${job.dsa_memory_limit_mb || 256}MB memory\n`;
        output += `* **Coding Challenge Mode:** \`${job.dsa_question_mode || 'solve'}\` (Blind grading: ${job.dsa_blind_mode ? 'Enabled' : 'Disabled'})\n\n`;

        output += `### 🛡️ Anti-Cheating & Proctoring Rules\n`;
        output += `* **Tab Focus Tracking:** Enabled\n`;
        output += `* **Copy-Paste Telemetry:** Enabled\n`;
        output += `* **Resume Requirement:** ${job.resume_required ? 'Required' : 'Optional'}\n`;
        output += `* **Auto-Submit on Timer Expiry:** ${job.auto_submit_timer ? 'Yes' : 'No'}\n\n`;

        if (job.custom_questions) {
          output += `### 📝 Configured Questions\n`;
          const lines = String(job.custom_questions).split('\n').filter(Boolean);
          lines.forEach((q, idx) => {
            output += `${idx + 1}. ${q.replace(/^\d+[\.\)]\s*/, '')}\n`;
          });
          output += `\n`;
        }

        output += `### 📊 Candidate Pipeline Activity\n`;
        output += `* **Total Candidates Invited:** ${candidateStats?.total || 0}\n`;
        output += `* **Completed Screenings:** ${candidateStats?.completed || 0}\n`;
        output += `* **In-Progress Sessions:** ${candidateStats?.active || 0}\n\n`;

        output += `🔗 **Direct Candidate Link:** \`http://localhost:3001/interview.html?jobId=${job.id}\`\n`;

        return { content: [{ type: 'text', text: output }] };
      } catch (err) {
        return {
          content: [{
            type: 'text',
            text: `❌ Error fetching interview details: ${err.message}`
          }],
          isError: true
        };
      }
    }
  );

  // 3. create_interview
  server.tool(
    'create_interview',
    'Create a new technical screening interview round with custom questions, LeetCode coding problem, duration, and proctoring settings.',
    {
      title: z.string().describe('Role or interview title (e.g. "Senior React & Node Full-Stack Engineer")'),
      skills: z.string().describe('Comma-separated list of required technical skills (e.g. "React, Node.js, TypeScript, PostgreSQL, System Design")'),
      category: z.string().optional().default('Software & Tech').describe('Job category (default: "Software & Tech")'),
      level: z.enum(['entry', 'junior', 'mid', 'senior', 'lead']).optional().default('mid').describe('Seniority level (default: mid)'),
      duration_mins: z.number().int().min(5).max(180).optional().default(30).describe('Interview duration in minutes (default 30)'),
      leetcode_problem_id: z.string().optional().default('1').describe('LeetCode problem ID to assign for the coding assessment (default: "1" Two Sum)'),
      compiler_languages: z.string().optional().default('javascript,python,sql').describe('Supported coding languages (default: "javascript,python,sql")'),
      custom_questions: z.array(z.string()).optional().describe('Optional specific technical questions to ask during the interview'),
      jd_text: z.string().optional().describe('Optional job description or role context text')
    },
    async ({
      title,
      skills,
      category = 'Software & Tech',
      level = 'mid',
      duration_mins = 30,
      leetcode_problem_id = '1',
      compiler_languages = 'javascript,python,sql',
      custom_questions = [],
      jd_text = ''
    }) => {
      try {
        const jobId = 'job_' + crypto.randomUUID();
        const fullJd = jd_text || `Technical screening interview for ${title}. Target skills: ${skills}.`;
        const questionsStr = (custom_questions || []).map((q, i) => `${i + 1}. ${q}`).join('\n');
        const maxQuestions = Math.max(3, Math.min(20, Math.round(duration_mins / 3)));

        // Ensure default org exists
        db.prepare(`
          INSERT OR IGNORE INTO organizations (id, name, plan, included_interviews)
          VALUES ('org_default', 'Hiring Team', 'enterprise', 1000)
        `).run();

        db.prepare(`
          INSERT INTO jobs (
            id, org_id, title, jd_text, skills, level, max_minutes, max_questions,
            interview_type, question_mode, custom_questions, terminal_required,
            word_editor_required, resume_required, purpose, experience_required,
            leetcode_problem, compiler_languages, category, show_timer, auto_submit_timer,
            dsa_time_limit_ms, dsa_memory_limit_mb, dsa_question_mode, dsa_questions_count, dsa_blind_mode
          ) VALUES (
            ?, 'org_default', ?, ?, ?, ?, ?, ?,
            'technical', 'ai_adaptive', ?, 0,
            0, 1, 'job', '2-5 Yrs',
            ?, ?, ?, 1, 1,
            2000, 256, 'solve', 1, 1
          )
        `).run(
          jobId,
          title,
          fullJd,
          skills,
          level,
          duration_mins,
          maxQuestions,
          questionsStr,
          leetcode_problem_id,
          compiler_languages,
          category
        );

        let output = `## ✅ Technical Interview Round Created Successfully!\n\n`;
        output += `* **Job ID:** \`${jobId}\`\n`;
        output += `* **Title:** **${title}**\n`;
        output += `* **Category:** ${category}\n`;
        output += `* **Level:** ${level.toUpperCase()}\n`;
        output += `* **Duration:** ${duration_mins} minutes (${maxQuestions} questions)\n`;
        output += `* **Required Skills:** ${skills}\n`;
        output += `* **Assigned Coding Challenge:** LeetCode #${leetcode_problem_id}\n\n`;

        output += `### 🔗 Candidate Share Link\n`;
        output += `Candidates can launch this interview directly using:\n`;
        output += `\`http://localhost:3001/interview.html?jobId=${jobId}\`\n\n`;

        output += `💡 **Next Step:** You can invite specific candidates using \`invite_candidate({ job_id: "${jobId}", candidate_name: "...", candidate_email: "..." })\`.`;

        return { content: [{ type: 'text', text: output }] };
      } catch (err) {
        return {
          content: [{
            type: 'text',
            text: `❌ Error creating interview: ${err.message}`
          }],
          isError: true
        };
      }
    }
  );

  // 4. update_interview
  server.tool(
    'update_interview',
    'Update existing interview round settings such as duration, required skills, attached LeetCode problem, or questions.',
    {
      job_id: z.string().describe('Interview Job ID to update'),
      title: z.string().optional().describe('New interview title'),
      skills: z.string().optional().describe('New comma-separated skills list'),
      duration_mins: z.number().int().min(5).max(180).optional().describe('New duration in minutes'),
      leetcode_problem_id: z.string().optional().describe('New LeetCode problem ID')
    },
    async ({ job_id, title, skills, duration_mins, leetcode_problem_id }) => {
      try {
        const job = db.prepare('SELECT * FROM jobs WHERE id = ?').get(job_id);
        if (!job) {
          return {
            content: [{
              type: 'text',
              text: `❌ Interview round "${job_id}" not found.`
            }],
            isError: true
          };
        }

        const updates = [];
        const params = [];

        if (title !== undefined) { updates.push('title = ?'); params.push(title); }
        if (skills !== undefined) { updates.push('skills = ?'); params.push(skills); }
        if (duration_mins !== undefined) {
          updates.push('max_minutes = ?');
          params.push(duration_mins);
          updates.push('max_questions = ?');
          params.push(Math.max(3, Math.min(20, Math.round(duration_mins / 3))));
        }
        if (leetcode_problem_id !== undefined) { updates.push('leetcode_problem = ?'); params.push(leetcode_problem_id); }

        if (updates.length === 0) {
          return { content: [{ type: 'text', text: 'No fields specified to update.' }] };
        }

        params.push(job_id);
        db.prepare(`UPDATE jobs SET ${updates.join(', ')} WHERE id = ?`).run(...params);

        return {
          content: [{
            type: 'text',
            text: `✅ Interview round \`${job_id}\` updated successfully. Call \`get_interview_details\` to view the updated configuration.`
          }]
        };
      } catch (err) {
        return {
          content: [{
            type: 'text',
            text: `❌ Error updating interview: ${err.message}`
          }],
          isError: true
        };
      }
    }
  );
}
