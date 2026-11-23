import nodemailer from 'nodemailer';
import { db } from '../db/database.js';

/**
 * Unified Platform Email Service
 * Supports:
 * 1. Resend API Key (Simplest HTTP API, free at resend.com)
 * 2. Gmail / Standard SMTP (via Nodemailer with Google App Password)
 *
 * Dispatches:
 * - Recruiter email verification codes
 * - Admin 2FA login & registration OTPs
 * - Candidate interview invitations
 * - Test delivery handshakes
 */

export function getEmailConfig() {
  const settings = db.prepare("SELECT key, value FROM platform_settings WHERE key LIKE 'smtp_%' OR key IN ('resend_api_key', 'email_provider')").all();
  const map = {};
  settings.forEach(s => { map[s.key] = s.value; });

  const preferredProvider = (map.email_provider || process.env.EMAIL_PROVIDER || 'auto').toLowerCase().trim();
  const resendApiKey = map.resend_api_key || process.env.RESEND_API_KEY || '';
  const host = map.smtp_host || process.env.SMTP_HOST || 'smtp.gmail.com';
  const port = parseInt(map.smtp_port || process.env.SMTP_PORT || '587', 10);
  const user = map.smtp_user || process.env.SMTP_USER || '';
  const pass = map.smtp_pass || process.env.SMTP_PASS || '';
  const secure = (map.smtp_secure === '1' || port === 465);
  const fromName = map.smtp_from_name || process.env.SMTP_FROM_NAME || 'RoundOne AI Platform';
  const fromEmail = map.smtp_from_email || process.env.SMTP_FROM_EMAIL || user || 'onboarding@resend.dev';

  const isResendConfigured = Boolean(resendApiKey && resendApiKey.trim().length > 5);
  const isSmtpConfigured = Boolean(user && pass && user.trim().length > 3 && pass.trim().length > 3);

  let provider = 'none';
  if (preferredProvider === 'smtp') {
    provider = isSmtpConfigured ? 'smtp' : 'none';
  } else if (preferredProvider === 'resend') {
    provider = isResendConfigured ? 'resend' : 'none';
  } else if (isResendConfigured) {
    provider = 'resend';
  } else if (isSmtpConfigured) {
    provider = 'smtp';
  }

  return {
    provider,
    preferredProvider,
    resendApiKey,
    host,
    port,
    user,
    pass,
    secure,
    fromName,
    fromEmail,
    isConfigured: provider !== 'none'
  };
}

// Backward-compatible alias
export const getSmtpConfig = getEmailConfig;

export function createTransporter() {
  const config = getEmailConfig();
  if (config.provider !== 'smtp') return null;

  const cleanPass = config.host.toLowerCase().includes('gmail')
    ? config.pass.replace(/\s+/g, '')
    : config.pass;

  return nodemailer.createTransport({
    host: config.host,
    port: config.port,
    secure: config.secure,
    connectionTimeout: 8000,
    greetingTimeout: 8000,
    socketTimeout: 10000,
    auth: {
      user: config.user.trim(),
      pass: cleanPass
    },
    tls: {
      rejectUnauthorized: false
    }
  });
}

/**
 * Core unified email dispatcher
 */
