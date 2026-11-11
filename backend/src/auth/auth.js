import jwt from 'jsonwebtoken';
import bcrypt from 'bcryptjs';
import { db } from '../db/database.js';

const JWT_SECRET = process.env.JWT_SECRET || 'dev_jwt_secret_key_849204910284019284019';

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
