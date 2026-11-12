/**
 * In-Memory Server Diagnostics & Error Ring Buffer
 * Captures recent server issues, auth lockouts, email failures, and payment errors
 * for instant inspection in the Super Admin Operations panel.
 */

const MAX_EVENTS = 150;
const serverEvents = [];

/**
 * Record a runtime diagnostic event or error.
 * @param {{ level?: 'info'|'warn'|'error', source: string, message: string, details?: any }} entry
 */
export function recordServerEvent({ level = 'error', source = 'server', message = '', details = null }) {
  serverEvents.unshift({
    id: `${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
    timestamp: new Date().toISOString(),
    level,
    source,
    message: String(message || '').slice(0, 600),
    details: details ? String(typeof details === 'string' ? details : JSON.stringify(details)).slice(0, 600) : null,
  });
  if (serverEvents.length > MAX_EVENTS) {
    serverEvents.length = MAX_EVENTS;
  }
}

/**
 * Return recent recorded server events (newest first).
 * @param {number} [limit=50]
 */
export function getServerEvents(limit = 50) {
  return serverEvents.slice(0, Math.min(MAX_EVENTS, Math.max(1, Number(limit) || 50)));
}

/**
 * Clear recorded diagnostic events.
 */
export function clearServerEvents() {
  serverEvents.length = 0;
}
