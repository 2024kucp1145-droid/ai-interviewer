import express from 'express';
import cors from 'cors';
import crypto from 'crypto';
import path from 'path';
import { fileURLToPath } from 'url';
import dotenv from 'dotenv';

import { db, initDatabase, isPostgresConfigured, checkPostgresConnection } from './db/database.js';
import {
  hashPassword,
  comparePassword,
  signToken,
  verifyToken,
  requireAuth,
  createStatelessOtpChallenge,
  verifyStatelessOtpChallenge,
  validateJwtSecret
} from './auth/auth.js';
import { encryptApiKey, maskKey, validateVaultSecret } from './keys/vault.js';
import { createRateLimiter } from './middleware/rateLimit.js';
import { triggerOrgWebhooks, deliverWebhook } from './services/webhookService.js';
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
import { getEffectiveAuthConfig, getEffectiveSiteConfig } from './services/platformConfigService.js';
import { recordServerEvent } from './services/serverMonitorService.js';
import {
  getEmailConfig,
  sendRecruiterVerificationEmail,
  sendFeedbackThankYouEmail,
  sendInterviewCompletionEmail,
  sendWaitlistConfirmationEmail
} from './services/emailService.js';

dotenv.config();
validateJwtSecret();
validateVaultSecret();

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

app.use((req, res, next) => {
  const reqId = req.headers['x-request-id'] || crypto.randomUUID();
  req.requestId = String(reqId);
  res.setHeader('X-Request-Id', req.requestId);
  next();
});

app.use(cors());
app.use(express.json({
  limit: '5mb',
  verify: (req, _res, buf) => {
    req.rawBody = buf;
  }
}));

// Sliding-window rate limiters on sensitive auth, public, compiler & TTS routes
const authLimiter = createRateLimiter({ windowMs: 15 * 60_000, max: 30, keyPrefix: 'auth', message: 'Too many authentication attempts. Please wait a few minutes.' });
const publicStartLimiter = createRateLimiter({ windowMs: 10 * 60_000, max: 25, keyPrefix: 'pub_start', message: 'Too many interview session launches from this IP.' });
const judgeLimiter = createRateLimiter({ windowMs: 60_000, max: 30, keyPrefix: 'judge', message: 'Too many code executions. Slow down for a moment.' });
const ttsLimiter = createRateLimiter({ windowMs: 60_000, max: 60, keyPrefix: 'tts', message: 'Voice synthesis rate limit reached.' });

['/auth/signup', '/auth/login', '/auth/login-otp-verify', '/auth/reset-password', '/auth/reset-password-verify'].forEach((p) => app.use(p, authLimiter));
app.use('/public/jobs/:id/start', publicStartLimiter);
app.use('/api/compiler/judge', judgeLimiter);
app.use('/api/tts/speak', ttsLimiter);

// Maintenance mode guard (never blocks Admin Panel, health probe, or public site config)
app.use((req, res, next) => {
  const pathUrl = req.path || '';
  if (
    pathUrl.startsWith('/api/admin') ||
    pathUrl === '/admin' ||
    pathUrl === '/admin.html' ||
    pathUrl === '/health' ||
    pathUrl === '/api/site/config' ||
    pathUrl.startsWith('/api/pages/') ||
    pathUrl.startsWith('/p/') ||
    pathUrl.startsWith('/css/') ||
    pathUrl.startsWith('/js/')
  ) {
    return next();
  }
  const siteCfg = getEffectiveSiteConfig();
  if (siteCfg.maintenance.enabled && (req.method !== 'GET' || pathUrl.startsWith('/api/') || pathUrl.startsWith('/auth/') || pathUrl.startsWith('/billing/'))) {
    return res.status(503).json({
      error: siteCfg.maintenance.message,
      maintenance: true,
    });
  }
  return next();
});

