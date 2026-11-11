import express from 'express';
import cors from 'cors';
import crypto from 'crypto';
import path from 'path';
import { fileURLToPath } from 'url';
import dotenv from 'dotenv';

import { db, initDatabase } from './db/database.js';
import { hashPassword, comparePassword, signToken, verifyToken, requireAuth } from './auth/auth.js';
import { encryptApiKey, maskKey } from './keys/vault.js';
import { GeminiProvider } from './ai/gemini.js';
import { processInterviewTurn } from './interview/engine.js';
import { generateReport } from './reports/generator.js';
import multer from 'multer';
import { extractTextFromBuffer, parseResumeText } from './services/resumeParser.js';
import { getPlannedQuestions } from './interview/questionBank.js';
import { DOMAIN_FIELDS, TOP_COMPANIES, COMPANY_QUESTION_CATALOG, getCatalogQuestions } from './interview/questionBankCatalog.js';
import { billingRouter } from './billing/billingRoutes.js';
import { dispatchCandidateNotification, buildInterviewRulesText } from './services/dispatchService.js';
import { judgeLeetCodeSolution } from './services/leetcodeJudge.js';
import { generateNeuralAudio, NEURAL_VOICES } from './services/neuralTtsService.js';
import { adminRouter } from './admin/adminRoutes.js';
import { logActivity } from './services/activityService.js';
import { sendRecruiterVerificationEmail } from './services/emailService.js';

dotenv.config();

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Initialize DB schema
initDatabase();

const app = express();
const PORT = process.env.PORT || 3001;

// Multer memory storage for in-memory resume parsing (PDF, DOCX, TXT up to 10MB)
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 10 * 1024 * 1024 }
});

app.use(cors());
app.use(express.json());

// Billing routes
app.use('/billing', billingRouter);

// Platform Admin API & routes
app.use('/api/admin', adminRouter);

// Serve static frontend assets
const frontendPath = path.resolve(__dirname, '../../frontend/public');

// Dedicated Platform Admin Portal Web Page
app.get('/admin', (req, res) => {
  res.sendFile(path.resolve(frontendPath, 'admin.html'));
});

app.use(express.static(frontendPath));

// --- Health Check ---
app.get('/health', (req, res) => {
  res.json({
    status: 'ok',
    timestamp: new Date().toISOString(),
    uptime: process.uptime()
  });
});

