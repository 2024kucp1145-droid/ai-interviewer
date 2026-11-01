import crypto from 'crypto';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { db } from '../db/database.js';
import { GeminiProvider } from '../ai/gemini.js';
import { decryptApiKey } from '../keys/vault.js';
import { generateAdaptiveQuestion, generateFollowUpQuestion } from './questionBank.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const PROMPT_PATH = path.resolve(__dirname, '../../../prompts/interviewer.txt');

let INTERVIEWER_PROMPT_TEMPLATE = '';
try {
  INTERVIEWER_PROMPT_TEMPLATE = fs.readFileSync(PROMPT_PATH, 'utf8');
} catch (e) {
  INTERVIEWER_PROMPT_TEMPLATE = `You are a technical interviewer for a junior developer role. Ask ONE question at a time. Return JSON: {"question": "...", "skill": "...", "level": 1-3}`;
}

/**
 * Get Provider instance for an organization
 */
export function getProviderForOrg(orgId) {
  const keyRow = db.prepare('SELECT * FROM provider_keys WHERE org_id = ? AND status = ?').get(orgId, 'active');
  if (keyRow && keyRow.key_encrypted) {
    try {
      const decryptedKey = decryptApiKey(keyRow.key_encrypted);
      return new GeminiProvider(decryptedKey);
    } catch (e) {
      console.error(`Failed to decrypt key for org ${orgId}: ${e.message}`);
    }
  }
  return new GeminiProvider(process.env.GEMINI_API_KEY || '');
}

/**
 * Record usage event & calculate estimated cost (in INR)
 */
export function trackUsage(orgId, interviewId, kind, inputTokens, outputTokens) {
  // Rates: approx ₹25 / million input, ₹200 / million output
  const estCost = (inputTokens / 1000000 * 25) + (outputTokens / 1000000 * 200);
  const id = 'usage_' + crypto.randomUUID();
  db.prepare(`
    INSERT INTO usage_events (id, org_id, interview_id, kind, input_tokens, output_tokens, est_cost)
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `).run(id, orgId, interviewId, kind, inputTokens, outputTokens, estCost);
}

/**
 * Process a candidate turn or initialize the interview
 */
