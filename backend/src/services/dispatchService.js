/**
 * Candidate Notification Dispatcher (Email & WhatsApp)
 * Sends interview invitations with mandatory rules, timing, and security instructions.
 * Supports:
 * - Live SMTP delivery (via Nodemailer)
 * - 1-Click WhatsApp Web chat links & Meta WhatsApp Cloud API
 */

import nodemailer from 'nodemailer';

export function buildInterviewRulesText(job) {
  const rules = [];
  rules.push('1. Web Camera must remain active throughout the session.');
  rules.push('2. Screen exit protection is active. Exiting the window or switching tabs will result in instant disqualification.');
  if (job?.terminal_required) {
    rules.push('3. Online coding sandbox is provided for code execution when coding questions appear.');
  } else if (job?.word_editor_required) {
    rules.push('3. In-browser word editor is provided for written drafting.');
  } else {
    rules.push('3. Conversational hands-free voice evaluation: speak your answers naturally.');
  }
  rules.push(`4. Timed session: Complete within ${job?.max_minutes || 15} minutes.`);
  rules.push('5. DPDP Act 2023 Aligned: Audio is transcribed; responses verified before hiring team review.');
  return rules;
}

export function buildEmailTemplate({
  candidateName,
  jobTitle,
  companyName,
  interviewUrl,
  timerMinutes,
  rules = [],
  baseUrl = 'http://localhost:3001'
}) {
  const fullUrl = interviewUrl.startsWith('http') ? interviewUrl : `${baseUrl}${interviewUrl}`;
  const rulesHtml = rules.map(r => `<li style="margin-bottom: 6px; color: #334155;">${r}</li>`).join('');

  return `
<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <style>
    body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif; background-color: #f8fafc; margin: 0; padding: 24px; color: #0f172a; }
    .container { max-width: 580px; margin: 0 auto; background: #ffffff; border-radius: 12px; border: 1px solid #e2e8f0; overflow: hidden; box-shadow: 0 4px 16px rgba(0,0,0,0.04); }
    .header { background: #0f172a; padding: 24px 32px; color: #ffffff; }
    .header h1 { margin: 0 0 6px 0; font-size: 20px; font-weight: 800; letter-spacing: -0.02em; }
    .header p { margin: 0; font-size: 13px; color: #94a3b8; }
    .body { padding: 32px; }
    .pill { display: inline-block; background: #eff6ff; color: #1d4ed8; border: 1px solid #bfdbfe; font-size: 11px; font-weight: 700; padding: 3px 8px; border-radius: 4px; text-transform: uppercase; margin-bottom: 16px; }
    .rules-card { background: #f8fafc; border-left: 4px solid #2563eb; border: 1px solid #e2e8f0; border-left-width: 4px; border-radius: 8px; padding: 16px; margin: 20px 0; font-size: 13px; }
    .rules-card strong { color: #0f172a; display: block; margin-bottom: 8px; }
    .btn { display: block; text-align: center; background: #2563eb; color: #ffffff !important; text-decoration: none; font-weight: 700; font-size: 15px; padding: 14px 28px; border-radius: 8px; margin: 24px 0 16px; box-shadow: 0 4px 12px rgba(37,99,235,0.25); }
    .warning { font-size: 12px; color: #b91c1c; background: #fef2f2; border: 1px solid #fecaca; padding: 10px 14px; border-radius: 6px; margin-top: 16px; }
    .footer { border-top: 1px solid #e2e8f0; padding: 16px 32px; font-size: 11px; color: #94a3b8; text-align: center; background: #f8fafc; }
  </style>
</head>
<body>
  <div class="container">
    <div class="header">
      <h1>${companyName || 'Technical Hiring Team'}</h1>
      <p>Automated AI First-Round Technical Screening</p>
    </div>
    <div class="body">
      <span class="pill">Official Assessment Invitation</span>
      <h2 style="font-size: 18px; margin: 0 0 12px; color: #0f172a;">Hello ${candidateName || 'Candidate'},</h2>
      <p style="font-size: 14px; line-height: 1.5; color: #475569; margin: 0 0 16px;">
        You have been invited for the <strong>${jobTitle}</strong> technical screening round. Please complete your AI-guided assessment using your secure access link below.
      </p>

      <div class="rules-card">
        <strong>⚠️ Mandatory Assessment Rules & Instructions:</strong>
        <ul style="margin: 0; padding-left: 20px; line-height: 1.55;">
          ${rulesHtml}
        </ul>
      </div>

      <a href="${fullUrl}" class="btn" target="_blank">Start Your AI Technical Interview &rarr;</a>

      <p style="font-size: 12px; color: #64748b; text-align: center; margin: 0;">
        Link valid for <strong>${timerMinutes || 60} minutes</strong>. Single-use access.
      </p>

      <div class="warning">
        <strong>Anti-Cheating Notice:</strong> Active webcam required. Screen exit / tab switching is actively monitored and will immediately disqualify your screening session.
      </div>
    </div>
    <div class="footer">
      Secured with RoundOne AI &middot; DPDP Act 2023 Aligned &middot; Confidential Hiring Record
    </div>
  </div>
</body>
</html>
  `.trim();
}