export async function sendPlatformEmail({ to, subject, html }) {
  const config = getEmailConfig();
  const cleanEmail = (to || '').toLowerCase().trim();

  // 1. Resend API Provider
  if (config.provider === 'resend') {
    try {
      let fromAddress = config.fromEmail;
      // Resend sandbox strictly requires onboarding@resend.dev unless a custom domain is verified
      if (!fromAddress || fromAddress.includes('@gmail.com') || fromAddress.includes('@yahoo.com') || fromAddress.includes('@hotmail.com') || fromAddress.includes('@outlook.com') || fromAddress.includes('resend.dev')) {
        fromAddress = 'onboarding@resend.dev';
      }
      const sender = config.fromName ? `${config.fromName} <${fromAddress}>` : fromAddress;
      const res = await fetch('https://api.resend.com/emails', {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${config.resendApiKey.trim()}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          from: sender,
          to: [cleanEmail],
          subject,
          html
        })
      });
      const data = await res.json();
      if (!res.ok) {
        // If Resend is restricted to sandbox registered owner email
        const errorMsg = data.message || '';
        const isSandboxError = errorMsg.includes('own email address') || 
                               errorMsg.includes('testing email address') || 
                               errorMsg.includes('domain is not verified') || 
                               errorMsg.includes('validation_error') ||
                               res.status === 403;

        let ownerEmail = null;
        const sandboxMatch = errorMsg.match(/own email address \(([^)]+)\)/i);
        if (sandboxMatch && sandboxMatch[1]) {
          ownerEmail = sandboxMatch[1].toLowerCase().trim();
        } else if (process.env.RESEND_OWNER_EMAIL) {
          ownerEmail = process.env.RESEND_OWNER_EMAIL.toLowerCase().trim();
        } else if (config.user && config.user.includes('@')) {
          ownerEmail = config.user.toLowerCase().trim();
        } else {
          ownerEmail = 'fealyourfear99@gmail.com';
        }

        if (isSandboxError && ownerEmail && cleanEmail !== ownerEmail) {
          console.warn(`\n⚠️  [Resend Sandbox Notice] External recipient "${cleanEmail}" requires custom domain verification on resend.com.`);
          console.warn(`👉 Auto-forwarding email to your verified inbox: ${ownerEmail}\n`);

          const fallbackHtml = `
            <div style="background:#fef3c7;border:1px solid #f59e0b;padding:12px 16px;border-radius:6px;margin-bottom:20px;font-family:sans-serif;font-size:13px;color:#92400e;">
              <strong>⚠️ Sandbox Forwarding Notice:</strong><br>
              This message was dispatched for: <strong>${cleanEmail}</strong>.<br>
              Because your Resend account is in free testing mode (no custom domain verified yet), Resend routed it to your registered inbox (<strong>${ownerEmail}</strong>) so you can receive the OTP and continue testing without interruption.
            </div>
            ${html}
          `;

          const fallbackRes = await fetch('https://api.resend.com/emails', {
            method: 'POST',
            headers: {
              'Authorization': `Bearer ${config.resendApiKey.trim()}`,
              'Content-Type': 'application/json'
            },
            body: JSON.stringify({
              from: sender,
              to: [ownerEmail],
              subject: `[For: ${cleanEmail}] ${subject}`,
              html: fallbackHtml
            })
          });

          const fallbackData = await fallbackRes.json();
          if (fallbackRes.ok) {
            console.log(`✓ [Resend Sandbox] Email successfully forwarded to: ${ownerEmail} (intended for: ${cleanEmail})`);
            return {
              sent: true,
              provider: 'resend',
              messageId: fallbackData.id,
              forwardedTo: ownerEmail,
              intendedFor: cleanEmail,
              notice: `Resend free sandbox forwarded this email to ${ownerEmail}.`
            };
          }
        }

        throw new Error(data.message || (data.name ? `${data.name}: ${data.message}` : 'Resend API delivery error'));
      }
      console.log(`✓ [Resend API] Email successfully delivered to: ${cleanEmail}`);
      return { sent: true, provider: 'resend', messageId: data.id };
    } catch (err) {
      console.error(`❌ [Resend API Error] Failed to deliver email to ${cleanEmail}:`, err.message);
      return { sent: false, provider: 'resend', error: err.message };
    }
  }

  // 2. SMTP / Gmail Provider
  if (config.provider === 'smtp') {
    const transporter = createTransporter();
    if (!transporter) {
      return { sent: false, provider: 'smtp', error: 'SMTP transporter initialization failed' };
    }
    try {
      const smtpFrom = (config.fromEmail && !config.fromEmail.includes('resend.dev')) ? config.fromEmail : config.user;
      const info = await transporter.sendMail({
        from: `"${config.fromName}" <${smtpFrom}>`,
        to: cleanEmail,
        subject,
        html
      });
      console.log(`✓ [SMTP] Email successfully delivered to: ${cleanEmail}`);
      return { sent: true, provider: 'smtp', messageId: info.messageId };
    } catch (err) {
      const authHint = (err.message || '').match(/535|Username and Password not accepted|Invalid login/i)
        ? ' — Gmail requires 2-Step Verification ON and a 16-character Google App Password (myaccount.google.com/apppasswords), NOT your regular Gmail password.'
        : '';
      console.error(`❌ [SMTP Error] Failed to send email to ${cleanEmail}:`, err.message + authHint);
      return { sent: false, provider: 'smtp', error: err.message + authHint };
    }
  }

  // 3. Fallback when not configured
  console.warn(`\n======================================================`);
  console.warn(`⚠️  [EMAIL DELIVERY NOTICE]`);
  console.warn(`   No live email credentials (Gmail SMTP or Resend API Key) configured yet.`);
  console.warn(`   Recipient: ${cleanEmail}`);
  console.warn(`   Subject:   ${subject}`);
  console.warn(`👉 To send real emails to inboxes, add either:`);
  console.warn(`   Option 1: RESEND_API_KEY in .env or /admin Settings (free at resend.com)`);
  console.warn(`   Option 2: Gmail SMTP in .env or /admin Settings (Your Gmail + 16-char Google App Password)`);
  console.warn(`======================================================\n`);

  return {
    sent: false,
    provider: 'none',
    error: 'Email service credentials not configured. Please add Gmail SMTP or Resend API key in Admin Settings.'
  };
}

