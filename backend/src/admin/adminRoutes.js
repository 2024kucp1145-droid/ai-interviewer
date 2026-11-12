import express from 'express';
import crypto from 'crypto';
import { db } from '../db/database.js';
import {
  hashPassword,
  comparePassword,
  signToken,
  verifyToken,
  createSignedAdminProfileReceipt,
  verifySignedAdminProfileReceipt
} from '../auth/auth.js';
import { logActivity, getActivities } from '../services/activityService.js';
import { generateAndSendAdminOtp, verifyAdminOtp } from '../services/adminOtpService.js';
import { sendTestEmail, getSmtpConfig, sendPlatformEmail } from '../services/emailService.js';
import { getPlan } from '../billing/pricing.js';
import { checkPostgresConnection, getPostgresConfig } from '../db/postgres.js';
import { runMigration as runPostgresMigration } from '../db/migrateToPostgres.js';

export const adminRouter = express.Router();

function generateReadableAdminId(fullName) {
  const firstWord = (fullName || 'ADMIN').trim().split(/\s+/)[0] || 'ADMIN';
  const cleanPrefix = firstWord.replace(/[^a-zA-Z0-9]/g, '').toUpperCase().slice(0, 8) || 'ADMIN';
  for (let i = 0; i < 25; i++) {
    const digits = crypto.randomInt(1000, 9999);
    const candidate = `ADM-${cleanPrefix}-${digits}`;
    const existing = db.prepare('SELECT 1 FROM users WHERE UPPER(admin_uid) = UPPER(?)').get(candidate);
    if (!existing) return candidate;
  }
  return `ADM-${cleanPrefix}-${crypto.randomBytes(3).toString('hex').toUpperCase()}`;
}

function maskEmail(email) {
  const parts = (email || '').split('@');
  if (parts.length !== 2) return email || '';
  const [local, domain] = parts;
  const visible = local.slice(0, Math.min(2, local.length));
  return `${visible}${'*'.repeat(Math.max(2, local.length - visible.length))}@${domain}`;
}

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

function canUseOtpFallback() {
  return !getSmtpConfig().isConfigured || process.env.ALLOW_DEV_OTP === 'true';
}