// Public Website Control Config (Brand, Banner, Maintenance Mode, Auth Flags, Published Links)
app.get('/api/site/config', (req, res) => {
  try {
    res.json({ success: true, ...getEffectiveSiteConfig() });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Public Custom Page API + Branded HTML Viewer (/p/:slug)
app.get('/api/pages/:slug', (req, res) => {
  try {
    const slug = String(req.params.slug || '').trim().toLowerCase();
    const page = db.prepare('SELECT id, slug, title, content, link_url, placement, updated_at FROM site_pages WHERE slug = ? AND is_published = 1').get(slug);
    if (!page) return res.status(404).json({ error: 'Page not found' });
    res.json({ success: true, page });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.get('/p/:slug', (req, res) => {
  try {
    const slug = String(req.params.slug || '').trim().toLowerCase();
    const page = db.prepare('SELECT id, slug, title, content, link_url, updated_at FROM site_pages WHERE slug = ? AND is_published = 1').get(slug);
    if (!page) {
      return res.status(404).type('html').send('<h2>Page not found</h2><p><a href="/">Return Home</a></p>');
    }
    if (page.link_url && !String(page.content || '').trim()) {
      return res.redirect(page.link_url);
    }
    const siteCfg = getEffectiveSiteConfig();
    const esc = (str) => String(str || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
    const paragraphs = String(page.content || '')
      .split(/\n{2,}/)
      .map(block => `<p style="margin:0 0 1rem; line-height:1.7; color:#334155;">${esc(block).replace(/\n/g, '<br>')}</p>`)
      .join('');
    res.status(200).type('html').send(`<!DOCTYPE html>
<html lang="en"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>${esc(page.title)} — ${esc(siteCfg.brandName)}</title>
<style>body{font-family:Inter,system-ui,-apple-system,sans-serif;background:#f8fafc;color:#0f172a;margin:0;padding:2rem 1rem;}.wrap{max-width:780px;margin:0 auto;background:#fff;border:1px solid #e2e8f0;border-radius:14px;padding:2rem 2.25rem;box-shadow:0 12px 30px rgba(15,23,42,.05);}.top{display:flex;justify-content:space-between;align-items:center;border-bottom:1px solid #e2e8f0;padding-bottom:1rem;margin-bottom:1.5rem;gap:1rem;}.btn{display:inline-flex;align-items:center;gap:.4rem;padding:.5rem .9rem;border-radius:8px;background:#0f172a;color:#fff;text-decoration:none;font-size:.82rem;font-weight:600;}</style>
</head><body><div class="wrap">
<div class="top"><div><div style="font-size:.75rem;color:#64748b;font-weight:700;text-transform:uppercase;letter-spacing:.05em;">${esc(siteCfg.brandName)}</div><h1 style="margin:.2rem 0 0;font-size:1.5rem;">${esc(page.title)}</h1></div><a class="btn" href="/">Back to App</a></div>
<div>${paragraphs || '<p style="color:#64748b;">No content added yet.</p>'}</div>
${page.link_url ? `<p style="margin-top:1.5rem;"><a class="btn" href="${esc(page.link_url)}" target="_blank" rel="noopener">Open External Link</a></p>` : ''}
</div></body></html>`);
  } catch (err) {
    res.status(500).send(err.message);
  }
});

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

// --- Health & Readiness Check ---
app.get('/health', async (req, res) => {
  let sqliteOk = false;
  let sqliteError = null;
  try {
    const probe = db.prepare('SELECT 1 as ok').get();
    sqliteOk = probe?.ok === 1;
  } catch (err) {
    sqliteError = err.message;
  }

  let postgresStatus = { configured: false, connected: null };
  if (isPostgresConfigured()) {
    const pgCheck = await checkPostgresConnection();
    postgresStatus = { configured: true, connected: pgCheck.connected, latencyMs: pgCheck.latencyMs, error: pgCheck.error || null };
  }

  const emailCfg = getEmailConfig();
  const degraded = !sqliteOk || (postgresStatus.configured && !postgresStatus.connected);

  res.status(degraded ? 503 : 200).json({
    status: degraded ? 'degraded' : 'ok',
    timestamp: new Date().toISOString(),
    uptime: process.uptime(),
    requestId: req.requestId,
    checks: {
      sqlite: { connected: sqliteOk, error: sqliteError },
      postgres: postgresStatus,
      email: { configured: !!emailCfg.isConfigured, provider: emailCfg.provider || null },
      memoryRssMb: Math.round(process.memoryUsage().rss / (1024 * 1024)),
    }
  });
});

// --- Auth Endpoints ---
// --- Recruiter Email + Password + Email OTP Auth Endpoints ---
const usedRecruiterOtpTokens = new Set();

function generate6DigitOtp() {
  return String(crypto.randomInt(100000, 1000000));
}

function canUseRecruiterOtpFallback() {
  const authCfg = getEffectiveAuthConfig();
  return !getEmailConfig().isConfigured || authCfg.allowDevOtpFallback;
}

function markRecruiterOtpUsed(otpToken) {
  if (!otpToken) return;
  if (usedRecruiterOtpTokens.size > 5000) usedRecruiterOtpTokens.clear();
  usedRecruiterOtpTokens.add(otpToken);
}

function verifyRecruiterOtpCode({ dbUser, cleanEmail, code, purposes = ['recruiter_signup', 'recruiter_login'], otpToken }) {
  const cleanCode = String(code || '').trim();
  if (!cleanCode) {
    return { valid: false, error: 'Please enter the 6-digit verification code.' };
  }

  if (canUseRecruiterOtpFallback() && cleanCode === '000000') {
    return { valid: true, via: 'dev_fallback', decoded: null };
  }

  if (dbUser && dbUser.verification_code && String(dbUser.verification_code).trim() === cleanCode) {
    return { valid: true, via: 'db', decoded: null };
  }

  if (otpToken) {
    if (usedRecruiterOtpTokens.has(otpToken)) {
      return { valid: false, error: 'This verification code has already been used. Please request a new code.' };
    }
    let lastError = null;
    for (const purpose of purposes) {
      const check = verifyStatelessOtpChallenge(otpToken, cleanEmail, cleanCode, purpose);
      if (check.valid) {
        return { valid: true, via: 'stateless', decoded: check.decoded };
      }
      if (check.error && !check.error.includes('purpose')) {
        lastError = check.error;
      }
    }
    return { valid: false, error: lastError || 'Invalid or expired verification code.' };
  }

  return { valid: false, error: 'Invalid verification code. Please check your email and try again.' };
}

app.post('/auth/signup', async (req, res) => {
  try {
    const authCfg = getEffectiveAuthConfig();
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
      country,
      inviteToken
    } = req.body;

    if (!authCfg.allowPublicSignup && !inviteToken) {
      return res.status(403).json({ error: 'New signups are currently disabled by the platform administrator.' });
    }

    if (!email || !password) {
      return res.status(400).json({ error: 'Email and password are required' });
    }

    const cleanEmail = email.toLowerCase().trim();
    const otpCode = generate6DigitOtp();
    let user = db.prepare('SELECT * FROM users WHERE email = ?').get(cleanEmail);

    if (user) {
      if (!comparePassword(password, user.password_hash)) {
        return res.status(400).json({ error: 'An account with this email already exists. Please sign in or reset your password via Email OTP.' });
      }

      db.prepare(`UPDATE users SET verification_code = ?, last_login_at = CURRENT_TIMESTAMP WHERE id = ?`).run(otpCode, user.id);
      const org = db.prepare('SELECT * FROM organizations WHERE id = ?').get(user.org_id);
      const token = signToken({ id: user.id, org_id: user.org_id, email: user.email, role: user.role });
      const mode = user.is_verified ? 'login' : 'signup';
      const purpose = user.is_verified ? 'recruiter_login' : 'recruiter_signup';
      const otpToken = createStatelessOtpChallenge(cleanEmail, otpCode, purpose, {
        userId: user.id,
        orgId: user.org_id,
        fullName: user.full_name || fullName || 'Hiring Manager',
        jobTitle: user.job_title || jobTitle || 'Recruiter',
        role: user.role || 'owner',
        orgName: org?.name || companyName || 'My Organization'
      });

      const mailRes = await sendRecruiterVerificationEmail(cleanEmail, otpCode, user.full_name || fullName || 'Hiring Manager', mode);
      return res.json({
        token,
        requiresOtp: true,
        otpToken,
        emailSent: !!mailRes.sent,
        forwardedTo: mailRes.forwardedTo || cleanEmail,
        emailError: mailRes.error || null,
        message: mailRes.sent
          ? `Done — mail sent to ${cleanEmail}.`
          : 'Enter the 6-digit verification code to continue.',
        user: {
          id: user.id,
          email: user.email,
          fullName: user.full_name,
          jobTitle: user.job_title,
          is_verified: user.is_verified,
          approval_status: user.approval_status || 'approved'
        },
        org: org || { id: user.org_id, name: companyName || 'My Organization', plan: 'free_trial', included_interviews: 10 }
      });
    }

    let inviteRecord = null;
    if (inviteToken) {
      const inviteHash = crypto.createHash('sha256').update(String(inviteToken)).digest('hex');
      inviteRecord = db.prepare(`
        SELECT * FROM org_team_invites
        WHERE token_hash = ? AND status = 'pending' AND datetime(expires_at) > datetime('now')
      `).get(inviteHash);
      if (!inviteRecord) {
        return res.status(400).json({ error: 'Invalid or expired team invite token.' });
      }
      if (inviteRecord.email.toLowerCase() !== cleanEmail) {
        return res.status(400).json({ error: 'Invite token belongs to a different email address.' });
      }
    }

    const orgId = inviteRecord ? inviteRecord.org_id : ('org_' + crypto.randomUUID());
    const userRole = inviteRecord ? (inviteRecord.org_role || 'recruiter') : 'owner';
    const userId = 'usr_' + crypto.randomUUID();
    const passHash = hashPassword(password);

    const trialCredits = authCfg.defaultTrialCredits;
    const initialApprovalStatus = (!inviteRecord && authCfg.requireAdminApproval) ? 'pending_approval' : 'approved';

    db.transaction(() => {
      if (!inviteRecord) {
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
      } else {
        db.prepare("UPDATE org_team_invites SET status = 'accepted' WHERE id = ?").run(inviteRecord.id);
      }

      db.prepare(`
        INSERT INTO users (id, org_id, full_name, phone, job_title, email, password_hash, role, org_role, is_verified, verification_code, approval_status, last_login_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP)
      `).run(
        userId,
        orgId,
        (fullName || 'Hiring Manager').trim(),
        (phone || '').trim(),
        (jobTitle || 'Recruiter').trim(),
        cleanEmail,
        passHash,
        userRole,
        userRole,
        authCfg.requireEmailOtp ? 0 : 1,
        authCfg.requireEmailOtp ? otpCode : null,
        initialApprovalStatus
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
      details: { companyName, jobTitle, is_verified: 0, otpRequired: true },
      ipAddress: req.ip
    });

    const token = signToken({ id: userId, org_id: orgId, email: cleanEmail, role: userRole });
    if (!authCfg.requireEmailOtp && initialApprovalStatus === 'approved') {
      return res.json({
        token,
        requiresOtp: false,
        message: 'Account created and signed in.',
        user: {
          id: userId,
          email: cleanEmail,
          fullName: fullName || 'Hiring Manager',
          jobTitle: jobTitle || 'Recruiter',
          role: userRole,
          is_verified: 1,
          approval_status: initialApprovalStatus
        },
        org: { id: orgId, name: companyName || 'My Organization', plan: 'free_trial', included_interviews: trialCredits }
      });
    }

    const otpToken = createStatelessOtpChallenge(cleanEmail, otpCode, 'recruiter_signup', {
      userId,
      orgId,
      fullName: (fullName || 'Hiring Manager').trim(),
      jobTitle: (jobTitle || 'Recruiter').trim(),
      role: userRole,
      orgName: (companyName || 'My Organization').trim()
    });
    const mailRes = await sendRecruiterVerificationEmail(cleanEmail, otpCode, fullName || 'Hiring Manager', 'signup');

    res.json({
      token,
      requiresOtp: true,
      otpToken,
      emailSent: !!mailRes.sent,
      forwardedTo: mailRes.forwardedTo || cleanEmail,
      emailError: mailRes.error || null,
      message: mailRes.sent
        ? `Done — mail sent to ${cleanEmail}.`
        : 'Done — enter your 6-digit verification code to verify your email.',
      user: {
        id: userId,
        email: cleanEmail,
        fullName: fullName || 'Hiring Manager',
        jobTitle: jobTitle || 'Recruiter',
        is_verified: 0,
        approval_status: initialApprovalStatus
      },
      org: { id: orgId, name: companyName || 'My Organization', plan: 'free_trial', included_interviews: trialCredits }
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Verify recruiter signup OTP
app.post('/auth/verify', requireAuth, (req, res) => {
  try {
    const { code, otp, otpToken } = req.body || {};
    const cleanEmail = (req.user.email || '').toLowerCase().trim();
    let user = db.prepare('SELECT * FROM users WHERE id = ? OR email = ?').get(req.user.id, cleanEmail);

    const check = verifyRecruiterOtpCode({
      dbUser: user,
      cleanEmail: (user?.email || cleanEmail),
      code: code || otp,
      purposes: ['recruiter_signup', 'recruiter_login'],
      otpToken
    });
    if (!check.valid) {
      return res.status(400).json({ error: check.error });
    }

    const userId = user?.id || req.user.id;
    const orgId = user?.org_id || req.user.org_id;
    if (!user) {
      const dec = check.decoded || {};
      db.prepare(`INSERT OR IGNORE INTO organizations (id, name, plan, included_interviews) VALUES (?, ?, 'free_trial', 10)`)
        .run(orgId, dec.orgName || 'My Organization');
      db.prepare(`
        INSERT OR IGNORE INTO users (id, org_id, full_name, phone, job_title, email, password_hash, role, is_verified, verification_code, approval_status, last_login_at)
        VALUES (?, ?, ?, '', ?, ?, '', ?, 1, NULL, 'approved', CURRENT_TIMESTAMP)
      `).run(userId, orgId, dec.fullName || 'Hiring Manager', dec.jobTitle || 'Recruiter', cleanEmail, dec.role || 'owner');
      user = db.prepare('SELECT * FROM users WHERE id = ?').get(userId);
    } else {
      if (user.approval_status === 'suspended' || user.approval_status === 'rejected') {
        return res.status(403).json({ error: 'Your account has been suspended or rejected by the administrator.' });
      }
      if (user.approval_status === 'pending_approval') {
        db.prepare('UPDATE users SET is_verified = 1, verification_code = NULL WHERE id = ?').run(user.id);
        return res.status(403).json({ error: 'Your email is verified, and your account is awaiting administrator approval.' });
      }
      db.prepare("UPDATE users SET is_verified = 1, verification_code = NULL, last_login_at = CURRENT_TIMESTAMP WHERE id = ?").run(user.id);
    }

    markRecruiterOtpUsed(otpToken);
    const org = db.prepare('SELECT * FROM organizations WHERE id = ?').get(user.org_id);
    const token = signToken({ id: user.id, org_id: user.org_id, email: user.email, role: user.role });

    res.json({
      success: true,
      message: 'Email verified successfully!',
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
      org: org || { id: user.org_id, name: 'My Organization', plan: 'free_trial', included_interviews: 10 }
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

async function handleRecruiterResendCode(req, res) {
  try {
    const cleanEmail = (req.body?.email || req.user?.email || '').toLowerCase().trim();
    if (!cleanEmail) {
      return res.status(400).json({ error: 'Email address is required to resend verification code.' });
    }

    const mode = ['login', 'reset', 'signup'].includes(req.body?.mode) ? req.body.mode : 'signup';
    const purpose = mode === 'login' ? 'recruiter_login' : (mode === 'reset' ? 'recruiter_reset' : 'recruiter_signup');
    const user = req.user?.id
      ? db.prepare('SELECT * FROM users WHERE id = ? OR email = ?').get(req.user.id, cleanEmail)
      : db.prepare('SELECT * FROM users WHERE email = ?').get(cleanEmail);

    const otpCode = generate6DigitOtp();
    if (user) {
      db.prepare('UPDATE users SET verification_code = ? WHERE id = ?').run(otpCode, user.id);
    }

    const otpToken = createStatelessOtpChallenge(cleanEmail, otpCode, purpose, {
      userId: user?.id || req.user?.id,
      orgId: user?.org_id || req.user?.org_id,
      fullName: user?.full_name || 'Hiring Manager',
      jobTitle: user?.job_title || 'Recruiter',
      role: user?.role || 'owner'
    });

    const mailRes = await sendRecruiterVerificationEmail(cleanEmail, otpCode, user?.full_name || 'Hiring Manager', mode);

    res.json({
      success: true,
      otpToken,
      emailSent: !!mailRes.sent,
      forwardedTo: mailRes.forwardedTo || cleanEmail,
      emailError: mailRes.error || null,
      message: mailRes.sent
        ? `Done — mail sent to ${cleanEmail}.`
        : (mailRes.error ? `Verification code ready, email notice: ${mailRes.error}` : 'Done — new code ready.')
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
}

app.post('/auth/resend-code', (req, res) => {
  if (!req.body?.email && req.headers.authorization) {
    return requireAuth(req, res, () => handleRecruiterResendCode(req, res));
  }
  return handleRecruiterResendCode(req, res);
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

// Email + Password Login Step 1 -> Send 6-digit Email OTP
app.post('/auth/login', async (req, res) => {
  try {
    const { email, password } = req.body;
    if (!email || !password) {
      return res.status(400).json({ error: 'Email and password are required' });
    }

    const cleanEmail = email.toLowerCase().trim();
    let user = db.prepare('SELECT * FROM users WHERE email = ?').get(cleanEmail);

    // If user does not exist in local SQLite (e.g. Vercel container restart wiped local DB),
    // automatically provision account with this password so the user is never locked out of Step 1.
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
          VALUES (?, ?, 'Hiring Manager', '', 'Recruiter', ?, ?, 'owner', 0, 'approved', CURRENT_TIMESTAMP)
        `).run(userId, orgId, cleanEmail, passHash);
      })();

      user = db.prepare('SELECT * FROM users WHERE id = ?').get(userId);
    } else if (!comparePassword(password, user.password_hash)) {
      return res.status(401).json({
        error: 'Incorrect password. Click "Verify Email & Set This Password" below to confirm your email via OTP and update your password.',
        canReset: true,
        email: cleanEmail
      });
    }

    if (user.approval_status === 'suspended' || user.approval_status === 'rejected') {
      return res.status(403).json({ error: 'Your account is suspended. Please contact support or an administrator.' });
    }
    if (user.approval_status === 'pending_approval') {
      return res.status(403).json({ error: 'Your account is awaiting administrator approval.' });
    }

    // Ensure organization exists
    let org = db.prepare('SELECT * FROM organizations WHERE id = ?').get(user.org_id);
    if (!org) {
      db.prepare(`
        INSERT OR IGNORE INTO organizations (id, name, plan, included_interviews)
        VALUES (?, 'My Organization', 'free_trial', 10)
      `).run(user.org_id);
      org = db.prepare('SELECT * FROM organizations WHERE id = ?').get(user.org_id);
    }

    const authCfg = getEffectiveAuthConfig();
    if (!authCfg.requireEmailOtp) {
      db.prepare('UPDATE users SET is_verified = 1, last_login_at = CURRENT_TIMESTAMP WHERE id = ?').run(user.id);
      const token = signToken({ id: user.id, org_id: user.org_id, email: user.email, role: user.role });
      return res.json({
        success: true,
        requiresOtp: false,
        token,
        user: {
          id: user.id,
          email: user.email,
          fullName: user.full_name || 'Hiring Manager',
          jobTitle: user.job_title || 'Recruiter',
          role: user.role,
          is_verified: 1,
          approval_status: user.approval_status || 'approved',
        },
        org,
      });
    }

    const otpCode = generate6DigitOtp();
    db.prepare('UPDATE users SET verification_code = ?, last_login_at = CURRENT_TIMESTAMP WHERE id = ?').run(otpCode, user.id);

    const otpToken = createStatelessOtpChallenge(cleanEmail, otpCode, 'recruiter_login', {
      userId: user.id,
      orgId: user.org_id,
      fullName: user.full_name || 'Hiring Manager',
      jobTitle: user.job_title || 'Recruiter',
      role: user.role || 'owner',
      orgName: org?.name || 'My Organization'
    });

    const mailRes = await sendRecruiterVerificationEmail(cleanEmail, otpCode, user.full_name || 'Hiring Manager', 'login');
    res.json({
      success: true,
      requiresOtp: true,
      email: cleanEmail,
      otpToken,
      emailSent: !!mailRes.sent,
      forwardedTo: mailRes.forwardedTo || cleanEmail,
      emailError: mailRes.error || null,
      message: mailRes.sent
        ? `Done — mail sent to ${cleanEmail}.`
        : 'Enter your 6-digit verification code to complete sign in.'
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Email + Password Login Step 2 -> Verify 6-digit Email OTP and issue JWT
app.post('/auth/login-otp-verify', (req, res) => {
  try {
    const { email, code, otp, otpToken } = req.body || {};
    if (!email || !(code || otp)) {
      return res.status(400).json({ error: 'Email and 6-digit verification code are required.' });
    }

    const cleanEmail = email.toLowerCase().trim();
    let user = db.prepare('SELECT * FROM users WHERE email = ?').get(cleanEmail);

    const check = verifyRecruiterOtpCode({
      dbUser: user,
      cleanEmail,
      code: code || otp,
      purposes: ['recruiter_login', 'recruiter_signup'],
      otpToken
    });
    if (!check.valid) {
      return res.status(400).json({ error: check.error });
    }

    if (!user) {
      const dec = check.decoded || {};
      const resolvedOrgId = dec.orgId || ('org_' + crypto.randomUUID());
      const resolvedUserId = dec.userId || ('usr_' + crypto.randomUUID());
      db.transaction(() => {
        db.prepare(`
          INSERT OR IGNORE INTO organizations (id, name, plan, included_interviews)
          VALUES (?, ?, 'free_trial', 10)
        `).run(resolvedOrgId, dec.orgName || 'My Organization');
        db.prepare(`
          INSERT OR IGNORE INTO users (id, org_id, full_name, phone, job_title, email, password_hash, role, is_verified, verification_code, approval_status, last_login_at)
          VALUES (?, ?, ?, '', ?, ?, '', ?, 1, NULL, 'approved', CURRENT_TIMESTAMP)
        `).run(
          resolvedUserId,
          resolvedOrgId,
          dec.fullName || 'Hiring Manager',
          dec.jobTitle || 'Recruiter',
          cleanEmail,
          dec.role || 'owner'
        );
      })();
      user = db.prepare('SELECT * FROM users WHERE email = ?').get(cleanEmail);
    } else {
      if (user.approval_status === 'suspended' || user.approval_status === 'rejected') {
        return res.status(403).json({ error: 'Your account has been suspended or rejected by the administrator.' });
      }
      if (user.approval_status === 'pending_approval') {
        db.prepare('UPDATE users SET is_verified = 1, verification_code = NULL WHERE id = ?').run(user.id);
        return res.status(403).json({ error: 'Your email is verified, and your account is awaiting administrator approval.' });
      }
      db.prepare("UPDATE users SET is_verified = 1, verification_code = NULL, last_login_at = CURRENT_TIMESTAMP WHERE id = ?").run(user.id);
    }

    let org = db.prepare('SELECT * FROM organizations WHERE id = ?').get(user.org_id);
    if (!org) {
      db.prepare(`
        INSERT OR IGNORE INTO organizations (id, name, plan, included_interviews)
        VALUES (?, 'My Organization', 'free_trial', 10)
      `).run(user.org_id);
      org = db.prepare('SELECT * FROM organizations WHERE id = ?').get(user.org_id);
    }

    markRecruiterOtpUsed(otpToken);
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
      success: true,
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

// Password Reset Step 1 -> Send 6-digit Email OTP (never overwrites password without OTP verification)
app.post('/auth/reset-password', async (req, res) => {
  try {
    const { email, password } = req.body || {};
    if (!email || !password) {
      return res.status(400).json({ error: 'Email and new password are required' });
    }
    const cleanEmail = email.toLowerCase().trim();
    const user = db.prepare('SELECT * FROM users WHERE email = ?').get(cleanEmail);
    const otpCode = generate6DigitOtp();

    if (user) {
      db.prepare('UPDATE users SET verification_code = ? WHERE id = ?').run(otpCode, user.id);
    }

    const otpToken = createStatelessOtpChallenge(cleanEmail, otpCode, 'recruiter_reset', {
      userId: user?.id || ('usr_' + crypto.randomUUID()),
      orgId: user?.org_id || ('org_' + crypto.randomUUID()),
      fullName: user?.full_name || 'Hiring Manager',
      jobTitle: user?.job_title || 'Recruiter',
      role: user?.role || 'owner'
    });

    const mailRes = await sendRecruiterVerificationEmail(cleanEmail, otpCode, user?.full_name || 'Hiring Manager', 'reset');
    res.json({
      success: true,
      requiresOtp: true,
      email: cleanEmail,
      otpToken,
      emailSent: !!mailRes.sent,
      forwardedTo: mailRes.forwardedTo || cleanEmail,
      emailError: mailRes.error || null,
      message: mailRes.sent
        ? `Done — mail sent to ${cleanEmail}.`
        : 'Enter the 6-digit verification code to confirm your password reset.'
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Password Reset Step 2 -> Verify 6-digit Email OTP, update password, and sign in
app.post('/auth/reset-password-verify', (req, res) => {
  try {
    const { email, password, code, otp, otpToken } = req.body || {};
    if (!email || !password || !(code || otp)) {
      return res.status(400).json({ error: 'Email, new password, and 6-digit verification code are required.' });
    }

    const cleanEmail = email.toLowerCase().trim();
    let user = db.prepare('SELECT * FROM users WHERE email = ?').get(cleanEmail);
    const check = verifyRecruiterOtpCode({
      dbUser: user,
      cleanEmail,
      code: code || otp,
      purposes: ['recruiter_reset'],
      otpToken
    });
    if (!check.valid) {
      return res.status(400).json({ error: check.error });
    }

    const passHash = hashPassword(password);
    if (!user) {
      const dec = check.decoded || {};
      const resolvedOrgId = dec.orgId || ('org_' + crypto.randomUUID());
      const resolvedUserId = dec.userId || ('usr_' + crypto.randomUUID());
      db.transaction(() => {
        db.prepare(`
          INSERT OR IGNORE INTO organizations (id, name, plan, included_interviews)
          VALUES (?, 'My Organization', 'free_trial', 10)
        `).run(resolvedOrgId);
        db.prepare(`
          INSERT OR IGNORE INTO users (id, org_id, full_name, phone, job_title, email, password_hash, role, is_verified, verification_code, approval_status, last_login_at)
          VALUES (?, ?, ?, '', ?, ?, ?, ?, 1, NULL, 'approved', CURRENT_TIMESTAMP)
        `).run(resolvedUserId, resolvedOrgId, dec.fullName || 'Hiring Manager', dec.jobTitle || 'Recruiter', cleanEmail, passHash, dec.role || 'owner');
      })();
      user = db.prepare('SELECT * FROM users WHERE email = ?').get(cleanEmail);
    } else {
      db.prepare("UPDATE users SET password_hash = ?, is_verified = 1, verification_code = NULL, approval_status = 'approved', last_login_at = CURRENT_TIMESTAMP WHERE id = ?").run(passHash, user.id);
    }

    let org = db.prepare('SELECT * FROM organizations WHERE id = ?').get(user.org_id);
    if (!org) {
      db.prepare(`
        INSERT OR IGNORE INTO organizations (id, name, plan, included_interviews)
        VALUES (?, 'My Organization', 'free_trial', 10)
      `).run(user.org_id);
      org = db.prepare('SELECT * FROM organizations WHERE id = ?').get(user.org_id);
    }

    markRecruiterOtpUsed(otpToken);
    const token = signToken({ id: user.id, org_id: user.org_id, email: user.email, role: user.role });

    logActivity({
      action: 'USER_PASSWORD_RESET',
      actorType: 'user',
      actorId: user.id,
      actorEmail: user.email,
      actorName: user.full_name,
      orgId: user.org_id,
      ipAddress: req.ip
    });

    res.json({
      success: true,
      token,
      message: 'Password updated and signed in successfully!',
      user: {
        id: user.id,
        email: user.email,
        fullName: user.full_name || 'Hiring Manager',
        jobTitle: user.job_title || 'Recruiter',
        role: user.role,
        is_verified: 1,
        approval_status: 'approved'
      },
      org: org || { id: user.org_id, name: 'My Organization', plan: 'free_trial', included_interviews: 10 }
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.get('/auth/me', requireAuth, (req, res) => {
  try {
    const user = db.prepare("SELECT id, full_name, email, phone, job_title, role, COALESCE(org_role, role, 'owner') as org_role, is_verified, approval_status FROM users WHERE id = ?").get(req.user.id);
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

function normalizeThresholds(selectedThreshold, borderlineThreshold) {
  let selectedCutoff = parseInt(selectedThreshold, 10);
  let borderlineCutoff = parseInt(borderlineThreshold, 10);
  if (!Number.isFinite(selectedCutoff)) selectedCutoff = 70;
  if (!Number.isFinite(borderlineCutoff)) borderlineCutoff = 50;
  selectedCutoff = Math.max(0, Math.min(100, selectedCutoff));
  borderlineCutoff = Math.max(0, Math.min(selectedCutoff, borderlineCutoff));
  return { selectedCutoff, borderlineCutoff };
}

function parseResultsConfig(rawConfig) {
  if (!rawConfig) return {};
  if (typeof rawConfig === 'object') return rawConfig;
  try {
    return JSON.parse(rawConfig) || {};
  } catch {
    return {};
  }
}

function classifyCandidateResult({ state, score, verdict, manualDecision }, selectedCutoff = 70, borderlineCutoff = 50) {
  const cleanState = String(state || '').toLowerCase();
  if (cleanState === 'disqualified') return 'rejected';

  const manual = String(manualDecision || '').toLowerCase();
  if (manual === 'selected' || manual === 'borderline' || manual === 'rejected') {
    return manual;
  }

  if (typeof score === 'number' && Number.isFinite(score)) {
    if (score >= selectedCutoff) return 'selected';
    if (score >= borderlineCutoff) return 'borderline';
    return 'rejected';
  }

  const cleanVerdict = String(verdict || '').toUpperCase().trim();
  if (
    cleanVerdict === 'DISQUALIFIED' ||
    cleanVerdict === 'NOT_RECOMMENDED' ||
    cleanVerdict === 'DO_NOT_HIRE' ||
    cleanVerdict === 'REJECT' ||
    cleanVerdict.includes('REJECT')
  ) {
    return 'rejected';
  }
  if (
    cleanVerdict === 'RECOMMENDED_HIRE' ||
    cleanVerdict === 'STRONG_HIRE' ||
    cleanVerdict === 'SELECTED' ||
    cleanVerdict === 'ADVANCE' ||
    cleanVerdict === 'HIRE'
  ) {
    return 'selected';
  }
  if (
    cleanVerdict === 'POTENTIAL_HIRE' ||
    cleanVerdict === 'MAYBE' ||
    cleanVerdict.includes('CONSIDER') ||
    cleanState === 'completed' ||
    cleanState === 'report_ready'
  ) {
    return 'borderline';
  }
  return 'pending';
}

function enrichInterviewRow(row, selectedCutoff = 70, borderlineCutoff = 50) {
  let score = null;
  let verdict = null;
  let summary = '';
  let skills = [];
  let manualDecision = row.manual_decision || null;
  let dsaResult = null;

  if (row.report_json) {
    try {
      const parsed = JSON.parse(row.report_json);
      const rawScore = parsed.overall_score ?? parsed.score;
      if (rawScore !== null && rawScore !== undefined && rawScore !== '' && Number.isFinite(Number(rawScore))) {
        score = Math.round(Number(rawScore));
      }
      verdict = parsed.candidate_verdict || parsed.recommendation || null;
      summary = parsed.hiring_clarification || parsed.overall_summary || parsed.summary || '';
      skills = Array.isArray(parsed.skills) ? parsed.skills : [];
      if (!manualDecision && parsed.manual_decision) manualDecision = parsed.manual_decision;
    } catch {}
  }

  if (row.state === 'disqualified') {
    score = 0;
    verdict = 'DISQUALIFIED';
  }

  if (row.dsa_result) {
    try { dsaResult = JSON.parse(row.dsa_result); } catch {}
  }

  let proctorLogs = [];
  if (row.proctor_logs) {
    try { proctorLogs = JSON.parse(row.proctor_logs); } catch {}
  }

  let durationSeconds = null;
  if (row.started_at && row.ended_at) {
    const startMs = new Date(row.started_at).getTime();
    const endMs = new Date(row.ended_at).getTime();
    if (Number.isFinite(startMs) && Number.isFinite(endMs) && endMs >= startMs) {
      durationSeconds = Math.round((endMs - startMs) / 1000);
    }
  }

  const category = classifyCandidateResult(
    { state: row.state, score, verdict, manualDecision },
    selectedCutoff,
    borderlineCutoff
  );

  return {
    ...row,
    score,
    verdict,
    summary,
    skills,
    manual_decision: manualDecision,
    category,
    duration_seconds: durationSeconds,
    proctor_logs: Array.isArray(proctorLogs) ? proctorLogs : [],
    dsa_result: dsaResult
  };
}

function getOrgJobOrNull(jobId, orgId) {
  return db.prepare(`
    SELECT * FROM jobs
    WHERE id = ? AND (org_id = ? OR org_id = 'org_default' OR org_id IS NULL)
  `).get(jobId, orgId);
}

function fetchEnrichedJobInterviews(job, orgId, selectedCutoff, borderlineCutoff) {
  const rows = db.prepare(`
    SELECT 
      i.id as interview_id,
      i.job_id,
      i.state,
      i.started_at,
      i.ended_at,
      i.expires_at,
      i.dispatch_status,
      i.dispatch_channel,
      i.source as interview_source,
      i.proctor_warnings,
      i.disqualified_reason,
      i.proctor_logs,
      i.dsa_result,
      c.id as candidate_id,
      c.org_id as candidate_org_id,
      c.name as candidate_name,
      c.email as candidate_email,
      c.phone as candidate_phone,
      c.source as candidate_source,
      r.id as report_id,
      r.json as report_json,
      r.reviewed_by,
      r.reviewer_note,
      r.manual_decision
    FROM interviews i
    JOIN candidates c ON i.candidate_id = c.id
    JOIN jobs j ON i.job_id = j.id
    LEFT JOIN reports r ON r.interview_id = i.id
    WHERE j.id = ?
      AND (j.org_id = ? OR c.org_id = ? OR c.org_id = 'org_default' OR c.org_id IS NULL)
    ORDER BY COALESCE(i.ended_at, i.started_at, i.expires_at) DESC, i.id DESC
  `).all(job.id, orgId, orgId);

  return rows.map(r => enrichInterviewRow(r, selectedCutoff, borderlineCutoff));
}

app.get('/jobs', requireAuth, (req, res) => {
  try {
    const jobs = db.prepare(`
      SELECT j.*
      FROM jobs j 
      WHERE j.org_id = ? OR j.org_id = 'org_default' OR j.org_id IS NULL
      ORDER BY j.created_at DESC
    `).all(req.user.org_id);

    const rows = db.prepare(`
      SELECT
        i.id as interview_id,
        i.job_id,
        i.state,
        c.org_id as candidate_org_id,
        j.org_id as job_org_id,
        r.json as report_json,
        r.manual_decision
      FROM interviews i
      JOIN candidates c ON i.candidate_id = c.id
      JOIN jobs j ON i.job_id = j.id
      LEFT JOIN reports r ON r.interview_id = i.id
      WHERE (j.org_id = ? OR j.org_id = 'org_default' OR j.org_id IS NULL)
        AND (j.org_id = ? OR c.org_id = ? OR c.org_id = 'org_default' OR c.org_id IS NULL)
    `).all(req.user.org_id, req.user.org_id, req.user.org_id);

    const rowsByJob = new Map();
    for (const r of rows) {
      if (!rowsByJob.has(r.job_id)) rowsByJob.set(r.job_id, []);
      rowsByJob.get(r.job_id).push(r);
    }

    const enrichedJobs = jobs.map(job => {
      const { selectedCutoff, borderlineCutoff } = normalizeThresholds(
        job.selected_threshold,
        job.borderline_threshold
      );
      const jobRows = rowsByJob.get(job.id) || [];

      let totalCandidates = 0;
      let completedCandidates = 0;
      let selectedCandidates = 0;
      let borderlineCandidates = 0;
      let rejectedCandidates = 0;
      let pendingCandidates = 0;
      let scoreSum = 0;
      let scoredCount = 0;

      for (const r of jobRows) {
        totalCandidates++;
        if (r.state === 'completed' || r.state === 'report_ready') {
          completedCandidates++;
        }
        const enriched = enrichInterviewRow(r, selectedCutoff, borderlineCutoff);
        if (enriched.category === 'selected') selectedCandidates++;
        else if (enriched.category === 'borderline') borderlineCandidates++;
        else if (enriched.category === 'rejected') rejectedCandidates++;
        else pendingCandidates++;

        if (typeof enriched.score === 'number') {
          scoreSum += enriched.score;
          scoredCount++;
        }
      }

      return {
        ...job,
        selected_threshold: selectedCutoff,
        borderline_threshold: borderlineCutoff,
        results_config: parseResultsConfig(job.results_config),
        total_candidates: totalCandidates,
        completed_candidates: completedCandidates,
        selected_candidates: selectedCandidates,
        borderline_candidates: borderlineCandidates,
        rejected_candidates: rejectedCandidates,
        pending_candidates: pendingCandidates,
        avg_score: scoredCount > 0 ? Number((scoreSum / scoredCount).toFixed(1)) : null
      };
    });

    res.json(enrichedJobs);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.get('/jobs/:id', requireAuth, (req, res) => {
  try {
    const job = db.prepare('SELECT * FROM jobs WHERE id = ?').get(req.params.id);
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
        j.org_id, c.id as candidate_id, c.name as candidate_name, c.email as candidate_email, c.resume_text,
        o.name as company_name
      FROM interviews i
      JOIN jobs j ON i.job_id = j.id
      JOIN candidates c ON i.candidate_id = c.id
      LEFT JOIN organizations o ON j.org_id = o.id
      WHERE i.id = ?
    `).get(decoded.interviewId);
  } catch (e) {
    console.error('Failed to hydrate interview from token:', e.message);
    return null;
  }
}

// Universal Helper: Always find or automatically rehydrate interview from rawToken across any Vercel container
function getOrHydrateInterview(rawToken) {
  if (!rawToken) return null;
  const tokenHash = crypto.createHash('sha256').update(rawToken).digest('hex');

  let interview = db.prepare(`
    SELECT 
      i.id, i.state, i.started_at, i.expires_at, i.link_timer_minutes,
      i.disqualified_reason, i.proctor_warnings, i.code_draft, i.code_lang, i.code_history,
      j.id as job_id, j.title as job_title, j.skills, j.qualifications, j.level, j.max_minutes, j.max_questions,
      j.show_timer, j.auto_submit_timer,
      j.interview_type, j.question_mode, j.terminal_required, j.word_editor_required, j.resume_required,
      j.purpose, j.experience_required, j.assessment_rules, j.leetcode_problem, j.compiler_languages,
      j.org_id, c.id as candidate_id, c.name as candidate_name, c.email as candidate_email, c.resume_text,
      o.name as company_name
    FROM interviews i
    LEFT JOIN jobs j ON i.job_id = j.id
    LEFT JOIN candidates c ON i.candidate_id = c.id
    LEFT JOIN organizations o ON j.org_id = o.id
    WHERE i.token_hash = ? OR i.id = ?
  `).get(tokenHash, rawToken);

  if (!interview) {
    try {
      const decoded = verifyToken(rawToken);
      if (decoded && (decoded.type === 'interview_invite' || decoded.interviewId)) {
        interview = hydrateInterviewFromToken(decoded, rawToken);
      }
    } catch (e) {
      console.warn('getOrHydrateInterview verify error:', e.message);
    }
  }

  return interview;
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

    const effectiveOrgId = (job.org_id && job.org_id !== 'org_default') ? job.org_id : req.user.org_id;
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

    const effectiveOrgId = (job.org_id && job.org_id !== 'org_default') ? job.org_id : req.user.org_id;
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
    const job = getOrgJobOrNull(req.params.id, req.user.org_id);
    if (!job) return res.status(404).json({ error: 'Interview round not found' });

    const { selectedCutoff, borderlineCutoff } = normalizeThresholds(
      req.query.selectedCutoff ?? job.selected_threshold,
      req.query.borderlineCutoff ?? job.borderline_threshold
    );

    const enriched = fetchEnrichedJobInterviews(job, req.user.org_id, selectedCutoff, borderlineCutoff);
    res.json(enriched);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// --- Customize Results Cutoffs & Report Preferences ---
app.put('/jobs/:id/results-settings', requireAuth, (req, res) => {
  try {
    const job = getOrgJobOrNull(req.params.id, req.user.org_id);
    if (!job) return res.status(404).json({ error: 'Interview round not found' });

    const { selectedCutoff, borderlineCutoff } = normalizeThresholds(
      req.body?.selected_threshold ?? job.selected_threshold,
      req.body?.borderline_threshold ?? job.borderline_threshold
    );

    const incomingConfig = req.body?.results_config && typeof req.body.results_config === 'object'
      ? req.body.results_config
      : parseResultsConfig(job.results_config);

    db.prepare(`
      UPDATE jobs
      SET selected_threshold = ?, borderline_threshold = ?, results_config = ?
      WHERE id = ?
    `).run(selectedCutoff, borderlineCutoff, JSON.stringify(incomingConfig), job.id);

    logActivity({
      action: 'RESULTS_CUSTOMIZED',
      actorType: 'user',
      actorId: req.user.id,
      actorEmail: req.user.email,
      orgId: req.user.org_id,
      entityType: 'job',
      entityId: job.id,
      details: { selectedCutoff, borderlineCutoff, title: job.title },
      ipAddress: req.ip
    });

    res.json({
      success: true,
      jobId: job.id,
      selected_threshold: selectedCutoff,
      borderline_threshold: borderlineCutoff,
      results_config: incomingConfig
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// --- Recruiter Manual Decision Override & Reviewer Note ---
app.patch('/interviews/:id/decision', requireAuth, (req, res) => {
  try {
    const interview = db.prepare(`
      SELECT i.*, j.org_id as job_org_id
      FROM interviews i
      JOIN jobs j ON i.job_id = j.id
      WHERE i.id = ? AND (j.org_id = ? OR j.org_id = 'org_default' OR j.org_id IS NULL)
    `).get(req.params.id, req.user.org_id);

    if (!interview) return res.status(404).json({ error: 'Candidate interview not found' });

    const rawDecision = String(req.body?.manual_decision || 'auto').toLowerCase();
    const validDecisions = ['auto', 'selected', 'borderline', 'rejected'];
    const manualDecision = validDecisions.includes(rawDecision) ? (rawDecision === 'auto' ? null : rawDecision) : null;
    const reviewerNote = typeof req.body?.reviewer_note === 'string' ? req.body.reviewer_note.trim() : null;
    const reviewerName = req.user.full_name || req.user.email || 'Recruiter';

    const existingReport = db.prepare('SELECT * FROM reports WHERE interview_id = ?').get(interview.id);
    if (existingReport) {
      let parsed = {};
      try { parsed = JSON.parse(existingReport.json) || {}; } catch {}
      parsed.manual_decision = manualDecision;
      db.prepare(`
        UPDATE reports
        SET json = ?, manual_decision = ?, reviewed_by = ?, reviewer_note = COALESCE(?, reviewer_note)
        WHERE interview_id = ?
      `).run(JSON.stringify(parsed), manualDecision, reviewerName, reviewerNote, interview.id);
    } else {
      const reportPayload = {
        overall_score: interview.state === 'disqualified' ? 0 : null,
        candidate_verdict: manualDecision ? manualDecision.toUpperCase() : null,
        manual_decision: manualDecision,
        hiring_clarification: reviewerNote || 'Updated manually by recruiter.',
        skills: []
      };
      db.prepare(`
        INSERT INTO reports (id, interview_id, json, model, reviewed_by, reviewer_note, manual_decision)
        VALUES (?, ?, ?, 'recruiter-override', ?, ?, ?)
      `).run('rep_' + crypto.randomUUID(), interview.id, JSON.stringify(reportPayload), reviewerName, reviewerNote || '', manualDecision);
    }

    logActivity({
      action: 'CANDIDATE_DECISION_UPDATED',
      actorType: 'user',
      actorId: req.user.id,
      actorEmail: req.user.email,
      orgId: req.user.org_id,
      entityType: 'interview',
      entityId: interview.id,
      details: { manualDecision: manualDecision || 'auto', reviewerNote },
      ipAddress: req.ip
    });

    triggerOrgWebhooks(interview.job_org_id || req.user.org_id, 'candidate.decision_updated', {
      interviewId: interview.id,
      manualDecision: manualDecision || 'auto',
      reviewerNote,
      reviewedBy: reviewerName,
    }).catch((err) => console.warn('[Webhook] decision trigger failed:', err.message));

    res.json({ success: true, interviewId: interview.id, manual_decision: manualDecision, reviewer_note: reviewerNote, reviewed_by: reviewerName });
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
      WHERE (j.org_id = ? OR j.org_id = 'org_default' OR j.org_id IS NULL)
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
// Supports both /question-bank and /api/question-bank paths
const handleGetCatalog = (req, res) => {
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
};
app.get('/question-bank/catalog', handleGetCatalog);
app.get('/api/question-bank/catalog', handleGetCatalog);

const handleGetCustom = (req, res) => {
  try {
    const orgId = req.user.org_id;
    const rows = db.prepare(`
      SELECT * FROM org_question_bank WHERE org_id = ? ORDER BY created_at DESC
    `).all(orgId);
    res.json({ success: true, count: rows.length, questions: rows });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};
app.get('/question-bank/custom', requireAuth, handleGetCustom);
app.get('/api/question-bank/custom', requireAuth, handleGetCustom);

const handlePostCustom = (req, res) => {
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
};
app.post('/question-bank/custom', requireAuth, handlePostCustom);
app.post('/api/question-bank/custom', requireAuth, handlePostCustom);

const handleDeleteCustom = (req, res) => {
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
};
app.delete('/question-bank/custom/:id', requireAuth, handleDeleteCustom);
app.delete('/api/question-bank/custom/:id', requireAuth, handleDeleteCustom);

function loadCustomProblemMeta(problemRef) {
  const ref = String(problemRef || '').trim();
  if (!ref.startsWith('cprob_')) return null;
  const row = db.prepare('SELECT * FROM org_custom_problems WHERE id = ?').get(ref);
  if (!row) return null;
  let cases = [];
  try { cases = JSON.parse(row.test_cases_json || '[]'); } catch { cases = []; }
  return {
    id: row.id,
    title: row.title,
    difficulty: row.difficulty || 'Medium',
    description: row.description,
    functionName: { js: row.function_name_js || 'solve', py: row.function_name_py || 'solve' },
    starter: {
      javascript: row.starter_js || `function ${row.function_name_js || 'solve'}(input) {\n  // TODO: Implement\n  return null;\n}`,
      python: row.starter_py || `def ${row.function_name_py || 'solve'}(input):\n    # TODO: Implement\n    return None`,
      sql: row.starter_sql || 'SELECT name, salary FROM employees ORDER BY salary DESC;',
    },
    cases,
  };
}

// --- Automated LeetCode & Coding Judge Runner Endpoint ---
app.post('/api/compiler/judge', async (req, res) => {
  try {
    const { problemId = '1', lang = 'javascript', code = '', token = '' } = req.body;
    if (!code || !code.trim()) {
      return res.status(400).json({ error: 'Please enter code to evaluate against test cases.' });
    }

    const customSuite = loadCustomProblemMeta(problemId);
    const result = await judgeLeetCodeSolution(String(problemId), lang, code, customSuite);

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

    let interview = getOrHydrateInterview(rawToken);

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

    // Compute exact remaining seconds when candidate reloads an active session
    const totalMinutes = Number(interview.link_timer_minutes || interview.max_minutes || 60);
    let remainingSeconds = totalMinutes * 60;
    if (interview.started_at) {
      const startedMs = new Date(interview.started_at.endsWith('Z') ? interview.started_at : `${interview.started_at}Z`).getTime();
      if (Number.isFinite(startedMs)) {
        const elapsedSec = Math.max(0, Math.floor((Date.now() - startedMs) / 1000));
        remainingSeconds = Math.max(0, (totalMinutes * 60) - elapsedSec);
      }
    }

    const customProblem = loadCustomProblemMeta(interview.leetcode_problem);

    res.json({
      ...interview,
      custom_problem: customProblem,
      remainingSeconds,
      code_draft: interview.code_draft || null,
      code_lang: interview.code_lang || 'javascript',
      turns
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post('/i/:token/consent', (req, res) => {
  try {
    const rawToken = req.params.token;

    const interview = getOrHydrateInterview(rawToken);
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

    const interview = getOrHydrateInterview(rawToken);
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

    const interview = getOrHydrateInterview(rawToken);
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

    const interview = getOrHydrateInterview(rawToken);
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

    const jobOrg = db.prepare('SELECT org_id FROM jobs WHERE id = ?').get(interview.job_id);
    if (jobOrg?.org_id) {
      triggerOrgWebhooks(jobOrg.org_id, 'interview.completed', {
        interviewId: interview.id,
        jobId: interview.job_id,
        jobTitle: interview.job_title,
        candidateName: interview.candidate_name,
        candidateEmail: interview.candidate_email,
        score: report?.overall_score ?? null,
        verdict: report?.candidate_verdict ?? null,
        recommendation: report?.recommendation ?? null,
      }).catch((err) => console.warn('[Webhook] interview.completed failed:', err.message));
    }

    let emailSent = false;
    if (interview.candidate_email && interview.candidate_email.includes('@')) {
      try {
        const mailRes = await sendInterviewCompletionEmail({
          email: interview.candidate_email,
          candidateName: interview.candidate_name || 'Candidate',
          jobTitle: interview.job_title || 'Interview Role',
          companyName: interview.company_name || 'RoundOne AI Platform'
        });
        emailSent = !!mailRes?.sent;
      } catch (mailErr) {
        console.warn('[Interview Finish] Completion email error:', mailErr.message);
      }
    }

    res.json({ success: true, message: emailSent ? 'Done — interview submitted. Mail sent.' : 'Done — interview submitted.', emailSent, report });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// --- AI Proctoring & Disqualification Endpoints ---
app.post('/i/:token/disqualify', async (req, res) => {
  try {
    const rawToken = req.params.token;
    const { reason, warnings, violations } = req.body || {};

    const interview = getOrHydrateInterview(rawToken);
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

    const disqJobOrg = db.prepare('SELECT org_id FROM jobs WHERE id = ?').get(interview.job_id);
    if (disqJobOrg?.org_id) {
      triggerOrgWebhooks(disqJobOrg.org_id, 'interview.disqualified', {
        interviewId: interview.id,
        jobId: interview.job_id,
        candidateName: interview.candidate_name,
        candidateEmail: interview.candidate_email,
        reason: disqualificationReason,
        warnings: warnings || 3,
      }).catch((err) => console.warn('[Webhook] interview.disqualified failed:', err.message));
    }

    res.json({ success: true, message: 'Candidate disqualified', reason: disqualificationReason });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post('/i/:token/proctor-event', (req, res) => {
  try {
    const rawToken = req.params.token;
    const { type, reason, warningsCount } = req.body || {};

    const interview = getOrHydrateInterview(rawToken);
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

// Capture compressed webcam snapshot during proctoring violations
app.post('/i/:token/snapshot', (req, res) => {
  try {
    const interview = getOrHydrateInterview(req.params.token);
    if (!interview) return res.status(404).json({ error: 'Invalid token' });

    const { reason, imageData } = req.body || {};
    if (!imageData || typeof imageData !== 'string' || !imageData.startsWith('data:image/')) {
      return res.status(400).json({ error: 'Valid base64 imageData URI is required' });
    }
    if (imageData.length > 450_000) {
      return res.status(413).json({ error: 'Snapshot image exceeds 450KB limit' });
    }

    // Cap snapshots per interview to prevent storage abuse (keep newest 20)
    const countRow = db.prepare('SELECT COUNT(*) as c FROM proctor_snapshots WHERE interview_id = ?').get(interview.id);
    if ((countRow?.c || 0) >= 20) {
      db.prepare(`
        DELETE FROM proctor_snapshots WHERE id IN (
          SELECT id FROM proctor_snapshots WHERE interview_id = ? ORDER BY created_at ASC LIMIT 1
        )
      `).run(interview.id);
    }

    const snapId = 'snap_' + crypto.randomUUID();
    db.prepare(`
      INSERT INTO proctor_snapshots (id, interview_id, reason, image_data)
      VALUES (?, ?, ?, ?)
    `).run(snapId, interview.id, String(reason || 'proctor_alert').slice(0, 200), imageData);

    res.json({ success: true, snapshotId: snapId });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Autosave candidate code editor draft + keystroke timeline replay keyframes
app.post('/i/:token/draft', (req, res) => {
  try {
    const interview = getOrHydrateInterview(req.params.token);
    if (!interview) return res.status(404).json({ error: 'Invalid token' });

    const codeDraft = typeof req.body?.code === 'string' ? req.body.code.slice(0, 100_000) : '';
    const codeLang = String(req.body?.lang || 'javascript').slice(0, 32);
    const keyframe = req.body?.keyframe && typeof req.body.keyframe === 'object' ? req.body.keyframe : null;

    let history = [];
    try { history = interview.code_history ? JSON.parse(interview.code_history) : []; } catch { history = []; }
    if (!Array.isArray(history)) history = [];

    if (keyframe) {
      history.push({
        t: Number(keyframe.t) || Date.now(),
        lang: codeLang,
        len: codeDraft.length,
        pasteDelta: Number(keyframe.pasteDelta) || 0,
        code: codeDraft.slice(0, 20_000),
      });
      if (history.length > 60) history = history.slice(-60);
      db.prepare('UPDATE interviews SET code_draft = ?, code_lang = ?, code_history = ? WHERE id = ?')
        .run(codeDraft, codeLang, JSON.stringify(history), interview.id);
    } else {
      db.prepare('UPDATE interviews SET code_draft = ?, code_lang = ? WHERE id = ?')
        .run(codeDraft, codeLang, interview.id);
    }

    res.json({ success: true, savedBytes: codeDraft.length, lang: codeLang, keyframesCount: history.length });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Recruiter view of proctoring snapshots for an interview
app.get('/interviews/:id/snapshots', requireAuth, (req, res) => {
  try {
    const interview = db.prepare(`
      SELECT i.id FROM interviews i
      JOIN jobs j ON i.job_id = j.id
      WHERE i.id = ? AND (j.org_id = ? OR j.org_id = 'org_default' OR j.org_id IS NULL)
    `).get(req.params.id, req.user.org_id);
    if (!interview) return res.status(404).json({ error: 'Interview not found' });

    const snapshots = db.prepare('SELECT id, reason, image_data, created_at FROM proctor_snapshots WHERE interview_id = ? ORDER BY created_at DESC LIMIT 20').all(interview.id);
    res.json({ snapshots });
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
      WHERE i.id = ? AND (j.org_id = ? OR j.org_id = 'org_default' OR j.org_id IS NULL)
    `).get(req.params.id, req.user.org_id);

    if (!interview) return res.status(404).json({ error: 'Interview not found' });

    const reportRow = db.prepare('SELECT * FROM reports WHERE interview_id = ?').get(interview.id);
    const turns = db.prepare('SELECT idx, role, text, skill, level, created_at FROM turns WHERE interview_id = ? ORDER BY idx ASC').all(interview.id);
    const snapshots = db.prepare('SELECT id, reason, image_data, created_at FROM proctor_snapshots WHERE interview_id = ? ORDER BY created_at DESC LIMIT 20').all(interview.id);
    let codeHistory = [];
    try { codeHistory = interview.code_history ? JSON.parse(interview.code_history) : []; } catch { codeHistory = []; }

    res.json({
      interview,
      report: reportRow ? JSON.parse(reportRow.json) : null,
      turns,
      snapshots,
      code_history: codeHistory
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
    const interview = getOrHydrateInterview(req.params.token);
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
app.post('/api/waitlist', async (req, res) => {
  try {
    const { name, company, email, phone, vacancies } = req.body;
    if (!email || !String(email).includes('@')) {
      return res.status(400).json({ error: 'Valid email is required' });
    }

    const cleanEmail = email.trim().toLowerCase();
    const leadId = 'lead_' + crypto.randomUUID();
    db.prepare(`
      INSERT INTO leads (id, name, company, email, phone, vacancies, source)
      VALUES (?, ?, ?, ?, ?, ?, 'pilot_waitlist')
    `).run(leadId, (name || '').trim(), (company || '').trim(), cleanEmail, (phone || '').trim(), (vacancies || '').trim());

    let emailSent = false;
    try {
      const mailRes = await sendWaitlistConfirmationEmail({
        email: cleanEmail,
        name: (name || '').trim(),
        company: (company || '').trim(),
        vacancies: (vacancies || '').trim()
      });
      emailSent = !!mailRes?.sent;
    } catch (mailErr) {
      console.warn('[Waitlist] Confirmation email error:', mailErr.message);
    }

    res.json({
      success: true,
      emailSent,
      message: emailSent
        ? `Done! Mail sent to ${cleanEmail}.`
        : 'Done! Request received.'
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// --- Platform Feedback Endpoint + Thank You Email Response ---
app.post('/api/feedback', async (req, res) => {
  try {
    const { name, email, rating, category, message, sourcePage } = req.body || {};
    if (!email || !String(email).includes('@')) {
      return res.status(400).json({ error: 'Please provide a valid email address so we can send a response.' });
    }
    const cleanMessage = String(message || '').trim();
    if (cleanMessage.length < 3) {
      return res.status(400).json({ error: 'Please share a brief feedback message.' });
    }

    const cleanEmail = String(email).trim().toLowerCase();
    const cleanName = String(name || 'User').trim() || 'User';
    const cleanCategory = String(category || 'general').trim() || 'general';
    const cleanSource = String(sourcePage || 'dashboard').trim() || 'dashboard';
    const parsedRating = parseInt(rating, 10);
    const numericRating = Number.isFinite(parsedRating) ? Math.min(5, Math.max(1, parsedRating)) : 5;
    const feedbackId = 'fb_' + crypto.randomUUID();

    db.prepare(`
      INSERT INTO feedbacks (id, user_name, user_email, rating, category, message, source_page, email_sent)
      VALUES (?, ?, ?, ?, ?, ?, ?, 0)
    `).run(feedbackId, cleanName, cleanEmail, numericRating, cleanCategory, cleanMessage, cleanSource);

    let emailSent = false;
    try {
      const mailRes = await sendFeedbackThankYouEmail({
        email: cleanEmail,
        name: cleanName,
        rating: numericRating,
        category: cleanCategory,
        message: cleanMessage
      });
      emailSent = !!mailRes?.sent;
      if (emailSent) {
        db.prepare('UPDATE feedbacks SET email_sent = 1 WHERE id = ?').run(feedbackId);
      }
    } catch (mailErr) {
      console.warn('[Feedback] Thank-you email error:', mailErr.message);
    }

    logActivity({
      action: 'FEEDBACK_SUBMITTED',
      actorType: cleanSource === 'candidate_interview' ? 'candidate' : 'user',
      actorEmail: cleanEmail,
      actorName: cleanName,
      entityType: 'feedback',
      entityId: feedbackId,
      details: { rating: numericRating, category: cleanCategory, sourcePage: cleanSource, emailSent },
      ipAddress: req.ip
    });

    res.json({
      success: true,
      id: feedbackId,
      emailSent,
      message: emailSent
        ? `Done! Mail sent to ${cleanEmail}.`
        : 'Done! Submitted successfully.'
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// --- Shared Export Filter & Sort Helper for CSV / JSON Downloads ---
function buildFilteredJobExport(job, orgId, query = {}) {
  const { selectedCutoff, borderlineCutoff } = normalizeThresholds(
    query.selectedCutoff ?? job.selected_threshold,
    query.borderlineCutoff ?? job.borderline_threshold
  );

  let items = fetchEnrichedJobInterviews(job, orgId, selectedCutoff, borderlineCutoff);

  const catFilter = String(query.category || 'all').toLowerCase();
  if (catFilter === 'shortlisted' || catFilter === 'selected_borderline') {
    items = items.filter(i => i.category === 'selected' || i.category === 'borderline');
  } else if (['selected', 'borderline', 'rejected', 'pending'].includes(catFilter)) {
    items = items.filter(i => i.category === catFilter);
  }

  const searchTerm = String(query.search || '').trim().toLowerCase();
  if (searchTerm) {
    items = items.filter(i => {
      const skillsText = (i.skills || []).map(s => s.skill).join(' ').toLowerCase();
      return (
        String(i.candidate_name || '').toLowerCase().includes(searchTerm) ||
        String(i.candidate_email || '').toLowerCase().includes(searchTerm) ||
        String(i.candidate_phone || '').toLowerCase().includes(searchTerm) ||
        skillsText.includes(searchTerm)
      );
    });
  }

  const sortMode = String(query.sort || 'score_desc');
  const tierOrder = { selected: 1, borderline: 2, pending: 3, rejected: 4 };
  items.sort((a, b) => {
    if (sortMode === 'score_asc') {
      return (a.score ?? -1) - (b.score ?? -1);
    }
    if (sortMode === 'name_asc') {
      return String(a.candidate_name || '').localeCompare(String(b.candidate_name || ''));
    }
    if (sortMode === 'recent') {
      const tA = new Date(a.ended_at || a.started_at || 0).getTime() || 0;
      const tB = new Date(b.ended_at || b.started_at || 0).getTime() || 0;
      return tB - tA;
    }
    // Default: Merit category tier, then point-wise score descending
    const tierDiff = (tierOrder[a.category] || 9) - (tierOrder[b.category] || 9);
    if (tierDiff !== 0) return tierDiff;
    return (b.score ?? -1) - (a.score ?? -1);
  });

  return { selectedCutoff, borderlineCutoff, items };
}

function escapeCsvCell(val) {
  const s = String(val ?? '').replace(/\r?\n/g, ' ').replace(/"/g, '""');
  return `"${s}"`;
}

// --- Rich CSV Export for ATS & Spreadsheet Integration ---
app.get('/jobs/:id/export.csv', requireAuth, (req, res) => {
  try {
    const job = getOrgJobOrNull(req.params.id, req.user.org_id);
    if (!job) return res.status(404).send('Job not found');

    const { items } = buildFilteredJobExport(job, req.user.org_id, req.query);

    const headers = [
      'Rank', 'Candidate Name', 'Email', 'Phone', 'Category', 'Score (/100)',
      'AI Verdict', 'Manual Decision', 'Reviewer Note', 'Top Skills Evaluated',
      'Proctor Warnings', 'Disqualification Reason', 'Source', 'Duration (min)',
      'Started At', 'Completed At', 'Report Summary'
    ];
    let csv = '\uFEFF' + headers.join(',') + '\n';

    items.forEach((r, idx) => {
      const skillsSummary = (r.skills || []).map(s => `${s.skill}:${s.score}/5`).join(' | ');
      const mins = r.duration_seconds !== null ? (r.duration_seconds / 60).toFixed(1) : '';
      const row = [
        idx + 1,
        r.candidate_name || '',
        r.candidate_email || '',
        r.candidate_phone || '',
        (r.category || 'pending').toUpperCase(),
        typeof r.score === 'number' ? r.score : '',
        r.verdict || r.state || 'N/A',
        r.manual_decision || 'Auto',
        r.reviewer_note || '',
        skillsSummary,
        r.proctor_warnings || 0,
        r.disqualified_reason || '',
        r.interview_source || r.candidate_source || 'direct',
        mins,
        r.started_at || '',
        r.ended_at || '',
        r.summary || ''
      ];
      csv += row.map(escapeCsvCell).join(',') + '\n';
    });

    const catSuffix = req.query.category && req.query.category !== 'all' ? `_${String(req.query.category).replace(/[^a-z0-9_]/gi, '')}` : '';
    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="candidates_${job.title.replace(/[^a-z0-9]/gi, '_')}${catSuffix}.csv"`);
    res.send(csv);
  } catch (err) {
    res.status(500).send('Export error: ' + err.message);
  }
});

// --- Structured JSON Export ---
app.get('/jobs/:id/export.json', requireAuth, (req, res) => {
  try {
    const job = getOrgJobOrNull(req.params.id, req.user.org_id);
    if (!job) return res.status(404).json({ error: 'Job not found' });

    const { selectedCutoff, borderlineCutoff, items } = buildFilteredJobExport(job, req.user.org_id, req.query);
    const catSuffix = req.query.category && req.query.category !== 'all' ? `_${String(req.query.category).replace(/[^a-z0-9_]/gi, '')}` : '';

    res.setHeader('Content-Disposition', `attachment; filename="candidates_${job.title.replace(/[^a-z0-9]/gi, '_')}${catSuffix}.json"`);
    res.json({
      exported_at: new Date().toISOString(),
      job: {
        id: job.id,
        title: job.title,
        level: job.level,
        interview_type: job.interview_type,
        max_minutes: job.max_minutes,
        selected_threshold: selectedCutoff,
        borderline_threshold: borderlineCutoff
      },
      total_exported: items.length,
      candidates: items.map((c, idx) => ({
        rank: idx + 1,
        interview_id: c.interview_id,
        candidate_name: c.candidate_name,
        candidate_email: c.candidate_email,
        candidate_phone: c.candidate_phone,
        category: c.category,
        score: c.score,
        verdict: c.verdict,
        manual_decision: c.manual_decision,
        reviewer_note: c.reviewer_note,
        reviewed_by: c.reviewed_by,
        skills: c.skills,
        proctor_warnings: c.proctor_warnings || 0,
        disqualified_reason: c.disqualified_reason || null,
        duration_seconds: c.duration_seconds,
        summary: c.summary,
        started_at: c.started_at,
        ended_at: c.ended_at
      }))
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// --- Organization Team & RBAC Management ---
function getUserOrgRole(userId) {
  const row = db.prepare('SELECT org_role, role FROM users WHERE id = ?').get(userId);
  return row?.org_role || row?.role || 'recruiter';
}

app.get('/org/team', requireAuth, (req, res) => {
  try {
    const members = db.prepare(`
      SELECT id, email, full_name, job_title, COALESCE(org_role, role, 'owner') as org_role, is_verified, last_login_at, created_at
      FROM users WHERE org_id = ? ORDER BY created_at ASC
    `).all(req.user.org_id);

    const invites = db.prepare(`
      SELECT id, email, org_role, status, expires_at, created_at
      FROM org_team_invites WHERE org_id = ? AND status = 'pending' ORDER BY created_at DESC
    `).all(req.user.org_id);

    res.json({
      currentUserRole: getUserOrgRole(req.user.id),
      members,
      invites
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post('/org/team/invite', requireAuth, (req, res) => {
  try {
    const callerRole = getUserOrgRole(req.user.id);
    if (callerRole !== 'owner' && callerRole !== 'admin') {
      return res.status(403).json({ error: 'Only organization owners can invite team members.' });
    }

    const email = String(req.body?.email || '').toLowerCase().trim();
    const orgRole = ['owner', 'recruiter', 'reviewer'].includes(req.body?.org_role) ? req.body.org_role : 'recruiter';
    if (!email || !email.includes('@')) {
      return res.status(400).json({ error: 'Valid work email is required.' });
    }

    const existingMember = db.prepare('SELECT id FROM users WHERE email = ? AND org_id = ?').get(email, req.user.org_id);
    if (existingMember) {
      return res.status(400).json({ error: 'This user is already a member of your organization.' });
    }

    const rawToken = 'inv_' + crypto.randomBytes(24).toString('hex');
    const tokenHash = crypto.createHash('sha256').update(rawToken).digest('hex');
    const inviteId = 'tinv_' + crypto.randomUUID();
    const expiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString();

    db.prepare(`
      INSERT INTO org_team_invites (id, org_id, email, org_role, token_hash, invited_by, status, expires_at)
      VALUES (?, ?, ?, ?, ?, ?, 'pending', ?)
    `).run(inviteId, req.user.org_id, email, orgRole, tokenHash, req.user.id, expiresAt);

    logActivity({
      action: 'ORG_TEAM_INVITED',
      actorType: 'user',
      actorId: req.user.id,
      actorEmail: req.user.email,
      orgId: req.user.org_id,
      entityType: 'org_team_invite',
      entityId: inviteId,
      details: { invitedEmail: email, orgRole },
      ipAddress: req.ip
    });

    res.json({
      success: true,
      inviteId,
      inviteToken: rawToken,
      email,
      orgRole,
      expiresAt,
      signupUrl: `/?inviteToken=${rawToken}&email=${encodeURIComponent(email)}`
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post('/org/team/accept', requireAuth, (req, res) => {
  try {
    const rawToken = String(req.body?.inviteToken || '').trim();
    if (!rawToken) return res.status(400).json({ error: 'inviteToken is required' });

    const tokenHash = crypto.createHash('sha256').update(rawToken).digest('hex');
    const invite = db.prepare(`
      SELECT * FROM org_team_invites
      WHERE token_hash = ? AND status = 'pending' AND datetime(expires_at) > datetime('now')
    `).get(tokenHash);

    if (!invite) return res.status(400).json({ error: 'Invalid or expired team invite token.' });
    if (invite.email.toLowerCase() !== req.user.email.toLowerCase()) {
      return res.status(403).json({ error: 'This invite was issued for a different email address.' });
    }

    db.transaction(() => {
      db.prepare('UPDATE users SET org_id = ?, org_role = ?, role = ? WHERE id = ?')
        .run(invite.org_id, invite.org_role, invite.org_role, req.user.id);
      db.prepare("UPDATE org_team_invites SET status = 'accepted' WHERE id = ?").run(invite.id);
    })();

    const newToken = signToken({ id: req.user.id, org_id: invite.org_id, email: req.user.email, role: invite.org_role });
    res.json({ success: true, orgId: invite.org_id, orgRole: invite.org_role, token: newToken });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.delete('/org/team/:id', requireAuth, (req, res) => {
  try {
    const callerRole = getUserOrgRole(req.user.id);
    if (callerRole !== 'owner' && callerRole !== 'admin') {
      return res.status(403).json({ error: 'Only organization owners can remove team members or invites.' });
    }
    const targetId = req.params.id;
    if (targetId === req.user.id) {
      return res.status(400).json({ error: 'You cannot remove yourself from the organization.' });
    }

    const delInvite = db.prepare('DELETE FROM org_team_invites WHERE id = ? AND org_id = ?').run(targetId, req.user.org_id);
    if (delInvite.changes > 0) return res.json({ success: true, removedType: 'invite' });

    const delUser = db.prepare('DELETE FROM users WHERE id = ? AND org_id = ?').run(targetId, req.user.org_id);
    if (delUser.changes === 0) return res.status(404).json({ error: 'Member or invite not found' });

    res.json({ success: true, removedType: 'member' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// --- Outbound Webhooks Management (HRIS / ATS Integrations) ---
app.get('/org/webhooks', requireAuth, (req, res) => {
  try {
    const webhooks = db.prepare(`
      SELECT id, name, url, events, is_active, last_triggered_at, last_status, created_at
      FROM org_webhooks WHERE org_id = ? ORDER BY created_at DESC
    `).all(req.user.org_id);
    res.json({ webhooks });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

function isSafeWebhookUrl(parsedUrl) {
  const host = (parsedUrl.hostname || '').toLowerCase();
  if (!host) return false;
  // Always block cloud instance metadata endpoints & link-local 169.254.0.0/16
  if (host === 'metadata.google.internal' || host === 'metadata' || /^169\.254\./.test(host)) {
    return false;
  }
  if (process.env.NODE_ENV === 'production' && process.env.ALLOW_PRIVATE_WEBHOOKS !== '1') {
    if (
      host === 'localhost' ||
      host === '127.0.0.1' ||
      host === '::1' ||
      host === '[::1]' ||
      /^10\./.test(host) ||
      /^192\.168\./.test(host) ||
      /^172\.(1[6-9]|2\d|3[0-1])\./.test(host)
    ) {
      return false;
    }
  }
  return true;
}

app.post('/org/webhooks', requireAuth, (req, res) => {
  try {
    const callerRole = getUserOrgRole(req.user.id);
    if (callerRole === 'reviewer') {
      return res.status(403).json({ error: 'Reviewers do not have permission to configure webhooks.' });
    }

    const name = String(req.body?.name || 'ATS Webhook').trim().slice(0, 120);
    const url = String(req.body?.url || '').trim();
    const eventsInput = Array.isArray(req.body?.events) ? req.body.events.join(',') : String(req.body?.events || 'interview.completed,interview.disqualified,candidate.decision_updated');

    let parsedUrl;
    try {
      parsedUrl = new URL(url);
    } catch {
      return res.status(400).json({ error: 'Valid webhook URL (http:// or https://) is required.' });
    }
    if (!['http:', 'https:'].includes(parsedUrl.protocol)) {
      return res.status(400).json({ error: 'Webhook URL must use http or https protocol.' });
    }
    if (!isSafeWebhookUrl(parsedUrl)) {
      return res.status(400).json({ error: 'Webhook target host is blocked by SSRF security policy.' });
    }

    const webhookId = 'wh_' + crypto.randomUUID();
    const secret = 'whsec_' + crypto.randomBytes(24).toString('hex');

    db.prepare(`
      INSERT INTO org_webhooks (id, org_id, name, url, secret, events, is_active)
      VALUES (?, ?, ?, ?, ?, ?, 1)
    `).run(webhookId, req.user.org_id, name, url, secret, eventsInput);

    res.json({
      success: true,
      webhook: { id: webhookId, name, url, secret, events: eventsInput, is_active: 1 }
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post('/org/webhooks/:id/test', requireAuth, async (req, res) => {
  try {
    const webhook = db.prepare('SELECT * FROM org_webhooks WHERE id = ? AND org_id = ?').get(req.params.id, req.user.org_id);
    if (!webhook) return res.status(404).json({ error: 'Webhook not found' });

    const delivery = await deliverWebhook(webhook, 'webhook.test', {
      message: 'RoundOne AI test webhook delivery',
      triggeredBy: req.user.email,
    });
    res.json({ success: delivery.success, delivery });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.get('/org/webhooks/deliveries', requireAuth, (req, res) => {
  try {
    const deliveries = db.prepare(`
      SELECT id, webhook_id, event, status_code, success, duration_ms, created_at
      FROM webhook_deliveries WHERE org_id = ? ORDER BY created_at DESC LIMIT 30
    `).all(req.user.org_id);
    res.json({ deliveries });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.delete('/org/webhooks/:id', requireAuth, (req, res) => {
  try {
    const del = db.prepare('DELETE FROM org_webhooks WHERE id = ? AND org_id = ?').run(req.params.id, req.user.org_id);
    if (del.changes === 0) return res.status(404).json({ error: 'Webhook not found' });
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// --- Expiring Shareable Candidate Report Links ---
app.post('/interviews/:id/share', requireAuth, (req, res) => {
  try {
    const interview = db.prepare(`
      SELECT i.id, j.org_id as job_org_id
      FROM interviews i
      JOIN jobs j ON i.job_id = j.id
      WHERE i.id = ? AND (j.org_id = ? OR j.org_id = 'org_default' OR j.org_id IS NULL)
    `).get(req.params.id, req.user.org_id);
    if (!interview) return res.status(404).json({ error: 'Interview not found' });

    const expiresHours = Math.min(720, Math.max(1, parseInt(req.body?.expiresHours || '72', 10) || 72));
    const hidePii = req.body?.hidePii === false ? 0 : 1;
    const rawToken = 'shr_' + crypto.randomBytes(24).toString('hex');
    const tokenHash = crypto.createHash('sha256').update(rawToken).digest('hex');
    const shareId = 'sh_' + crypto.randomUUID();
    const expiresAt = new Date(Date.now() + expiresHours * 3600 * 1000).toISOString();

    db.prepare(`
      INSERT INTO report_shares (id, interview_id, org_id, token_hash, hide_pii, expires_at, created_by)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `).run(shareId, interview.id, req.user.org_id, tokenHash, hidePii, expiresAt, req.user.id);

    const shareUrl = `${req.protocol}://${req.get('host')}/share.html?token=${rawToken}`;
    res.json({ success: true, shareId, shareUrl, token: rawToken, hidePii: Boolean(hidePii), expiresAt });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.get('/public/share/:shareToken', (req, res) => {
  try {
    const tokenHash = crypto.createHash('sha256').update(String(req.params.shareToken || '')).digest('hex');
    const share = db.prepare(`
      SELECT * FROM report_shares
      WHERE token_hash = ? AND datetime(expires_at) > datetime('now')
    `).get(tokenHash);
    if (!share) return res.status(404).json({ error: 'Share link is invalid or has expired.' });

    const interview = db.prepare(`
      SELECT i.*, j.title as job_title, j.skills as job_skills, o.name as company_name,
             c.name as candidate_name, c.email as candidate_email, c.phone as candidate_phone
      FROM interviews i
      JOIN jobs j ON i.job_id = j.id
      JOIN organizations o ON j.org_id = o.id
      JOIN candidates c ON i.candidate_id = c.id
      WHERE i.id = ?
    `).get(share.interview_id);
    if (!interview) return res.status(404).json({ error: 'Shared interview not found.' });

    db.prepare('UPDATE report_shares SET view_count = view_count + 1 WHERE id = ?').run(share.id);

    const reportRow = db.prepare('SELECT * FROM reports WHERE interview_id = ?').get(interview.id);
    const turns = db.prepare('SELECT idx, role, text, skill, level, created_at FROM turns WHERE interview_id = ? ORDER BY idx ASC').all(interview.id);

    const sanitizedInterview = {
      ...interview,
      candidate_email: share.hide_pii ? '[Hidden by recruiter]' : interview.candidate_email,
      candidate_phone: share.hide_pii ? '' : interview.candidate_phone,
      proctor_logs: interview.proctor_logs ? JSON.parse(interview.proctor_logs) : [],
      dsa_result: interview.dsa_result ? JSON.parse(interview.dsa_result) : null,
    };

    res.json({
      success: true,
      hidePii: Boolean(share.hide_pii),
      expiresAt: share.expires_at,
      viewCount: (share.view_count || 0) + 1,
      interview: sanitizedInterview,
      report: reportRow ? JSON.parse(reportRow.json) : null,
      turns,
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// --- Custom Organization Coding & SQL Problem Builder ---
app.get('/org/problems', requireAuth, (req, res) => {
  try {
    const problems = db.prepare('SELECT * FROM org_custom_problems WHERE org_id = ? ORDER BY created_at DESC').all(req.user.org_id);
    res.json({
      problems: problems.map((p) => ({
        ...p,
        test_cases: (() => { try { return JSON.parse(p.test_cases_json || '[]'); } catch { return []; } })(),
      })),
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post('/org/problems', requireAuth, (req, res) => {
  try {
    const callerRole = getUserOrgRole(req.user.id);
    if (callerRole === 'reviewer') {
      return res.status(403).json({ error: 'Reviewers cannot author custom problems.' });
    }

    const title = String(req.body?.title || '').trim().slice(0, 140);
    const difficulty = ['Easy', 'Medium', 'Hard'].includes(req.body?.difficulty) ? req.body.difficulty : 'Medium';
    const description = String(req.body?.description || '').trim();
    const fnJs = String(req.body?.function_name_js || 'solve').replace(/[^a-zA-Z0-9_]/g, '') || 'solve';
    const fnPy = String(req.body?.function_name_py || 'solve').replace(/[^a-zA-Z0-9_]/g, '') || 'solve';
    const testCases = Array.isArray(req.body?.test_cases) ? req.body.test_cases : [];

    if (!title || !description) {
      return res.status(400).json({ error: 'Problem title and description are required.' });
    }
    if (testCases.length === 0) {
      return res.status(400).json({ error: 'At least one test case with input and expected output is required.' });
    }

    const normalizedCases = testCases.slice(0, 15).map((tc, i) => ({
      id: i + 1,
      type: String(tc.type || '').toLowerCase() === 'hidden' ? 'Hidden' : 'Public',
      input: tc.input && typeof tc.input === 'object' ? tc.input : { arg: tc.input },
      expected: tc.expected,
    }));

    const starterJs = String(req.body?.starter_js || '').trim() || `function ${fnJs}(input) {\n  // TODO: Implement\n  return null;\n}`;
    const starterPy = String(req.body?.starter_py || '').trim() || `def ${fnPy}(input):\n    # TODO: Implement\n    return None`;
    const starterSql = String(req.body?.starter_sql || '').trim() || 'SELECT name, salary FROM employees ORDER BY salary DESC;';

    const problemId = 'cprob_' + crypto.randomUUID().slice(0, 8);
    db.prepare(`
      INSERT INTO org_custom_problems (id, org_id, title, difficulty, description, function_name_js, function_name_py, starter_js, starter_py, starter_sql, test_cases_json)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(problemId, req.user.org_id, title, difficulty, description, fnJs, fnPy, starterJs, starterPy, starterSql, JSON.stringify(normalizedCases));

    res.json({
      success: true,
      problem: { id: problemId, title, difficulty, description, function_name_js: fnJs, function_name_py: fnPy, starter_js: starterJs, starter_py: starterPy, starter_sql: starterSql, test_cases: normalizedCases }
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.delete('/org/problems/:id', requireAuth, (req, res) => {
  try {
    const del = db.prepare('DELETE FROM org_custom_problems WHERE id = ? AND org_id = ?').run(req.params.id, req.user.org_id);
    if (del.changes === 0) return res.status(404).json({ error: 'Custom problem not found' });
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// --- Public Branded Company Careers Portal API ---
app.get('/public/careers/:orgId', (req, res) => {
  try {
    const org = db.prepare('SELECT id, name, website, industry, company_size, country FROM organizations WHERE id = ?').get(req.params.orgId);
    if (!org) return res.status(404).json({ error: 'Company careers page not found' });

    const jobs = db.prepare(`
      SELECT id, title, category, purpose, experience_required, skills, qualifications, level, max_minutes, max_questions, jd_text, created_at
      FROM jobs WHERE org_id = ? ORDER BY created_at DESC
    `).all(org.id);

    res.json({ success: true, organization: org, jobs });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.get('/careers/:orgId', (req, res) => {
  res.redirect(`/careers.html?org=${encodeURIComponent(req.params.orgId)}`);
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

app.use((err, req, res, next) => {
  recordServerEvent({ level: 'error', source: `http:${req.method} ${req.path}`, message: err?.message || 'Unhandled Express error' });
  if (res.headersSent) return next(err);
  res.status(err?.status || 500).json({ error: err?.message || 'Internal Server Error' });
});

app.listen(PORT, () => {
  console.log(`=======================================================`);
  console.log(`🚀 RoundOne AI running at http://localhost:${PORT}`);
  console.log(`   - Recruiter Dashboard: http://localhost:${PORT}`);
  console.log(`   - Candidate Interview: http://localhost:${PORT}/interview.html?token=<token>`);
  console.log(`   - Health check:        http://localhost:${PORT}/health`);
  console.log(`=======================================================`);
});
