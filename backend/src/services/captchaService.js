/**
 * Unified CAPTCHA & Bot Protection Service
 * Supports:
 * 1. Cloudflare Turnstile (when TURNSTILE_SITE_KEY + TURNSTILE_SECRET_KEY are set)
 * 2. hCaptcha (when HCAPTCHA_SITE_KEY + HCAPTCHA_SECRET_KEY are set)
 * 3. Built-in Stateless Cryptographic Human Verification Challenge (active out-of-the-box)
 */

import crypto from 'crypto';
import jwt from 'jsonwebtoken';
import { getPlatformSettingsMap } from './platformConfigService.js';

const DEV_JWT_FALLBACK = 'dev_jwt_secret_key_849204910284019284019';
const getCaptchaSecret = () => process.env.JWT_SECRET || DEV_JWT_FALLBACK;

/**
 * Resolve active CAPTCHA configuration from platform_settings and .env.
 * Defaults to enabled=true so bot protection is ON unless explicitly disabled by an admin.
 */
export function getEffectiveCaptchaConfig() {
  const s = getPlatformSettingsMap();

  const enabled = s.captcha_enabled !== undefined
    ? (s.captcha_enabled !== '0' && s.captcha_enabled !== 'false')
    : (process.env.CAPTCHA_ENABLED !== 'false' && process.env.CAPTCHA_ENABLED !== '0');

  const turnstileSiteKey = (s.turnstile_site_key || process.env.TURNSTILE_SITE_KEY || '').trim();
  const turnstileSecretKey = (s.turnstile_secret_key || process.env.TURNSTILE_SECRET_KEY || '').trim();

  const hcaptchaSiteKey = (s.hcaptcha_site_key || process.env.HCAPTCHA_SITE_KEY || '').trim();
  const hcaptchaSecretKey = (s.hcaptcha_secret_key || process.env.HCAPTCHA_SECRET_KEY || '').trim();

  const preferredProvider = (s.captcha_provider || process.env.CAPTCHA_PROVIDER || 'auto').toLowerCase().trim();

  let provider = 'builtin';
  let siteKey = '';

  if (preferredProvider === 'turnstile' && turnstileSiteKey && turnstileSecretKey) {
    provider = 'turnstile';
    siteKey = turnstileSiteKey;
  } else if (preferredProvider === 'hcaptcha' && hcaptchaSiteKey && hcaptchaSecretKey) {
    provider = 'hcaptcha';
    siteKey = hcaptchaSiteKey;
  } else if (preferredProvider === 'auto') {
    if (turnstileSiteKey && turnstileSecretKey) {
      provider = 'turnstile';
      siteKey = turnstileSiteKey;
    } else if (hcaptchaSiteKey && hcaptchaSecretKey) {
      provider = 'hcaptcha';
      siteKey = hcaptchaSiteKey;
    }
  }

  return {
    enabled,
    provider,
    siteKey,
    hasTurnstileKeys: Boolean(turnstileSiteKey && turnstileSecretKey),
    hasHcaptchaKeys: Boolean(hcaptchaSiteKey && hcaptchaSecretKey),
    strictApiEnforcement: s.captcha_strict_api === '1' || process.env.CAPTCHA_STRICT_API === 'true',
  };
}

function buildChallengeProof(nonce, expectedAnswer) {
  return crypto
    .createHmac('sha256', getCaptchaSecret())
    .update(`captcha:${nonce}:${String(expectedAnswer).trim()}`)
    .digest('hex');
}

/**
 * Issue a stateless signed built-in human verification challenge.
 * Plaintext answer is never serialized in the token.
 */
