# Legacy Manual System Backup Archive

This folder stores the original manual system implementations that were active prior to shifting the application to **Supabase** (Supabase Auth, Supabase Postgres Database, Supabase Storage, and Supabase OAuth).

---

## 📁 Archived Components Overview

| File | Original File Path | Description |
|---|---|---|
| `auth_manual_otp_jwt.js` | `backend/src/auth/auth.js` | Manual bcrypt password hashing, manual JWT token issuance, HMAC-SHA256 stateless OTP challenge generation, and verification routines. |
| `admin_otp_manual_service.js` | `backend/src/services/adminOtpService.js` | Administrator 2FA and registration OTP generation, dispatching through manual SMTP/email, and local database storage. |
| `email_manual_smtp_resend.js` | `backend/src/services/emailService.js` | Direct Nodemailer SMTP transport setup (Gmail/custom SMTP) and Resend API fallbacks for manual transactional emails. |
| `billing_manual_upi_bank_transfers.js` | `backend/src/billing/billingRoutes.js` | Direct manual UPI intent QR code generator (`upi://pay`), Bank NEFT/RTGS wire transfer instructions, manual UTR submission, and order verification. |
| `database_sqlite_manual.js` | `backend/src/db/database.js` | Local SQLite database schema, WAL mode connection, pragma settings, and 28 table creation scripts. |

---

## 🚀 Why Shift to Supabase?

1. **Enterprise Authentication & Social OAuth**:
   - Supabase Auth provides Google, GitHub, LinkedIn, and Slack OAuth with zero manual token handling or password hash management.
   - Secure Row Level Security (RLS) and JWT claim verification.
2. **Persistent Cloud PostgreSQL**:
   - Single-container SQLite lost state on serverless platforms (e.g. Vercel container sleep).
   - Supabase PostgreSQL runs 24/7 with ACID compliance, automated backups, and real-time triggers.
3. **Automated Transactional Emails & Magic Links**:
   - Supabase Auth automatically dispatches magic links, email confirmations, and password resets without needing brittle Gmail SMTP passwords or manual OTP logic.
4. **Cloud Storage**:
   - Supabase Storage securely hosts candidate resumes, code evaluation outputs, and proctor webcam snapshots.

---

## 🔄 Restoration Instructions

If you ever need to restore any manual component:
1. Copy the corresponding backup file back to its location in `backend/src/`.
2. Ensure required legacy environment variables (`JWT_SECRET`, `SMTP_HOST`, `SMTP_USER`, `SMTP_PASS`) are configured.
3. Restart the server.