export async function processInterviewTurn({ interviewId, candidateText = null }) {
  const interview = db.prepare('SELECT * FROM interviews WHERE id = ?').get(interviewId);
  if (!interview) throw new Error('Interview not found');

  const job = db.prepare('SELECT * FROM jobs WHERE id = ?').get(interview.job_id);
  const candidate = db.prepare('SELECT * FROM candidates WHERE id = ?').get(interview.candidate_id);

  // Fetch turns
  const turns = db.prepare('SELECT * FROM turns WHERE interview_id = ? ORDER BY idx ASC').all(interviewId);

  // If candidateText is provided, save candidate turn first
  if (candidateText && candidateText.trim()) {
    const nextIdx = turns.length + 1;
    const turnId = 'turn_' + crypto.randomUUID();
    db.prepare(`
      INSERT INTO turns (id, interview_id, idx, role, text, skill, level)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `).run(turnId, interviewId, nextIdx, 'candidate', candidateText.trim(), 'Answer', 1);

    turns.push({
      id: turnId,
      interview_id: interviewId,
      idx: nextIdx,
      role: 'candidate',
      text: candidateText.trim()
    });
  }

  // Count AI questions asked so far
  const aiTurnsCount = turns.filter(t => t.role === 'ai').length;

  // Check if max questions reached
  if (aiTurnsCount >= (job.max_questions || 10)) {
    db.prepare(`UPDATE interviews SET state = 'completed', ended_at = CURRENT_TIMESTAMP WHERE id = ?`).run(interviewId);
    return {
      isCompleted: true,
      message: 'Interview completed. Thank you for your time!',
      state: 'completed'
    };
  }

  // Check if recruiter defined custom questions
  const customQuestionsList = (job.custom_questions || '')
    .split('\n')
    .map(q => q.trim())
    .filter(Boolean);

  let parsedQuestion = null;

  if (job.question_mode === 'custom_questions' && customQuestionsList.length > 0) {
    if (aiTurnsCount < customQuestionsList.length) {
      parsedQuestion = {
        question: customQuestionsList[aiTurnsCount],
        skill: "Custom Screening Question",
        level: 2
      };
    } else {
      // Completed all custom questions
      db.prepare(`UPDATE interviews SET state = 'completed', ended_at = CURRENT_TIMESTAMP WHERE id = ?`).run(interviewId);
      return {
        isCompleted: true,
        message: 'All custom screening questions answered. Interview completed.',
        state: 'completed'
      };
    }
  }

  // Check if an adaptive follow-up question is warranted (max 1-2 per topic)
  if (!parsedQuestion && candidateText && candidateText.trim() && turns.length > 1) {
    let consecutiveFollowUps = 0;
    for (let i = turns.length - 2; i >= 0; i--) {
      if (turns[i].role === 'ai') {
        const sk = turns[i].skill || '';
        if (sk.includes('Follow-Up') || sk.includes('Deep Dive') || sk.includes('Problem Solving')) {
          consecutiveFollowUps++;
        } else {
          break;
        }
      }
    }

    const lastAiTurn = turns.filter(t => t.role === 'ai').pop();
    if (lastAiTurn && consecutiveFollowUps < 2 && aiTurnsCount < (job.max_questions || 6)) {
      const followUp = generateFollowUpQuestion({
        lastQuestion: lastAiTurn.text,
        lastAnswer: candidateText.trim(),
        skill: lastAiTurn.skill || 'General',
        followUpCount: consecutiveFollowUps
      });
      if (followUp) {
        parsedQuestion = followUp;
      }
    }
  }

  // Otherwise, AI Adaptive Generation for next main topic
  if (!parsedQuestion) {
    // Count main topics asked so far (excluding follow-ups)
    const mainQuestionsAsked = turns.filter(t => 
      t.role === 'ai' && 
      !t.skill?.includes('Follow-Up') && 
      !t.skill?.includes('Deep Dive') && 
      !t.skill?.includes('Problem Solving')
    ).length;

    // Prepare system prompt with substitutions
    const skillsList = job.skills || 'Core Skills';
    const roleTitle = job.title || 'Technical Professional';
    const category = job.category || 'Software & Tech';
    const claims = candidate.resume_text ? candidate.resume_text.slice(0, 1000) : 'Candidate screening session';
    const qualifications = job.qualifications || 'Standard degree or equivalent experience';
    const rules = job.assessment_rules || 'Standard objective proctoring';
    const leetcode = job.leetcode_problem || 'None';

    const systemPrompt = INTERVIEWER_PROMPT_TEMPLATE
      .replace(/{role}/g, roleTitle)
      .replace(/{category}/g, category)
      .replace(/{skills}/g, skillsList)
      .replace(/{claims}/g, `${claims}. Candidate qualifications: ${qualifications}`)
      .replace(/{rules}/g, rules)
      .replace(/{leetcode}/g, leetcode)
      .replace(/{max_q}/g, String(job.max_questions || 6))
      .replace(/{max_min}/g, String(job.max_minutes || 15));

    // Build message history (last 8 turns to conserve tokens & prevent drift)
    const recentTurns = turns.slice(-8);
    const messages = recentTurns.map(t => {
      if (t.role === 'candidate') {
        return {
          role: 'candidate',
          text: `<candidate_answer>\n${t.text}\n</candidate_answer>`
        };
      }
      return {
        role: 'ai',
        text: t.text
      };
    });

    if (messages.length === 0) {
      messages.push({
        role: 'candidate',
        text: '<candidate_answer>\nCandidate has just started the interview.\n</candidate_answer>'
      });
    }

    const provider = getProviderForOrg(job.org_id);
    const lastCandidateAnswer = turns.filter(t => t.role === 'candidate').pop()?.text || '';

    const context = {
      role: roleTitle,
      category,
      skills: skillsList,
      leetcode: job.leetcode_problem,
      candidateTurnIndex: mainQuestionsAsked,
      lastAnswer: lastCandidateAnswer,
      resumeSummary: claims
    };

    const aiResult = await provider.generate({
      systemPrompt,
      messages,
      temperature: 0.3,
      context
    });

    trackUsage(job.org_id, interviewId, 'interview_turn', aiResult.inputTokens, aiResult.outputTokens);

    try {
      const cleanedText = aiResult.text.replace(/```json/g, '').replace(/```/g, '').trim();
      const jsonParsed = JSON.parse(cleanedText);
      if (jsonParsed.question) {
        parsedQuestion = jsonParsed;
      }
    } catch (err) {
      if (aiResult.text && !aiResult.text.startsWith('{')) {
        parsedQuestion = { question: aiResult.text, skill: 'General', level: 1 };
      }
    }

    if (!parsedQuestion) {
      parsedQuestion = generateAdaptiveQuestion(context);
    }
  }

  // Save AI Turn
  const aiTurnId = 'turn_' + crypto.randomUUID();
  const aiIdx = turns.length + 1;
  db.prepare(`
    INSERT INTO turns (id, interview_id, idx, role, text, skill, level)
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `).run(aiTurnId, interviewId, aiIdx, 'ai', parsedQuestion.question, parsedQuestion.skill || 'General', parsedQuestion.level || 1);

  // Update interview state to in_progress
  if (interview.state !== 'in_progress') {
    db.prepare(`UPDATE interviews SET state = 'in_progress', started_at = COALESCE(started_at, CURRENT_TIMESTAMP) WHERE id = ?`).run(interviewId);
  }

  return {
    isCompleted: false,
    question: parsedQuestion.question,
    skill: parsedQuestion.skill,
    level: parsedQuestion.level,
    turnIndex: aiIdx,
    isFollowUp: Boolean(parsedQuestion.isFollowUp),
    state: 'in_progress'
  };
}
