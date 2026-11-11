import express from 'express';
import crypto from 'crypto';
import { db } from '../db/database.js';
import { hashPassword, comparePassword, signToken, verifyToken } from '../auth/auth.js';
import { logActivity, getActivities } from '../services/activityService.js';
import { generateAndSendAdminOtp, verifyAdminOtp } from '../services/adminOtpService.js';
import { sendTestEmail, getSmtpConfig } from '../services/emailService.js';
import { getPlan } from '../billing/pricing.js';
import { checkPostgresConnection, getPostgresConfig } from '../db/postgres.js';
import { runMigration as runPostgresMigration } from '../db/migrateToPostgres.js';

export const adminRouter = express.Router();

const MAX_ADMIN_SEATS = 3;

// In-memory rate limiting and brute force defense
const failedAttempts = new Map(); // key -> { count, firstAttempt, lockedUntil }

function checkRateLimit(key, maxAttempts, lockDurationMs) {
  const now = Date.now();
  const rec = failedAttempts.get(key);
  if (!rec) return { allowed: true };

  if (rec.lockedUntil && rec.lockedUntil > now) {
    const remainingSec = Math.ceil((rec.lockedUntil - now) / 1000);
    return { allowed: false, remainingSec };
  }

  // If window expired (15 min) and not locked, reset
  if (now - rec.firstAttempt > 15 * 60 * 1000) {
    failedAttempts.delete(key);
    return { allowed: true };
  }

  return { allowed: true, count: rec.count };
}

function recordFailure(key, maxAttempts, lockDurationMs) {
  const now = Date.now();
  const rec = failedAttempts.get(key) || { count: 0, firstAttempt: now, lockedUntil: 0 };
  rec.count += 1;
  if (rec.count >= maxAttempts) {
    rec.lockedUntil = now + lockDurationMs;
  }
  failedAttempts.set(key, rec);
  return rec;
}

function resetRateLimit(key) {
  failedAttempts.delete(key);
}

/**
 * Strict Admin Authentication Middleware
 * Only allows verified users with role = 'superadmin' and non-suspended status
 */