export function issueBuiltinCaptchaChallenge() {
  const useSubtraction = crypto.randomInt(0, 2) === 1;
  let a;
  let b;
  let answer;
  let prompt;

  if (useSubtraction) {
    a = crypto.randomInt(6, 19);
    b = crypto.randomInt(1, a);
    answer = a - b;
    prompt = `${a} - ${b} = ?`;
  } else {
    a = crypto.randomInt(2, 13);
    b = crypto.randomInt(1, 10);
    answer = a + b;
    prompt = `${a} + ${b} = ?`;
  }

  const nonce = crypto.randomBytes(16).toString('hex');
  const proof = buildChallengeProof(nonce, answer);

  const challengeToken = jwt.sign(
    { type: 'captcha_challenge', nonce, proof },
    getCaptchaSecret(),
    { expiresIn: '10m' }
  );

  return {
    challengeToken,
    prompt,
    a,
    b,
    operator: useSubtraction ? '-' : '+'
  };
}

/**
 * Verify a CAPTCHA submission against the configured provider.
 */
export async function verifyCaptchaResponse({
  captchaToken,
  captchaChallengeToken,
  captchaAnswer,
  remoteIp = ''
} = {}) {
  const cfg = getEffectiveCaptchaConfig();

  if (!cfg.enabled) {
    return { valid: true, provider: 'disabled' };
  }

  // 1. External Cloudflare Turnstile verification
  if (cfg.provider === 'turnstile') {
    if (!captchaToken) {
      return { valid: false, provider: 'turnstile', error: 'Please complete the Cloudflare Turnstile verification.' };
    }
    const s = getPlatformSettingsMap();
    const secret = (s.turnstile_secret_key || process.env.TURNSTILE_SECRET_KEY || '').trim();
    const body = new URLSearchParams({ secret, response: String(captchaToken) });
    if (remoteIp) body.set('remoteip', remoteIp);

    const res = await fetch('https://challenges.cloudflare.com/turnstile/v0/siteverify', {
      method: 'POST',
      body
    });
    const data = await res.json();
    if (!data.success) {
      return { valid: false, provider: 'turnstile', error: 'CAPTCHA verification failed. Please retry.' };
    }
    return { valid: true, provider: 'turnstile' };
  }

  // 2. External hCaptcha verification
  if (cfg.provider === 'hcaptcha') {
    if (!captchaToken) {
      return { valid: false, provider: 'hcaptcha', error: 'Please complete the hCaptcha verification.' };
    }
    const s = getPlatformSettingsMap();
    const secret = (s.hcaptcha_secret_key || process.env.HCAPTCHA_SECRET_KEY || '').trim();
    const body = new URLSearchParams({ secret, response: String(captchaToken) });
    if (remoteIp) body.set('remoteip', remoteIp);

    const res = await fetch('https://api.hcaptcha.com/siteverify', {
      method: 'POST',
      body
    });
    const data = await res.json();
    if (!data.success) {
      return { valid: false, provider: 'hcaptcha', error: 'hCaptcha verification failed. Please retry.' };
    }
    return { valid: true, provider: 'hcaptcha' };
  }

  // 3. Built-in cryptographic challenge verification
  if (!captchaChallengeToken || captchaAnswer === undefined || captchaAnswer === null || String(captchaAnswer).trim() === '') {
    return { valid: false, provider: 'builtin', error: 'Please answer the CAPTCHA human check before continuing.' };
  }

  let decoded;
  try {
    decoded = jwt.verify(captchaChallengeToken, getCaptchaSecret());
  } catch (_) {
    return { valid: false, provider: 'builtin', error: 'CAPTCHA challenge expired. Please refresh the challenge and try again.' };
  }

  if (!decoded || decoded.type !== 'captcha_challenge' || !decoded.nonce || !decoded.proof) {
    return { valid: false, provider: 'builtin', error: 'Invalid CAPTCHA challenge token.' };
  }

  const normalizedAnswer = String(captchaAnswer).trim();
  const expectedBuf = Buffer.from(buildChallengeProof(decoded.nonce, normalizedAnswer), 'hex');
  const actualBuf = Buffer.from(String(decoded.proof), 'hex');

  if (expectedBuf.length !== actualBuf.length || !crypto.timingSafeEqual(expectedBuf, actualBuf)) {
    return { valid: false, provider: 'builtin', error: 'Incorrect CAPTCHA answer. Please solve the new check and try again.' };
  }

  return { valid: true, provider: 'builtin' };
}