// --- Auth Endpoints ---
// --- Direct Email + Password Auth Endpoints (No OTP / No Blocking) ---
app.post('/auth/signup', async (req, res) => {
  try {
    const { 
      email,
      password,
      fullName, 
      phone, 
      jobTitle, 
      companyName, 
      website, 
      industry, 
      companySize, 
      country 
    } = req.body;

    if (!email || !password) {
      return res.status(400).json({ error: 'Email and password are required' });
    }

    const cleanEmail = email.toLowerCase().trim();
    let user = db.prepare('SELECT * FROM users WHERE email = ?').get(cleanEmail);

    if (user) {
      // If user exists and password matches, log them straight in
      if (comparePassword(password, user.password_hash)) {
        db.prepare(`UPDATE users SET is_verified = 1, approval_status = 'approved', last_login_at = CURRENT_TIMESTAMP WHERE id = ?`).run(user.id);
        const org = db.prepare('SELECT * FROM organizations WHERE id = ?').get(user.org_id);
        const token = signToken({ id: user.id, org_id: user.org_id, email: user.email, role: user.role });
        return res.json({
          token,
          user: { id: user.id, email: user.email, fullName: user.full_name, jobTitle: user.job_title, is_verified: 1, approval_status: 'approved' },
          org: org || { id: user.org_id, name: companyName || 'My Organization', plan: 'free_trial', included_interviews: 10 }
        });
      } else {
        return res.status(400).json({ error: 'An account with this email already exists. Please use Existing User Sign In.' });
      }
    }

    const orgId = 'org_' + crypto.randomUUID();
    const userId = 'usr_' + crypto.randomUUID();
    const passHash = hashPassword(password);

    const settingCredits = db.prepare("SELECT value FROM platform_settings WHERE key = 'default_trial_credits'").get();
    const trialCredits = parseInt(settingCredits?.value || '10', 10) || 10;

    db.transaction(() => {
      db.prepare(`
        INSERT INTO organizations (id, name, website, industry, company_size, country, plan, included_interviews)
        VALUES (?, ?, ?, ?, ?, ?, 'free_trial', ?)
      `).run(
        orgId, 
        (companyName || 'My Organization').trim(), 
        (website || '').trim(), 
        (industry || 'Technology').trim(), 
        (companySize || '1-20').trim(), 
        (country || 'India').trim(),
        trialCredits
      );

      db.prepare(`
        INSERT INTO users (id, org_id, full_name, phone, job_title, email, password_hash, role, is_verified, verification_code, approval_status, last_login_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, 'owner', 1, NULL, 'approved', CURRENT_TIMESTAMP)
      `).run(
        userId, 
        orgId, 
        (fullName || 'Hiring Manager').trim(), 
        (phone || '').trim(), 
        (jobTitle || 'Recruiter').trim(), 
        cleanEmail, 
        passHash
      );
    })();

    logActivity({
      action: 'USER_SIGNUP',
      actorType: 'user',
      actorId: userId,
      actorEmail: cleanEmail,
      actorName: fullName || 'Hiring Manager',
      orgId,
      entityType: 'user',
      entityId: userId,
      details: { companyName, jobTitle, is_verified: 1 },
      ipAddress: req.ip
    });

    const token = signToken({ id: userId, org_id: orgId, email: cleanEmail, role: 'owner' });
    res.json({
      token,
      message: 'Account created successfully!',
      user: { id: userId, email: cleanEmail, fullName: fullName || 'Hiring Manager', jobTitle: jobTitle || 'Recruiter', is_verified: 1, approval_status: 'approved' },
      org: { id: orgId, name: companyName || 'My Organization', plan: 'free_trial', included_interviews: trialCredits }
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Verification step - auto-pass any request
app.post('/auth/verify', requireAuth, (req, res) => {
  try {
    db.prepare("UPDATE users SET is_verified = 1, approval_status = 'approved' WHERE id = ?").run(req.user.id);
    res.json({ success: true, message: 'Verified successfully!' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post('/auth/resend-code', requireAuth, async (req, res) => {
  res.json({ success: true, message: 'Verification bypassed. Account is active.' });
});

// Company profile update
app.post('/auth/company-profile', requireAuth, (req, res) => {
  try {
    const { companyName, website, industry, companySize, country } = req.body;
    db.prepare(`
      UPDATE organizations 
      SET name = COALESCE(?, name),
          website = COALESCE(?, website),
          industry = COALESCE(?, industry),
          company_size = COALESCE(?, company_size),
          country = COALESCE(?, country)
      WHERE id = ?
    `).run(
      companyName ? companyName.trim() : null,
      website ? website.trim() : null,
      industry ? industry.trim() : null,
      companySize ? companySize.trim() : null,
      country ? country.trim() : null,
      req.user.org_id
    );

    const updatedOrg = db.prepare('SELECT * FROM organizations WHERE id = ?').get(req.user.org_id);
    res.json({ success: true, org: updatedOrg });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Direct Email + Password Login (with container cold-start auto-provisioning)
app.post('/auth/login', (req, res) => {
  try {
    const { email, password } = req.body;
    if (!email || !password) {
      return res.status(400).json({ error: 'Email and password are required' });
    }

    const cleanEmail = email.toLowerCase().trim();
    let user = db.prepare('SELECT * FROM users WHERE email = ?').get(cleanEmail);

    // If user does not exist in local SQLite (e.g. Vercel container restart wiped local DB),
    // automatically provision account with this password so the user is never locked out!
    if (!user) {
      const orgId = 'org_' + crypto.randomUUID();
      const userId = 'usr_' + crypto.randomUUID();
      const passHash = hashPassword(password);

      db.transaction(() => {
        db.prepare(`
          INSERT INTO organizations (id, name, plan, included_interviews)
          VALUES (?, 'My Organization', 'free_trial', 10)
        `).run(orgId);

        db.prepare(`
          INSERT INTO users (id, org_id, full_name, phone, job_title, email, password_hash, role, is_verified, approval_status, last_login_at)
          VALUES (?, ?, 'Hiring Manager', '', 'Recruiter', ?, ?, 'owner', 1, 'approved', CURRENT_TIMESTAMP)
        `).run(userId, orgId, cleanEmail, passHash);
      })();

      user = db.prepare('SELECT * FROM users WHERE id = ?').get(userId);
    } else {
      // Validate password
      if (!comparePassword(password, user.password_hash)) {
        return res.status(401).json({ error: 'Incorrect password. Please try again.' });
      }
    }

    // Always ensure verified & approved
    db.prepare("UPDATE users SET is_verified = 1, approval_status = 'approved', last_login_at = CURRENT_TIMESTAMP WHERE id = ?").run(user.id);

    // Ensure organization exists
    let org = db.prepare('SELECT * FROM organizations WHERE id = ?').get(user.org_id);
    if (!org) {
      db.prepare(`
        INSERT OR IGNORE INTO organizations (id, name, plan, included_interviews)
        VALUES (?, 'My Organization', 'free_trial', 10)
      `).run(user.org_id);
      org = db.prepare('SELECT * FROM organizations WHERE id = ?').get(user.org_id);
    }

    const token = signToken({ id: user.id, org_id: user.org_id, email: user.email, role: user.role });

    logActivity({
      action: 'USER_LOGIN',
      actorType: 'user',
      actorId: user.id,
      actorEmail: user.email,
      actorName: user.full_name,
      orgId: user.org_id,
      ipAddress: req.ip
    });

    res.json({
      token,
      user: { 
        id: user.id, 
        email: user.email, 
        fullName: user.full_name || 'Hiring Manager', 
        jobTitle: user.job_title || 'Recruiter', 
        role: user.role,
        is_verified: 1,
        approval_status: 'approved'
      },
      org: org || { 
        id: user.org_id, 
        name: 'My Organization', 
        plan: 'free_trial',
        included_interviews: 10
      }
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.get('/auth/me', requireAuth, (req, res) => {
  try {
    const user = db.prepare('SELECT id, full_name, email, phone, job_title, role, is_verified, approval_status FROM users WHERE id = ?').get(req.user.id);
    const org = db.prepare('SELECT * FROM organizations WHERE id = ?').get(req.user.org_id);
    res.json({ user, org });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// --- Provider Key Endpoints (Customer-Owned Key Model, Section 4.3) ---
app.post('/org/provider-key', requireAuth, async (req, res) => {
  try {
    const { provider = 'gemini', apiKey } = req.body;
    if (!apiKey || typeof apiKey !== 'string') {
      return res.status(400).json({ error: 'Valid apiKey string is required' });
    }

    // Step 2 from 4.3: Validate key immediately
    const tempProvider = new GeminiProvider(apiKey.trim());
    const validation = await tempProvider.validateKey();
    if (!validation.valid) {
      return res.status(400).json({ error: `Key validation failed: ${validation.error}` });
    }

    // Encrypt key with AES-256-GCM
    const encrypted = encryptApiKey(apiKey.trim());
    const last4 = apiKey.trim().slice(-4);
    const keyId = 'pk_' + crypto.randomUUID();

    db.prepare(`
      INSERT INTO provider_keys (id, org_id, provider, key_encrypted, key_last4, status)
      VALUES (?, ?, ?, ?, ?, 'active')
      ON CONFLICT(id) DO UPDATE SET
        key_encrypted = excluded.key_encrypted,
        key_last4 = excluded.key_last4,
        status = 'active'
    `).run(keyId, req.user.org_id, provider, encrypted, last4);

    res.json({ success: true, provider, key_last4: last4, masked: maskKey(apiKey) });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.get('/org/provider-key', requireAuth, (req, res) => {
  try {
    const row = db.prepare('SELECT provider, key_last4, status, created_at FROM provider_keys WHERE org_id = ? AND status = ?').get(req.user.org_id, 'active');
    if (!row) {
      return res.json({ configured: false, defaultFallbackAvailable: Boolean(process.env.GEMINI_API_KEY) });
    }
    res.json({
      configured: true,
      provider: row.provider,
      masked: `****...${row.key_last4}`,
      created_at: row.created_at
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.delete('/org/provider-key', requireAuth, (req, res) => {
  try {
    db.prepare('DELETE FROM provider_keys WHERE org_id = ?').run(req.user.org_id);
    res.json({ success: true, message: 'Provider key deleted safely.' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// --- Jobs Endpoints ---
app.post('/jobs', requireAuth, (req, res) => {
  try {
    const { 
      title, 
      jd_text, 
      skills, 
      qualifications,
      level = 'junior', 
      max_minutes = 15, 
      max_questions = 10,
      interview_type = 'technical',
      question_mode = 'ai_adaptive',
      custom_questions = '',
      terminal_required = 0,
      word_editor_required = 0,
      resume_required = 1,
      purpose = 'job',
      experience_required = '0-2 Yrs',
      assessment_rules = '',
      leetcode_problem = '',
      compiler_languages = 'javascript,python,sql',
      category = 'Software & Tech',
      show_timer = 1,
      auto_submit_timer = 1
    } = req.body;

    if (!title || !jd_text) {
      return res.status(400).json({ error: 'Title and Job Description (JD) text are required' });
    }

    // Safeguard: Ensure organization exists in organizations table
    if (req.user && req.user.org_id) {
      db.prepare(`
        INSERT OR IGNORE INTO organizations (id, name, plan, included_interviews)
        VALUES (?, 'My Organization', 'free_trial', 10)
      `).run(req.user.org_id);
    }

    // Auto-extract skills if none passed
    let skillList = skills;
    if (!skillList) {
      const detected = [];
      const keywords = ['Python', 'Java', 'C++', 'SQL', 'JavaScript', 'TypeScript', 'Git', 'React', 'Node.js', 'Data Structures', 'REST APIs'];
      for (const kw of keywords) {
        const escaped = kw.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
        if (new RegExp(`(?:\\b|(?<=\\W))${escaped}(?:\\b|(?=\\W))`, 'i').test(jd_text)) {
          detected.push(kw);
        }
      }
      skillList = detected.length > 0 ? detected.join(', ') : 'C++, Java, Python, SQL';
    }

    const jobId = 'job_' + crypto.randomUUID();
    db.prepare(`
      INSERT INTO jobs (
        id, org_id, title, jd_text, skills, qualifications, level, max_minutes, max_questions,
        interview_type, question_mode, custom_questions, terminal_required, word_editor_required, resume_required,
        purpose, experience_required, assessment_rules, leetcode_problem, compiler_languages, category,
        show_timer, auto_submit_timer
      )
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      jobId, 
      req.user.org_id, 
      title.trim(), 
      jd_text.trim(), 
      skillList, 
      qualifications ? qualifications.trim() : 'Bachelor degree in Engineering / CS or equivalent practical experience',
      level, 
      parseInt(max_minutes, 10) || 15, 
      parseInt(max_questions, 10) || 6,
      interview_type,
      question_mode,
      custom_questions ? custom_questions.trim() : '',
      terminal_required ? 1 : 0,
      word_editor_required ? 1 : 0,
      resume_required ? 1 : 0,
      purpose,
      experience_required,
      assessment_rules ? assessment_rules.trim() : '',
      leetcode_problem ? leetcode_problem.trim() : '',
      compiler_languages,
      category || 'Software & Tech',
      show_timer ? 1 : 0,
      auto_submit_timer ? 1 : 0
    );

    const created = db.prepare('SELECT * FROM jobs WHERE id = ?').get(jobId);

    logActivity({
      action: 'JOB_CREATED',
      actorType: 'user',
      actorId: req.user.id,
      actorEmail: req.user.email,
      orgId: req.user.org_id,
      entityType: 'job',
      entityId: jobId,
      details: { title: title.trim(), skills: skillList, category },
      ipAddress: req.ip
    });

    res.json(created);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.get('/jobs', requireAuth, (req, res) => {
  try {
    const jobs = db.prepare(`
      SELECT 
        j.*,
        (SELECT COUNT(*) FROM interviews i WHERE i.job_id = j.id) as total_candidates,
        (SELECT COUNT(*) FROM interviews i WHERE i.job_id = j.id AND i.state IN ('completed', 'report_ready')) as completed_candidates,
        (SELECT COUNT(*) FROM interviews i JOIN reports r ON r.interview_id = i.id WHERE i.job_id = j.id AND (json_extract(r.json, '$.overall_score') >= 70 OR json_extract(r.json, '$.candidate_verdict') = 'RECOMMENDED_HIRE')) as selected_candidates,
        (SELECT COUNT(*) FROM interviews i LEFT JOIN reports r ON r.interview_id = i.id WHERE i.job_id = j.id AND (i.state = 'disqualified' OR json_extract(r.json, '$.overall_score') < 50 OR json_extract(r.json, '$.candidate_verdict') = 'NOT_RECOMMENDED')) as rejected_candidates,
        (SELECT ROUND(AVG(json_extract(r.json, '$.overall_score')), 1) FROM interviews i JOIN reports r ON r.interview_id = i.id WHERE i.job_id = j.id AND json_extract(r.json, '$.overall_score') IS NOT NULL) as avg_score
      FROM jobs j 
      WHERE j.org_id = ? 
      ORDER BY j.created_at DESC
    `).all(req.user.org_id);
    res.json(jobs);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.get('/jobs/:id', requireAuth, (req, res) => {
  try {
    const job = db.prepare('SELECT * FROM jobs WHERE id = ? AND org_id = ?').get(req.params.id, req.user.org_id);
    if (!job) return res.status(404).json({ error: 'Interview not found' });
    res.json(job);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.put('/jobs/:id', requireAuth, (req, res) => {
  try {
    const jobId = req.params.id;
    const existing = db.prepare('SELECT * FROM jobs WHERE id = ? AND org_id = ?').get(jobId, req.user.org_id);
    if (!existing) return res.status(404).json({ error: 'Interview not found' });

    const { 
      title, 
      jd_text = '', 
      skills, 
      qualifications,
      level = 'junior', 
      max_minutes = 15, 
      max_questions = 10,
      interview_type = 'technical',
      question_mode = 'ai_adaptive',
      custom_questions = '',
      terminal_required = 0,
      word_editor_required = 0,
      resume_required = 1,
      purpose = 'job',
      experience_required = '0-2 Yrs',
      assessment_rules = '',
      leetcode_problem = '',
      compiler_languages = 'javascript,python,sql',
      category = 'Software & Tech',
      show_timer = 1,
      auto_submit_timer = 1
    } = req.body;

    if (!title) {
      return res.status(400).json({ error: 'Interview title is required' });
    }

    db.prepare(`
      UPDATE jobs SET
        title = ?,
        jd_text = ?,
        skills = ?,
        qualifications = ?,
        level = ?,
        max_minutes = ?,
        max_questions = ?,
        interview_type = ?,
        question_mode = ?,
        custom_questions = ?,
        terminal_required = ?,
        word_editor_required = ?,
        resume_required = ?,
        purpose = ?,
        experience_required = ?,
        assessment_rules = ?,
        leetcode_problem = ?,
        compiler_languages = ?,
        category = ?,
        show_timer = ?,
        auto_submit_timer = ?
      WHERE id = ? AND org_id = ?
    `).run(
      title.trim(),
      jd_text.trim(),
      skills ? skills.trim() : existing.skills,
      qualifications ? qualifications.trim() : existing.qualifications,
      level,
      parseInt(max_minutes, 10) || existing.max_minutes || 15,
      parseInt(max_questions, 10) || existing.max_questions || 6,
      interview_type,
      question_mode,
      custom_questions ? custom_questions.trim() : '',
      terminal_required ? 1 : 0,
      word_editor_required ? 1 : 0,
      resume_required ? 1 : 0,
      purpose,
      experience_required,
      assessment_rules ? assessment_rules.trim() : '',
      leetcode_problem ? leetcode_problem.trim() : '',
      compiler_languages,
      category || existing.category || 'Software & Tech',
      show_timer !== undefined ? (show_timer ? 1 : 0) : (existing.show_timer ?? 1),
      auto_submit_timer !== undefined ? (auto_submit_timer ? 1 : 0) : (existing.auto_submit_timer ?? 1),
      jobId,
      req.user.org_id
    );

    const updated = db.prepare('SELECT * FROM jobs WHERE id = ?').get(jobId);
    res.json(updated);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.delete('/jobs/:id', requireAuth, (req, res) => {
  try {
    const jobId = req.params.id;
    const existing = db.prepare('SELECT * FROM jobs WHERE id = ? AND org_id = ?').get(jobId, req.user.org_id);
    if (!existing) return res.status(404).json({ error: 'Interview not found' });

    db.transaction(() => {
      const interviews = db.prepare('SELECT id FROM interviews WHERE job_id = ?').all(jobId);
      for (const intv of interviews) {
        db.prepare('DELETE FROM turns WHERE interview_id = ?').run(intv.id);
        db.prepare('DELETE FROM reports WHERE interview_id = ?').run(intv.id);
      }
      db.prepare('DELETE FROM interviews WHERE job_id = ?').run(jobId);
      db.prepare('DELETE FROM jobs WHERE id = ? AND org_id = ?').run(jobId, req.user.org_id);
    })();

    logActivity({
      action: 'JOB_DELETED',
      actorType: 'user',
      actorId: req.user.id,
      actorEmail: req.user.email,
      orgId: req.user.org_id,
      entityType: 'job',
      entityId: jobId,
      details: { title: existing.title },
      ipAddress: req.ip
    });

    res.json({ success: true, message: `Interview "${existing.title}" deleted successfully.` });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Helper: Rehydrate an interview session from a signed JWT token
function hydrateInterviewFromToken(decoded, rawToken) {
  try {
    const orgId = decoded.orgId || 'org_default';
    db.prepare(`
      INSERT OR IGNORE INTO organizations (id, name, plan, included_interviews)
      VALUES (?, 'Technical Hiring Team', 'free_trial', 10)
    `).run(orgId);

    db.prepare(`
      INSERT OR IGNORE INTO jobs (
        id, org_id, title, jd_text, skills, qualifications, level, max_minutes, max_questions,
        interview_type, question_mode, category, show_timer, auto_submit_timer
      ) VALUES (?, ?, ?, 'Technical Assessment', ?, 'Degree in CS or equivalent experience', 'junior', ?, ?, ?, ?, ?, 1, 1)
    `).run(
      decoded.jobId,
      orgId,
      decoded.jobTitle || 'Technical Assessment',
      decoded.skills || 'Core Skills',
      decoded.max_minutes || 15,
      decoded.max_questions || 6,
      decoded.interview_type || 'technical',
      decoded.question_mode || 'ai_adaptive',
      decoded.category || 'Software & Tech'
    );

    db.prepare(`
      INSERT OR IGNORE INTO candidates (id, org_id, name, email, phone, source)
      VALUES (?, ?, ?, ?, ?, 'token_hydrate')
    `).run(decoded.candidateId, orgId, decoded.candidateName || 'Candidate', decoded.candidateEmail || 'candidate@applicant.local', decoded.phone || null);

    const tokenHash = crypto.createHash('sha256').update(rawToken).digest('hex');
    const expiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString();

    db.prepare(`
      INSERT OR IGNORE INTO interviews (id, job_id, candidate_id, token_hash, state, link_timer_minutes, expires_at, dispatch_status)
      VALUES (?, ?, ?, ?, 'created', ?, ?, 'dispatched')
    `).run(decoded.interviewId, decoded.jobId, decoded.candidateId, tokenHash, decoded.timerMins || 10080, expiresAt);

    return db.prepare(`
      SELECT 
        i.id, i.state, i.expires_at, i.link_timer_minutes,
        j.id as job_id, j.title as job_title, j.skills, j.qualifications, j.level, j.max_minutes, j.max_questions,
        j.show_timer, j.auto_submit_timer,
        j.interview_type, j.question_mode, j.terminal_required, j.word_editor_required, j.resume_required,
        j.purpose, j.experience_required, j.assessment_rules, j.leetcode_problem, j.compiler_languages,
        c.name as candidate_name, c.email as candidate_email, c.resume_text
      FROM interviews i
      JOIN jobs j ON i.job_id = j.id
      JOIN candidates c ON i.candidate_id = c.id
      WHERE i.id = ?
    `).get(decoded.interviewId);
  } catch (e) {
    console.error('Failed to hydrate interview from token:', e.message);
    return null;
  }
}

// --- Candidate & Interview Link Generation with Timer & Dispatch ---
app.post('/jobs/:id/interviews', requireAuth, async (req, res) => {
  try {
    const jobId = req.params.id;
    const { name, email, phone, resume_text, link_timer_minutes, expiresInMinutes, dispatch_channel = 'both', send_notification = false } = req.body;

    if (!email && !phone) {
      return res.status(400).json({ error: 'Either Candidate Email or WhatsApp Number is required.' });
    }

    const job = db.prepare('SELECT * FROM jobs WHERE id = ?').get(jobId);
    if (!job) return res.status(404).json({ error: 'Job not found' });

    const effectiveOrgId = job.org_id || req.user.org_id;
    // Ensure organization row exists in database
    db.prepare(`
      INSERT OR IGNORE INTO organizations (id, name, plan, included_interviews)
      VALUES (?, 'Technical Hiring Team', 'free_trial', 10)
    `).run(effectiveOrgId);

    const org = db.prepare('SELECT name FROM organizations WHERE id = ?').get(effectiveOrgId);
    const companyName = org ? org.name : 'Technical Hiring Team';

    const cleanName = (name || '').trim() || (email ? email.split('@')[0] : 'Candidate');
    const cleanEmail = (email || '').trim().toLowerCase() || (phone ? `wa_${phone.replace(/\D/g, '')}@candidate.local` : '');
    const cleanPhone = (phone || '').trim();

    const candidateId = 'cand_' + crypto.randomUUID();
    const interviewId = 'int_' + crypto.randomUUID();

    // Custom expiration timer (default 7 days: 10080 mins)
    const timerMins = parseInt(link_timer_minutes || expiresInMinutes, 10) || 10080;
    const expiresAt = new Date(Date.now() + timerMins * 60 * 1000).toISOString();

    // Generate portable self-hydrating signed token
    const rawToken = signToken({
      type: 'interview_invite',
      interviewId,
      jobId: job.id,
      orgId: effectiveOrgId,
      candidateId,
      candidateName: cleanName,
      candidateEmail: cleanEmail,
      phone: cleanPhone || null,
      timerMins,
      jobTitle: job.title,
      skills: job.skills,
      max_minutes: job.max_minutes,
      max_questions: job.max_questions,
      interview_type: job.interview_type,
      question_mode: job.question_mode,
      category: job.category
    });
    const tokenHash = crypto.createHash('sha256').update(rawToken).digest('hex');

    db.transaction(() => {
      db.prepare(`
        INSERT INTO candidates (id, org_id, name, email, phone, resume_text, source)
        VALUES (?, ?, ?, ?, ?, ?, 'direct_invite')
      `).run(candidateId, effectiveOrgId, cleanName, cleanEmail, cleanPhone || null, resume_text || '');

      db.prepare(`
        INSERT INTO interviews (id, job_id, candidate_id, token_hash, state, link_timer_minutes, expires_at, dispatch_status, dispatch_channel, source)
        VALUES (?, ?, ?, ?, 'created', ?, ?, 'created', ?, 'direct_invite')
      `).run(interviewId, job.id, candidateId, tokenHash, timerMins, expiresAt, dispatch_channel);
    })();

    const inviteUrl = `/interview.html?token=${rawToken}`;
    let dispatchRes = null;

    if (send_notification) {
      const rules = buildInterviewRulesText(job);
      dispatchRes = await dispatchCandidateNotification({
        channel: dispatch_channel,
        candidateName: cleanName,
        email: email ? cleanEmail : null,
        phone: cleanPhone || null,
        jobTitle: job.title,
        companyName,
        interviewUrl: inviteUrl,
        timerMinutes: timerMins,
        rules
      });
      db.prepare("UPDATE interviews SET dispatch_status = 'dispatched' WHERE id = ?").run(interviewId);
    }

    logActivity({
      action: 'INTERVIEW_DISPATCHED',
      actorType: 'user',
      actorId: req.user.id,
      actorEmail: req.user.email,
      orgId: effectiveOrgId,
      entityType: 'interview',
      entityId: interviewId,
      details: { candidateName: cleanName, candidateEmail: cleanEmail, channel: dispatch_channel, jobTitle: job.title },
      ipAddress: req.ip
    });

    res.json({
      interviewId,
      candidateId,
      token: rawToken,
      inviteUrl,
      timerMinutes: timerMins,
      expiresAt,
      whatsappUrl: dispatchRes?.channels?.whatsapp?.url || null,
      whatsappText: dispatchRes?.waMessageText || null,
      emailSent: dispatchRes?.channels?.email?.sent || false
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// --- Batch Candidate Dispatch (Email & WhatsApp with Rules & Instructions) ---
app.post('/jobs/:id/dispatch-batch', requireAuth, async (req, res) => {
  try {
    const jobId = req.params.id;
    const { candidates = [], link_timer_minutes, expiresInMinutes, channel = 'both' } = req.body;

    if (!Array.isArray(candidates) || candidates.length === 0) {
      return res.status(400).json({ error: 'Please provide at least one candidate in the list.' });
    }

    const job = db.prepare('SELECT * FROM jobs WHERE id = ?').get(jobId);
    if (!job) return res.status(404).json({ error: 'Job position not found.' });

    const effectiveOrgId = job.org_id || req.user.org_id;
    // Ensure organization row exists in database
    db.prepare(`
      INSERT OR IGNORE INTO organizations (id, name, plan, included_interviews)
      VALUES (?, 'Technical Hiring Team', 'free_trial', 10)
    `).run(effectiveOrgId);

    const org = db.prepare('SELECT name FROM organizations WHERE id = ?').get(effectiveOrgId);
    const companyName = org ? org.name : 'Technical Hiring Team';
    const rules = buildInterviewRulesText(job);

    // Default expiration timer: 7 days (10080 mins)
    const timerMins = parseInt(link_timer_minutes || expiresInMinutes, 10) || 10080;
    const expiresAt = new Date(Date.now() + timerMins * 60 * 1000).toISOString();
    const dispatchedCandidates = [];

    for (const c of candidates) {
      const email = (c.email || '').trim().toLowerCase();
      const phone = (c.phone || '').trim();
      const name = (c.name || '').trim() || (email ? email.split('@')[0] : 'Candidate');

      if (!email && !phone) {
        continue; // Skip invalid row without email or phone
      }

      const candidateId = 'cand_' + crypto.randomUUID();
      const interviewId = 'int_' + crypto.randomUUID();
      const effectiveEmail = email || `cand_${phone.replace(/\D/g, '')}@interviewer.local`;

      // Portable self-hydrating signed token
      const rawToken = signToken({
        type: 'interview_invite',
        interviewId,
        jobId: job.id,
        orgId: effectiveOrgId,
        candidateId,
        candidateName: name,
        candidateEmail: effectiveEmail,
        phone: phone || null,
        timerMins,
        jobTitle: job.title,
        skills: job.skills,
        max_minutes: job.max_minutes,
        max_questions: job.max_questions,
        interview_type: job.interview_type,
        question_mode: job.question_mode,
        category: job.category
      });
      const tokenHash = crypto.createHash('sha256').update(rawToken).digest('hex');
      const inviteUrl = `/interview.html?token=${rawToken}`;

      db.transaction(() => {
        db.prepare(`
          INSERT INTO candidates (id, org_id, name, email, phone, resume_text, source)
          VALUES (?, ?, ?, ?, ?, ?, 'batch_dispatch')
        `).run(candidateId, effectiveOrgId, name, effectiveEmail, phone || null, c.resume_text || '');

        db.prepare(`
          INSERT INTO interviews (id, job_id, candidate_id, token_hash, state, link_timer_minutes, expires_at, dispatch_status, dispatch_channel, source)
          VALUES (?, ?, ?, ?, 'created', ?, ?, 'dispatched', ?, 'batch_dispatch')
        `).run(interviewId, job.id, candidateId, tokenHash, timerMins, expiresAt, channel);
      })();

      // Send Email & WhatsApp notification
      const dispatchRes = await dispatchCandidateNotification({
        channel,
        candidateName: name,
        email: email || null,
        phone: phone || null,
        jobTitle: job.title,
        companyName,
        interviewUrl: inviteUrl,
        timerMinutes: timerMins,
        rules
      });

      dispatchedCandidates.push({
        candidateId,
        interviewId,
        name,
        candidate_name: name,
        email,
        phone,
        inviteUrl,
        token: rawToken,
        wa_direct_link: dispatchRes.channels.whatsapp.url,
        whatsappUrl: dispatchRes.channels.whatsapp.url,
        whatsappText: dispatchRes.waMessageText,
        emailSent: dispatchRes.channels.email.sent,
        email_method: dispatchRes.channels.email.method,
        mailto_url: dispatchRes.channels.email.mailtoUrl,
        status: 'dispatched'
      });
    }

    res.json({
      success: true,
      count: dispatchedCandidates.length,
      results: dispatchedCandidates,
      candidates: dispatchedCandidates
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.get('/jobs/:id/interviews', requireAuth, (req, res) => {
  try {
    const rows = db.prepare(`
      SELECT 
        i.id as interview_id,
        i.state,
        i.started_at,
        i.ended_at,
        i.expires_at,
        i.dispatch_status,
        i.dispatch_channel,
        i.source as interview_source,
        i.proctor_warnings,
        i.disqualified_reason,
        c.id as candidate_id,
        c.name as candidate_name,
        c.email as candidate_email,
        c.phone as candidate_phone,
        c.source as candidate_source,
        r.id as report_id,
        r.json as report_json
      FROM interviews i
      JOIN candidates c ON i.candidate_id = c.id
      JOIN jobs j ON i.job_id = j.id
      LEFT JOIN reports r ON r.interview_id = i.id
      WHERE j.id = ? AND j.org_id = ?
      ORDER BY i.started_at DESC, i.id DESC
    `).all(req.params.id, req.user.org_id);

    const enriched = rows.map(row => {
      let score = null;
      let verdict = null;
      let summary = '';
      let skills = [];
      if (row.report_json) {
        try {
          const parsed = JSON.parse(row.report_json);
          score = typeof parsed.overall_score === 'number' ? parsed.overall_score : null;
          verdict = parsed.candidate_verdict || parsed.recommendation || null;
          summary = parsed.hiring_clarification || parsed.summary || '';
          skills = Array.isArray(parsed.skills) ? parsed.skills : [];
        } catch (e) {}
      } else if (row.state === 'disqualified') {
        score = 0;
        verdict = 'DISQUALIFIED';
      }
      return {
        ...row,
        score,
        verdict,
        summary,
        skills
      };
    });

    res.json(enriched);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.get('/org/responses', requireAuth, (req, res) => {
  try {
    const rows = db.prepare(`
      SELECT 
        i.id as interview_id,
        i.state,
        i.proctor_warnings,
        i.disqualified_reason,
        i.proctor_logs,
        i.started_at,
        i.ended_at,
        i.expires_at,
        i.link_timer_minutes,
        j.id as job_id,
        j.title as job_title,
        j.skills as job_skills,
        j.interview_type,
        c.id as candidate_id,
        c.name as candidate_name,
        c.email as candidate_email,
        c.resume_text,
        r.id as report_id,
        r.json as report_json
      FROM interviews i
      JOIN candidates c ON i.candidate_id = c.id
      JOIN jobs j ON i.job_id = j.id
      LEFT JOIN reports r ON r.interview_id = i.id
      WHERE j.org_id = ?
      ORDER BY i.ended_at DESC, i.started_at DESC, i.id DESC
    `).all(req.user.org_id);

    const formatted = rows.map(r => {
      let parsedReport = null;
      if (r.report_json) {
        try { parsedReport = JSON.parse(r.report_json); } catch {}
      }
      return {
        interview_id: r.interview_id,
        state: r.state,
        proctor_warnings: r.proctor_warnings || 0,
        disqualified_reason: r.disqualified_reason || null,
        proctor_logs: r.proctor_logs ? JSON.parse(r.proctor_logs) : [],
        started_at: r.started_at,
        ended_at: r.ended_at,
        expires_at: r.expires_at,
        link_timer_minutes: r.link_timer_minutes,
        job_id: r.job_id,
        job_title: r.job_title,
        job_skills: r.job_skills,
        interview_type: r.interview_type,
        candidate_id: r.candidate_id,
        candidate_name: r.candidate_name,
        candidate_email: r.candidate_email,
        resume_text: r.resume_text,
        report_id: r.report_id,
        report: parsedReport
      };
    });

    res.json(formatted);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// --- Questions Preview Endpoint (for company/recruiter to preview questions in advance) ---
app.post('/api/questions/preview', (req, res) => {
  try {
    const { role = '', category = 'Software & Tech', skills = '', leetcode = '', max_questions = 6, custom_questions = '' } = req.body;
    const questions = getPlannedQuestions({
      role,
      category,
      skills,
      leetcode,
      maxQuestions: parseInt(max_questions, 10) || 6,
      customQuestions: custom_questions
    });
    res.json({ success: true, count: questions.length, questions });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// --- Question Bank: Curated Company-Wise Catalog & Org Custom Bank ---
app.get('/api/question-bank/catalog', (req, res) => {
  try {
    const { field = 'all', company = 'all', search = '' } = req.query;
    const questions = getCatalogQuestions({ field, company, search });
    res.json({
      success: true,
      domains: DOMAIN_FIELDS,
      companies: TOP_COMPANIES,
      count: questions.length,
      questions
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.get('/api/question-bank/custom', requireAuth, (req, res) => {
  try {
    const orgId = req.user.org_id;
    const rows = db.prepare(`
      SELECT * FROM org_question_bank WHERE org_id = ? ORDER BY created_at DESC
    `).all(orgId);
    res.json({ success: true, count: rows.length, questions: rows });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/question-bank/custom', requireAuth, (req, res) => {
  try {
    const orgId = req.user.org_id;
    const { question, skill = '', category = '', difficulty = 'Medium', expected_answer = '', company_tag = '' } = req.body;
    if (!question || !question.trim()) {
      return res.status(400).json({ error: 'Question text is required' });
    }
    const id = 'q_custom_' + crypto.randomUUID();
    db.prepare(`
      INSERT INTO org_question_bank (id, org_id, question, skill, category, difficulty, expected_answer, company_tag)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `).run(id, orgId, question.trim(), skill.trim(), category.trim(), difficulty, expected_answer.trim(), company_tag.trim());

    const created = db.prepare(`SELECT * FROM org_question_bank WHERE id = ?`).get(id);
    res.json({ success: true, question: created });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.delete('/api/question-bank/custom/:id', requireAuth, (req, res) => {
  try {
    const orgId = req.user.org_id;
    const { id } = req.params;
    const result = db.prepare(`DELETE FROM org_question_bank WHERE id = ? AND org_id = ?`).run(id, orgId);
    if (result.changes === 0) {
      return res.status(404).json({ error: 'Custom question not found or unauthorized' });
    }
    res.json({ success: true, message: 'Question deleted successfully' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// --- Automated LeetCode & Coding Judge Runner Endpoint ---
app.post('/api/compiler/judge', async (req, res) => {
  try {
    const { problemId = '1', lang = 'javascript', code = '', token = '' } = req.body;
    if (!code || !code.trim()) {
      return res.status(400).json({ error: 'Please enter code to evaluate against test cases.' });
    }

    const result = await judgeLeetCodeSolution(String(problemId), lang, code);

    // If an interview session token is provided, persist result in the database
    if (token) {
      try {
        const tokenHash = crypto.createHash('sha256').update(token).digest('hex');
        const interview = db.prepare('SELECT id FROM interviews WHERE token_hash = ? OR id = ?').get(tokenHash, token);
        if (interview) {
          const dsaSummary = {
            problemId,
            lang,
            verdict: result.verdict,
            passedCount: result.passedCount,
            totalCount: result.totalCount,
            runtimeMs: result.runtimeMs,
            memoryMb: result.memoryMb,
            timestamp: new Date().toISOString()
          };
          db.prepare('UPDATE interviews SET dsa_result = ? WHERE id = ?').run(JSON.stringify(dsaSummary), interview.id);
        }
      } catch (saveErr) {
        console.warn('[Judge] Failed to save dsa_result to interview:', saveErr.message);
      }
    }

    res.json({ success: true, result });
  } catch (err) {
    console.error('[Judge Error]:', err);
    res.status(500).json({ error: err.message || 'Judge execution failed' });
  }
});

// --- Public Job Info & Candidate Self-Registration Direct Link Endpoints ---
app.get('/public/jobs/:id', (req, res) => {
  try {
    let job = db.prepare(`
      SELECT 
        j.id, j.title, j.category, j.purpose, j.experience_required, j.skills, 
        j.qualifications, j.jd_text, j.max_minutes, j.max_questions,
        j.show_timer, j.auto_submit_timer,
        j.terminal_required, j.word_editor_required, j.resume_required,
        j.question_mode, j.assessment_rules, j.leetcode_problem, j.compiler_languages,
        o.name as company_name, o.industry as company_industry
      FROM jobs j
      LEFT JOIN organizations o ON j.org_id = o.id
      WHERE j.id = ?
    `).get(req.params.id);

    // If job was not found in SQLite (e.g. fresh ephemeral container restart on Vercel),
    // check if portable configuration payload was attached via ?d=
    if (!job && req.query.d) {
      try {
        let jsonStr = '';
        try {
          jsonStr = Buffer.from(req.query.d, 'base64url').toString('utf8');
        } catch (e) {
          jsonStr = Buffer.from(req.query.d, 'base64').toString('utf8');
        }
        const decoded = JSON.parse(jsonStr);
        if (decoded && decoded.title) {
          const orgId = decoded.org_id || 'org_default';
          db.prepare(`INSERT OR IGNORE INTO organizations (id, name, plan, included_interviews) VALUES (?, ?, 'free_trial', 10)`).run(orgId, decoded.company_name || 'Technical Hiring Team');
          
          db.prepare(`
            INSERT OR REPLACE INTO jobs (
              id, org_id, title, jd_text, skills, qualifications, level, max_minutes, max_questions,
              interview_type, question_mode, custom_questions, terminal_required, word_editor_required, resume_required,
              purpose, experience_required, assessment_rules, leetcode_problem, compiler_languages, category,
              show_timer, auto_submit_timer
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
          `).run(
            req.params.id,
            orgId,
            decoded.title,
            decoded.jd_text || 'Technical assessment evaluation',
            decoded.skills || 'Core Technical Skills',
            decoded.qualifications || 'Degree in Computer Science or equivalent',
            decoded.level || 'junior',
            decoded.max_minutes || 15,
            decoded.max_questions || 6,
            decoded.interview_type || 'technical',
            decoded.question_mode || 'ai_adaptive',
            decoded.custom_questions || '',
            decoded.terminal_required ? 1 : 0,
            decoded.word_editor_required ? 1 : 0,
            decoded.resume_required ? 1 : 0,
            decoded.purpose || 'job',
            decoded.experience_required || '0-2 Yrs',
            decoded.assessment_rules || '',
            decoded.leetcode_problem || '',
            decoded.compiler_languages || 'javascript,python,sql',
            decoded.category || 'Software & Tech',
            decoded.show_timer ?? 1,
            decoded.auto_submit_timer ?? 1
          );

          job = db.prepare('SELECT j.*, o.name as company_name FROM jobs j LEFT JOIN organizations o ON j.org_id = o.id WHERE j.id = ?').get(req.params.id);
        }
      } catch (e) {
        console.warn('Notice: could not hydrate job from ?d:', e.message);
      }
    }

    // Secondary Fallback: If still not found, return latest active job rather than throwing an error!
    if (!job) {
      const latestJob = db.prepare('SELECT j.*, o.name as company_name FROM jobs j LEFT JOIN organizations o ON j.org_id = o.id ORDER BY j.created_at DESC LIMIT 1').get();
      if (latestJob) {
        return res.json(latestJob);
      }
      return res.status(404).json({ error: 'Interview round not found or has expired.' });
    }

    res.json(job);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post('/public/jobs/:id/start', async (req, res) => {
  try {
    const jobId = req.params.id;
    const { name, email, phone, resume_text, source = 'external_link', jobData } = req.body;

    if (!email && !phone) {
      return res.status(400).json({ error: 'Please enter at least an Email address or WhatsApp number to proceed.' });
    }

    let job = db.prepare('SELECT * FROM jobs WHERE id = ?').get(jobId);
    
    // Rehydrate if jobData passed from client
    if (!job && jobData) {
      try {
        const orgId = jobData.org_id || 'org_default';
        db.prepare(`INSERT OR IGNORE INTO organizations (id, name, plan, included_interviews) VALUES (?, ?, 'free_trial', 10)`).run(orgId, jobData.company_name || 'Technical Hiring Team');
        db.prepare(`
          INSERT OR REPLACE INTO jobs (id, org_id, title, jd_text, skills, category, max_minutes, max_questions, show_timer, auto_submit_timer)
          VALUES (?, ?, ?, 'Technical Assessment', ?, ?, ?, ?, 1, 1)
        `).run(jobId, orgId, jobData.title || 'Technical Assessment', jobData.skills || 'Core Skills', jobData.category || 'Software & Tech', jobData.max_minutes || 15, jobData.max_questions || 6);
        job = db.prepare('SELECT * FROM jobs WHERE id = ?').get(jobId);
      } catch (e) {}
    }

    // Fallback to latest job if still not found
    if (!job) {
      job = db.prepare('SELECT * FROM jobs ORDER BY created_at DESC LIMIT 1').get();
    }
    if (!job) return res.status(404).json({ error: 'Interview round not found or has expired.' });

    // Safeguard: ensure organization exists in organizations table
    if (job.org_id) {
      db.prepare(`
        INSERT OR IGNORE INTO organizations (id, name, plan, included_interviews)
        VALUES (?, 'Technical Hiring Team', 'free_trial', 10)
      `).run(job.org_id);
    }

    const org = db.prepare('SELECT name FROM organizations WHERE id = ?').get(job.org_id);
    const companyName = org ? org.name : 'Technical Hiring Team';

    const cleanName = (name || '').trim() || (email ? email.split('@')[0] : 'Candidate');
    const cleanEmail = (email || '').trim().toLowerCase() || (phone ? `wa_${phone.replace(/\D/g, '')}@applicant.local` : '');
    const cleanPhone = (phone || '').trim();

    const candidateId = 'cand_' + crypto.randomUUID();
    const interviewId = 'int_' + crypto.randomUUID();

    // Link expiration: duration + 7 days buffer (10080 minutes)
    const timerMins = (job.max_minutes || 15) + 10080;
    const expiresAt = new Date(Date.now() + timerMins * 60 * 1000).toISOString();

    // Generate portable signed token
    const rawToken = signToken({
      type: 'interview_invite',
      interviewId,
      jobId: job.id,
      orgId: job.org_id,
      candidateId,
      candidateName: cleanName,
      candidateEmail: cleanEmail,
      phone: cleanPhone || null,
      timerMins,
      jobTitle: job.title,
      skills: job.skills,
      max_minutes: job.max_minutes,
      max_questions: job.max_questions,
      interview_type: job.interview_type,
      question_mode: job.question_mode,
      category: job.category
    });
    const tokenHash = crypto.createHash('sha256').update(rawToken).digest('hex');

    db.transaction(() => {
      db.prepare(`
        INSERT INTO candidates (id, org_id, name, email, phone, resume_text, source)
        VALUES (?, ?, ?, ?, ?, ?, ?)
      `).run(candidateId, job.org_id, cleanName, cleanEmail, cleanPhone || null, resume_text || '', source);

      db.prepare(`
        INSERT INTO interviews (id, job_id, candidate_id, token_hash, state, link_timer_minutes, expires_at, source, dispatch_status)
        VALUES (?, ?, ?, ?, 'created', ?, ?, ?, 'dispatched')
      `).run(interviewId, job.id, candidateId, tokenHash, timerMins, expiresAt, source);
    })();

    const interviewUrl = `/interview.html?token=${rawToken}`;

    // Auto-dispatch confirmation to candidate's email or WhatsApp so they have the link saved!
    try {
      const rules = buildInterviewRulesText(job);
      await dispatchCandidateNotification({
        candidateName: cleanName,
        email: email ? cleanEmail : null,
        phone: cleanPhone || null,
        jobTitle: job.title,
        companyName,
        interviewUrl,
        timerMinutes: timerMins,
        rules
      });
    } catch (e) {
      console.warn('Auto-dispatch error on external registration:', e.message);
    }

    res.json({
      success: true,
      token: rawToken,
      interviewUrl
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// --- Candidate Interview Portal Endpoints ---
app.get('/i/:token', (req, res) => {
  try {
    const rawToken = req.params.token;
    const tokenHash = crypto.createHash('sha256').update(rawToken).digest('hex');

    let interview = db.prepare(`
      SELECT 
        i.id, i.state, i.expires_at, i.link_timer_minutes,
        j.id as job_id, j.title as job_title, j.skills, j.qualifications, j.level, j.max_minutes, j.max_questions,
        j.show_timer, j.auto_submit_timer,
        j.interview_type, j.question_mode, j.terminal_required, j.word_editor_required, j.resume_required,
        j.purpose, j.experience_required, j.assessment_rules, j.leetcode_problem, j.compiler_languages,
        c.name as candidate_name, c.email as candidate_email, c.resume_text
      FROM interviews i
      JOIN jobs j ON i.job_id = j.id
      JOIN candidates c ON i.candidate_id = c.id
      WHERE i.token_hash = ? OR i.id = ?
    `).get(tokenHash, rawToken);

    // If not found in SQLite (e.g. fresh container on Vercel), try to rehydrate from signed JWT token!
    if (!interview) {
      try {
        const decoded = verifyToken(rawToken);
        if (decoded && decoded.type === 'interview_invite') {
          interview = hydrateInterviewFromToken(decoded, rawToken);
        }
      } catch (e) {}
    }

    if (!interview) {
      // Check if rawToken is actually a job_id
      const jobCheck = db.prepare('SELECT id, title FROM jobs WHERE id = ?').get(rawToken);
      if (jobCheck) {
        return res.json({ isJobLink: true, jobId: jobCheck.id, jobTitle: jobCheck.title });
      }

      // Check if portable payload was passed via ?d=
      if (req.query.d) {
        try {
          let jsonStr = '';
          try {
            jsonStr = Buffer.from(req.query.d, 'base64url').toString('utf8');
          } catch (e) {
            jsonStr = Buffer.from(req.query.d, 'base64').toString('utf8');
          }
          const jobObj = JSON.parse(jsonStr);
          if (jobObj && jobObj.title) {
            return res.json({ isJobLink: true, jobId: rawToken, jobTitle: jobObj.title });
          }
        } catch (e) {}
      }

      // Fallback: Check if ANY job exists to auto-create session so candidate is NEVER blocked
      const fallbackJob = db.prepare('SELECT id, title FROM jobs ORDER BY created_at DESC LIMIT 1').get();
      if (fallbackJob) {
        return res.json({ isJobLink: true, jobId: fallbackJob.id, jobTitle: fallbackJob.title });
      }

      return res.status(404).json({ error: 'Interview round not found or has expired.' });
    }

    // Auto-extend link validity if expires_at is passed - NEVER block candidate!
    if (interview.expires_at && new Date(interview.expires_at) < new Date()) {
      const extendedExpires = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString();
      try {
        db.prepare('UPDATE interviews SET expires_at = ? WHERE id = ?').run(extendedExpires, interview.id);
        interview.expires_at = extendedExpires;
      } catch (e) {}
      interview.is_late = true;
    }

    const turns = db.prepare('SELECT idx, role, text, skill, level FROM turns WHERE interview_id = ? ORDER BY idx ASC').all(interview.id);

    res.json({
      ...interview,
      turns
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post('/i/:token/consent', (req, res) => {
  try {
    const rawToken = req.params.token;
    const tokenHash = crypto.createHash('sha256').update(rawToken).digest('hex');

    const interview = db.prepare('SELECT id, candidate_id, state FROM interviews WHERE token_hash = ? OR id = ?').get(tokenHash, rawToken);
    if (!interview) return res.status(404).json({ error: 'Invalid token' });

    // DPDP 2023 Consent audit trail
    db.prepare(`
      UPDATE candidates 
      SET consent_at = CURRENT_TIMESTAMP, consent_version = 'v1.0_oct2026'
      WHERE id = ?
    `).run(interview.candidate_id);

    db.prepare(`UPDATE interviews SET state = 'in_progress', started_at = COALESCE(started_at, CURRENT_TIMESTAMP) WHERE id = ?`).run(interview.id);

    logActivity({
      action: 'INTERVIEW_STARTED',
      actorType: 'candidate',
      actorId: interview.candidate_id,
      entityType: 'interview',
      entityId: interview.id,
      ipAddress: req.ip
    });

    res.json({ success: true, state: 'in_progress' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// --- Universal Cross-Browser Speech-to-Text Endpoint (Safari, Firefox, Chrome, Edge, Mobile) ---
app.post('/i/:token/transcribe', upload.single('audio'), async (req, res) => {
  try {
    const rawToken = req.params.token;
    const tokenHash = crypto.createHash('sha256').update(rawToken).digest('hex');

    const interview = db.prepare(`
      SELECT i.id, i.state, j.org_id 
      FROM interviews i 
      JOIN jobs j ON i.job_id = j.id 
      WHERE i.token_hash = ? OR i.id = ?
    `).get(tokenHash, rawToken);

    if (!interview) return res.status(404).json({ error: 'Invalid interview session' });

    if (interview.state === 'completed' || interview.state === 'disqualified') {
      return res.status(400).json({ error: 'Interview session is not active' });
    }

    let audioBuffer = null;
    let mimeType = 'audio/webm';

    if (req.file) {
      audioBuffer = req.file.buffer;
      mimeType = req.file.mimetype || 'audio/webm';
    } else if (req.body && req.body.audioBase64) {
      audioBuffer = Buffer.from(req.body.audioBase64, 'base64');
      mimeType = req.body.mimeType || 'audio/webm';
    }

    if (!audioBuffer || audioBuffer.length === 0) {
      return res.status(400).json({ error: 'No audio stream or buffer received' });
    }

    const { getProviderForOrg } = await import('./interview/engine.js');
    const provider = getProviderForOrg(interview.org_id);
    const transcript = await provider.transcribeAudio(audioBuffer, mimeType);

    res.json({
      success: true,
      transcript: transcript || '',
      bytesReceived: audioBuffer.length
    });
  } catch (err) {
    console.error('[Transcribe Audio Route Error]:', err);
    res.status(500).json({ error: 'Transcription processing error: ' + err.message });
  }
});

// --- Microsoft Neural Text-to-Speech Engine Endpoint (ElevenLabs Quality) ---
app.post('/api/tts/speak', async (req, res) => {
  try {
    const text = (req.body && req.body.text) || '';
    const voiceName = (req.body && req.body.voice) || 'en-IN-female';

    if (!text || text.trim().length === 0) {
      return res.status(400).json({ error: 'Text is required for TTS synthesis' });
    }

    const voiceKey = NEURAL_VOICES[voiceName] || NEURAL_VOICES['en-IN-female'];
    const audioBuffer = await generateNeuralAudio(text.trim(), { voice: voiceKey });

    res.setHeader('Content-Type', 'audio/mpeg');
    res.setHeader('Content-Length', audioBuffer.length);
    res.setHeader('Cache-Control', 'public, max-age=86400');
    res.send(audioBuffer);
  } catch (err) {
    console.warn('[NeuralTTS Route Error]:', err.message);
    res.status(500).json({ error: 'TTS audio synthesis failed: ' + err.message });
  }
});

app.get('/api/tts/speak', async (req, res) => {
  try {
    const text = req.query.text || '';
    const voiceName = req.query.voice || 'en-IN-female';

    if (!text || text.trim().length === 0) {
      return res.status(400).send('Text query param is required');
    }

    const voiceKey = NEURAL_VOICES[voiceName] || NEURAL_VOICES['en-IN-female'];
    const audioBuffer = await generateNeuralAudio(text.trim(), { voice: voiceKey });

    res.setHeader('Content-Type', 'audio/mpeg');
    res.setHeader('Content-Length', audioBuffer.length);
    res.setHeader('Cache-Control', 'public, max-age=86400');
    res.send(audioBuffer);
  } catch (err) {
    res.status(500).send('TTS Error: ' + err.message);
  }
});

app.post('/i/:token/answer', async (req, res) => {
  try {
    const rawToken = req.params.token;
    const answerText = req.body.answerText || req.body.text || null;
    const tokenHash = crypto.createHash('sha256').update(rawToken).digest('hex');

    const interview = db.prepare('SELECT id, state FROM interviews WHERE token_hash = ? OR id = ?').get(tokenHash, rawToken);
    if (!interview) return res.status(404).json({ error: 'Invalid token' });

    if (interview.state === 'completed' || interview.state === 'report_ready') {
      return res.json({ isCompleted: true, message: 'Interview already concluded.' });
    }

    const nextStep = await processInterviewTurn({
      interviewId: interview.id,
      candidateText: answerText || null
    });

    res.json(nextStep);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post('/i/:token/finish', async (req, res) => {
  try {
    const rawToken = req.params.token;
    const tokenHash = crypto.createHash('sha256').update(rawToken).digest('hex');

    const interview = db.prepare('SELECT id FROM interviews WHERE token_hash = ? OR id = ?').get(tokenHash, rawToken);
    if (!interview) return res.status(404).json({ error: 'Invalid token' });

    db.prepare(`UPDATE interviews SET state = 'completed', ended_at = CURRENT_TIMESTAMP WHERE id = ?`).run(interview.id);

    // Generate evidence-backed report automatically
    const report = await generateReport(interview.id);

    logActivity({
      action: 'INTERVIEW_COMPLETED',
      actorType: 'candidate',
      entityType: 'interview',
      entityId: interview.id,
      details: { score: report?.overall_score, verdict: report?.candidate_verdict, recommendation: report?.recommendation },
      ipAddress: req.ip
    });

    res.json({ success: true, message: 'Interview completed and report generated.', report });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// --- AI Proctoring & Disqualification Endpoints ---
app.post('/i/:token/disqualify', async (req, res) => {
  try {
    const rawToken = req.params.token;
    const tokenHash = crypto.createHash('sha256').update(rawToken).digest('hex');
    const { reason, warnings, violations } = req.body || {};

    const interview = db.prepare('SELECT id, job_id, candidate_id FROM interviews WHERE token_hash = ? OR id = ?').get(tokenHash, rawToken);
    if (!interview) return res.status(404).json({ error: 'Invalid token' });

    const disqualificationReason = reason || 'Proctoring breach / Cheating detected';
    const violationsJson = JSON.stringify(violations || []);

    db.prepare(`
      UPDATE interviews 
      SET state = 'disqualified', 
          disqualified_reason = ?, 
          proctor_warnings = ?,
          proctor_logs = ?,
          ended_at = CURRENT_TIMESTAMP 
      WHERE id = ?
    `).run(disqualificationReason, warnings || 3, violationsJson, interview.id);

    // Record system turn in transcript
    const maxTurn = db.prepare('SELECT COALESCE(MAX(idx), 0) as m FROM turns WHERE interview_id = ?').get(interview.id).m;
    db.prepare(`
      INSERT INTO turns (id, interview_id, idx, role, text, skill, level)
      VALUES (?, ?, ?, 'system', ?, 'proctor', 0)
    `).run('turn_' + crypto.randomUUID(), interview.id, maxTurn + 1, `[SECURITY ALERT] Candidate DISQUALIFIED. Reason: ${disqualificationReason}`);

    // Create Disqualified Report immediately
    const reportId = 'rep_' + crypto.randomUUID();
    const disqualifiedReport = {
      candidate_verdict: 'DISQUALIFIED',
      recommendation: 'reject',
      overall_score: 0,
      disqualified: true,
      disqualified_reason: disqualificationReason,
      hiring_clarification: `STRONG REJECT / DISQUALIFIED: Candidate was disqualified by the AI Proctoring System for severe policy violations (${disqualificationReason}).`,
      overall_summary: `Candidate failed and was disqualified during the technical screening due to proctoring violations: ${disqualificationReason}. Total warnings issued: ${warnings || 3}.`,
      red_flags: [
        `Proctoring Violation: ${disqualificationReason}`,
        ...(violations || []).map(v => `Proctor Event: ${v.reason || v.type} (${v.time || 'active session'})`)
      ],
      proctor_violations: violations || [],
      skills: [],
      question_evaluations: [],
      meta: { disqualified: true, warnings: warnings || 3 }
    };

    db.prepare(`
      INSERT INTO reports (id, interview_id, json, model)
      VALUES (?, ?, ?, 'ai-proctor-v1')
      ON CONFLICT(interview_id) DO UPDATE SET
        json = excluded.json,
        model = excluded.model,
        created_at = CURRENT_TIMESTAMP
    `).run(reportId, interview.id, JSON.stringify(disqualifiedReport));

    logActivity({
      action: 'INTERVIEW_DISQUALIFIED',
      actorType: 'candidate',
      entityType: 'interview',
      entityId: interview.id,
      details: { reason: disqualificationReason, warnings: warnings || 3 },
      ipAddress: req.ip
    });

    res.json({ success: true, message: 'Candidate disqualified', reason: disqualificationReason });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post('/i/:token/proctor-event', (req, res) => {
  try {
    const rawToken = req.params.token;
    const tokenHash = crypto.createHash('sha256').update(rawToken).digest('hex');
    const { type, reason, warningsCount } = req.body || {};

    const interview = db.prepare('SELECT id, proctor_logs FROM interviews WHERE token_hash = ? OR id = ?').get(tokenHash, rawToken);
    if (!interview) return res.status(404).json({ error: 'Invalid token' });

    let existingLogs = [];
    try {
      if (interview.proctor_logs) existingLogs = JSON.parse(interview.proctor_logs);
    } catch (e) {}

    existingLogs.push({
      type: type || 'suspicious_activity',
      reason: reason || 'Detected by vision engine',
      warningNumber: warningsCount || 1,
      time: new Date().toLocaleTimeString('en-US', { hour12: false })
    });

    db.prepare(`
      UPDATE interviews 
      SET proctor_warnings = ?, proctor_logs = ? 
      WHERE id = ?
    `).run(warningsCount || 0, JSON.stringify(existingLogs), interview.id);

    res.json({ success: true, logged: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// --- Recruiter Report View ---
app.get('/interviews/:id/report', requireAuth, (req, res) => {
  try {
    const interview = db.prepare(`
      SELECT i.*, j.title as job_title, j.skills as job_skills, c.name as candidate_name, c.email as candidate_email
      FROM interviews i
      JOIN jobs j ON i.job_id = j.id
      JOIN candidates c ON i.candidate_id = c.id
      WHERE i.id = ? AND j.org_id = ?
    `).get(req.params.id, req.user.org_id);

    if (!interview) return res.status(404).json({ error: 'Interview not found' });

    const reportRow = db.prepare('SELECT * FROM reports WHERE interview_id = ?').get(interview.id);
    const turns = db.prepare('SELECT idx, role, text, skill, level, created_at FROM turns WHERE interview_id = ? ORDER BY idx ASC').all(interview.id);

    res.json({
      interview,
      report: reportRow ? JSON.parse(reportRow.json) : null,
      turns
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// --- Usage & Metrics Dashboard (Section 10 & 11) ---
app.get('/usage', requireAuth, (req, res) => {
  try {
    const stats = db.prepare(`
      SELECT 
        COUNT(DISTINCT interview_id) as total_interviews,
        COALESCE(SUM(input_tokens), 0) as total_input_tokens,
        COALESCE(SUM(output_tokens), 0) as total_output_tokens,
        COALESCE(SUM(est_cost), 0) as total_est_cost_inr
      FROM usage_events
      WHERE org_id = ?
    `).get(req.user.org_id);

    const totalJobs = db.prepare('SELECT COUNT(*) as c FROM jobs WHERE org_id = ?').get(req.user.org_id).c;
    const completedInterviews = db.prepare(`
      SELECT COUNT(*) as c 
      FROM interviews i 
      JOIN jobs j ON i.job_id = j.id 
      WHERE j.org_id = ? AND i.state IN ('completed', 'report_ready')
    `).get(req.user.org_id).c;

    res.json({
      stats,
      totalJobs,
      completedInterviews
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// --- DPDP 2023 Candidate Erasure Endpoint (Section 5.4 & 9.2) ---
app.delete('/candidates/:id', requireAuth, (req, res) => {
  try {
    const candidate = db.prepare('SELECT id FROM candidates WHERE id = ? AND org_id = ?').get(req.params.id, req.user.org_id);
    if (!candidate) return res.status(404).json({ error: 'Candidate not found' });

    // Anonymize/Delete personal data under Right to Erasure
    db.prepare(`
      UPDATE candidates 
      SET name = '[DELETED_DPDP]', email = 'deleted@erased.dpdp', resume_text = NULL, deleted_at = CURRENT_TIMESTAMP
      WHERE id = ?
    `).run(candidate.id);

    // Audit log
    db.prepare(`
      INSERT INTO audit_logs (id, org_id, actor, action, target)
      VALUES (?, ?, ?, 'DPDP_ERASURE', ?)
    `).run('audit_' + crypto.randomUUID(), req.user.org_id, req.user.email, `Candidate ID ${candidate.id}`);

    res.json({ success: true, message: 'Candidate personal records erased in compliance with DPDP Act.' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// --- Resume Parsing & Drag-and-Drop Parser Endpoint (PDF, DOCX, TXT) ---
app.post('/api/resume/parse', upload.single('resume'), async (req, res) => {
  try {
    let rawText = '';
    if (req.file) {
      const mime = req.file.mimetype || 'application/pdf';
      rawText = await extractTextFromBuffer(req.file.buffer, mime);
    } else if (req.body && req.body.text) {
      rawText = req.body.text;
    } else {
      return res.status(400).json({ error: 'No resume file or text provided' });
    }

    if (!rawText || rawText.trim().length === 0) {
      return res.status(400).json({ error: 'Could not extract readable text from the provided file.' });
    }

    const parsed = parseResumeText(rawText);
    res.json({
      success: true,
      message: 'Resume parsed successfully',
      data: parsed
    });
  } catch (err) {
    console.error('Resume parse error:', err);
    res.status(500).json({ error: 'Failed to parse resume: ' + err.message });
  }
});

// Candidate resume upload/update in candidate room
app.post('/i/:token/resume', upload.single('resume'), async (req, res) => {
  try {
    const tokenHash = crypto.createHash('sha256').update(req.params.token).digest('hex');
    const interview = db.prepare('SELECT * FROM interviews WHERE token_hash = ?').get(tokenHash);
    if (!interview) return res.status(404).json({ error: 'Interview not found' });

    let rawText = '';
    if (req.file) {
      const mime = req.file.mimetype || 'application/pdf';
      rawText = await extractTextFromBuffer(req.file.buffer, mime);
    } else if (req.body && req.body.text) {
      rawText = req.body.text;
    } else {
      return res.status(400).json({ error: 'No resume file or text provided' });
    }

    const parsed = parseResumeText(rawText);

    // Update candidate record with parsed structured resume summary
    db.prepare('UPDATE candidates SET resume_text = ? WHERE id = ?').run(
      parsed.summary,
      interview.candidate_id
    );

    res.json({
      success: true,
      message: 'Resume successfully parsed and attached to interview session',
      data: parsed
    });
  } catch (err) {
    console.error('Candidate resume upload error:', err);
    res.status(500).json({ error: 'Failed to process resume: ' + err.message });
  }
});

// --- Lead Magnet Endpoint (Chapter 11.3 #4: Free Interview Questions & Rubric) ---
app.post('/api/lead-magnet', async (req, res) => {
  try {
    const { name, email, jd_text } = req.body;
    if (!email || !jd_text) {
      return res.status(400).json({ error: 'Email and Job Description (JD) text are required' });
    }

    // Save lead
    const leadId = 'lead_' + crypto.randomUUID();
    db.prepare(`
      INSERT INTO leads (id, name, email, vacancies, source)
      VALUES (?, ?, ?, 'lead_magnet_user', 'lead_magnet')
    `).run(leadId, name || 'Lead Magnet User', email.trim());

    // Extract skills & generate 10 questions + rubric
    const detected = [];
    const keywords = ['Python', 'Java', 'C++', 'SQL', 'JavaScript', 'TypeScript', 'Git', 'React', 'Node.js', 'REST APIs', 'Data Structures'];
    for (const kw of keywords) {
      const escaped = kw.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      if (new RegExp(`(?:\\b|(?<=\\W))${escaped}(?:\\b|(?=\\W))`, 'i').test(jd_text)) detected.push(kw);
    }
    const skills = detected.length > 0 ? detected : ['Core Programming', 'SQL', 'Problem Solving'];

    const questionsAndRubric = skills.flatMap((sk, idx) => [
      {
        id: idx * 2 + 1,
        skill: sk,
        level: 'Basic / Core',
        question: `Can you explain how ${sk} handles fundamental operations, and what data structures or primitives you use most frequently?`,
        rubric: {
          score_1: `Incorrect syntax or unable to define basic ${sk} concepts.`,
          score_3: `Correctly defines primitives and common standard library methods.`,
          score_5: `Explains internal memory representation, performance tradeoffs, and best practices.`
        }
      },
      {
        id: idx * 2 + 2,
        skill: sk,
        level: 'Practical / Scenario',
        question: `Walk me through a bug or unexpected error you resolved while working with ${sk}. How did you trace and fix it?`,
        rubric: {
          score_1: `Cannot describe concrete debugging steps or error handling.`,
          score_3: `Explains standard stack trace reading, print/logging statements, or try/catch blocks.`,
          score_5: `Demonstrates systematic debugging, root-cause isolation, and preventative testing.`
        }
      }
    ]).slice(0, 10);

    res.json({
      success: true,
      skills,
      questions: questionsAndRubric,
      message: 'Here are 10 tailored technical screening questions with rubrics for your role.'
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// --- Pilot Waitlist Endpoint (Chapter 11.5) ---
app.post('/api/waitlist', (req, res) => {
  try {
    const { name, company, email, phone, vacancies } = req.body;
    if (!email) {
      return res.status(400).json({ error: 'Email is required' });
    }

    const leadId = 'lead_' + crypto.randomUUID();
    db.prepare(`
      INSERT INTO leads (id, name, company, email, phone, vacancies, source)
      VALUES (?, ?, ?, ?, ?, ?, 'pilot_waitlist')
    `).run(leadId, name || '', company || '', email.trim(), phone || '', vacancies || '');

    res.json({ success: true, message: 'Thank you! You have been added to the VIP Pilot program.' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// --- CSV Export for ATS & Spreadsheet Integration (Week 4 / Section 14.1) ---
app.get('/jobs/:id/export.csv', requireAuth, (req, res) => {
  try {
    const jobId = req.params.id;
    const job = db.prepare('SELECT title FROM jobs WHERE id = ? AND org_id = ?').get(jobId, req.user.org_id);
    if (!job) return res.status(404).send('Job not found');

    const rows = db.prepare(`
      SELECT 
        c.name as candidate_name,
        c.email as candidate_email,
        c.consent_at,
        i.state,
        i.started_at,
        i.ended_at,
        r.json as report_json
      FROM interviews i
      JOIN candidates c ON i.candidate_id = c.id
      LEFT JOIN reports r ON r.interview_id = i.id
      WHERE i.job_id = ?
      ORDER BY i.id DESC
    `).all(jobId);

    let csv = 'Candidate Name,Email,Status,Consent Given,Recommendation,Top Skills Evaluated,Report Summary\n';
    for (const r of rows) {
      let rec = 'N/A';
      let skillsSummary = '';
      let summary = '';
      if (r.report_json) {
        try {
          const parsed = JSON.parse(r.report_json);
          rec = (parsed.recommendation || 'N/A').toUpperCase();
          summary = (parsed.overall_summary || '').replace(/"/g, '""');
          skillsSummary = (parsed.skills || []).map(s => `${s.skill}:${s.score}/5`).join(' | ');
        } catch (e) {}
      }

      csv += `"${r.candidate_name}","${r.candidate_email}","${r.state}","${r.consent_at ? 'Yes' : 'No'}","${rec}","${skillsSummary}","${summary}"\n`;
    }

    res.setHeader('Content-Type', 'text/csv');
    res.setHeader('Content-Disposition', `attachment; filename="candidates_${job.title.replace(/[^a-z0-9]/gi, '_')}.csv"`);
    res.send(csv);
  } catch (err) {
    res.status(500).send('Export error: ' + err.message);
  }
});

// Serve candidate app or recruiter dashboard fallback for client routes
app.use((req, res, next) => {
  if (req.method === 'GET') {
    return res.sendFile(path.resolve(frontendPath, 'index.html'));
  }
  next();
});

// JSON 404 handler for missing API endpoints
app.use((req, res) => {
  res.status(404).json({ error: `Cannot ${req.method} ${req.path}` });
});

app.listen(PORT, () => {
  console.log(`=======================================================`);
  console.log(`🚀 RoundOne AI running at http://localhost:${PORT}`);
  console.log(`   - Recruiter Dashboard: http://localhost:${PORT}`);
  console.log(`   - Candidate Interview: http://localhost:${PORT}/interview.html?token=<token>`);
  console.log(`   - Health check:        http://localhost:${PORT}/health`);
  console.log(`=======================================================`);
});
