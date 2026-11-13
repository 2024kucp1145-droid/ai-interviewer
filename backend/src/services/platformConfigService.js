/**
 * Dynamic Platform Configuration Service
 * Single source of truth reading live Admin Control Panel overrides from `platform_settings`
 * with seamless fallback to `.env` defaults.
 */
import { db } from '../db/database.js';

/**
 * Load all platform_settings rows as a flat key -> string map.
 * @returns {Record<string, string>}
 */
export function getPlatformSettingsMap() {
  try {
    const rows = db.prepare('SELECT key, value FROM platform_settings').all();
    const map = {};
    for (const r of rows) {
      map[r.key] = r.value;
    }
    return map;
  } catch (_) {
    return {};
  }
}

/**
 * Resolve live Payment, UPI QR, Bank Transfer, Stripe, and Razorpay settings.
 * Admin Panel values in `platform_settings` override `.env` immediately without restart.
 */
export function getEffectivePaymentConfig() {
  const s = getPlatformSettingsMap();
  const str = (dbKey, envKey, fallback = '') => {
    const dbVal = s[dbKey];
    if (dbVal !== undefined && String(dbVal).trim() !== '') return String(dbVal).trim();
    const envVal = envKey ? process.env[envKey] : '';
    return String(envVal || fallback).trim();
  };
  const flagEnabled = (dbKey, defaultVal = true) => {
    if (s[dbKey] === undefined) return defaultVal;
    return s[dbKey] !== '0' && s[dbKey] !== 'false';
  };

  const upiId = str('merchant_upi_id', 'MERCHANT_UPI_ID', '');
  const upiName = str('merchant_upi_name', 'MERCHANT_UPI_NAME', 'RoundOne AI');
  const usdToInrRate = Math.max(1, Number(str('usd_to_inr_rate', 'USD_TO_INR_RATE', '85')) || 85);

  const bankDetails = {
    holder: str('merchant_bank_holder', 'MERCHANT_BANK_HOLDER', ''),
    bankName: str('merchant_bank_name', 'MERCHANT_BANK_NAME', ''),
    accountNumber: str('merchant_bank_account', 'MERCHANT_BANK_ACCOUNT', ''),
    ifscOrSwift: str('merchant_bank_ifsc', 'MERCHANT_BANK_IFSC', ''),
  };
  const bankTransferConfigured = Boolean(bankDetails.accountNumber && bankDetails.ifscOrSwift);

  const stripePublishableKey = str('stripe_publishable_key', 'STRIPE_PUBLISHABLE_KEY', '');
  const stripeSecretKey = str('stripe_secret_key', 'STRIPE_SECRET_KEY', '');
  const stripeWebhookSecret = str('stripe_webhook_secret', 'STRIPE_WEBHOOK_SECRET', '');

  const razorpayKeyId = str('razorpay_key_id', 'RAZORPAY_KEY_ID', '');
  const razorpayKeySecret = str('razorpay_key_secret', 'RAZORPAY_KEY_SECRET', '');
  const razorpayWebhookSecret = str('razorpay_webhook_secret', 'RAZORPAY_WEBHOOK_SECRET', '');

  const enableCard = flagEnabled('payment_enable_card', true);
  const enableUpiDirect = flagEnabled('payment_enable_upi_direct', true);
  const enableBankTransfer = flagEnabled('payment_enable_bank_transfer', true);
  const enableRazorpay = flagEnabled('payment_enable_razorpay', true);
  const autoApprovePayments = flagEnabled('payment_auto_approve', true);

  return {
    upiId,
    upiName,
    usdToInrRate,
    bankDetails,
    bankTransferConfigured,
    stripePublishableKey,
    stripeSecretKey,
    stripeWebhookSecret,
    razorpayKeyId,
    razorpayKeySecret,
    razorpayWebhookSecret,
    enableCard,
    enableUpiDirect,
    enableBankTransfer,
    enableRazorpay,
    autoApprovePayments,
    stripeConfigured: enableCard && Boolean(stripeSecretKey),
    razorpayConfigured: enableRazorpay && Boolean(razorpayKeyId && razorpayKeySecret),
    upiDirectConfigured: enableUpiDirect && Boolean(upiId),
    bankAvailable: enableBankTransfer && bankTransferConfigured,
  };
}

/**
 * Resolve live Authentication & Signup Governance controls.
 */
export function getEffectiveAuthConfig() {
  const s = getPlatformSettingsMap();
  return {
    allowPublicSignup: s.allow_public_signup !== '0',
    requireAdminApproval: s.require_admin_approval === '1',
    requireEmailOtp: s.require_email_otp !== '0',
    allowDevOtpFallback: s.allow_dev_otp_fallback !== undefined
      ? s.allow_dev_otp_fallback === '1'
      : (process.env.ALLOW_DEV_OTP === 'true'),
    defaultTrialCredits: Math.max(0, parseInt(s.default_trial_credits || '10', 10) || 10),
  };
}

/**
 * Resolve live User Website Branding, Banner, Maintenance Mode, and Published Custom Pages/Links.
 */
export function getEffectiveSiteConfig() {
  const s = getPlatformSettingsMap();
  const auth = getEffectiveAuthConfig();
  let pages = [];
  try {
    pages = db.prepare(`
      SELECT id, slug, title, link_url, placement, sort_order,
             CASE WHEN length(trim(content)) > 0 THEN 1 ELSE 0 END AS has_content
      FROM site_pages
      WHERE is_published = 1
      ORDER BY sort_order ASC, created_at ASC
    `).all();
  } catch (_) {
    pages = [];
  }

  return {
    brandName: (s.site_brand_name || 'RoundOne AI').trim(),
    tagline: (s.site_tagline || 'Technical Screening & Hiring Platform').trim(),
    supportEmail: (s.site_support_email || '').trim(),
    announcement: {
      enabled: s.site_announcement_enabled === '1' && Boolean((s.site_announcement_text || '').trim()),
      text: (s.site_announcement_text || '').trim(),
      tone: s.site_announcement_tone || 'info',
    },
    maintenance: {
      enabled: s.maintenance_mode_enabled === '1',
      message: (s.maintenance_message || 'Scheduled maintenance is in progress. Please check back shortly.').trim(),
    },
    auth: {
      allowPublicSignup: auth.allowPublicSignup,
      requireAdminApproval: auth.requireAdminApproval,
      requireEmailOtp: auth.requireEmailOtp,
    },
    pages,
  };
}
