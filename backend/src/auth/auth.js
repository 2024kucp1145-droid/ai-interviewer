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
  return jwt.sign(payload, JWT_SECRET, { expiresIn: '7d' });
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

  // Safeguard: Ensure user's organization exists in organizations table
  // This prevents any foreign key mismatches across container restarts or new databases
  if (req.user && req.user.org_id) {
    try {
      const orgCheck = db.prepare('SELECT id FROM organizations WHERE id = ?').get(req.user.org_id);
      if (!orgCheck) {
        db.prepare(`
          INSERT OR IGNORE INTO organizations (id, name, plan, included_interviews)
          VALUES (?, 'My Organization', 'free_trial', 10)
        `).run(req.user.org_id);
      }
    } catch (e) {
      // Non-fatal fallback
    }
  }

  next();
}