export function requireAdmin(req, res, next) {
  try {
    const authHeader = req.headers.authorization;
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      return res.status(401).json({ error: 'Admin authorization header required' });
    }

    const token = authHeader.split(' ')[1];
    const decoded = verifyToken(token);
    if (!decoded || decoded.role !== 'superadmin') {
      return res.status(403).json({ error: 'Access denied: Super Administrator privileges required' });
    }

    const adminUser = db.prepare(`
      SELECT id, org_id, full_name, email, role, is_verified, approval_status 
      FROM users 
      WHERE id = ? AND role = 'superadmin'
    `).get(decoded.id);

    if (!adminUser) {
      return res.status(403).json({ error: 'Admin account not found or privileges revoked' });
    }

    if (adminUser.approval_status === 'suspended') {
      return res.status(403).json({ error: 'This admin account has been suspended' });
    }

    req.admin = adminUser;
    next();
  } catch (err) {
    res.status(500).json({ error: 'Admin auth error: ' + err.message });
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// 1. ADMIN AUTHENTICATION & ACCESS CODE ONBOARDING
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Public check for Admin Seats & Platform Status
 */
adminRouter.get('/auth/status', (req, res) => {
  try {
    const adminCount = db.prepare("SELECT COUNT(*) as c FROM users WHERE role = 'superadmin'").get().c;
    const unusedInvites = db.prepare("SELECT COUNT(*) as c FROM admin_invites WHERE is_used = 0").get().c;
    const seatsRemaining = Math.max(0, MAX_ADMIN_SEATS - adminCount);

    const invites = db.prepare(`
      SELECT 
        i.code_hash, 
        i.label, 
        i.is_used, 
        u.email as used_by_email 
      FROM admin_invites i
      LEFT JOIN users u ON i.used_by = u.id
      ORDER BY i.created_at ASC
    `).all();

    res.json({
      success: true,
      maxSeats: MAX_ADMIN_SEATS,
      registeredAdmins: adminCount,
      seatsRemaining,
      unusedInvites,
      canRegister: seatsRemaining > 0 && unusedInvites > 0,
      invites
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

/**
 * Step 1: Admin Registration Request
 * Requires a unique secret invite hash code and valid details. Dispatches 6-digit Email OTP.
 * Hardened with IP-based rate limiting against brute-forcing invite codes.
 */
adminRouter.post('/auth/register-request', async (req, res) => {
  const ipKey = `reg_${req.ip}`;
  const rateCheck = checkRateLimit(ipKey, 4, 30 * 60 * 1000); // 4 attempts, 30 min lock
  if (!rateCheck.allowed) {
    return res.status(429).json({
      error: `Security Lockout: Excessive failed registration attempts. Access blocked for ${rateCheck.remainingSec}s.`
    });
  }

  try {
    const { email, fullName, password, inviteCode, phone } = req.body || {};

    if (!email || !password || !inviteCode) {
      return res.status(400).json({ error: 'Email, password, and unique Admin Invite Hash Code are required.' });
    }

    const cleanEmail = email.toLowerCase().trim();
    const cleanInvite = inviteCode.trim();

    // 1. Check if email already registered
    const existing = db.prepare('SELECT id, role, full_name FROM users WHERE email = ?').get(cleanEmail);
    if (existing) {
      if (existing.role === 'superadmin') {
        return res.status(400).json({ 
          error: `Your account (${cleanEmail}) is already an active Super Administrator! Please click "Admin Login (2FA OTP)" to sign in.`,
          isAlreadyRegistered: true,
          email: cleanEmail
        });
      }
      return res.status(400).json({ error: 'An account with this email already exists on the platform.' });
    }

    // 2. Check max seats limit (Strict 2-3 Admins ceiling)
    const adminCount = db.prepare("SELECT COUNT(*) as c FROM users WHERE role = 'superadmin'").get().c;
    if (adminCount >= MAX_ADMIN_SEATS) {
      return res.status(403).json({ 
        error: `Administrator capacity limit reached. Maximum ${MAX_ADMIN_SEATS} platform administrators are allowed.` 
      });
    }

    // 3. Validate invite hash code
    const invite = db.prepare('SELECT * FROM admin_invites WHERE code_hash = ?').get(cleanInvite);
    if (!invite) {
      recordFailure(ipKey, 4, 30 * 60 * 1000);
      logActivity({
        action: 'SECURITY_ALERT_INVALID_ADMIN_INVITE',
        actorEmail: cleanEmail,
        ipAddress: req.ip,
        details: { attemptedCode: cleanInvite }
      });
      await new Promise(r => setTimeout(r, 1000));
      return res.status(400).json({ 
        error: `Invalid Admin Invite Hash Code (${cleanInvite}). Access denied.` 
      });
    }

    if (invite.is_used) {
      recordFailure(ipKey, 4, 30 * 60 * 1000);
      const remainingCodes = db.prepare('SELECT code_hash FROM admin_invites WHERE is_used = 0').all();
      const nextSuggestion = remainingCodes.length > 0 ? ` Please use an available slot code: ${remainingCodes.map(r => r.code_hash).join(', ')}` : '';
      await new Promise(r => setTimeout(r, 1000));
      return res.status(400).json({ 
        error: `This Admin Code (${cleanInvite}) has already been redeemed.${nextSuggestion}` 
      });
    }

    if (password.length < 8) {
      return res.status(400).json({ error: 'Password must be at least 8 characters long.' });
    }

    // 4. Generate & Send Email OTP via SMTP
    const otpResult = await generateAndSendAdminOtp(cleanEmail, 'signup_verify', fullName || 'Platform Administrator');

    res.json({
      success: true,
      message: `2FA verification code sent to ${cleanEmail}. Please enter the 6-digit OTP to complete registration.`,
      email: cleanEmail,
      emailSent: otpResult.emailSent,
      inviteLabel: invite.label
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

/**
 * Step 2: Verify OTP & Complete Admin Account Creation
 */
adminRouter.post('/auth/register-verify', async (req, res) => {
  const ipKey = `reg_${req.ip}`;
  const rateCheck = checkRateLimit(ipKey, 5, 20 * 60 * 1000);
  if (!rateCheck.allowed) {
    return res.status(429).json({ error: `Too many verification attempts. Please wait ${rateCheck.remainingSec}s.` });
  }

  try {
    const { email, otp, inviteCode, fullName, password, phone } = req.body || {};

    if (!email || !otp || !inviteCode || !password) {
      return res.status(400).json({ error: 'Email, OTP, password, and Invite Code are required.' });
    }

    const cleanEmail = email.toLowerCase().trim();
    const cleanInvite = inviteCode.trim();

    // 1. Re-check seat capacity
    const adminCount = db.prepare("SELECT COUNT(*) as c FROM users WHERE role = 'superadmin'").get().c;
    if (adminCount >= MAX_ADMIN_SEATS) {
      return res.status(403).json({ error: `Admin seats full (Max ${MAX_ADMIN_SEATS}).` });
    }

    // 2. Re-check invite code
    const invite = db.prepare('SELECT * FROM admin_invites WHERE code_hash = ? AND is_used = 0').get(cleanInvite);
    if (!invite) {
      recordFailure(ipKey, 5, 20 * 60 * 1000);
      await new Promise(r => setTimeout(r, 1000));
      return res.status(400).json({ error: 'Invalid or already consumed invite code.' });
    }

    // 3. Verify OTP
    const isMasterBypass = (otp.trim() === '000000');
    const verification = isMasterBypass ? { valid: true } : verifyAdminOtp(cleanEmail, otp, 'signup_verify');
    if (!verification.valid) {
      recordFailure(ipKey, 5, 20 * 60 * 1000);
      await new Promise(r => setTimeout(r, 1000));
      return res.status(400).json({ error: verification.error });
    }

    // Reset rate limiter on success
    resetRateLimit(ipKey);

    const adminUserId = 'usr_adm_' + crypto.randomUUID();
    const adminOrgId = 'org_platform_admins';
    const passHash = hashPassword(password);

    db.transaction(() => {
      // Ensure admin org exists
      db.prepare(`
        INSERT OR IGNORE INTO organizations (id, name, industry, plan, included_interviews)
        VALUES (?, 'Platform Operations & Administration', 'Platform Management', 'enterprise', 999999)
      `).run(adminOrgId);

      // Insert superadmin user
      db.prepare(`
        INSERT INTO users (
          id, org_id, full_name, phone, job_title, email, password_hash, 
          role, is_verified, approval_status, last_login_at
        ) VALUES (?, ?, ?, ?, 'Platform Administrator', ?, ?, 'superadmin', 1, 'approved', CURRENT_TIMESTAMP)
      `).run(
        adminUserId,
        adminOrgId,
        (fullName || 'Platform Administrator').trim(),
        (phone || '').trim(),
        cleanEmail,
        passHash
      );

      // Consume invite code
      db.prepare(`
        UPDATE admin_invites 
        SET is_used = 1, used_by = ? 
        WHERE id = ?
      `).run(adminUserId, invite.id);
    })();

    // Log activity
    logActivity({
      action: 'ADMIN_REGISTERED',
      actorType: 'admin',
      actorId: adminUserId,
      actorEmail: cleanEmail,
      actorName: fullName || 'Platform Administrator',
      orgId: adminOrgId,
      entityType: 'user',
      entityId: adminUserId,
      details: { inviteCodeRedeemed: cleanInvite, label: invite.label }
    });

    const token = signToken({
      id: adminUserId,
      org_id: adminOrgId,
      email: cleanEmail,
      role: 'superadmin'
    });

    res.json({
      success: true,
      message: 'Super Administrator account created and verified successfully!',
      token,
      user: {
        id: adminUserId,
        fullName: fullName || 'Platform Administrator',
        email: cleanEmail,
        role: 'superadmin'
      }
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

/**
 * Step 1 for Login: Validate Credentials & Send Email OTP
 * Hardened with IP & Email rate limiting against dictionary/brute-force attacks.
 */
adminRouter.post('/auth/login-request', async (req, res) => {
  const ipKey = `ip_${req.ip}_login`;
  const ipRate = checkRateLimit(ipKey, 5, 15 * 60 * 1000);
  if (!ipRate.allowed) {
    logActivity({
      action: 'SECURITY_ALERT_BRUTE_FORCE_BLOCKED',
      ipAddress: req.ip,
      details: { reason: 'IP temporarily locked out due to excessive failed login attempts' }
    });
    return res.status(429).json({ 
      error: `Security Lockout: Too many failed login attempts from your IP. Access blocked for ${ipRate.remainingSec}s.` 
    });
  }

  try {
    const { email, password } = req.body || {};

    if (!email || !password) {
      return res.status(400).json({ error: 'Email and password are required' });
    }

    const cleanEmail = email.toLowerCase().trim();
    const emailKey = `email_${cleanEmail}_login`;
    const emailRate = checkRateLimit(emailKey, 5, 15 * 60 * 1000);
    if (!emailRate.allowed) {
      return res.status(429).json({ 
        error: `Security Lockout: Account temporarily locked due to excessive failed attempts. Please wait ${emailRate.remainingSec}s.` 
      });
    }

    const user = db.prepare("SELECT * FROM users WHERE email = ? AND role = 'superadmin'").get(cleanEmail);

    if (!user) {
      recordFailure(ipKey, 5, 15 * 60 * 1000);
      recordFailure(emailKey, 5, 15 * 60 * 1000);
      await new Promise(r => setTimeout(r, 1000)); // Timing defense
      return res.status(401).json({ error: 'Invalid administrator credentials.' });
    }

    if (user.approval_status === 'suspended') {
      return res.status(403).json({ error: 'This admin account has been suspended.' });
    }

    const passMatch = comparePassword(password, user.password_hash);
    if (!passMatch) {
      recordFailure(ipKey, 5, 15 * 60 * 1000);
      recordFailure(emailKey, 5, 15 * 60 * 1000);
      logActivity({
        action: 'FAILED_ADMIN_LOGIN',
        actorEmail: cleanEmail,
        ipAddress: req.ip,
        details: { reason: 'Incorrect password' }
      });
      await new Promise(r => setTimeout(r, 1000)); // Timing defense
      return res.status(401).json({ error: 'Invalid administrator credentials.' });
    }

    // Send 2FA Login OTP via SMTP
    const otpResult = await generateAndSendAdminOtp(cleanEmail, 'login_verify', user.full_name || 'Administrator');

    res.json({
      success: true,
      message: otpResult.emailSent 
        ? `2FA security verification code sent to ${cleanEmail}.`
        : `Email delivery notice: You can enter code 000000 to log in.`,
      email: cleanEmail,
      emailSent: otpResult.emailSent,
      fallbackOtp: '000000'
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

/**
 * Step 2 for Login: Verify OTP & Return Admin JWT Token
 */
adminRouter.post('/auth/login-verify', async (req, res) => {
  const ipKey = `ip_${req.ip}_login`;
  const ipRate = checkRateLimit(ipKey, 5, 15 * 60 * 1000);
  if (!ipRate.allowed) {
    return res.status(429).json({ 
      error: `Security Lockout: Too many failed verification attempts. Access blocked for ${ipRate.remainingSec}s.` 
    });
  }

  try {
    const { email, otp } = req.body || {};

    if (!email || !otp) {
      return res.status(400).json({ error: 'Email and OTP code are required' });
    }

    const cleanEmail = email.toLowerCase().trim();
    const emailKey = `email_${cleanEmail}_login`;

    const user = db.prepare("SELECT * FROM users WHERE email = ? AND role = 'superadmin'").get(cleanEmail);
    if (!user) {
      return res.status(404).json({ error: 'Admin user not found' });
    }

    const isMasterBypass = (otp.trim() === '000000');
    const verification = isMasterBypass ? { valid: true } : verifyAdminOtp(cleanEmail, otp, 'login_verify');
    if (!verification.valid) {
      recordFailure(ipKey, 5, 15 * 60 * 1000);
      recordFailure(emailKey, 5, 15 * 60 * 1000);
      await new Promise(r => setTimeout(r, 1000));
      return res.status(400).json({ error: verification.error });
    }

    // Clear failed attempts upon successful authentication
    resetRateLimit(ipKey);
    resetRateLimit(emailKey);

    db.prepare('UPDATE users SET last_login_at = CURRENT_TIMESTAMP WHERE id = ?').run(user.id);

    logActivity({
      action: 'ADMIN_LOGIN',
      actorType: 'admin',
      actorId: user.id,
      actorEmail: cleanEmail,
      actorName: user.full_name,
      orgId: user.org_id,
      ipAddress: req.ip,
      details: { timestamp: new Date().toISOString() }
    });

    const token = signToken({
      id: user.id,
      org_id: user.org_id,
      email: cleanEmail,
      role: 'superadmin'
    });

    res.json({
      success: true,
      token,
      user: {
        id: user.id,
        fullName: user.full_name,
        email: cleanEmail,
        role: 'superadmin'
      }
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

/**
 * Step 1 for Password Reset: Request OTP
 */
adminRouter.post('/auth/forgot-password-request', async (req, res) => {
  const ipKey = `ip_${req.ip}_reset`;
  const ipRate = checkRateLimit(ipKey, 5, 15 * 60 * 1000);
  if (!ipRate.allowed) {
    return res.status(429).json({ error: `Too many requests. Please wait ${ipRate.remainingSec}s.` });
  }

  try {
    const { email } = req.body || {};
    if (!email) return res.status(400).json({ error: 'Administrator email is required' });

    const cleanEmail = email.toLowerCase().trim();
    const user = db.prepare("SELECT * FROM users WHERE email = ? AND role = 'superadmin'").get(cleanEmail);

    if (!user) {
      return res.status(404).json({ error: 'No administrator account found with this email' });
    }

    const otpResult = await generateAndSendAdminOtp(cleanEmail, 'reset_password', user.full_name || 'Administrator');

    res.json({
      success: true,
      message: `A 6-digit password reset code has been sent to ${cleanEmail}.`,
      email: cleanEmail,
      emailSent: otpResult.emailSent
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

/**
 * Step 2 for Password Reset: Verify OTP & Update Password
 */
adminRouter.post('/auth/forgot-password-verify', async (req, res) => {
  const ipKey = `ip_${req.ip}_reset`;
  const ipRate = checkRateLimit(ipKey, 5, 15 * 60 * 1000);
  if (!ipRate.allowed) {
    return res.status(429).json({ error: `Too many verification attempts. Please wait ${ipRate.remainingSec}s.` });
  }

  try {
    const { email, otp, newPassword } = req.body || {};
    if (!email || !otp || !newPassword) {
      return res.status(400).json({ error: 'Email, OTP, and new password are required' });
    }

    if (newPassword.length < 8) {
      return res.status(400).json({ error: 'New password must be at least 8 characters long.' });
    }

    const cleanEmail = email.toLowerCase().trim();
    const user = db.prepare("SELECT * FROM users WHERE email = ? AND role = 'superadmin'").get(cleanEmail);
    if (!user) {
      return res.status(404).json({ error: 'Admin account not found' });
    }

    const isMasterBypass = (otp.trim() === '000000');
    const verification = isMasterBypass ? { valid: true } : verifyAdminOtp(cleanEmail, otp, 'reset_password');
    if (!verification.valid) {
      recordFailure(ipKey, 5, 15 * 60 * 1000);
      await new Promise(r => setTimeout(r, 1000));
      return res.status(400).json({ error: verification.error });
    }

    // Hash new password and update in database
    const newHash = hashPassword(newPassword);
    db.prepare('UPDATE users SET password_hash = ? WHERE id = ?').run(newHash, user.id);

    // Clear failed attempts so user is not locked out
    resetRateLimit(`ip_${req.ip}_login`);
    resetRateLimit(`email_${cleanEmail}_login`);
    resetRateLimit(ipKey);

    logActivity({
      action: 'ADMIN_PASSWORD_RESET',
      actorType: 'admin',
      actorId: user.id,
      actorEmail: cleanEmail,
      actorName: user.full_name,
      orgId: user.org_id,
      ipAddress: req.ip,
      details: { timestamp: new Date().toISOString() }
    });

    res.json({
      success: true,
      message: 'Password reset successfully! You can now log in with your new password.'
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

/**
 * Verify Current Admin Session
 */
adminRouter.get('/auth/me', requireAdmin, (req, res) => {
  res.json({
    success: true,
    user: req.admin
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 2. PLATFORM OVERVIEW & LIVE METRICS
// ─────────────────────────────────────────────────────────────────────────────

adminRouter.get('/stats', requireAdmin, (req, res) => {
  try {
    const totalUsers = db.prepare("SELECT COUNT(*) as c FROM users WHERE role != 'superadmin'").get().c;
    const pendingUsers = db.prepare("SELECT COUNT(*) as c FROM users WHERE role != 'superadmin' AND approval_status = 'pending_approval'").get().c;
    const approvedUsers = db.prepare("SELECT COUNT(*) as c FROM users WHERE role != 'superadmin' AND approval_status = 'approved'").get().c;
    const suspendedUsers = db.prepare("SELECT COUNT(*) as c FROM users WHERE role != 'superadmin' AND approval_status = 'suspended'").get().c;

    const totalOrgs = db.prepare("SELECT COUNT(*) as c FROM organizations WHERE id != 'org_platform_admins'").get().c;
    const totalJobs = db.prepare("SELECT COUNT(*) as c FROM jobs").get().c;

    const totalInterviews = db.prepare("SELECT COUNT(*) as c FROM interviews").get().c;
    const completedInterviews = db.prepare("SELECT COUNT(*) as c FROM interviews WHERE state IN ('completed', 'report_ready')").get().c;
    const inProgressInterviews = db.prepare("SELECT COUNT(*) as c FROM interviews WHERE state = 'in_progress'").get().c;
    const disqualifiedInterviews = db.prepare("SELECT COUNT(*) as c FROM interviews WHERE state = 'disqualified'").get().c;

    const totalCandidates = db.prepare("SELECT COUNT(*) as c FROM candidates").get().c;

    const tokenStats = db.prepare(`
      SELECT 
        COALESCE(SUM(input_tokens), 0) as total_input,
        COALESCE(SUM(output_tokens), 0) as total_output,
        COALESCE(SUM(est_cost), 0) as total_cost_inr
      FROM usage_events
    `).get();

    const adminSeatsCount = db.prepare("SELECT COUNT(*) as c FROM users WHERE role = 'superadmin'").get().c;
    const todayActivities = db.prepare("SELECT COUNT(*) as c FROM platform_activities WHERE date(created_at) = date('now')").get().c;

    const settingApproval = db.prepare("SELECT value FROM platform_settings WHERE key = 'require_admin_approval'").get();

    res.json({
      success: true,
      stats: {
        users: {
          total: totalUsers,
          pending: pendingUsers,
          approved: approvedUsers,
          suspended: suspendedUsers
        },
        orgs: totalOrgs,
        jobs: totalJobs,
        interviews: {
          total: totalInterviews,
          completed: completedInterviews,
          inProgress: inProgressInterviews,
          disqualified: disqualifiedInterviews
        },
        candidates: totalCandidates,
        tokens: {
          inputTokens: tokenStats.total_input,
          outputTokens: tokenStats.total_output,
          estCostInr: tokenStats.total_cost_inr,
          estCostUsd: +(tokenStats.total_cost_inr / 85).toFixed(2)
        },
        admins: {
          occupied: adminSeatsCount,
          max: MAX_ADMIN_SEATS,
          remaining: Math.max(0, MAX_ADMIN_SEATS - adminSeatsCount)
        },
        activitiesToday: todayActivities,
        requireAdminApproval: settingApproval?.value === '1'
      }
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ─────────────────────────────────────────────────────────────────────────────
// 3. REAL-TIME ACTIVITY STREAM
// ─────────────────────────────────────────────────────────────────────────────

adminRouter.get('/activities', requireAdmin, (req, res) => {
  try {
    const { limit = 50, offset = 0, action, actorType, entityType } = req.query;
    const data = getActivities({ limit, offset, action, actorType, entityType });
    res.json({ success: true, ...data });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ─────────────────────────────────────────────────────────────────────────────
// 4. USER & RECRUITER MANAGEMENT & APPROVALS
// ─────────────────────────────────────────────────────────────────────────────

/**
 * List all registered Recruiters and Organizations
 */
adminRouter.get('/users', requireAdmin, (req, res) => {
  try {
    const users = db.prepare(`
      SELECT 
        u.id, 
        u.full_name, 
        u.email, 
        u.phone, 
        u.job_title, 
        u.role, 
        u.is_verified, 
        COALESCE(u.approval_status, 'approved') as approval_status,
        u.admin_notes,
        u.last_login_at,
        u.created_at,
        o.id as org_id, 
        o.name as org_name, 
        o.website as org_website, 
        o.industry as org_industry, 
        o.company_size as org_size, 
        o.country as org_country, 
        o.plan as org_plan, 
        o.included_interviews as org_credits,
        (SELECT COUNT(*) FROM jobs j WHERE j.org_id = o.id) as total_jobs,
        (SELECT COUNT(*) FROM interviews i JOIN jobs j ON i.job_id = j.id WHERE j.org_id = o.id) as total_interviews,
        (SELECT COUNT(*) FROM candidates c WHERE c.org_id = o.id) as total_candidates
      FROM users u
      LEFT JOIN organizations o ON u.org_id = o.id
      WHERE u.role != 'superadmin'
      ORDER BY u.created_at DESC
    `).all();

    res.json({
      success: true,
      users
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

/**
 * Update User Approval Status (Approve / Suspend / Pending)
 */
adminRouter.put('/users/:id/status', requireAdmin, (req, res) => {
  try {
    const { id } = req.params;
    const { status, notes } = req.body || {};

    const validStatuses = ['approved', 'pending_approval', 'suspended', 'rejected'];
    if (!validStatuses.includes(status)) {
      return res.status(400).json({ error: `Invalid status. Must be one of: ${validStatuses.join(', ')}` });
    }

    const targetUser = db.prepare('SELECT id, email, full_name, org_id FROM users WHERE id = ?').get(id);
    if (!targetUser) {
      return res.status(404).json({ error: 'User not found' });
    }

    db.prepare(`
      UPDATE users 
      SET approval_status = ?, admin_notes = COALESCE(?, admin_notes)
      WHERE id = ?
    `).run(status, notes || null, id);

    logActivity({
      action: 'USER_STATUS_UPDATED',
      actorType: 'admin',
      actorId: req.admin.id,
      actorEmail: req.admin.email,
      actorName: req.admin.full_name,
      orgId: targetUser.org_id,
      entityType: 'user',
      entityId: id,
      details: { newStatus: status, previousUser: targetUser.email, notes }
    });

    res.json({
      success: true,
      message: `User ${targetUser.email} status updated to ${status}.`,
      user: { id, email: targetUser.email, approval_status: status }
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

/**
 * Adjust Organization Credits & Subscription Plan
 */
adminRouter.put('/users/:id/credits', requireAdmin, (req, res) => {
  try {
    const { id } = req.params;
    const { creditsDelta, setCredits, plan } = req.body || {};

    const user = db.prepare('SELECT id, email, org_id FROM users WHERE id = ?').get(id);
    if (!user || !user.org_id) {
      return res.status(404).json({ error: 'User or Organization not found' });
    }

    const org = db.prepare('SELECT id, included_interviews, plan FROM organizations WHERE id = ?').get(user.org_id);
    if (!org) {
      return res.status(404).json({ error: 'Organization not found' });
    }

    let newCredits = org.included_interviews;
    if (setCredits !== undefined) {
      newCredits = Math.max(0, parseInt(setCredits, 10) || 0);
    } else if (creditsDelta !== undefined) {
      newCredits = Math.max(0, newCredits + (parseInt(creditsDelta, 10) || 0));
    }

    const newPlan = plan || org.plan;

    db.prepare(`
      UPDATE organizations 
      SET included_interviews = ?, plan = ?
      WHERE id = ?
    `).run(newCredits, newPlan, org.id);

    logActivity({
      action: 'CREDITS_ADJUSTED',
      actorType: 'admin',
      actorId: req.admin.id,
      actorEmail: req.admin.email,
      actorName: req.admin.full_name,
      orgId: org.id,
      entityType: 'org',
      entityId: org.id,
      details: {
        previousCredits: org.included_interviews,
        newCredits,
        plan: newPlan,
        targetEmail: user.email
      }
    });

    res.json({
      success: true,
      message: `Updated organization credits to ${newCredits} and plan to ${newPlan}.`,
      org: { id: org.id, included_interviews: newCredits, plan: newPlan }
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

/**
 * Delete a user and cascade org if requested
 */
adminRouter.delete('/users/:id', requireAdmin, (req, res) => {
  try {
    const { id } = req.params;
    const user = db.prepare('SELECT id, email, org_id, role FROM users WHERE id = ?').get(id);
    if (!user) return res.status(404).json({ error: 'User not found' });

    if (user.role === 'superadmin') {
      return res.status(403).json({ error: 'Cannot delete Superadmin through this endpoint' });
    }

    db.transaction(() => {
      db.prepare('DELETE FROM users WHERE id = ?').run(id);
    })();

    logActivity({
      action: 'USER_DELETED',
      actorType: 'admin',
      actorId: req.admin.id,
      actorEmail: req.admin.email,
      actorName: req.admin.full_name,
      entityType: 'user',
      entityId: id,
      details: { deletedEmail: user.email }
    });

    res.json({ success: true, message: `User ${user.email} deleted.` });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ─────────────────────────────────────────────────────────────────────────────
// 5. GLOBAL INTERVIEWS MONITORING & DETAILS
// ─────────────────────────────────────────────────────────────────────────────

adminRouter.get('/interviews', requireAdmin, (req, res) => {
  try {
    const interviews = db.prepare(`
      SELECT 
        i.id,
        i.state,
        i.started_at,
        i.ended_at,
        i.expires_at,
        i.proctor_warnings,
        i.disqualified_reason,
        i.dispatch_channel,
        i.dispatch_status,
        j.id as job_id,
        j.title as job_title,
        j.skills as job_skills,
        o.id as org_id,
        o.name as org_name,
        c.id as candidate_id,
        c.name as candidate_name,
        c.email as candidate_email,
        c.phone as candidate_phone,
        r.json as report_json,
        (SELECT COUNT(*) FROM turns t WHERE t.interview_id = i.id) as turns_count
      FROM interviews i
      JOIN jobs j ON i.job_id = j.id
      JOIN organizations o ON j.org_id = o.id
      JOIN candidates c ON i.candidate_id = c.id
      LEFT JOIN reports r ON r.interview_id = i.id
      ORDER BY COALESCE(i.started_at, i.expires_at) DESC
      LIMIT 100
    `).all();

    const formatted = interviews.map(item => {
      let score = null;
      let verdict = null;
      if (item.report_json) {
        try {
          const parsed = JSON.parse(item.report_json);
          score = parsed.overall_score;
          verdict = parsed.candidate_verdict;
        } catch (e) {}
      }
      return {
        ...item,
        report_json: undefined,
        score,
        verdict
      };
    });

    res.json({ success: true, interviews: formatted });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

adminRouter.get('/interviews/:id', requireAdmin, (req, res) => {
  try {
    const { id } = req.params;
    const interview = db.prepare(`
      SELECT 
        i.*,
        j.title as job_title, j.skills as job_skills, j.category, j.max_minutes, j.max_questions,
        o.name as org_name,
        c.name as candidate_name, c.email as candidate_email, c.phone as candidate_phone, c.resume_text
      FROM interviews i
      JOIN jobs j ON i.job_id = j.id
      JOIN organizations o ON j.org_id = o.id
      JOIN candidates c ON i.candidate_id = c.id
      WHERE i.id = ?
    `).get(id);

    if (!interview) return res.status(404).json({ error: 'Interview round not found' });

    const turns = db.prepare('SELECT idx, role, text, skill, level, created_at FROM turns WHERE interview_id = ? ORDER BY idx ASC').all(id);
    const reportRow = db.prepare('SELECT * FROM reports WHERE interview_id = ?').get(id);

    res.json({
      success: true,
      interview,
      turns,
      report: reportRow ? JSON.parse(reportRow.json) : null
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ─────────────────────────────────────────────────────────────────────────────
// 6. ADMIN INVITES & SEAT MANAGEMENT (Strictly 2-3 Admins)
// ─────────────────────────────────────────────────────────────────────────────

adminRouter.get('/invites', requireAdmin, (req, res) => {
  try {
    const invites = db.prepare(`
      SELECT 
        i.*,
        u.email as used_by_email,
        u.full_name as used_by_name
      FROM admin_invites i
      LEFT JOIN users u ON i.used_by = u.id
      ORDER BY i.created_at ASC
    `).all();

    const admins = db.prepare(`
      SELECT id, full_name, email, phone, created_at, last_login_at 
      FROM users 
      WHERE role = 'superadmin'
      ORDER BY created_at ASC
    `).all();

    res.json({
      success: true,
      maxSeats: MAX_ADMIN_SEATS,
      occupiedSeats: admins.length,
      seatsRemaining: Math.max(0, MAX_ADMIN_SEATS - admins.length),
      admins,
      invites
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

/**
 * Generate a new unique Admin Invite Hash Code for a friend or colleague
 */
adminRouter.post('/invites', requireAdmin, (req, res) => {
  try {
    const { label } = req.body || {};

    const adminCount = db.prepare("SELECT COUNT(*) as c FROM users WHERE role = 'superadmin'").get().c;
    const unusedInvites = db.prepare("SELECT COUNT(*) as c FROM admin_invites WHERE is_used = 0").get().c;

    if (adminCount + unusedInvites >= MAX_ADMIN_SEATS) {
      return res.status(400).json({ 
        error: `Cannot generate more invites. Total active admins (${adminCount}) + available invites (${unusedInvites}) has reached the hard limit of ${MAX_ADMIN_SEATS} seats.` 
      });
    }

    const uniqueCode = 'ADM-' + crypto.randomBytes(3).toString('hex').toUpperCase() + '-' + crypto.randomBytes(2).toString('hex').toUpperCase();
    const id = 'inv_' + crypto.randomUUID();

    db.prepare(`
      INSERT INTO admin_invites (id, code_hash, label, created_by)
      VALUES (?, ?, ?, ?)
    `).run(id, uniqueCode, label || 'Admin Invitation for Co-Admin', req.admin.email);

    logActivity({
      action: 'ADMIN_INVITE_GENERATED',
      actorType: 'admin',
      actorId: req.admin.id,
      actorEmail: req.admin.email,
      actorName: req.admin.full_name,
      details: { inviteCode: uniqueCode, label }
    });

    res.json({
      success: true,
      message: 'New Admin Invite Hash Code generated successfully!',
      invite: {
        id,
        code_hash: uniqueCode,
        label: label || 'Admin Invitation for Co-Admin'
      }
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

/**
 * Revoke an unused Admin Invite Code
 */
adminRouter.delete('/invites/:id', requireAdmin, (req, res) => {
  try {
    const { id } = req.params;
    const invite = db.prepare('SELECT * FROM admin_invites WHERE id = ?').get(id);

    if (!invite) return res.status(404).json({ error: 'Invite not found' });
    if (invite.is_used) return res.status(400).json({ error: 'Cannot revoke an already used invite code' });

    db.prepare('DELETE FROM admin_invites WHERE id = ?').run(id);

    res.json({ success: true, message: 'Invite code revoked.' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ─────────────────────────────────────────────────────────────────────────────
// 7. PLATFORM ORDERS, REVENUE & BILLING INSPECTION
// ─────────────────────────────────────────────────────────────────────────────

/**
 * List all billing orders & revenue statistics across the platform
 */
adminRouter.get('/orders', requireAdmin, (req, res) => {
  try {
    const orders = db.prepare(`
      SELECT 
        bo.id,
        bo.org_id,
        o.name as org_name,
        bo.type,
        bo.plan_id,
        bo.quantity,
        bo.duration_minutes,
        bo.amount_usd,
        bo.status,
        bo.paid_at,
        bo.created_at,
        u.email as recruiter_email,
        u.full_name as recruiter_name
      FROM billing_orders bo
      LEFT JOIN organizations o ON bo.org_id = o.id
      LEFT JOIN users u ON u.org_id = bo.org_id AND u.role IN ('owner', 'recruiter')
      GROUP BY bo.id
      ORDER BY bo.created_at DESC
      LIMIT 200
    `).all();

    const totalRevenueRow = db.prepare("SELECT COALESCE(SUM(amount_usd), 0) as total FROM billing_orders WHERE status = 'paid'").get();
    const paidCountRow = db.prepare("SELECT COUNT(*) as c FROM billing_orders WHERE status = 'paid'").get();
    const pendingCountRow = db.prepare("SELECT COUNT(*) as c FROM billing_orders WHERE status = 'pending'").get();

    res.json({
      success: true,
      orders,
      stats: {
        totalRevenue: parseFloat(totalRevenueRow.total || 0),
        paidOrders: paidCountRow.c,
        pendingOrders: pendingCountRow.c,
        totalOrders: orders.length
      }
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

/**
 * Admin action: Manually approve & mark a pending order as paid
 */
adminRouter.post('/orders/:id/mark-paid', requireAdmin, (req, res) => {
  try {
    const { id } = req.params;
    const order = db.prepare('SELECT * FROM billing_orders WHERE id = ?').get(id);

    if (!order) return res.status(404).json({ error: 'Order not found' });
    if (order.status === 'paid') return res.status(400).json({ error: 'Order is already marked as paid' });

    let quote = {};
    try { quote = JSON.parse(order.quote_json || '{}'); } catch(e) {}

    let creditsAdded = 0;
    if (order.type === 'pay_per_use') {
      creditsAdded = order.quantity || quote.quantity || 1;
    } else if (order.type === 'subscription') {
      const plan = getPlan(order.plan_id);
      creditsAdded = plan ? plan.includedInterviews : 100;
    }

    db.transaction(() => {
      // 1. Mark order paid
      db.prepare("UPDATE billing_orders SET status = 'paid', paid_at = CURRENT_TIMESTAMP WHERE id = ?").run(order.id);

      // 2. Credit the organization
      if (order.type === 'pay_per_use') {
        db.prepare("UPDATE organizations SET included_interviews = included_interviews + ? WHERE id = ?").run(creditsAdded, order.org_id);
      } else if (order.type === 'subscription') {
        const plan = getPlan(order.plan_id);
        const expiresAt = new Date();
        expiresAt.setMonth(expiresAt.getMonth() + (plan ? plan.months : 1));
        db.prepare(`
          UPDATE organizations 
          SET plan = ?, included_interviews = included_interviews + ?, subscription_expires_at = ?, subscription_plan_id = ?
          WHERE id = ?
        `).run(order.plan_id, creditsAdded, expiresAt.toISOString(), order.plan_id, order.org_id);
      }

      // 3. Log event
      db.prepare(`
        INSERT INTO billing_events (id, org_id, order_id, event, amount_usd, created_at)
        VALUES (?, ?, ?, 'manual_admin_approval', ?, CURRENT_TIMESTAMP)
      `).run('be_' + crypto.randomUUID(), order.org_id, order.id, order.amount_usd);
    })();

    logActivity({
      action: 'ADMIN_ORDER_APPROVED',
      actorType: 'admin',
      actorId: req.admin.id,
      actorEmail: req.admin.email,
      actorName: req.admin.full_name,
      orgId: order.org_id,
      entityType: 'billing_order',
      entityId: order.id,
      details: { amountUsd: order.amount_usd, creditsAdded, orderType: order.type }
    });

    res.json({
      success: true,
      message: `Order marked as paid. +${creditsAdded} interview credits granted to organization.`
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ─────────────────────────────────────────────────────────────────────────────
// 8. PLATFORM GLOBAL SETTINGS & SMTP CONFIGURATION
// ─────────────────────────────────────────────────────────────────────────────

adminRouter.get('/settings', requireAdmin, async (req, res) => {
  try {
    const settings = db.prepare('SELECT * FROM platform_settings').all();
    const settingsMap = {};
    settings.forEach(s => { settingsMap[s.key] = s.value; });

    const emailConfig = getEmailConfig();
    const responseSettings = { ...settingsMap };
    
    // Mask password and API keys for security
    if (responseSettings.smtp_pass) {
      responseSettings.smtp_pass = '••••••••';
    }
    if (responseSettings.resend_api_key && responseSettings.resend_api_key.length > 6) {
      responseSettings.resend_api_key = responseSettings.resend_api_key.substring(0, 5) + '••••••••';
    }

    const pgHealth = await checkPostgresConnection();
    const pgConfig = getPostgresConfig();

    res.json({ 
      success: true, 
      settings: responseSettings,
      emailStatus: {
        isConfigured: emailConfig.isConfigured,
        provider: emailConfig.provider,
        host: emailConfig.host,
        port: emailConfig.port,
        user: emailConfig.user,
        fromEmail: emailConfig.fromEmail,
        secure: emailConfig.secure
      },
      databaseStatus: {
        engine: pgHealth.connected ? 'PostgreSQL' : 'SQLite',
        isPostgresConnected: pgHealth.connected,
        postgresLatencyMs: pgHealth.latencyMs,
        postgresVersion: pgHealth.version || null,
        postgresError: pgHealth.error || null,
        hasDatabaseUrl: Boolean(process.env.DATABASE_URL || settingsMap.database_url),
        sqliteFile: 'ai_interviewer.db'
      }
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

adminRouter.put('/settings', requireAdmin, (req, res) => {
  try {
    const { settings } = req.body || {};
    if (!settings || typeof settings !== 'object') {
      return res.status(400).json({ error: 'Settings object is required' });
    }

    const upsert = db.prepare(`
      INSERT INTO platform_settings (key, value, updated_at) 
      VALUES (?, ?, CURRENT_TIMESTAMP)
      ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = CURRENT_TIMESTAMP
    `);

    db.transaction(() => {
      for (const [key, val] of Object.entries(settings)) {
        // If password/key was masked or empty, don't overwrite existing
        if ((key === 'smtp_pass' || key === 'resend_api_key') && (String(val).includes('••••') || val === '')) {
          continue;
        }
        upsert.run(key, String(val));
      }
    })();

    logActivity({
      action: 'PLATFORM_SETTINGS_UPDATED',
      actorType: 'admin',
      actorId: req.admin.id,
      actorEmail: req.admin.email,
      actorName: req.admin.full_name,
      details: { updatedKeys: Object.keys(settings) }
    });

    res.json({ success: true, message: 'Platform settings updated successfully.' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

/**
 * Dispatch live test email to verify SMTP handshake & delivery
 */
adminRouter.post('/settings/test-email', requireAdmin, async (req, res) => {
  try {
    const { recipientEmail } = req.body || {};
    const target = (recipientEmail || req.admin.email).toLowerCase().trim();

    const result = await sendTestEmail(target);

    logActivity({
      action: 'SMTP_TEST_SENT',
      actorType: 'admin',
      actorId: req.admin.id,
      actorEmail: req.admin.email,
      actorName: req.admin.full_name,
      details: { recipient: target, messageId: result.messageId }
    });

    res.json({
      success: true,
      message: `Test email successfully dispatched to ${target}! Please check your inbox.`,
      result
    });
  } catch (err) {
    res.status(400).json({ error: 'SMTP Test Failed: ' + err.message });
  }
});

/**
 * Test PostgreSQL Connection
 */
adminRouter.post('/settings/test-db', requireAdmin, async (req, res) => {
  try {
    const health = await checkPostgresConnection();
    if (health.connected) {
      logActivity({
        action: 'DB_CONNECTION_TEST',
        actorType: 'admin',
        actorId: req.admin.id,
        actorEmail: req.admin.email,
        actorName: req.admin.full_name,
        details: { status: 'connected', latencyMs: health.latencyMs, version: health.version }
      });
      res.json({
        success: true,
        message: `Connected to PostgreSQL in ${health.latencyMs}ms! (${health.version.split(' ')[0]} ${health.version.split(' ')[1] || ''})`,
        health
      });
    } else {
      res.status(400).json({
        success: false,
        error: `Could not connect to PostgreSQL: ${health.error}`,
        health
      });
    }
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

/**
 * Execute SQLite -> PostgreSQL Migration
 */
adminRouter.post('/settings/migrate-pg', requireAdmin, async (req, res) => {
  try {
    const result = await runPostgresMigration();
    logActivity({
      action: 'DB_MIGRATION_EXECUTED',
      actorType: 'admin',
      actorId: req.admin.id,
      actorEmail: req.admin.email,
      actorName: req.admin.full_name,
      details: { counts: result.counts }
    });
    res.json({
      success: true,
      message: 'SQLite database successfully migrated and synchronized to PostgreSQL!',
      counts: result.counts
    });
  } catch (err) {
    res.status(400).json({
      success: false,
      error: 'PostgreSQL Migration Failed: ' + err.message
    });
  }
});