export function buildWhatsAppMessage({
  candidateName,
  jobTitle,
  companyName,
  interviewUrl,
  timerMinutes,
  rules = [],
  baseUrl = 'http://localhost:3001'
}) {
  const fullUrl = interviewUrl.startsWith('http') ? interviewUrl : `${baseUrl}${interviewUrl}`;
  
  return `*AI Technical Interview Invitation* 🚀

Hello *${candidateName || 'Candidate'}*,
You have been shortlisted by *${companyName || 'Technical Hiring Team'}* for the *${jobTitle}* role!

🔗 *Your Unique Interview Link:*
${fullUrl}

⏱️ *Session Duration:* ${timerMinutes || 15} Mins
⏳ *Link Validity:* ${timerMinutes || 60} Mins

⚠️ *Mandatory Rules & Instructions:*
1. 📹 Active Webcam & Mic required
2. 🖥️ Screen exit / tab switch = Immediate Disqualification
3. 🎯 Hands-free voice interview: speak answers naturally
4. 💻 In-browser coding compiler active for coding challenges

Please take the interview in a quiet room on a desktop/laptop browser.
Good luck!`.trim();
}

/**
 * Creates SMTP transporter if credentials exist in .env
 */
function getSmtpTransporter() {
  const host = process.env.SMTP_HOST || 'smtp.gmail.com';
  const port = parseInt(process.env.SMTP_PORT || '587', 10);
  const user = process.env.SMTP_USER;
  const pass = process.env.SMTP_PASS;

  if (user && pass) {
    return nodemailer.createTransport({
      host,
      port,
      secure: port === 465,
      auth: { user, pass }
    });
  }
  return null;
}

/**
 * Dispatch notification via Email and/or WhatsApp
 */
export async function dispatchCandidateNotification({
  channel = 'both', // 'email', 'whatsapp', 'both'
  candidateName,
  email,
  phone,
  jobTitle,
  companyName,
  interviewUrl,
  timerMinutes = 60,
  rules = [],
  baseUrl = 'http://localhost:3001'
}) {
  const results = {
    email: { sent: false, error: null, method: 'none' },
    whatsapp: { sent: false, url: null, error: null, method: 'click_to_chat' }
  };

  const emailHtml = buildEmailTemplate({ candidateName, jobTitle, companyName, interviewUrl, timerMinutes, rules, baseUrl });
  const waText = buildWhatsAppMessage({ candidateName, jobTitle, companyName, interviewUrl, timerMinutes, rules, baseUrl });

  // 1. WhatsApp Dispatch
  if (phone) {
    let cleanPhone = phone.replace(/[^0-9]/g, '');
    // If Indian 10-digit number without country code, add 91
    if (cleanPhone.length === 10) {
      cleanPhone = '91' + cleanPhone;
    }

    const waUrl = `https://api.whatsapp.com/send?phone=${cleanPhone}&text=${encodeURIComponent(waText)}`;
    results.whatsapp.sent = true;
    results.whatsapp.url = waUrl;
    results.whatsapp.phone = cleanPhone;

    // Check if Meta WhatsApp Cloud API credentials exist for direct background delivery
    const waToken = process.env.WHATSAPP_TOKEN;
    const waPhoneId = process.env.WHATSAPP_PHONE_NUMBER_ID;

    if (waToken && waPhoneId) {
      try {
        const metaRes = await fetch(`https://graph.facebook.com/v18.0/${waPhoneId}/messages`, {
          method: 'POST',
          headers: {
            'Authorization': `Bearer ${waToken}`,
            'Content-Type': 'application/json'
          },
          body: JSON.stringify({
            messaging_product: 'whatsapp',
            to: cleanPhone,
            type: 'text',
            text: { body: waText }
          })
        });
        if (metaRes.ok) {
          results.whatsapp.method = 'meta_cloud_api';
          console.log(`[WhatsApp API] Direct WhatsApp message delivered to +${cleanPhone}`);
        } else {
          const metaErr = await metaRes.json().catch(() => ({}));
          console.warn('[WhatsApp API] Meta API error, fallback to click-to-chat:', metaErr);
        }
      } catch (waErr) {
        console.warn('[WhatsApp API] Network error calling Meta API:', waErr.message);
      }
    } else {
      console.log(`[WhatsApp Dispatch] Click-to-chat link prepared for +${cleanPhone}`);
    }
  }

  // 2. Email Dispatch (Real SMTP via Nodemailer or fallback)
  if (email && !email.endsWith('@candidate.local')) {
    const transporter = getSmtpTransporter();
    if (transporter) {
      try {
        const fromAddr = process.env.SMTP_FROM || process.env.SMTP_USER || 'no-reply@ai-interviewer.com';
        await transporter.sendMail({
          from: `"${companyName || 'Technical Hiring'}" <${fromAddr}>`,
          to: email,
          subject: `Interview Invitation: ${jobTitle} at ${companyName || 'Technical Team'}`,
          html: emailHtml
        });
        results.email.sent = true;
        results.email.method = 'live_smtp';
        results.email.to = email;
        console.log(`[Email Dispatch] Live SMTP email successfully delivered to ${email}`);
      } catch (mailErr) {
        console.error(`[Email Dispatch] SMTP error for ${email}:`, mailErr.message);
        results.email.error = mailErr.message;
        results.email.method = 'smtp_failed';
      }
    } else {
      // SMTP credentials not configured in .env
      const mailtoUrl = `mailto:${email}?subject=${encodeURIComponent(`Interview Invitation: ${jobTitle}`)}&body=${encodeURIComponent(waText)}`;
      results.email.sent = true;
      results.email.method = 'mailto_link';
      results.email.mailtoUrl = mailtoUrl;
      results.email.to = email;
      results.email.note = 'SMTP_USER not configured in .env. Use 1-click mailto or add SMTP credentials.';
      console.log(`[Email Dispatch] Prepared mailto invitation for ${email}`);
    }
  }

  return {
    success: true,
    channels: {
      email: results.email,
      whatsapp: results.whatsapp
    },
    waMessageText: waText
  };
}
