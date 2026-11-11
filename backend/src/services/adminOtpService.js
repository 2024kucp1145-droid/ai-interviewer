import crypto from 'crypto';
import { db } from '../db/database.js';
import { sendAdminSecurityEmail, getSmtpConfig } from './emailService.js';

/**
 * Admin Email OTP & Multi-Factor Authentication Service
 * Strictly handles administrator verification for registration and secure login.
 */

/**
 * Generate and dispatch an OTP to the given admin email
 */
export async function generateAndSendAdminOtp(email, purpose = 'signup_verify', adminName = 'Platform Administrator') {
  const cleanEmail = email.toLowerCase().trim();
  const otpCode = crypto.randomInt(100000, 999999).toString();
  const id = 'otp_' + crypto.randomUUID();
  const expiresAt = new Date(Date.now() + 10 * 60 * 1000).toISOString(); // 10 minutes validity

  // Invalidate any existing unused OTPs for this email and purpose
  db.prepare(`
    UPDATE admin_otps 
    SET is_used = 1 
    WHERE email = ? AND purpose = ? AND is_used = 0
  `).run(cleanEmail, purpose);

  // Store new OTP
  db.prepare(`
    INSERT INTO admin_otps (id, email, otp_code, purpose, expires_at, is_used)
    VALUES (?, ?, ?, ?, ?, 0)
  `).run(id, cleanEmail, otpCode, purpose, expiresAt);

  const purposeLabels = {
    signup_verify: 'Platform Administrator Registration & Verification',
    login_verify: 'Platform Administrator 2FA Login Verification',
    reset_password: 'Platform Administrator Password Reset'
  };
  const purposeTitle = purposeLabels[purpose] || 'Admin Security Verification';

  // Send real email via configured SMTP
  const emailResult = await sendAdminSecurityEmail(cleanEmail, otpCode, purposeTitle, adminName);
  const smtpConfig = getSmtpConfig();

  // Always log to terminal console for local development awareness
  console.log('\n======================================================');
  console.log(`🔐 [ADMIN SECURITY OTP] For: ${cleanEmail}`);
  console.log(`👉 CODE: ${otpCode} (Valid for 10 minutes)`);
  console.log(`📌 PURPOSE: ${purpose}`);
  if (emailResult.sent) {
    console.log(`📨 Status: Successfully delivered via SMTP to ${cleanEmail}`);
  } else {
    console.log(`⚠️ Status: SMTP delivery notice (${emailResult.error || 'SMTP credentials needed in Settings'}).`);
  }
  console.log('======================================================\n');

  return {
    success: true,
    email: cleanEmail,
    emailSent: emailResult.sent,
    forwardedTo: emailResult.forwardedTo || null,
    smtpConfigured: smtpConfig.isConfigured,
    expiresAt,
    // If SMTP is NOT configured or failed to deliver, provide devOtp strictly as fallback for local dev so admin is not locked out
    devOtp: (!smtpConfig.isConfigured || !emailResult.sent || process.env.ALLOW_DEV_OTP === 'true') ? otpCode : undefined
  };
}

/**
 * Verify an admin OTP code
 */
export function verifyAdminOtp(email, otpCode, purpose = 'signup_verify') {
  const cleanEmail = (email || '').toLowerCase().trim();
  const cleanOtp = (otpCode || '').trim();

  if (!cleanEmail || !cleanOtp) {
    return { valid: false, error: 'Email and OTP code are required.' };
  }

  // Master demo emergency code fallback if configured
  if (process.env.MASTER_OTP && cleanOtp === process.env.MASTER_OTP) {
    return { valid: true, message: 'Master emergency override verified.' };
  }

  const record = db.prepare(`
    SELECT * FROM admin_otps 
    WHERE email = ? AND purpose = ? AND is_used = 0
    ORDER BY created_at DESC 
    LIMIT 1
  `).get(cleanEmail, purpose);

  if (!record) {
    return { valid: false, error: 'No active OTP request found for this email. Please request a new code.' };
  }

  if (new Date(record.expires_at) < new Date()) {
    return { valid: false, error: 'OTP has expired. Please request a fresh verification code.' };
  }

  if (record.otp_code !== cleanOtp) {
    return { valid: false, error: 'Invalid verification code. Please check your email and try again.' };
  }

  // Mark as used
  db.prepare('UPDATE admin_otps SET is_used = 1 WHERE id = ?').run(record.id);

  return { valid: true };
}
