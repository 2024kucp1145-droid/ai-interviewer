import crypto from 'crypto';
import { db } from '../db/database.js';

/**
 * Platform Activity Logger
 * Logs all recruiter, candidate, and administrator actions in real-time
 * so platform administrators can audit, monitor, and operate seamlessly.
 */
export function logActivity({
  action,
  actorType = 'user',
  actorId = null,
  actorEmail = null,
  actorName = null,
  orgId = null,
  entityType = null,
  entityId = null,
  details = null,
  ipAddress = null
}) {
  try {
    const id = 'act_' + crypto.randomUUID();
    const detailsJson = details ? (typeof details === 'string' ? details : JSON.stringify(details)) : null;

    db.prepare(`
      INSERT INTO platform_activities (
        id, action, actor_type, actor_id, actor_email, actor_name, 
        org_id, entity_type, entity_id, details, ip_address, created_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP)
    `).run(
      id,
      action,
      actorType,
      actorId,
      actorEmail,
      actorName,
      orgId,
      entityType,
      entityId,
      detailsJson,
      ipAddress
    );
    return id;
  } catch (err) {
    console.warn('[ActivityLogger] Failed to log activity:', err.message);
    return null;
  }
}

/**
 * Fetch filtered activities with human-readable pagination
 */
export function getActivities({ limit = 50, offset = 0, action = null, actorType = null, entityType = null }) {
  try {
    let sql = `
      SELECT 
        a.*,
        o.name as org_name
      FROM platform_activities a
      LEFT JOIN organizations o ON a.org_id = o.id
      WHERE 1=1
    `;
    const params = [];

    if (action) {
      sql += ' AND a.action = ?';
      params.push(action);
    }
    if (actorType) {
      sql += ' AND a.actor_type = ?';
      params.push(actorType);
    }
    if (entityType) {
      sql += ' AND a.entity_type = ?';
      params.push(entityType);
    }

    sql += ' ORDER BY a.created_at DESC LIMIT ? OFFSET ?';
    params.push(Number(limit) || 50, Number(offset) || 0);

    const activities = db.prepare(sql).all(...params);

    const total = db.prepare('SELECT COUNT(*) as c FROM platform_activities').get().c;

    return {
      total,
      limit: Number(limit) || 50,
      offset: Number(offset) || 0,
      activities: activities.map(a => {
        let parsedDetails = null;
        try {
          parsedDetails = a.details ? JSON.parse(a.details) : null;
        } catch (e) {
          parsedDetails = a.details;
        }
        return {
          ...a,
          details: parsedDetails
        };
      })
    };
  } catch (err) {
    console.error('[ActivityLogger] Error fetching activities:', err);
    return { total: 0, activities: [] };
  }
}