function rehydrateAdminFromClaims(claims) {
  if (!claims?.email || !claims?.admin_uid) return null;
  const cleanEmail = String(claims.email).toLowerCase().trim();
  const cleanUid = String(claims.admin_uid).toUpperCase();
  const existing = db.prepare(`
    SELECT id, org_id, full_name, email, admin_uid, role, is_verified, approval_status
    FROM users WHERE email = ?
  `).get(cleanEmail);

  if (existing) {
    if (existing.role !== 'superadmin') return { conflictNonAdmin: true };
    if (!existing.admin_uid && cleanUid) {
      db.prepare('UPDATE users SET admin_uid = ? WHERE id = ?').run(cleanUid, existing.id);
      existing.admin_uid = cleanUid;
    }
    return existing;
  }

  const orgId = claims.org_id || 'org_platform_admins';
  const adminId = claims.id || ('usr_adm_' + crypto.randomUUID());
  db.prepare(`
    INSERT OR IGNORE INTO organizations (id, name, industry, plan, included_interviews)
    VALUES (?, 'Platform Operations & Administration', 'Platform Management', 'enterprise', 999999)
  `).run(orgId);
  db.prepare(`
    INSERT OR IGNORE INTO users (
      id, org_id, full_name, job_title, email, password_hash, role, admin_uid, is_verified, approval_status
    ) VALUES (?, ?, ?, 'Platform Administrator', ?, 'ephemeral-vercel-session', 'superadmin', ?, 1, 'approved')
  `).run(
    adminId,
    orgId,
    claims.full_name || claims.fullName || 'Platform Administrator',
    cleanEmail,
    cleanUid
  );
  return db.prepare(`
    SELECT id, org_id, full_name, email, admin_uid, role, is_verified, approval_status
    FROM users WHERE email = ? AND role = 'superadmin'
  `).get(cleanEmail);
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
    if (!decoded) {
      return res.status(401).json({ error: 'Admin session expired or invalid. Please log in again.' });
    }
    if (decoded.role !== 'superadmin') {
      return res.status(403).json({ error: 'Access denied: Super Administrator privileges required' });
    }

    let adminUser = db.prepare(`
      SELECT id, org_id, full_name, email, admin_uid, role, is_verified, approval_status 
      FROM users 
      WHERE id = ? AND role = 'superadmin'
    `).get(decoded.id);

    // Adopt matching superadmin email or rehydrate ephemeral Vercel /tmp cold starts
    if (!adminUser && decoded.email) {
      const cleanEmail = decoded.email.toLowerCase().trim();
      const byEmail = db.prepare(`
        SELECT id, org_id, full_name, email, admin_uid, role, is_verified, approval_status
        FROM users WHERE email = ?
      `).get(cleanEmail);

      if (byEmail && byEmail.role !== 'superadmin') {
        return res.status(403).json({ error: 'Access denied: Super Administrator privileges required' });
      }
      if (byEmail) {
        adminUser = byEmail;
      } else if (process.env.VERCEL && decoded.admin_uid) {
        const rehydrated = rehydrateAdminFromClaims(decoded);
        if (rehydrated?.conflictNonAdmin) {
          return res.status(403).json({ error: 'Access denied: Super Administrator privileges required' });
        }
        adminUser = rehydrated;
      }
    }

    if (!adminUser) {
      return res.status(401).json({ error: 'Admin account not found or session reset. Please sign in.' });
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
// 1. ADMIN AUTHENTICATION & UNIQUE ADMIN ID ONBOARDING
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Public check for Platform Admin Registration Status
 */
adminRouter.get('/auth/status', (req, res) => {
  try {
    const adminCount = db.prepare("SELECT COUNT(*) as c FROM users WHERE role = 'superadmin'").get().c;

    res.json({
      success: true,
      unlimited: true,
      maxSeats: null,
      registeredAdmins: adminCount,
      canRegister: true
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

/**
 * Step 1: Admin Registration Request
 * Accepts Name, Email, and Password (no invite code or seat limit). Dispatches 6-digit Email OTP.
 */
adminRouter.post('/auth/register-request', async (req, res) => {
  const ipKey = `reg_${req.ip}`;
  const rateCheck = checkRateLimit(ipKey, 10, 15 * 60 * 1000);
  if (!rateCheck.allowed) {
    return res.status(429).json({
      error: `Security Lockout: Too many registration attempts. Please wait ${rateCheck.remainingSec}s.`
    });
  }

  try {
    const { email, fullName, password } = req.body || {};
    const cleanName = (fullName || '').trim();
    const cleanEmail = (email || '').toLowerCase().trim();

    if (!cleanName || cleanName.length < 2) {
      return res.status(400).json({ error: 'Full Name (at least 2 characters) is required.' });
    }
    if (!cleanEmail || !cleanEmail.includes('@')) {
      return res.status(400).json({ error: 'A valid admin email address is required.' });
    }
    if (!password || password.length < 8) {
      return res.status(400).json({ error: 'Password must be at least 8 characters long.' });
    }

    const existing = db.prepare('SELECT id, role, full_name, admin_uid FROM users WHERE email = ?').get(cleanEmail);
    if (existing) {
      if (existing.role === 'superadmin') {
        return res.status(400).json({
          error: `This email (${cleanEmail}) is already registered as an Admin (ID: ${existing.admin_uid || 'Assigned'}). Switch to Admin Login using your Name and Unique ID.`,
          isAlreadyRegistered: true,
          email: cleanEmail,
          adminUid: existing.admin_uid,
          fullName: existing.full_name
        });
      }
      return res.status(400).json({ error: 'An account with this email already exists on the platform.' });
    }

    const otpResult = await generateAndSendAdminOtp(cleanEmail, 'signup_verify', cleanName);

    res.json({
      success: true,
      message: otpResult.emailSent
        ? `Done — mail sent to ${cleanEmail}.`
        : `Email delivery fallback active: Enter 000000 (or check server console) to complete registration.`,
      email: cleanEmail,
      emailSent: otpResult.emailSent,
      otpToken: otpResult.otpToken,
      forwardedTo: otpResult.forwardedTo || null,
      fallbackOtp: !otpResult.emailSent ? '000000' : undefined
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

/**
 * Step 2: Verify OTP, Create Admin Account & Generate Readable Unique Admin ID
 */
adminRouter.post('/auth/register-verify', async (req, res) => {
  const ipKey = `reg_${req.ip}`;
  const rateCheck = checkRateLimit(ipKey, 10, 15 * 60 * 1000);
  if (!rateCheck.allowed) {
    return res.status(429).json({ error: `Too many verification attempts. Please wait ${rateCheck.remainingSec}s.` });
  }

  try {
    const { email, otp, fullName, password, phone, otpToken } = req.body || {};
    const cleanName = (fullName || '').trim();
    const cleanEmail = (email || '').toLowerCase().trim();

    if (!cleanName || !cleanEmail || !otp || !password) {
      return res.status(400).json({ error: 'Name, email, password, and OTP are required.' });
    }

    const existing = db.prepare('SELECT id FROM users WHERE email = ?').get(cleanEmail);
    if (existing) {
      return res.status(400).json({ error: 'An account with this email already exists.' });
    }

    const isMasterBypass = canUseOtpFallback() && (otp.trim() === '000000');
    const verification = isMasterBypass ? { valid: true } : verifyAdminOtp(cleanEmail, otp, 'signup_verify', otpToken);
    if (!verification.valid) {
      recordFailure(ipKey, 10, 15 * 60 * 1000);
      await new Promise(r => setTimeout(r, 800));
      return res.status(400).json({ error: verification.error });
    }

    resetRateLimit(ipKey);

    const adminUserId = 'usr_adm_' + crypto.randomUUID();
    const adminOrgId = 'org_platform_admins';
    const adminUid = generateReadableAdminId(cleanName);
    const passHash = hashPassword(password);

    db.transaction(() => {
      db.prepare(`
        INSERT OR IGNORE INTO organizations (id, name, industry, plan, included_interviews)
        VALUES (?, 'Platform Operations & Administration', 'Platform Management', 'enterprise', 999999)
      `).run(adminOrgId);

      db.prepare(`
        INSERT INTO users (
          id, org_id, full_name, phone, job_title, email, password_hash, 
          role, admin_uid, is_verified, approval_status, last_login_at
        ) VALUES (?, ?, ?, ?, 'Platform Administrator', ?, ?, 'superadmin', ?, 1, 'approved', CURRENT_TIMESTAMP)
      `).run(
        adminUserId,
        adminOrgId,
        cleanName,
        (phone || '').trim(),
        cleanEmail,
        passHash,
        adminUid
      );
    })();

    logActivity({
      action: 'ADMIN_REGISTERED',
      actorType: 'admin',
      actorId: adminUserId,
      actorEmail: cleanEmail,
      actorName: cleanName,
      orgId: adminOrgId,
      entityType: 'user',
      entityId: adminUserId,
      details: { adminUid }
    });

    try {
      await sendPlatformEmail({
        to: cleanEmail,
        subject: `Welcome to RoundOne AI Admin — Your Unique ID: ${adminUid}`,
        html: `
          <div style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; max-width: 520px; margin: 0 auto; padding: 24px; background: #0f172a; color: #f8fafc; border-radius: 12px;">
            <h2 style="margin: 0 0 8px; color: #ffffff;">Welcome, ${cleanName}!</h2>
            <p style="color: #94a3b8; font-size: 14px; margin: 0 0 18px;">Your RoundOne AI Superadmin portal account is active.</p>
            <div style="background: #1e293b; border: 1px solid #334155; border-radius: 8px; padding: 16px; margin-bottom: 18px;">
              <div style="font-size: 12px; color: #94a3b8; margin-bottom: 4px;">Your Unique Admin ID (Required for Login):</div>
              <div style="font-family: 'Courier New', monospace; font-size: 22px; font-weight: 800; color: #818cf8; letter-spacing: 1px;">${adminUid}</div>
            </div>
            <p style="font-size: 13px; color: #cbd5e1; margin: 0;">Whenever you sign in, enter your Name (<strong>${cleanName}</strong>) and Unique Admin ID (<strong>${adminUid}</strong>). We will send an OTP to <strong>${cleanEmail}</strong>.</p>
          </div>
        `
      });
    } catch (emailErr) {
      console.warn('Welcome email notice:', emailErr.message);
    }

    const adminProfilePayload = {
      id: adminUserId,
      org_id: adminOrgId,
      email: cleanEmail,
      full_name: cleanName,
      admin_uid: adminUid,
      role: 'superadmin'
    };
    const token = signToken(adminProfilePayload);
    const profileToken = createSignedAdminProfileReceipt(adminProfilePayload);

    res.json({
      success: true,
      message: 'Super Administrator account created and verified successfully!',
      token,
      profileToken,
      adminUid,
      user: {
        id: adminUserId,
        fullName: cleanName,
        email: cleanEmail,
        admin_uid: adminUid,
        role: 'superadmin'
      }
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

/**
 * Step 1 for Login: Validate Admin Name & Unique Admin ID, look up linked email, and send Email OTP.
 * Hardened with IP & ID rate limiting against brute-force attacks.
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
    const { name, fullName, adminId, admin_uid, profileToken } = req.body || {};
    const cleanName = (name || fullName || '').trim().replace(/\s+/g, ' ');
    const cleanAdminId = (adminId || admin_uid || '').trim().toUpperCase();

    if (!cleanName || !cleanAdminId) {
      recordFailure(ipKey, 5, 15 * 60 * 1000);
      return res.status(400).json({ error: 'Admin Name and Unique Admin ID are required.' });
    }

    const idKey = `id_${cleanAdminId}_login`;
    const idRate = checkRateLimit(idKey, 5, 15 * 60 * 1000);
    if (!idRate.allowed) {
      return res.status(429).json({
        error: `Security Lockout: Account temporarily locked due to excessive failed attempts. Please wait ${idRate.remainingSec}s.`
      });
    }

    let user = db.prepare("SELECT * FROM users WHERE UPPER(admin_uid) = UPPER(?) AND role = 'superadmin'").get(cleanAdminId);

    // Recover verified admin on cold serverless instances using signed profile receipt when Name & ID match
    if (!user && profileToken) {
      const receipt = verifySignedAdminProfileReceipt(profileToken);
      const receiptName = (receipt?.full_name || '').trim().replace(/\s+/g, ' ').toLowerCase();
      if (receipt && receipt.admin_uid === cleanAdminId && receiptName === cleanName.toLowerCase()) {
        const rehydrated = rehydrateAdminFromClaims(receipt);
        if (rehydrated && !rehydrated.conflictNonAdmin) {
          user = rehydrated;
        }
      }
    }

    const dbNormalizedName = (user?.full_name || '').trim().replace(/\s+/g, ' ').toLowerCase();
    if (!user || dbNormalizedName !== cleanName.toLowerCase()) {
      recordFailure(ipKey, 5, 15 * 60 * 1000);
      recordFailure(idKey, 5, 15 * 60 * 1000);
      logActivity({
        action: 'FAILED_ADMIN_LOGIN',
        actorName: cleanName,
        ipAddress: req.ip,
        details: { attemptedAdminId: cleanAdminId, reason: 'Invalid Name or Unique Admin ID' }
      });
      await new Promise(r => setTimeout(r, 800));
      return res.status(401).json({ error: 'Invalid Admin Name or Unique Admin ID.' });
    }

    if (user.approval_status === 'suspended') {
      return res.status(403).json({ error: 'This admin account has been suspended.' });
    }

    const otpResult = await generateAndSendAdminOtp(user.email, 'login_verify', user.full_name);

    res.json({
      success: true,
      message: otpResult.emailSent
        ? `Done — mail sent to ${maskEmail(user.email)}.`
        : `Email delivery notice: Enter fallback code 000000 to log in.`,
      adminUid: user.admin_uid,
      name: user.full_name,
      emailHint: maskEmail(user.email),
      emailSent: otpResult.emailSent,
      otpToken: otpResult.otpToken,
      profileToken: createSignedAdminProfileReceipt(user),
      forwardedTo: otpResult.forwardedTo || null,
      fallbackOtp: !otpResult.emailSent ? '000000' : undefined
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

/**
 * Step 2 for Login: Verify Email OTP via Unique Admin ID & Return Admin JWT Token
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
    const { adminId, admin_uid, otp, otpToken, profileToken } = req.body || {};
    const cleanAdminId = (adminId || admin_uid || '').trim().toUpperCase();

    if (!cleanAdminId || !otp) {
      return res.status(400).json({ error: 'Unique Admin ID and OTP code are required.' });
    }

    const idKey = `id_${cleanAdminId}_login`;
    let user = db.prepare("SELECT * FROM users WHERE UPPER(admin_uid) = UPPER(?) AND role = 'superadmin'").get(cleanAdminId);
    if (!user && profileToken) {
      const receipt = verifySignedAdminProfileReceipt(profileToken);
      if (receipt && receipt.admin_uid === cleanAdminId) {
        const rehydrated = rehydrateAdminFromClaims(receipt);
        if (rehydrated && !rehydrated.conflictNonAdmin) {
          user = rehydrated;
        }
      }
    }
    if (!user) {
      return res.status(404).json({ error: 'Admin user not found.' });
    }

    const isMasterBypass = canUseOtpFallback() && (otp.trim() === '000000');
    const verification = isMasterBypass ? { valid: true } : verifyAdminOtp(user.email, otp, 'login_verify', otpToken);
    if (!verification.valid) {
      recordFailure(ipKey, 5, 15 * 60 * 1000);
      recordFailure(idKey, 5, 15 * 60 * 1000);
      await new Promise(r => setTimeout(r, 800));
      return res.status(400).json({ error: verification.error });
    }

    resetRateLimit(ipKey);
    resetRateLimit(idKey);

    db.prepare('UPDATE users SET last_login_at = CURRENT_TIMESTAMP WHERE id = ?').run(user.id);

    logActivity({
      action: 'ADMIN_LOGIN',
      actorType: 'admin',
      actorId: user.id,
      actorEmail: user.email,
      actorName: user.full_name,
      orgId: user.org_id,
      ipAddress: req.ip,
      details: { adminUid: user.admin_uid, timestamp: new Date().toISOString() }
    });

    const token = signToken({
      id: user.id,
      org_id: user.org_id,
      email: user.email,
      full_name: user.full_name,
      admin_uid: user.admin_uid,
      role: 'superadmin'
    });
    const refreshedProfileToken = createSignedAdminProfileReceipt(user);

    res.json({
      success: true,
      token,
      profileToken: refreshedProfileToken,
      user: {
        id: user.id,
        fullName: user.full_name,
        email: user.email,
        admin_uid: user.admin_uid,
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
      message: otpResult.emailSent
        ? `Done — mail sent to ${cleanEmail}.`
        : 'Enter the 6-digit reset code to continue.',
      email: cleanEmail,
      emailSent: otpResult.emailSent,
      otpToken: otpResult.otpToken
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
    const { email, otp, newPassword, otpToken } = req.body || {};
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

    const isMasterBypass = canUseOtpFallback() && (otp.trim() === '000000');
    const verification = isMasterBypass ? { valid: true } : verifyAdminOtp(cleanEmail, otp, 'reset_password', otpToken);
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
    const userAgg = db.prepare(`
      SELECT
        SUM(CASE WHEN role != 'superadmin' THEN 1 ELSE 0 END) as total_users,
        SUM(CASE WHEN role != 'superadmin' AND approval_status = 'pending_approval' THEN 1 ELSE 0 END) as pending_users,
        SUM(CASE WHEN role != 'superadmin' AND approval_status = 'approved' THEN 1 ELSE 0 END) as approved_users,
        SUM(CASE WHEN role != 'superadmin' AND approval_status = 'suspended' THEN 1 ELSE 0 END) as suspended_users,
        SUM(CASE WHEN role = 'superadmin' THEN 1 ELSE 0 END) as admin_seats
      FROM users
    `).get();

    const intvAgg = db.prepare(`
      SELECT
        COUNT(*) as total_interviews,
        SUM(CASE WHEN state IN ('completed', 'report_ready') THEN 1 ELSE 0 END) as completed_interviews,
        SUM(CASE WHEN state = 'in_progress' THEN 1 ELSE 0 END) as in_progress_interviews,
        SUM(CASE WHEN state = 'disqualified' THEN 1 ELSE 0 END) as disqualified_interviews,
        SUM(CASE WHEN started_at IS NOT NULL OR state IN ('in_progress','completed','report_ready','disqualified') THEN 1 ELSE 0 END) as attempted_interviews
      FROM interviews
    `).get();

    const countsAgg = db.prepare(`
      SELECT
        (SELECT COUNT(*) FROM organizations WHERE id != 'org_platform_admins') as total_orgs,
        (SELECT COUNT(*) FROM jobs) as total_jobs,
        (SELECT COUNT(*) FROM candidates) as total_candidates,
        (SELECT COUNT(*) FROM platform_activities WHERE date(created_at) = date('now')) as today_activities,
        (SELECT COUNT(*) FROM feedbacks) as total_feedbacks
    `).get();

    const tokenStats = db.prepare(`
      SELECT 
        COALESCE(SUM(input_tokens), 0) as total_input,
        COALESCE(SUM(output_tokens), 0) as total_output,
        COALESCE(SUM(est_cost), 0) as total_cost_inr
      FROM usage_events
    `).get();

    // Candidate funnel data
    const funnelData = {
      invited: intvAgg.total_interviews || 0,
      attempted: intvAgg.attempted_interviews || 0,
      completed: intvAgg.completed_interviews || 0,
      disqualified: intvAgg.disqualified_interviews || 0,
      live: intvAgg.in_progress_interviews || 0,
      pending: Math.max(0, (intvAgg.total_interviews || 0) - (intvAgg.attempted_interviews || 0))
    };

    // Score distribution buckets: 0-10, 10-20, ..., 90-100
    let scoreDistribution = [];
    try {
      scoreDistribution = db.prepare(`
        SELECT
          CASE
            WHEN json_extract(r.json, '$.overall_score') < 10 THEN '0-9'
            WHEN json_extract(r.json, '$.overall_score') < 20 THEN '10-19'
            WHEN json_extract(r.json, '$.overall_score') < 30 THEN '20-29'
            WHEN json_extract(r.json, '$.overall_score') < 40 THEN '30-39'
            WHEN json_extract(r.json, '$.overall_score') < 50 THEN '40-49'
            WHEN json_extract(r.json, '$.overall_score') < 60 THEN '50-59'
            WHEN json_extract(r.json, '$.overall_score') < 70 THEN '60-69'
            WHEN json_extract(r.json, '$.overall_score') < 80 THEN '70-79'
            WHEN json_extract(r.json, '$.overall_score') < 90 THEN '80-89'
            ELSE '90-100'
          END as range,
          COUNT(*) as count
        FROM reports r
        WHERE json_extract(r.json, '$.overall_score') IS NOT NULL
          AND typeof(json_extract(r.json, '$.overall_score')) IN ('integer','real')
        GROUP BY range
        ORDER BY range
      `).all();
    } catch { scoreDistribution = []; }

    // Top 5 active companies
    let topCompanies = [];
    try {
      topCompanies = db.prepare(`
        SELECT o.id, o.name, o.plan, o.included_interviews,
          (SELECT COUNT(*) FROM jobs j WHERE j.org_id = o.id) as job_count,
          (SELECT COUNT(*) FROM interviews i JOIN jobs j2 ON i.job_id = j2.id WHERE j2.org_id = o.id) as interview_count,
          (SELECT COUNT(*) FROM interviews i2 JOIN jobs j3 ON i2.job_id = j3.id WHERE j3.org_id = o.id AND i2.state IN ('completed','report_ready')) as completed_count,
          (SELECT COUNT(*) FROM interviews i3 JOIN jobs j4 ON i3.job_id = j4.id WHERE j4.org_id = o.id AND i3.state = 'in_progress') as live_count
        FROM organizations o
        WHERE o.id != 'org_platform_admins'
        ORDER BY interview_count DESC
        LIMIT 5
      `).all();
    } catch { topCompanies = []; }

    // Quick action items
    const quickActions = [];
    try {
      const liveCount = intvAgg.in_progress_interviews || 0;
      if (liveCount > 0) quickActions.push({ type: 'live', label: `${liveCount} interview(s) happening right now`, icon: 'broadcast', tone: 'warning' });
      const pendingUsers = userAgg.pending_users || 0;
      if (pendingUsers > 0) quickActions.push({ type: 'approval', label: `${pendingUsers} recruiter(s) awaiting approval`, icon: 'person-check', tone: 'danger' });
      const expiringCount = db.prepare(`SELECT COUNT(*) as c FROM interviews WHERE state = 'created' AND expires_at IS NOT NULL AND datetime(expires_at) < datetime('now', '+24 hours') AND datetime(expires_at) > datetime('now')`).get()?.c || 0;
      if (expiringCount > 0) quickActions.push({ type: 'expiring', label: `${expiringCount} interview link(s) expiring in 24h`, icon: 'clock-history', tone: 'warning' });
      const feedbacksToday = db.prepare(`SELECT COUNT(*) as c FROM feedbacks WHERE date(created_at) = date('now')`).get()?.c || 0;
      if (feedbacksToday > 0) quickActions.push({ type: 'feedback', label: `${feedbacksToday} new feedback(s) submitted today`, icon: 'chat-heart', tone: 'info' });
    } catch { /* non-critical */ }

    // Average score
    let avgScore = null;
    try {
      const avg = db.prepare(`SELECT AVG(json_extract(r.json, '$.overall_score')) as avg_score FROM reports r WHERE json_extract(r.json, '$.overall_score') IS NOT NULL AND typeof(json_extract(r.json, '$.overall_score')) IN ('integer','real')`).get();
      if (avg?.avg_score !== null && avg?.avg_score !== undefined) avgScore = Math.round(avg.avg_score);
    } catch { /* skip */ }

    // Completion rate
    const completionRate = funnelData.attempted > 0 ? Math.round((funnelData.completed / funnelData.attempted) * 100) : 0;

    const settingApproval = db.prepare("SELECT value FROM platform_settings WHERE key = 'require_admin_approval'").get();

    res.json({
      success: true,
      stats: {
        users: {
          total: userAgg.total_users || 0,
          pending: userAgg.pending_users || 0,
          approved: userAgg.approved_users || 0,
          suspended: userAgg.suspended_users || 0
        },
        orgs: countsAgg.total_orgs || 0,
        jobs: countsAgg.total_jobs || 0,
        interviews: {
          total: intvAgg.total_interviews || 0,
          completed: intvAgg.completed_interviews || 0,
          inProgress: intvAgg.in_progress_interviews || 0,
          disqualified: intvAgg.disqualified_interviews || 0,
          attempted: intvAgg.attempted_interviews || 0
        },
        candidates: countsAgg.total_candidates || 0,
        feedbacks: countsAgg.total_feedbacks || 0,
        tokens: {
          inputTokens: tokenStats.total_input,
          outputTokens: tokenStats.total_output,
          estCostInr: tokenStats.total_cost_inr,
          estCostUsd: +(tokenStats.total_cost_inr / 85).toFixed(2)
        },
        admins: {
          occupied: userAgg.admin_seats || 0,
          max: null,
          remaining: null,
          unlimited: true
        },
        funnel: funnelData,
        scoreDistribution,
        topCompanies,
        quickActions,
        avgScore,
        completionRate,
        activitiesToday: countsAgg.today_activities || 0,
        requireAdminApproval: settingApproval?.value === '1'
      }
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ─────────────────────────────────────────────────────────────────────────────
// 3. REAL-TIME ACTIVITY STREAM & HIERARCHICAL INTERVIEWER FOLDER TREE
// ─────────────────────────────────────────────────────────────────────────────

function safeJsonParse(raw, fallback = null) {
  if (!raw) return fallback;
  if (typeof raw === 'object') return raw;
  try {
    return JSON.parse(raw);
  } catch {
    return fallback;
  }
}

function buildInterviewerActivityTree() {
  const orgRows = db.prepare(`
    SELECT id, name, website, industry, company_size, country, plan, included_interviews, created_at
    FROM organizations
    WHERE id != 'org_platform_admins'
    ORDER BY created_at DESC
  `).all();

  const userRows = db.prepare(`
    SELECT id, org_id, full_name, email, phone, job_title, role, is_verified,
           COALESCE(approval_status, 'approved') as approval_status, admin_notes, last_login_at, created_at
    FROM users
    WHERE role != 'superadmin'
    ORDER BY created_at DESC
  `).all();

  const jobRows = db.prepare(`
    SELECT id, org_id, title, category, skills, experience_required, level, purpose,
           max_minutes, max_questions, custom_questions, assessment_rules,
           selected_threshold, borderline_threshold,
           terminal_required, word_editor_required, resume_required, show_timer, auto_submit_timer, created_at
    FROM jobs
    ORDER BY created_at DESC
  `).all();

  const interviewRows = db.prepare(`
    SELECT
      i.id, i.job_id, i.candidate_id, i.state, i.started_at, i.ended_at, i.expires_at,
      i.link_timer_minutes, i.proctor_warnings, i.disqualified_reason, i.proctor_logs,
      i.dispatch_channel, i.dispatch_status, i.source, i.dsa_result,
      j.org_id as job_org_id,
      c.name as candidate_name, c.email as candidate_email, c.phone as candidate_phone,
      c.resume_text, c.consent_at, c.source as candidate_source, c.created_at as candidate_created_at,
      r.json as report_json, r.model as report_model, r.manual_decision, r.created_at as report_created_at,
      r.reviewed_by, r.reviewer_note,
      (SELECT COUNT(*) FROM turns t WHERE t.interview_id = i.id) as turns_count,
      (SELECT COALESCE(SUM(u.input_tokens + u.output_tokens), 0) FROM usage_events u WHERE u.interview_id = i.id) as tokens_used,
      (SELECT COALESCE(SUM(u.est_cost), 0) FROM usage_events u WHERE u.interview_id = i.id) as est_cost
    FROM interviews i
    JOIN jobs j ON i.job_id = j.id
    JOIN candidates c ON i.candidate_id = c.id
    LEFT JOIN reports r ON r.interview_id = i.id
    ORDER BY COALESCE(i.started_at, i.expires_at, c.created_at) DESC
  `).all();

  const activityRows = db.prepare(`
    SELECT id, action, actor_type, actor_id, actor_email, actor_name, org_id, entity_type, entity_id, details, ip_address, created_at
    FROM platform_activities
    ORDER BY created_at DESC
    LIMIT 500
  `).all().map(a => ({ ...a, details: safeJsonParse(a.details, a.details) }));

  const orderRows = db.prepare(`
    SELECT id, org_id, type, plan_id, quantity, duration_minutes, amount_usd, status, paid_at, created_at
    FROM billing_orders
    ORDER BY created_at DESC
    LIMIT 250
  `).all();

  const feedbackRows = db.prepare(`
    SELECT id, user_name, user_email, rating, category, message, source_page, email_sent, created_at
    FROM feedbacks
    ORDER BY created_at DESC
    LIMIT 200
  `).all();

  const orgMap = new Map();
  const emailToOrgId = new Map();
  const userByIdMap = new Map();
  const userByEmailMap = new Map();

  for (const org of orgRows) {
    orgMap.set(org.id, {
      ...org,
      recruiters: [],
      jobs: [],
      activities: [],
      orders: [],
      feedbacks: [],
      summary: {
        recruiterCount: 0,
        jobCount: 0,
        interviewCount: 0,
        completedCount: 0,
        liveCount: 0,
        disqualifiedCount: 0,
        activityCount: 0,
        orderCount: 0,
        feedbackCount: 0,
        attemptedCount: 0,
        successfulCount: 0,
        borderlineCount: 0,
        rejectedCount: 0,
        pendingCount: 0,
        avgScore: null,
        totalTokens: 0,
        totalCostInr: 0,
        lastActiveAt: org.created_at || null
      }
    });
  }

  function classifyInterviewOutcome(row, report, selectedCutoff = 70, borderlineCutoff = 50) {
    if (row.state === 'disqualified') return 'disqualified';
    if (row.manual_decision && ['selected', 'borderline', 'rejected'].includes(row.manual_decision)) {
      return row.manual_decision;
    }
    const score = report?.overall_score;
    if (typeof score === 'number' && Number.isFinite(score)) {
      if (score >= selectedCutoff) return 'selected';
      if (score >= borderlineCutoff) return 'borderline';
      return 'rejected';
    }
    if (row.state === 'completed' || row.state === 'report_ready') {
      const rec = String(report?.recommendation || report?.candidate_verdict || '').toLowerCase();
      if (rec.includes('not ') || rec.includes('no hire') || rec.includes('reject')) return 'rejected';
      if (rec.includes('borderline') || rec.includes('review') || rec.includes('hold')) return 'borderline';
      if (rec.includes('strong hire') || rec.includes('select') || /\bhire\b/.test(rec)) return 'selected';
    }
    return 'pending';
  }

  function createSummaryBase(lastTs = null) {
    return {
      interviewCount: 0,
      totalCandidates: 0,
      attemptedCount: 0,
      completedCount: 0,
      successfulCount: 0,
      borderlineCount: 0,
      rejectedCount: 0,
      liveCount: 0,
      disqualifiedCount: 0,
      pendingCount: 0,
      avgScore: null,
      totalTokens: 0,
      totalCostInr: 0,
      lastActivityAt: lastTs || null
    };
  }

  function ensureOrgNode(orgId, fallbackName = 'Organization Workspace') {
    if (!orgId || orgId === 'org_platform_admins') return null;
    if (!orgMap.has(orgId)) {
      orgMap.set(orgId, {
        id: orgId,
        name: fallbackName,
        website: '',
        industry: '',
        company_size: '',
        country: '',
        plan: 'free_trial',
        included_interviews: 0,
        created_at: null,
        recruiters: [],
        jobs: [],
        activities: [],
        orders: [],
        feedbacks: [],
        summary: {
          recruiterCount: 0,
          jobCount: 0,
          ...createSummaryBase(null),
          activityCount: 0,
          orderCount: 0,
          feedbackCount: 0,
          lastActiveAt: null
        }
      });
    }
    return orgMap.get(orgId);
  }

  function bumpLatest(orgNode, ts) {
    if (!orgNode || !ts) return;
    if (!orgNode.summary.lastActiveAt || new Date(ts) > new Date(orgNode.summary.lastActiveAt)) {
      orgNode.summary.lastActiveAt = ts;
    }
  }

  function bumpJobLatest(jobNode, ts) {
    if (!jobNode || !ts) return;
    if (!jobNode.summary.lastActivityAt || new Date(ts) > new Date(jobNode.summary.lastActivityAt)) {
      jobNode.summary.lastActivityAt = ts;
    }
  }

  const orgScoreAccum = new Map();
  const jobScoreAccum = new Map();
  function recordScore(accumMap, key, score) {
    if (typeof score !== 'number' || !Number.isFinite(score) || !key) return;
    const prev = accumMap.get(key) || { sum: 0, count: 0 };
    prev.sum += score;
    prev.count += 1;
    accumMap.set(key, prev);
  }

  for (const u of userRows) {
    const cleanEmail = (u.email || '').toLowerCase().trim();
    const recNode = {
      ...u,
      activities: [],
      activityCount: 0
    };
    userByIdMap.set(u.id, recNode);
    if (cleanEmail) userByEmailMap.set(cleanEmail, recNode);
    const orgNode = ensureOrgNode(u.org_id, `${u.full_name || 'Recruiter'} Workspace`);
    if (orgNode) {
      orgNode.recruiters.push(recNode);
      orgNode.summary.recruiterCount += 1;
      if (cleanEmail) emailToOrgId.set(cleanEmail, orgNode.id);
      bumpLatest(orgNode, u.last_login_at || u.created_at);
    }
  }

  const jobMap = new Map();
  for (const j of jobRows) {
    const customQs = safeJsonParse(j.custom_questions, []);
    const jobNode = {
      id: j.id,
      org_id: j.org_id,
      title: j.title,
      category: j.category,
      skills: j.skills,
      experience_required: j.experience_required,
      level: j.level,
      purpose: j.purpose,
      max_minutes: j.max_minutes,
      max_questions: j.max_questions,
      custom_questions_count: Array.isArray(customQs) ? customQs.length : 0,
      assessment_rules: j.assessment_rules,
      selected_threshold: j.selected_threshold ?? 70,
      borderline_threshold: j.borderline_threshold ?? 50,
      terminal_required: Boolean(j.terminal_required),
      word_editor_required: Boolean(j.word_editor_required),
      resume_required: Boolean(j.resume_required),
      show_timer: Boolean(j.show_timer),
      auto_submit_timer: Boolean(j.auto_submit_timer),
      created_at: j.created_at,
      created_by_name: null,
      created_by_email: null,
      interviews: [],
      summary: createSummaryBase(j.created_at)
    };
    jobMap.set(j.id, jobNode);
    const orgNode = ensureOrgNode(j.org_id);
    if (orgNode) {
      orgNode.jobs.push(jobNode);
      orgNode.summary.jobCount += 1;
      bumpLatest(orgNode, j.created_at);
    }
  }

  const interviewMap = new Map();
  for (const row of interviewRows) {
    const report = safeJsonParse(row.report_json, null);
    const proctorLogs = safeJsonParse(row.proctor_logs, []);
    const dsaResult = safeJsonParse(row.dsa_result, row.dsa_result);
    const jobNode = jobMap.get(row.job_id);
    const selectedCutoff = jobNode?.selected_threshold ?? 70;
    const borderlineCutoff = jobNode?.borderline_threshold ?? 50;
    const outcomeCategory = classifyInterviewOutcome(row, report, selectedCutoff, borderlineCutoff);
    const attempted = Boolean(
      row.started_at ||
      row.ended_at ||
      ['in_progress', 'completed', 'report_ready', 'disqualified'].includes(row.state)
    );

    let durationSeconds = null;
    if (row.started_at && row.ended_at) {
      const diff = Math.round((new Date(row.ended_at) - new Date(row.started_at)) / 1000);
      if (Number.isFinite(diff) && diff >= 0) durationSeconds = diff;
    }

    const intvNode = {
      id: row.id,
      job_id: row.job_id,
      org_id: row.job_org_id,
      candidate_id: row.candidate_id,
      candidate_name: row.candidate_name,
      candidate_email: row.candidate_email,
      candidate_phone: row.candidate_phone,
      candidate_source: row.candidate_source || row.source || 'direct',
      resume_text: row.resume_text || '',
      invited_at: row.candidate_created_at || null,
      consent_at: row.consent_at,
      state: row.state,
      attempted,
      outcome_category: outcomeCategory,
      manual_decision: row.manual_decision || null,
      started_at: row.started_at,
      ended_at: row.ended_at,
      expires_at: row.expires_at,
      report_created_at: row.report_created_at || null,
      link_timer_minutes: row.link_timer_minutes || null,
      duration_seconds: durationSeconds,
      dispatch_channel: row.dispatch_channel || 'link',
      dispatch_status: row.dispatch_status || 'created',
      proctor_warnings: row.proctor_warnings || 0,
      disqualified_reason: row.disqualified_reason || '',
      proctor_logs: Array.isArray(proctorLogs) ? proctorLogs : [],
      dsa_result: dsaResult || null,
      turns_count: row.turns_count || 0,
      tokens_used: row.tokens_used || 0,
      est_cost: row.est_cost || 0,
      score: report?.overall_score ?? null,
      verdict: report?.candidate_verdict ?? null,
      recommendation: report?.recommendation ?? null,
      overall_summary: report?.overall_summary ?? null,
      hiring_clarification: report?.hiring_clarification ?? null,
      report_model: row.report_model || null,
      reviewed_by: row.reviewed_by || null,
      reviewer_note: row.reviewer_note || null,
      skills_evaluated: Array.isArray(report?.skill_breakdown) ? report.skill_breakdown : (Array.isArray(report?.skills) ? report.skills : []),
      activities: []
    };

    interviewMap.set(row.id, intvNode);
    const candEmail = (row.candidate_email || '').toLowerCase().trim();
    if (candEmail && !emailToOrgId.has(candEmail)) {
      emailToOrgId.set(candEmail, row.job_org_id);
    }

    function applyToSummary(summaryObj) {
      summaryObj.interviewCount += 1;
      summaryObj.totalCandidates += 1;
      summaryObj.totalTokens += intvNode.tokens_used;
      summaryObj.totalCostInr += intvNode.est_cost;
      if (attempted) summaryObj.attemptedCount += 1;
      if (row.state === 'completed' || row.state === 'report_ready') summaryObj.completedCount += 1;
      else if (row.state === 'in_progress') summaryObj.liveCount += 1;
      else if (row.state === 'disqualified') summaryObj.disqualifiedCount += 1;
      else summaryObj.pendingCount += 1;

      if (outcomeCategory === 'selected') summaryObj.successfulCount += 1;
      else if (outcomeCategory === 'borderline') summaryObj.borderlineCount += 1;
      else if (outcomeCategory === 'rejected') summaryObj.rejectedCount += 1;
    }

    if (jobNode) {
      jobNode.interviews.push(intvNode);
      applyToSummary(jobNode.summary);
      recordScore(jobScoreAccum, jobNode.id, intvNode.score);
      bumpJobLatest(jobNode, row.ended_at || row.started_at || row.candidate_created_at);
    }

    const orgNode = ensureOrgNode(row.job_org_id);
    if (orgNode) {
      applyToSummary(orgNode.summary);
      recordScore(orgScoreAccum, orgNode.id, intvNode.score);
      bumpLatest(orgNode, row.ended_at || row.started_at || row.candidate_created_at);
    }
  }

  for (const jobNode of jobMap.values()) {
    const acc = jobScoreAccum.get(jobNode.id);
    if (acc && acc.count > 0) jobNode.summary.avgScore = Math.round(acc.sum / acc.count);
  }
  for (const orgNode of orgMap.values()) {
    const acc = orgScoreAccum.get(orgNode.id);
    if (acc && acc.count > 0) orgNode.summary.avgScore = Math.round(acc.sum / acc.count);
  }

  const directActivities = [];
  for (const act of activityRows) {
    if (act.entity_type === 'interview' && act.entity_id && interviewMap.has(act.entity_id)) {
      interviewMap.get(act.entity_id).activities.push(act);
    }
    if (act.entity_type === 'job' && act.entity_id && jobMap.has(act.entity_id)) {
      const targetJob = jobMap.get(act.entity_id);
      if (!targetJob.created_by_name && (act.actor_name || act.actor_email)) {
        targetJob.created_by_name = act.actor_name || act.actor_email;
        targetJob.created_by_email = act.actor_email || null;
      }
    }
    const actorEmail = (act.actor_email || '').toLowerCase().trim();
    const recNode = (act.actor_id && userByIdMap.get(act.actor_id)) || (actorEmail && userByEmailMap.get(actorEmail));
    if (recNode) {
      recNode.activities.push(act);
      recNode.activityCount += 1;
    }

    const resolvedOrgId = (act.org_id && act.org_id !== 'org_platform_admins' && orgMap.has(act.org_id))
      ? act.org_id
      : (actorEmail && emailToOrgId.get(actorEmail)) || null;

    if (resolvedOrgId && orgMap.has(resolvedOrgId)) {
      const orgNode = orgMap.get(resolvedOrgId);
      orgNode.activities.push(act);
      orgNode.summary.activityCount += 1;
      bumpLatest(orgNode, act.created_at);
    } else {
      directActivities.push(act);
    }
  }

  const directOrders = [];
  for (const ord of orderRows) {
    if (ord.org_id && orgMap.has(ord.org_id)) {
      const orgNode = orgMap.get(ord.org_id);
      orgNode.orders.push(ord);
      orgNode.summary.orderCount += 1;
      bumpLatest(orgNode, ord.paid_at || ord.created_at);
    } else {
      directOrders.push(ord);
    }
  }

  const directFeedbacks = [];
  for (const fb of feedbackRows) {
    const fbEmail = (fb.user_email || '').toLowerCase().trim();
    const orgId = fbEmail ? emailToOrgId.get(fbEmail) : null;
    if (orgId && orgMap.has(orgId)) {
      const orgNode = orgMap.get(orgId);
      orgNode.feedbacks.push(fb);
      orgNode.summary.feedbackCount += 1;
      bumpLatest(orgNode, fb.created_at);
    } else {
      directFeedbacks.push(fb);
    }
  }

  const organizations = Array.from(orgMap.values()).sort((a, b) => {
    const ta = a.summary.lastActiveAt ? new Date(a.summary.lastActiveAt).getTime() : 0;
    const tb = b.summary.lastActiveAt ? new Date(b.summary.lastActiveAt).getTime() : 0;
    return tb - ta;
  });

  return {
    organizations,
    directActivities,
    directOrders,
    directFeedbacks,
    feedbacks: feedbackRows
  };
}

adminRouter.get('/activity-tree', requireAdmin, (req, res) => {
  try {
    const tree = buildInterviewerActivityTree();
    res.json({ success: true, ...tree });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

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
      report: reportRow ? JSON.parse(reportRow.json) : null,
      reportMeta: reportRow ? {
        manual_decision: reportRow.manual_decision || null,
        reviewed_by: reportRow.reviewed_by || null,
        reviewer_note: reportRow.reviewer_note || ''
      } : null
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

/**
 * Admin action: Override candidate evaluation decision & reviewer note
 */
adminRouter.patch('/interviews/:id/decision', requireAdmin, (req, res) => {
  try {
    const { id } = req.params;
    const interview = db.prepare(`
      SELECT i.*, j.org_id as job_org_id
      FROM interviews i
      JOIN jobs j ON i.job_id = j.id
      WHERE i.id = ?
    `).get(id);

    if (!interview) return res.status(404).json({ error: 'Interview round not found' });

    const rawDecision = String(req.body?.manual_decision || 'auto').toLowerCase().trim();
    const validDecisions = ['auto', 'selected', 'borderline', 'rejected'];
    if (!validDecisions.includes(rawDecision)) {
      return res.status(400).json({ error: 'Decision must be auto, selected, borderline, or rejected' });
    }

    const manualDecision = rawDecision === 'auto' ? null : rawDecision;
    const reviewerNote = typeof req.body?.reviewer_note === 'string' ? req.body.reviewer_note.trim() : null;
    const reviewerName = `${req.admin.full_name || 'Superadmin'} (Admin)`;

    const existingReport = db.prepare('SELECT * FROM reports WHERE interview_id = ?').get(id);
    if (existingReport) {
      let parsed = {};
      try { parsed = JSON.parse(existingReport.json) || {}; } catch {}
      parsed.manual_decision = manualDecision;
      db.prepare(`
        UPDATE reports
        SET json = ?, manual_decision = ?, reviewed_by = ?, reviewer_note = COALESCE(?, reviewer_note)
        WHERE interview_id = ?
      `).run(JSON.stringify(parsed), manualDecision, reviewerName, reviewerNote, id);
    } else {
      const reportPayload = {
        overall_score: interview.state === 'disqualified' ? 0 : null,
        candidate_verdict: manualDecision ? manualDecision.toUpperCase() : null,
        manual_decision: manualDecision,
        hiring_clarification: reviewerNote || 'Updated manually by platform administrator.',
        skills: []
      };
      db.prepare(`
        INSERT INTO reports (id, interview_id, json, model, reviewed_by, reviewer_note, manual_decision)
        VALUES (?, ?, ?, 'admin-override', ?, ?, ?)
      `).run('rep_' + crypto.randomUUID(), id, JSON.stringify(reportPayload), reviewerName, reviewerNote || '', manualDecision);
    }

    logActivity({
      action: 'CANDIDATE_DECISION_UPDATED',
      actorType: 'admin',
      actorId: req.admin.id,
      actorEmail: req.admin.email,
      actorName: req.admin.full_name,
      orgId: interview.job_org_id,
      entityType: 'interview',
      entityId: id,
      details: { manualDecision: manualDecision || 'auto', reviewerNote }
    });

    res.json({
      success: true,
      message: manualDecision ? `Decision overridden to ${manualDecision.toUpperCase()}.` : 'Decision reverted to AI automatic.',
      manual_decision: manualDecision,
      reviewed_by: reviewerName,
      reviewer_note: reviewerNote || ''
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

/**
 * Admin action: Update interview session lifecycle state (expire stuck session or reopen +48h)
 */
adminRouter.post('/interviews/:id/state', requireAdmin, (req, res) => {
  try {
    const { id } = req.params;
    const action = String(req.body?.action || '').toLowerCase().trim();
    const interview = db.prepare(`
      SELECT i.*, j.org_id as job_org_id
      FROM interviews i
      JOIN jobs j ON i.job_id = j.id
      WHERE i.id = ?
    `).get(id);

    if (!interview) return res.status(404).json({ error: 'Interview round not found' });

    if (action === 'expire') {
      db.prepare(`
        UPDATE interviews
        SET state = 'expired', ended_at = COALESCE(ended_at, CURRENT_TIMESTAMP)
        WHERE id = ?
      `).run(id);
    } else if (action === 'reopen') {
      db.prepare(`
        UPDATE interviews
        SET state = 'created', started_at = NULL, ended_at = NULL, expires_at = datetime('now', '+48 hours')
        WHERE id = ?
      `).run(id);
    } else {
      return res.status(400).json({ error: 'Invalid session action. Use expire or reopen.' });
    }

    logActivity({
      action: 'USER_STATUS_UPDATED',
      actorType: 'admin',
      actorId: req.admin.id,
      actorEmail: req.admin.email,
      actorName: req.admin.full_name,
      orgId: interview.job_org_id,
      entityType: 'interview',
      entityId: id,
      details: { sessionAction: action, previousState: interview.state }
    });

    res.json({
      success: true,
      message: action === 'expire' ? 'Session expired and closed.' : 'Invite reset and extended by 48 hours.'
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ─────────────────────────────────────────────────────────────────────────────
// 6. ADMIN INVITES & SEAT MANAGEMENT (Strictly 2-3 Admins)
// ─────────────────────────────────────────────────────────────────────────────

function getAdminTeamPayload() {
  const admins = db.prepare(`
    SELECT id, full_name, email, phone, admin_uid, approval_status, created_at, last_login_at 
    FROM users 
    WHERE role = 'superadmin'
    ORDER BY created_at ASC
  `).all();

  return {
    success: true,
    unlimited: true,
    maxSeats: null,
    occupiedSeats: admins.length,
    admins,
    invites: []
  };
}

adminRouter.get('/team', requireAdmin, (req, res) => {
  try {
    res.json(getAdminTeamPayload());
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

adminRouter.get('/invites', requireAdmin, (req, res) => {
  try {
    res.json(getAdminTeamPayload());
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
        preferredProvider: emailConfig.preferredProvider,
        host: emailConfig.host,
        port: emailConfig.port,
        user: emailConfig.user,
        fromName: emailConfig.fromName,
        fromEmail: emailConfig.fromEmail,
        hasPass: Boolean(emailConfig.pass && emailConfig.pass.trim().length > 3),
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

function upsertPlatformSettings(settings) {
  if (!settings || typeof settings !== 'object') return [];
  const upsert = db.prepare(`
    INSERT INTO platform_settings (key, value, updated_at) 
    VALUES (?, ?, CURRENT_TIMESTAMP)
    ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = CURRENT_TIMESTAMP
  `);

  const preserveIfEmptyKeys = new Set([
    'email_provider', 'smtp_host', 'smtp_port', 'smtp_user', 'smtp_from_name', 'smtp_from_email'
  ]);
  const updatedKeys = [];
  db.transaction(() => {
    for (const [key, val] of Object.entries(settings)) {
      if ((key === 'smtp_pass' || key === 'resend_api_key') && (String(val).includes('••••') || val === '')) {
        continue;
      }
      if (preserveIfEmptyKeys.has(key) && String(val ?? '').trim() === '') {
        continue;
      }
      upsert.run(key, String(val));
      updatedKeys.push(key);
    }
  })();
  return updatedKeys;
}

adminRouter.put('/settings', requireAdmin, (req, res) => {
  try {
    const { settings } = req.body || {};
    if (!settings || typeof settings !== 'object') {
      return res.status(400).json({ error: 'Settings object is required' });
    }

    upsertPlatformSettings(settings);

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
    const { recipientEmail, settings } = req.body || {};
    if (settings && typeof settings === 'object') {
      upsertPlatformSettings(settings);
    }
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
      message: `Done — mail sent to ${target}.`,
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

/**
 * List submitted platform/candidate feedbacks
 */
adminRouter.get('/feedbacks', requireAdmin, (req, res) => {
  try {
    const feedbacks = db.prepare(`
      SELECT id, user_name, user_email, rating, category, message, source_page, email_sent, created_at
      FROM feedbacks
      ORDER BY created_at DESC
      LIMIT 100
    `).all();
    res.json({ success: true, feedbacks });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

adminRouter.delete('/feedbacks/:id', requireAdmin, (req, res) => {
  try {
    const { id } = req.params;
    const info = db.prepare('DELETE FROM feedbacks WHERE id = ?').run(id);
    if (!info.changes) return res.status(404).json({ error: 'Feedback not found' });
    res.json({ success: true, message: 'Feedback removed.' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});
