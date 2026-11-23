import crypto from 'crypto';
import jwt from 'jsonwebtoken';
import bcrypt from 'bcryptjs';
import { db } from '../db/database.js';

const DEV_JWT_FALLBACK = 'dev_jwt_secret_key_849204910284019284019';
const JWT_SECRET = process.env.JWT_SECRET || DEV_JWT_FALLBACK;

/**
 * Verify JWT_SECRET is explicitly configured in production (fail-closed).
 */
export function validateJwtSecret() {
  if (process.env.NODE_ENV === 'production' && (!process.env.JWT_SECRET || process.env.JWT_SECRET === DEV_JWT_FALLBACK || process.env.JWT_SECRET.length < 32)) {
    throw new Error('SECURITY: JWT_SECRET must be set to a strong >=32 character secret in production.');
  }
}

export function hashPassword(password) {
  return bcrypt.hashSync(password, 10);
}

export function comparePassword(password, hash) {
  return bcrypt.compareSync(password, hash);
}

export function signToken(payload) {
  return jwt.sign(payload, JWT_SECRET, { expiresIn: '30d' });
}

export function verifyToken(token) {
  try {
    return jwt.verify(token, JWT_SECRET);
  } catch (err) {
    return null;
  }
}

function buildOtpHmac(purpose, cleanEmail, nonce, otpCode) {
  return crypto
    .createHmac('sha256', JWT_SECRET)
    .update(`${purpose}:${cleanEmail}:${nonce}:${String(otpCode).trim()}`)
    .digest('hex');
}

/**
 * Issue a signed stateless OTP challenge token for multi-container serverless verification.
 * Stores only a server-secret HMAC proof, never the plaintext OTP.
 */
export function createStatelessOtpChallenge(email, otpCode, purpose, extra = {}) {
  const cleanEmail = (email || '').toLowerCase().trim();
  const nonce = crypto.randomBytes(16).toString('hex');
  const proof = buildOtpHmac(purpose, cleanEmail, nonce, otpCode);
  return jwt.sign(
    { type: 'otp_challenge', email: cleanEmail, purpose, nonce, proof, ...extra },
    JWT_SECRET,
    { expiresIn: '15m' }
  );
}

/**
 * Verify a user-entered OTP code against a stateless signed OTP challenge token.
 */
export function verifyStatelessOtpChallenge(otpToken, email, otpCode, purpose) {
  if (!otpToken || !otpCode || !email) {
    return { valid: false, error: 'Missing challenge token or OTP code' };
  }
  const decoded = verifyToken(otpToken);
  if (!decoded || decoded.type !== 'otp_challenge' || decoded.purpose !== purpose) {
    return { valid: false, error: 'OTP challenge expired or invalid. Please request a new code.' };
  }
  const cleanEmail = email.toLowerCase().trim();
  if (decoded.email !== cleanEmail) {
    return { valid: false, error: 'OTP challenge does not match this email address.' };
  }
  const expected = Buffer.from(buildOtpHmac(purpose, cleanEmail, decoded.nonce, otpCode), 'hex');
  const actual = Buffer.from(decoded.proof || '', 'hex');
  if (expected.length !== actual.length || !crypto.timingSafeEqual(expected, actual)) {
    return { valid: false, error: 'Invalid verification code. Please check your email and try again.' };
  }
  return { valid: true, decoded };
}

/**
 * Create a durable signed receipt so admins can log back in even after a Vercel cold /tmp reset.
 */
export function createSignedAdminProfileReceipt(adminUser) {
  if (!adminUser?.email || !adminUser?.admin_uid) return null;
  return jwt.sign(
    {
      type: 'admin_profile_receipt',
      id: adminUser.id,
      org_id: adminUser.org_id || 'org_platform_admins',
      email: adminUser.email.toLowerCase().trim(),
      full_name: adminUser.full_name || adminUser.fullName || 'Platform Administrator',
      admin_uid: String(adminUser.admin_uid).toUpperCase(),
      role: 'superadmin'
    },
    JWT_SECRET,
    { expiresIn: '90d' }
  );
}

export function verifySignedAdminProfileReceipt(profileToken) {
  const decoded = verifyToken(profileToken);
  if (!decoded || decoded.type !== 'admin_profile_receipt' || decoded.role !== 'superadmin') {
    return null;
  }
  return decoded;
}

/**
 * Express middleware for authenticating recruiter requests
 */
export function requireAuth(req, res, next) {
  const authHeader = req.headers.authorization;
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return res.status(401).json({ error: 'Missing or invalid authorization header' });
  }

  const token = authHeader.split(' ')[1];
  const decoded = verifyToken(token);
  if (!decoded) {
    return res.status(401).json({ error: 'Token expired or invalid' });
  }

  req.user = decoded; // { id, org_id, email, role }

  // Safeguard: Ensure user's organization & user row exist across container restarts/serverless lambdas
  if (req.user && req.user.org_id) {
    try {
      const orgCheck = db.prepare('SELECT id FROM organizations WHERE id = ?').get(req.user.org_id);
      if (!orgCheck) {
        db.prepare(`
          INSERT OR IGNORE INTO organizations (id, name, plan, included_interviews)
          VALUES (?, 'My Organization', 'free_trial', 10)
        `).run(req.user.org_id);
      }
      if (req.user.id && req.user.email) {
        const userCheck = db.prepare('SELECT id FROM users WHERE id = ?').get(req.user.id);
        if (!userCheck) {
          db.prepare(`
            INSERT OR IGNORE INTO users (id, org_id, full_name, email, password_hash, role, is_verified, approval_status)
            VALUES (?, ?, ?, ?, 'jwt_rehydrated', ?, 1, 'approved')
          `).run(req.user.id, req.user.org_id, req.user.full_name || 'User', req.user.email, req.user.role || 'owner');
        }
      }
    } catch (e) {
      // Non-fatal fallback
    }
  }

  next();
}
