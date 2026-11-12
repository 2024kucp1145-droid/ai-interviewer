/**
 * In-memory sliding-window rate limiter middleware for Express.
 * Sets standard RateLimit headers and supports custom key generation.
 */

const stores = new Map();

/**
 * Extract client IP cleanly across reverse proxies and direct sockets.
 * @param {import('express').Request} req
 * @returns {string}
 */
export function getClientIp(req) {
  const forwarded = req.headers['x-forwarded-for'];
  if (typeof forwarded === 'string' && forwarded.trim()) {
    return forwarded.split(',')[0].trim();
  }
  return req.ip || req.socket?.remoteAddress || 'unknown';
}

/**
 * Create an Express sliding-window rate limiter middleware.
 * @param {object} options
 * @param {number} [options.windowMs=60000] Window size in milliseconds
 * @param {number} [options.max=30] Max requests allowed per window
 * @param {string} [options.keyPrefix='rl'] Store namespace
 * @param {string} [options.message='Too many requests, please try again later.'] Error message on 429
 * @param {(req: import('express').Request) => string} [options.keyGenerator] Custom key generator
 */
export function createRateLimiter({
  windowMs = 60_000,
  max = 30,
  keyPrefix = 'rl',
  message = 'Too many requests, please try again later.',
  keyGenerator = (req) => getClientIp(req),
} = {}) {
  const hits = new Map();
  stores.set(keyPrefix, hits);

  // Periodic sweep prevents unbounded memory growth under churn.
  const sweepInterval = setInterval(() => {
    const cutoff = Date.now() - windowMs;
    for (const [key, timestamps] of hits.entries()) {
      const fresh = timestamps.filter((t) => t > cutoff);
      if (fresh.length === 0) hits.delete(key);
      else hits.set(key, fresh);
    }
  }, Math.max(windowMs, 60_000));
  if (typeof sweepInterval.unref === 'function') sweepInterval.unref();

  return function rateLimitMiddleware(req, res, next) {
    if (process.env.DISABLE_RATE_LIMIT === '1') return next();

    const now = Date.now();
    const cutoff = now - windowMs;
    const rawKey = String(keyGenerator(req) || getClientIp(req));
    const bucketKey = `${keyPrefix}:${rawKey}`;

    const existing = hits.get(bucketKey) || [];
    const recent = existing.filter((ts) => ts > cutoff);

    res.setHeader('X-RateLimit-Limit', String(max));
    res.setHeader('X-RateLimit-Remaining', String(Math.max(0, max - recent.length - (recent.length < max ? 1 : 0))));

    if (recent.length >= max) {
      const oldestInWindow = recent[0];
      const retryAfterSec = Math.max(1, Math.ceil((oldestInWindow + windowMs - now) / 1000));
      res.setHeader('Retry-After', String(retryAfterSec));
      return res.status(429).json({
        error: message,
        retryAfter: retryAfterSec,
      });
    }

    recent.push(now);
    hits.set(bucketKey, recent);
    next();
  };
}

/**
 * Clear rate-limiter buckets (primarily for test isolation or admin resets).
 * @param {string} [prefix]
 */
export function resetRateLimits(prefix) {
  if (prefix) {
    const store = stores.get(prefix);
    if (store) store.clear();
    return;
  }
  for (const store of stores.values()) store.clear();
}
