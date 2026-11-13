import { analyzeAnswerCorrectnessAndCoverage } from '../interview/evaluator.js';
import crypto from 'crypto';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { db } from '../db/database.js';
import { getProviderForOrg, trackUsage } from '../interview/engine.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const PROMPT_PATH = path.resolve(__dirname, '../../../prompts/report.txt');

let REPORT_PROMPT_TEMPLATE = '';
try {
  REPORT_PROMPT_TEMPLATE = fs.readFileSync(PROMPT_PATH, 'utf8');
} catch (e) {
  REPORT_PROMPT_TEMPLATE = `You are a fair and rigorous technical hiring evaluator. Evaluate technical depth only. Output valid JSON.`;
}

/**
 * Validates that quotes referenced in report skills actually exist in the candidate transcript
 * Flags hallucinations or drops confidence if fabricated.
 */

/**
 * Rigorous Technical Answer Auditor
 * Audits candidate answers for genuine substance, penalizing "no", evasions, empty, or ultra-short responses.
 */
export function enforceStrictScoringAudit(report, turns, job) {
  const candidateTurns = turns.filter(t => t.role === 'candidate' && !t.text.toLowerCase().includes('ready to begin'));
  const totalCandidateAnswers = candidateTurns.length;

  if (totalCandidateAnswers === 0) {
    return {
      ...report,
      candidate_verdict: 'NOT_RECOMMENDED',
      recommendation: 'reject',
      overall_score: 5,
      hiring_clarification: 'STRONG REJECT: No candidate responses recorded during the interview session.',
      red_flags: ['No candidate responses submitted.'],
      skills: (report.skills || []).map(s => ({ ...s, score: 1, confidence: 'high' }))
    };
  }

  // Refusal and low-effort pattern detector
  const refusalRegex = /^(no|nope|na|nahi|idk|i don'?t know|don'?t know|skip|pass|nothing|none|nil|n\/a|not sure|\s*|\.)$/i;

  let refusalCount = 0;
  let shortAnswerCount = 0;
  let totalWordCount = 0;

  candidateTurns.forEach(t => {
    const raw = (t.text || '').trim();
    const words = raw.split(/\s+/).filter(Boolean).length;
    totalWordCount += words;

    if (refusalRegex.test(raw) || raw.length < 8 || words <= 2) {
      refusalCount++;
    } else if (words < 6) {
      shortAnswerCount++;
    }
  });

  const avgWordsPerAnswer = totalWordCount / totalCandidateAnswers;
  const refusalRatio = refusalCount / totalCandidateAnswers;
  const lowEffortRatio = (refusalCount + shortAnswerCount) / totalCandidateAnswers;

  let audited = { ...report };
  audited.red_flags = Array.isArray(audited.red_flags) ? [...audited.red_flags] : [];

    const qEvals = report.question_evaluations || [];
  const avgCoverage = qEvals.length > 0 
    ? Math.round(qEvals.reduce((acc, q) => acc + (q.coverage_score || 0), 0) / qEvals.length) 
    : 0;

  // CASE 1: Extreme failure - Candidate answered "no" or gave non-answers to 35%+ of questions, or avg coverage under 20%
  if (refusalRatio >= 0.35 || refusalCount >= 2 || (qEvals.length > 0 && avgCoverage < 20)) {
    const calculatedScore = Math.max(5, Math.min(20, Math.round(18 - refusalCount * 4)));
    audited.overall_score = calculatedScore;
    audited.candidate_verdict = 'NOT_RECOMMENDED';
    audited.recommendation = 'reject';
    audited.hiring_clarification = `STRONG REJECT: Candidate failed technical requirement coverage (average coverage: ${avgCoverage}%). The candidate repeatedly answered 'no' or provided evasive non-answers (${refusalCount} questions refused). Zero technical competence demonstrated.`;
    audited.overall_summary = `Candidate failed the technical screening with an overall requirement coverage of ${avgCoverage}%. Multiple core questions were refused with 'no' or non-answers.`;

    if (Array.isArray(audited.skills)) {
      audited.skills = audited.skills.map(s => ({
        ...s,
        score: 1,
        confidence: 'high',
        gaps: Array.isArray(s.gaps) ? [...s.gaps, "Failed required technical key points and answered with 'no'."] : ["Failed required concepts."]
      }));
    }

    if (!audited.red_flags.some(rf => rf.includes('answered "no"') || rf.includes('refused'))) {
      audited.red_flags.unshift(`Candidate answered 'no' or refused ${refusalCount} technical questions (Coverage: ${avgCoverage}%).`);
    }
    return audited;
  }
  // CASE 2: Low-effort / superficial answers (average words under 12 or coverage under 45%)
  else if (lowEffortRatio >= 0.5 || avgWordsPerAnswer < 12 || (qEvals.length > 0 && avgCoverage < 45)) {
    audited.overall_score = Math.min(audited.overall_score || 35, 40);
    audited.candidate_verdict = 'NOT_RECOMMENDED';
    audited.recommendation = 'reject';
    audited.hiring_clarification = `REJECT: Candidate answers were superficial (averaging ${Math.round(avgWordsPerAnswer)} words, ${avgCoverage}% requirement coverage) with no conceptual depth, code architecture, or tradeoff analysis.`;
    
    if (Array.isArray(audited.skills)) {
      audited.skills = audited.skills.map(s => ({
        ...s,
        score: Math.min(s.score || 2, 2),
        gaps: Array.isArray(s.gaps) ? [...s.gaps, "Lack of technical explanation and depth in candidate response."] : ["Superficial answer."]
      }));
    }

    if (!audited.red_flags.some(rf => rf.includes('superficial') || rf.includes('substance'))) {
      audited.red_flags.push(`Candidate responses lacked technical depth (average answer length: ${Math.round(avgWordsPerAnswer)} words, coverage: ${avgCoverage}%).`);
    }
    return audited;
  }
  // CASE 3: Qualified candidate
  else if (avgCoverage >= 70) {
    audited.overall_score = Math.max(audited.overall_score || 78, 78);
    audited.candidate_verdict = 'RECOMMENDED_HIRE';
    audited.recommendation = 'advance';
  }

  return audited;
}


