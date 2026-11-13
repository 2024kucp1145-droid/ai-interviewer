/**
 * MCP Tools: Candidate Management, Invitations & Evaluation Reports
 * 
 * Enables LLMs to list candidates, view detailed scorecards & transcripts,
 * check anti-cheat integrity telemetry, and generate interview invitation links.
 */

import { z } from 'zod';
import crypto from 'crypto';
import { db } from '../../backend/src/db/database.js';

export function registerCandidateTools(server) {
  // 1. list_candidates
  server.tool(
    'list_candidates',
    'List candidates across all or specific interview rounds with completion status, overall 0-100 scores, hiring recommendations, and proctoring flags.',
    {
      job_id: z.string().optional().describe('Filter by interview job ID'),
      status: z.enum(['all', 'completed', 'in_progress', 'created']).optional().default('all').describe('Filter by candidate interview state'),
      limit: z.number().int().min(1).max(50).default(25).describe('Max results to return (default 25)')
    },
    async ({ job_id, status = 'all', limit = 25 }) => {
      try {
        let sql = `
          SELECT 
            c.id as candidate_id,
            c.name as candidate_name,
            c.email as candidate_email,
            c.created_at as registered_at,
            i.id as interview_id,
            i.state as interview_state,
            i.job_id,
            j.title as job_title,
            i.started_at,
            i.ended_at,
            i.proctor_warnings,
            r.json as report_json,
            r.overall_score
          FROM candidates c
          JOIN interviews i ON i.candidate_id = c.id
          LEFT JOIN jobs j ON i.job_id = j.id
          LEFT JOIN reports r ON r.interview_id = i.id
        `;
        const params = [];
        const conditions = [];

        if (job_id) {
          conditions.push('i.job_id = ?');
          params.push(job_id);
        }
        if (status !== 'all') {
          conditions.push('i.state = ?');
          params.push(status);
        }

        if (conditions.length > 0) {
          sql += ` WHERE ${conditions.join(' AND ')} `;
        }

        sql += ` ORDER BY c.created_at DESC LIMIT ? `;
        params.push(limit);

        const rows = db.prepare(sql).all(...params);

        let output = `### 👥 Candidate Screening Roster (${rows.length} candidates)\n\n`;

        if (rows.length === 0) {
          output += `_No candidates found matching criteria._\n`;
          output += `Use \`invite_candidate\` to generate a candidate link and register an applicant.\n`;
          return { content: [{ type: 'text', text: output }] };
        }

        output += `| Candidate Name | Email | Interview Role | State | Score | Recommendation | Anti-Cheat |\n`;
        output += `|---|---|---|---|---|---|---|\n`;

        for (const r of rows) {
          let scoreStr = 'Pending';
          let recStr = '—';
          if (r.report_json) {
            try {
              const rep = JSON.parse(r.report_json);
              if (rep.overall_score !== undefined) scoreStr = `${rep.overall_score}/100`;
              if (rep.recommendation) recStr = rep.recommendation;
            } catch {}
          } else if (r.overall_score !== null && r.overall_score !== undefined) {
            scoreStr = `${r.overall_score}/100`;
          }

          const warnings = r.proctor_warnings ? `⚠️ ${r.proctor_warnings} flags` : '🟢 Clear';
          output += `| **${r.candidate_name}** | \`${r.candidate_email}\` | ${r.job_title || r.job_id} | \`${r.interview_state}\` | **${scoreStr}** | ${recStr} | ${warnings} |\n`;
        }

        output += `\n💡 **Tip:** Use \`get_candidate_report({ candidate_id_or_interview_id: "<ID>" })\` for full conversational transcripts, code snapshots, and rubric analysis.`;

        return { content: [{ type: 'text', text: output }] };
      } catch (err) {
        return {
          content: [{
            type: 'text',
            text: `❌ Error listing candidates: ${err.message}`
          }],
          isError: true
        };
      }
    }
  );

  // 2. get_candidate_report
  server.tool(
    'get_candidate_report',
    'Retrieve the comprehensive evaluation dossier for a candidate session: 0-100 score, rubric breakdown, question-by-question dialogue transcript with latency, code test submissions, and anti-cheating telemetry.',
    {
      candidate_id_or_interview_id: z.string().describe('Candidate ID, Interview Session ID, or session token'),
      include_transcript: z.boolean().optional().default(true).describe('Include question-by-question candidate dialogue turns (default: true)'),
      include_proctor_telemetry: z.boolean().optional().default(true).describe('Include anti-cheat integrity flags and tab switch logs (default: true)')
    },
    async ({ candidate_id_or_interview_id, include_transcript = true, include_proctor_telemetry = true }) => {
      try {
        const tokenHash = crypto.createHash('sha256').update(candidate_id_or_interview_id).digest('hex');

        const interview = db.prepare(`
          SELECT 
            i.*,
            c.name as candidate_name,
            c.email as candidate_email,
            c.phone as candidate_phone,
            c.resume_text,
            j.title as job_title,
            j.skills as job_skills,
            j.category as job_category,
            j.leetcode_problem,
            r.json as report_json,
            r.manual_decision,
            r.reviewer_note
          FROM interviews i
          LEFT JOIN candidates c ON i.candidate_id = c.id
          LEFT JOIN jobs j ON i.job_id = j.id
          LEFT JOIN reports r ON r.interview_id = i.id
          WHERE i.id = ? OR i.candidate_id = ? OR i.token_hash = ?
        `).get(candidate_id_or_interview_id, candidate_id_or_interview_id, tokenHash);

        if (!interview) {
          return {
            content: [{
              type: 'text',
              text: `❌ Candidate or interview session "${candidate_id_or_interview_id}" not found. Tip: Check ID using \`list_candidates\`.`
            }],
            isError: true
          };
        }

        let reportData = null;
        if (interview.report_json) {
          try { reportData = JSON.parse(interview.report_json); } catch {}
        }

        let output = `## 📄 Candidate Evaluation Dossier: ${interview.candidate_name || 'Anonymous Candidate'}\n\n`;
        output += `* **Email:** \`${interview.candidate_email || 'N/A'}\`\n`;
        output += `* **Target Role:** **${interview.job_title || interview.job_id}** (${interview.job_category || 'Tech'})\n`;
        output += `* **Session Status:** \`${interview.state.toUpperCase()}\` (Started: ${interview.started_at || 'Not started'}, Ended: ${interview.ended_at || 'In progress'})\n`;

        if (reportData) {
          const score = reportData.overall_score ?? 'N/A';
          const rec = reportData.recommendation || 'Under Review';
          output += `* **Overall Score:** **${score}/100**\n`;
          output += `* **Hiring Recommendation:** **${rec.toUpperCase()}**\n\n`;

          if (reportData.scores || reportData.rubric) {
            output += `### 📊 Objective Rubric Breakdown\n`;
            const rubrics = reportData.scores || reportData.rubric;
            if (typeof rubrics === 'object') {
              for (const [key, val] of Object.entries(rubrics)) {
                output += `* **${key.replace(/_/g, ' ').toUpperCase()}:** ${typeof val === 'object' ? JSON.stringify(val) : `${val}/100`}\n`;
              }
            }
            output += `\n`;
          }

          if (reportData.summary) {
            output += `### 💡 Executive Evaluation Summary\n${reportData.summary}\n\n`;
          }

          if (reportData.evidence_quotes && reportData.evidence_quotes.length > 0) {
            output += `### 💬 Key Evidence Quotes (Verbatim From Candidate)\n`;
            reportData.evidence_quotes.forEach(q => {
              output += `> "${q.quote || q}" _— ${q.skill || 'Response'}: ${q.assessment || 'verified'}_\n\n`;
            });
          }
        } else {
          output += `* **Evaluation Score:** _Interview still in progress or report pending generation._\n\n`;
        }

        // DSA Code Submission details
        if (interview.dsa_result) {
          try {
            const dsa = typeof interview.dsa_result === 'string' ? JSON.parse(interview.dsa_result) : interview.dsa_result;
            output += `### 💻 Live Coding Assessment (LeetCode #${interview.leetcode_problem || '1'})\n`;
            output += `* **Judge Verdict:** \`${dsa.verdict || 'PENDING'}\` (${dsa.passedCount || 0}/${dsa.totalCount || 0} test cases passed)\n`;
            output += `* **Runtime Latency:** ${dsa.runtimeMs || 0}ms\n`;
            output += `* **Memory:** ${dsa.memoryMb || 'N/A'} MB\n`;
            if (interview.code_draft) {
              output += `\n**Submitted Code (${interview.code_lang || 'javascript'}):**\n\`\`\`${interview.code_lang || 'javascript'}\n${interview.code_draft}\n\`\`\`\n\n`;
            }
          } catch {}
        }

        // Anti-Cheating & Proctoring Telemetry
        if (include_proctor_telemetry) {
          output += `### 🛡️ Anti-Cheating & Integrity Telemetry\n`;
          output += `* **Proctor Warnings Count:** ${interview.proctor_warnings || 0}\n`;

          const snapshots = db.prepare('SELECT reason, created_at FROM proctor_snapshots WHERE interview_id = ? ORDER BY created_at ASC').all(interview.id);
          if (snapshots.length > 0) {
            output += `* **Integrity Events Recorded:**\n`;
            snapshots.forEach(s => {
              output += `  - ⚠️ \`${s.created_at}\`: ${s.reason}\n`;
            });
          } else {
            output += `* **Integrity Status:** 🟢 Clean session (Zero suspicious focus loss or copy-paste events recorded).\n`;
          }
          output += `\n`;
        }

        // Conversational Transcript Turns
        if (include_transcript) {
          const turns = db.prepare('SELECT idx, role, text, skill, created_at FROM turns WHERE interview_id = ? ORDER BY idx ASC').all(interview.id);
          if (turns.length > 0) {
            output += `### 🎙️ Conversational Interview Transcript (${turns.length} dialog turns)\n\n`;
            for (const t of turns) {
              const speaker = t.role === 'agent' ? '🤖 AI Lead' : '👤 Candidate';
              output += `**${speaker} (Turn ${t.idx}${t.skill ? ` • ${t.skill}` : ''}):**\n${t.text}\n\n`;
            }
          }
        }

        return { content: [{ type: 'text', text: output }] };
      } catch (err) {
        return {
          content: [{
            type: 'text',
            text: `❌ Error generating candidate report: ${err.message}`
          }],
          isError: true
        };
      }
    }
  );

  // 3. invite_candidate
  server.tool(
    'invite_candidate',
    'Generate an AI technical interview session link for a candidate and optionally dispatch an invitation email.',
    {
      job_id: z.string().describe('Interview Job ID to invite the candidate for (e.g. "job_fullstack_starter")'),
      candidate_name: z.string().describe('Full name of the candidate'),
      candidate_email: z.string().describe('Email address of the candidate'),
      candidate_phone: z.string().optional().describe('Optional contact phone number')
    },
    async ({ job_id, candidate_name, candidate_email, candidate_phone }) => {
      try {
        const job = db.prepare('SELECT * FROM jobs WHERE id = ?').get(job_id);
        if (!job) {
          return {
            content: [{
              type: 'text',
              text: `❌ Interview round "${job_id}" not found. Please verify the Job ID using \`list_interviews\`.`
            }],
            isError: true
          };
        }

        const candidateId = 'cand_' + crypto.randomUUID();
        const interviewId = 'int_' + crypto.randomUUID();
        const rawToken = crypto.randomBytes(32).toString('hex');
        const tokenHash = crypto.createHash('sha256').update(rawToken).digest('hex');
        const timerMins = (job.max_minutes || 15) * 60;
        const expiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString();

        // Transactional insert
        const tx = db.transaction(() => {
          db.prepare(`
            INSERT INTO candidates (id, org_id, name, email, phone, resume_text, source)
            VALUES (?, ?, ?, ?, ?, '', 'mcp_agent_invite')
          `).run(candidateId, job.org_id || 'org_default', candidate_name.trim(), candidate_email.trim().toLowerCase(), candidate_phone || null);

          db.prepare(`
            INSERT INTO interviews (id, job_id, candidate_id, token_hash, state, link_timer_minutes, expires_at, dispatch_status, dispatch_channel, source)
            VALUES (?, ?, ?, ?, 'created', ?, ?, 'created', 'mcp_direct', 'mcp_agent_invite')
          `).run(interviewId, job.id, candidateId, tokenHash, timerMins, expiresAt);
        });

        tx();

        const candidateUrl = `http://localhost:3001/interview.html?token=${rawToken}`;

        let output = `## ✉️ Candidate Interview Invitation Created!\n\n`;
        output += `* **Candidate:** **${candidate_name}** (\`${candidate_email}\`)\n`;
        output += `* **Interview Role:** ${job.title}\n`;
        output += `* **Candidate ID:** \`${candidateId}\`\n`;
        output += `* **Interview ID:** \`${interviewId}\`\n`;
        output += `* **Expires:** ${expiresAt} (7 days)\n\n`;

        output += `### 🔗 Candidate Screening URL\n`;
        output += `Deliver this unique link to the candidate:\n`;
        output += `\`${candidateUrl}\`\n\n`;

        output += `💡 **Pro-Tip for AI Agents:** When the candidate completes the screening, call \`get_candidate_report({ candidate_id_or_interview_id: "${interviewId}" })\` to inspect the results.`;

        return { content: [{ type: 'text', text: output }] };
      } catch (err) {
        return {
          content: [{
            type: 'text',
            text: `❌ Error creating candidate invitation: ${err.message}`
          }],
          isError: true
        };
      }
    }
  );
}