function escapeEmailHtml(value) {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function buildLightEmailCard({ subtitle, bodyHtml, footerText = 'Secured with RoundOne AI &middot; Automated Technical Screening' }) {
  return `
<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <style>
    body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; background: #f8fafc; margin: 0; padding: 24px; color: #0f172a; }
    .card { max-width: 520px; margin: 0 auto; background: #ffffff; border: 1px solid #e2e8f0; border-radius: 12px; overflow: hidden; box-shadow: 0 4px 16px rgba(0,0,0,0.06); }
    .header { background: #0f172a; padding: 24px 32px; color: #ffffff; }
    .header h2 { margin: 0; font-size: 20px; font-weight: 800; }
    .body { padding: 32px; }
    .otp-box { background: #f1f5f9; border: 2px dashed #2563eb; border-radius: 10px; padding: 18px; text-align: center; margin: 24px 0; }
    .otp-code { font-family: 'Courier New', monospace; font-size: 36px; font-weight: 800; letter-spacing: 8px; color: #2563eb; }
    .summary-box { background: #f8fafc; border: 1px solid #e2e8f0; border-left: 4px solid #2563eb; border-radius: 8px; padding: 14px 16px; margin: 18px 0; font-size: 13px; color: #334155; }
    .footer { border-top: 1px solid #e2e8f0; padding: 16px 32px; font-size: 11px; color: #94a3b8; text-align: center; background: #f8fafc; }
  </style>
</head>
<body>
  <div class="card">
    <div class="header">
      <h2>RoundOne AI Platform</h2>
      <p style="margin: 4px 0 0; font-size: 13px; color: #94a3b8;">${escapeEmailHtml(subtitle)}</p>
    </div>
    <div class="body">${bodyHtml}</div>
    <div class="footer">${footerText}</div>
  </div>
</body>
</html>`.trim();
}

/**
 * Send 6-Digit Email Verification / Login OTP Code to Recruiter or Platform User
 */
export async function sendRecruiterVerificationEmail(email, verificationCode, fullName = 'Recruiter', mode = 'signup') {
  const cleanEmail = email.toLowerCase().trim();
  const modeConfig = {
    login: {
      subtitle: 'Account Sign-In Verification',
      introText: 'Please enter the following 6-digit One-Time Password (OTP) on the login screen to confirm your sign-in:',
      subject: `[Login OTP] ${verificationCode} — Verify Your Sign-In to RoundOne AI`
    },
    reset: {
      subtitle: 'Password Reset Verification',
      introText: 'We received a request to reset the password for your RoundOne AI account. Enter this 6-digit verification code to confirm your password update:',
      subject: `[Password Reset OTP] ${verificationCode} — Verify Password Change`
    },
    signup: {
      subtitle: 'Work Email Verification',
      introText: 'Thank you for creating your account on RoundOne AI. Please enter the following 6-digit verification code to activate your workspace:',
      subject: `[Verification Code] ${verificationCode} — Verify Your RoundOne AI Account`
    }
  };
  const cfg = modeConfig[mode] || modeConfig.signup;

  const html = buildLightEmailCard({
    subtitle: cfg.subtitle,
    bodyHtml: `
      <p style="font-size: 14px; color: #334155; margin: 0 0 12px;">Hello <strong>${escapeEmailHtml(fullName)}</strong>,</p>
      <p style="font-size: 13px; color: #64748b; line-height: 1.5; margin: 0;">${cfg.introText}</p>
      <div class="otp-box"><div class="otp-code">${escapeEmailHtml(verificationCode)}</div></div>
      <p style="font-size: 12px; color: #94a3b8; margin: 0;">
        This code is valid for 15 minutes. If you did not request this, you can safely ignore this email.
      </p>
    `
  });

  return await sendPlatformEmail({
    to: cleanEmail,
    subject: cfg.subject,
    html
  });
}

/**
 * Send automated "Thank You for Your Feedback" response email
 */
export async function sendFeedbackThankYouEmail({ email, name = 'Valued User', rating = 5, category = 'General', message = '' }) {
  const cleanEmail = email.toLowerCase().trim();
  const safeRating = Math.max(1, Math.min(5, parseInt(rating, 10) || 5));
  const stars = '★'.repeat(safeRating) + '☆'.repeat(5 - safeRating);
  const preview = message ? escapeEmailHtml(message.slice(0, 400)) : 'Submitted via RoundOne AI';

  const html = buildLightEmailCard({
    subtitle: 'Feedback Confirmation & Thank You',
    bodyHtml: `
      <p style="font-size: 14px; color: #334155; margin: 0 0 12px;">Hello <strong>${escapeEmailHtml(name)}</strong>,</p>
      <p style="font-size: 13px; color: #475569; line-height: 1.6; margin: 0;">
        Thank you for sharing your feedback with the <strong>RoundOne AI</strong> team! We genuinely appreciate your time and review every submission to make the platform better.
      </p>
      <div class="summary-box">
        <div><strong>Category:</strong> ${escapeEmailHtml(category)}</div>
        <div style="margin-top: 4px;"><strong>Rating:</strong> ${stars} (${safeRating}/5)</div>
        <div style="margin-top: 8px; color: #475569;">"${preview}"</div>
      </div>
      <p style="font-size: 12px; color: #64748b; margin: 0;">
        If your message requires a direct follow-up, our team will get back to you at <strong>${escapeEmailHtml(cleanEmail)}</strong>.
      </p>
    `
  });

  return await sendPlatformEmail({
    to: cleanEmail,
    subject: `Thank You for Your Feedback — RoundOne AI`,
    html
  });
}

/**
 * Send interview completion confirmation to candidate after finishing a screening
 */
export async function sendInterviewCompletionEmail({ email, candidateName = 'Candidate', jobTitle = 'Technical Screening', companyName = 'Hiring Team' }) {
  const cleanEmail = email.toLowerCase().trim();
  const html = buildLightEmailCard({
    subtitle: `${companyName} — Screening Completed`,
    bodyHtml: `
      <p style="font-size: 14px; color: #334155; margin: 0 0 12px;">Hello <strong>${escapeEmailHtml(candidateName)}</strong>,</p>
      <p style="font-size: 13px; color: #475569; line-height: 1.6; margin: 0;">
        Thank you for completing your AI technical screening for <strong>${escapeEmailHtml(jobTitle)}</strong> with <strong>${escapeEmailHtml(companyName)}</strong>.
      </p>
      <div class="summary-box">
        Your interview responses and verified transcript have been recorded and submitted to the recruiting team for review.
      </div>
      <p style="font-size: 12px; color: #64748b; margin: 0;">
        The hiring team will review your evaluation and follow up regarding next steps.
      </p>
    `
  });

  return await sendPlatformEmail({
    to: cleanEmail,
    subject: `Thank You for Completing Your Interview — ${jobTitle}`,
    html
  });
}

/**
 * Send confirmation email when a user applies for Pilot / Waitlist access
 */
export async function sendWaitlistConfirmationEmail({ email, name = 'Applicant', company = '', vacancies = '' }) {
  const cleanEmail = email.toLowerCase().trim();
  const html = buildLightEmailCard({
    subtitle: 'VIP Pilot Access Request Received',
    bodyHtml: `
      <p style="font-size: 14px; color: #334155; margin: 0 0 12px;">Hello <strong>${escapeEmailHtml(name)}</strong>,</p>
      <p style="font-size: 13px; color: #475569; line-height: 1.6; margin: 0;">
        Thank you for applying for the <strong>RoundOne AI 20 Free Pilot Interviews</strong> program. We have received your request!
      </p>
      <div class="summary-box">
        <div><strong>Company:</strong> ${escapeEmailHtml(company || 'N/A')}</div>
        <div style="margin-top: 4px;"><strong>Hiring Volume:</strong> ${escapeEmailHtml(vacancies || 'Not specified')}</div>
      </div>
      <p style="font-size: 12px; color: #64748b; margin: 0;">
        Our onboarding team will reach out to <strong>${escapeEmailHtml(cleanEmail)}</strong> shortly.
      </p>
    `
  });

  return await sendPlatformEmail({
    to: cleanEmail,
    subject: `Pilot Access Application Received — RoundOne AI`,
    html
  });
}

/**
 * Send 6-Digit Admin 2FA / Registration Security Code
 */
export async function sendAdminSecurityEmail(email, otpCode, purposeTitle, adminName = 'Platform Administrator') {
  const cleanEmail = email.toLowerCase().trim();

  const html = `
<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <style>
    body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; background: #09090b; margin: 0; padding: 24px; color: #f4f4f5; }
    .card { max-width: 500px; margin: 0 auto; background: #121215; border: 1px solid #27272a; border-radius: 14px; overflow: hidden; box-shadow: 0 10px 30px rgba(0,0,0,0.5); }
    .header { background: linear-gradient(135deg, #1e1b4b, #312e81); padding: 24px 32px; border-bottom: 1px solid #3730a3; }
    .header h2 { margin: 0; font-size: 20px; color: #ffffff; }
    .body { padding: 32px; }
    .otp-box { background: #18181b; border: 1px dashed #6366f1; border-radius: 10px; padding: 18px; text-align: center; margin: 24px 0; }
    .otp-code { font-family: 'Courier New', monospace; font-size: 34px; font-weight: 800; letter-spacing: 8px; color: #a5b4fc; }
    .note { font-size: 12px; color: #a1a1aa; line-height: 1.5; margin-top: 16px; border-top: 1px solid #27272a; padding-top: 16px; }
  </style>
</head>
<body>
  <div class="card">
    <div class="header">
      <h2>🛡️ Super Admin Security Verification</h2>
      <p style="margin: 4px 0 0; font-size: 12px; color: #c7d2fe;">${purposeTitle}</p>
    </div>
    <div class="body">
      <p style="font-size: 14px; color: #d4d4d8; margin: 0 0 12px;">Hello <strong>${adminName}</strong>,</p>
      <p style="font-size: 13px; color: #a1a1aa; margin: 0;">
        Use the following 6-digit One-Time Password (OTP) to authenticate your Superadmin access. This code expires in 10 minutes.
      </p>
      
      <div class="otp-box">
        <div class="otp-code">${otpCode}</div>
      </div>
      
      <div class="note">
        <strong>Security Warning:</strong> This code grants full operational privileges over the entire platform. If you did not initiate this request, take immediate security action.
      </div>
    </div>
  </div>
</body>
</html>
  `.trim();

  return await sendPlatformEmail({
    to: cleanEmail,
    subject: `[Admin Security OTP] ${otpCode} — ${purposeTitle}`,
    html
  });
}

/**
 * Test delivery handshake with recipient email
 */
export async function sendTestEmail(recipientEmail) {
  const config = getEmailConfig();
  if (!config.isConfigured) {
    throw new Error(
      'Email service is not configured! Please provide either a Resend API Key (re_...) OR your Gmail address and 16-character Google App Password in Settings.'
    );
  }

  const testId = 'test_' + Date.now();
  const html = `
    <div style="font-family: -apple-system, BlinkMacSystemFont, sans-serif; padding: 24px; background: #f8fafc; color: #0f172a; border-radius: 10px; max-width: 500px; margin: 0 auto; border: 1px solid #e2e8f0;">
      <h2 style="color: #059669; margin-top: 0;">✓ Email Delivery Test Successful!</h2>
      <p style="font-size: 14px; line-height: 1.5;">Your email configuration on RoundOne AI is working and delivering directly to inboxes.</p>
      <div style="background: #ffffff; padding: 12px 16px; border-radius: 6px; border: 1px solid #cbd5e1; font-size: 13px; margin: 16px 0;">
        <div><strong>Provider:</strong> ${config.provider.toUpperCase()}</div>
        ${config.provider === 'smtp' ? `<div><strong>SMTP Host:</strong> ${config.host}:${config.port}</div>` : ''}
        <div><strong>Sender:</strong> ${config.fromEmail || config.user}</div>
        <div><strong>Recipient:</strong> ${recipientEmail}</div>
        <div><strong>Timestamp:</strong> ${new Date().toISOString()}</div>
      </div>
      <p style="color: #64748b; font-size: 11px; margin-bottom: 0;">Automated test notification from RoundOne AI Platform Control Center.</p>
    </div>
  `;

  const result = await sendPlatformEmail({
    to: recipientEmail,
    subject: `[Test Successful] RoundOne AI Email Delivery Test (${testId})`,
    html
  });

  if (!result.sent) {
    throw new Error(result.error || 'Failed to dispatch test email');
  }

  return {
    success: true,
    provider: config.provider,
    messageId: result.messageId,
    recipient: recipientEmail
  };
}