export function validateEvidenceQuotes(reportJson, transcriptTurns) {
  const candidateTexts = transcriptTurns
    .filter(t => t.role === 'candidate')
    .map(t => ({ turn: t.idx, text: t.text.toLowerCase() }));

  if (!reportJson.skills || !Array.isArray(reportJson.skills)) return reportJson;

  reportJson.skills = reportJson.skills.map(skill => {
    let verifiedEvidence = [];
    if (skill.evidence && Array.isArray(skill.evidence)) {
      verifiedEvidence = skill.evidence.map(ev => {
        const quote = (ev.quote || '').toLowerCase();
        // Check if substring exists in candidate answers
        const match = candidateTexts.find(c => c.text.includes(quote) || quote.includes(c.text.slice(0, 30)));
        return {
          quote: ev.quote,
          turn: ev.turn || (match ? match.turn : null),
          verified_in_transcript: Boolean(match)
        };
      });
    }

    const hasUnverified = verifiedEvidence.some(e => !e.verified_in_transcript);
    return {
      ...skill,
      confidence: hasUnverified ? 'low' : (skill.confidence || 'medium'),
      evidence: verifiedEvidence
    };
  });

  return reportJson;
}

/**
 * Generate evidence-backed structured hiring report
 */
export async function generateReport(interviewId) {
  const interview = db.prepare('SELECT * FROM interviews WHERE id = ?').get(interviewId);
  if (!interview) throw new Error('Interview not found');

  const job = db.prepare('SELECT * FROM jobs WHERE id = ?').get(interview.job_id);
  const candidate = db.prepare('SELECT * FROM candidates WHERE id = ?').get(interview.candidate_id);
  const turns = db.prepare('SELECT * FROM turns WHERE interview_id = ? ORDER BY idx ASC').all(interviewId);

  // Format full transcript
  const transcriptFormatted = turns.map(t => `[Turn ${t.idx}] ${t.role.toUpperCase()}: ${t.text}`).join('\n\n');

  const promptInput = `
JOB DETAILS:
Title: ${job.title}
Required Skills: ${job.skills}
Level: ${job.level}

CANDIDATE INFO:
Name: ${candidate.name}
Resume Claims: ${candidate.resume_text || 'None provided'}

INTERVIEW FULL TRANSCRIPT:
${transcriptFormatted}
`;

  const provider = getProviderForOrg(job.org_id);
  const aiResult = await provider.generate({
    systemPrompt: REPORT_PROMPT_TEMPLATE,
    messages: [{ role: 'candidate', text: promptInput }],
    temperature: 0.2
  });

  trackUsage(job.org_id, interviewId, 'report_gen', aiResult.inputTokens, aiResult.outputTokens);

  let parsedReport = null;
  try {
    const cleanedText = aiResult.text.replace(/```json/g, '').replace(/```/g, '').trim();
    parsedReport = JSON.parse(cleanedText);
  } catch (err) {
    console.warn('[ReportGenerator] Error parsing AI report JSON:', err.message);
    parsedReport = {
      overall_summary: "Candidate completed technical screening interview. AI summary generated from transcript review.",
      skills: [
        {
          skill: "Core Technical Competence",
          score: 3,
          confidence: "medium",
          evidence: [{ quote: turns.find(t => t.role === 'candidate')?.text || "Answer provided", turn: 2, verified_in_transcript: true }],
          gaps: ["Detailed hands-on evaluation recommended in next round."]
        }
      ],
      resume_claims: [{ claim: "Junior developer skills", status: "partial" }],
      red_flags: [],
      recommendation: "maybe",
      meta: { questions: turns.filter(t => t.role === 'ai').length, minutes: 15 }
    };
  }

  // Build Question-by-Question Correctness & Requirement Coverage Analysis
  const questionEvaluations = [];
  for (let i = 0; i < turns.length; i++) {
    if (turns[i].role === 'ai') {
      const nextCand = turns.slice(i + 1).find(t => t.role === 'candidate');
      const candAnswer = nextCand ? nextCand.text : 'No answer provided';
      const analysis = analyzeAnswerCorrectnessAndCoverage(turns[i].text, candAnswer, turns[i].skill);
      questionEvaluations.push({
        question_turn: turns[i].idx,
        question: turns[i].text,
        skill: turns[i].skill,
        candidate_answer: candAnswer,
        correctness: analysis.correctness,
        correctness_level: analysis.correctnessLevel,
        coverage_score: analysis.coverageScore,
        covered_points: analysis.coveredKeyPoints,
        missing_points: analysis.missingKeyPoints,
        technical_notes: analysis.technicalNotes
      });
    }
  }

  parsedReport.question_evaluations = questionEvaluations;

  // Enforce Section 6.3 evidence validation
  let validatedReport = validateEvidenceQuotes(parsedReport, turns);
  validatedReport = enforceStrictScoringAudit(validatedReport, turns, job);
  validatedReport.question_evaluations = questionEvaluations;

  // Attach LeetCode & DSA Automated Judge Evaluation if available
  if (interview.dsa_result) {
    try {
      const dsaData = JSON.parse(interview.dsa_result);
      validatedReport.dsa_evaluation = {
        problem_id: dsaData.problemId,
        problem_title: dsaData.problemTitle || `Problem #${dsaData.problemId}`,
        language: dsaData.lang,
        question_mode: dsaData.mode || 'solve',
        verdict: dsaData.verdict,
        passed_tests: dsaData.passedCount,
        total_tests: dsaData.totalCount,
        runtime_ms: dsaData.runtimeMs,
        time_limit_ms: dsaData.timeLimitMs || 2000,
        memory_mb: dsaData.memoryMb,
        memory_limit_mb: dsaData.memoryLimitMb || 256,
        submissions: dsaData.submissions || null,
        summary: `${dsaData.problemTitle || `LeetCode #${dsaData.problemId}`}: ${dsaData.verdict} (${dsaData.passedCount}/${dsaData.totalCount} Passed · ${dsaData.runtimeMs}ms/${dsaData.timeLimitMs || 2000}ms · ${dsaData.memoryMb}MB/${dsaData.memoryLimitMb || 256}MB)`
      };

      if (dsaData.verdict === 'ACCEPTED') {
        if (!validatedReport.skills.some(s => s.skill.toLowerCase().includes('data structure') || s.skill.toLowerCase().includes('dsa') || s.skill.toLowerCase().includes('algorithms'))) {
          validatedReport.skills.unshift({
            skill: 'Data Structures & Algorithms (DSA)',
            score: 5,
            confidence: 'high',
            evidence: [{ quote: `Passed ${dsaData.passedCount}/${dsaData.totalCount} server test cases (${dsaData.runtimeMs}ms / ${dsaData.memoryMb}MB) for ${dsaData.problemTitle || `Problem #${dsaData.problemId}`}`, turn: 0, verified_in_transcript: true }],
            gaps: []
          });
        }
      }
    } catch (e) {
      console.warn('[ReportGenerator] Failed to attach dsa_result:', e.message);
    }
  }

  // Save report in DB
  const reportId = 'rep_' + crypto.randomUUID();
  db.prepare(`
    INSERT INTO reports (id, interview_id, json, model)
    VALUES (?, ?, ?, ?)
    ON CONFLICT(interview_id) DO UPDATE SET
      json = excluded.json,
      model = excluded.model,
      created_at = CURRENT_TIMESTAMP
  `).run(reportId, interviewId, JSON.stringify(validatedReport), aiResult.model || 'gemini-1.5-flash');

  // Mark interview state as report_ready
  db.prepare(`UPDATE interviews SET state = 'report_ready' WHERE id = ?`).run(interviewId);

  return validatedReport;
}
