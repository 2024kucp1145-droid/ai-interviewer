/**
 * Supabase Unified Service
 * Handles:
 * 1. Supabase Client & Admin initialization
 * 2. Supabase Auth token verification & user profile synchronization
 * 3. Supabase Cloud Storage (Candidate Resumes & Proctor Snapshots)
 * 4. Supabase Magic Links & Native Auth Invitations
 */

import { createClient } from '@supabase/supabase-js';
import crypto from 'crypto';
import { db } from '../db/database.js';

let cachedClient = null;
let cachedAdmin = null;
let cachedUrl = null;
let cachedAnonKey = null;
let cachedServiceKey = null;

/**
 * Retrieve Supabase credentials with environment fallback and dynamic db settings lookup
 */
export function getSupabaseCredentials() {
  let url = process.env.SUPABASE_URL || '';
  let anonKey = process.env.SUPABASE_ANON_KEY || '';
  let serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY || '';

  // Fallback to project ID default if configured
  if (!url && process.env.SUPABASE_PROJECT_ID) {
    url = `https://${process.env.SUPABASE_PROJECT_ID}.supabase.co`;
  }

  // Check dynamic platform_settings if present
  try {
    const rows = db.prepare("SELECT key, value FROM platform_settings WHERE key IN ('supabase_url', 'supabase_anon_key', 'supabase_service_role_key')").all();
    rows.forEach(r => {
      if (r.key === 'supabase_url' && r.value) url = r.value;
      if (r.key === 'supabase_anon_key' && r.value) anonKey = r.value;
      if (r.key === 'supabase_service_role_key' && r.value) serviceRoleKey = r.value;
    });
  } catch (e) {
    // Non-fatal if table doesn't exist yet
  }

  return {
    url: (url || '').trim(),
    anonKey: (anonKey || '').trim(),
    serviceRoleKey: (serviceRoleKey || '').trim(),
    isConfigured: Boolean(url && anonKey)
  };
}

/**
 * Check if Supabase is properly configured
 */
export function isSupabaseConfigured() {
  const creds = getSupabaseCredentials();
  return creds.isConfigured;
}

/**
 * Return safe public configuration for frontend clients.
 * NEVER returns the service_role key.
 */
export function getSupabasePublicConfig() {
  const creds = getSupabaseCredentials();
  return {
    isConfigured: creds.isConfigured,
    supabaseUrl: creds.url,
    supabaseAnonKey: creds.anonKey
  };
}

let cachedAuthSettings = null;
let cachedAuthSettingsAt = 0;
let cachedAuthSettingsUrl = '';
const AUTH_SETTINGS_TTL_MS = 60_000;

/**
 * Fetch live enabled OAuth & auth providers directly from Supabase GoTrue `/auth/v1/settings`.
 * Cached briefly to keep login modals fast while reflecting dashboard changes quickly.
 */
export async function getSupabaseAuthSettings({ forceRefresh = false } = {}) {
  const creds = getSupabaseCredentials();
  if (!creds.isConfigured) {
    return {
      external: {},
      passkeysEnabled: false,
      disableSignup: false,
      supabaseCaptchaEnabled: false,
      supabaseCaptchaProvider: null
    };
  }

  const now = Date.now();
  if (
    !forceRefresh &&
    cachedAuthSettings &&
    cachedAuthSettingsUrl === creds.url &&
    (now - cachedAuthSettingsAt) < AUTH_SETTINGS_TTL_MS
  ) {
    return cachedAuthSettings;
  }

  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 8000);
    const res = await fetch(`${creds.url}/auth/v1/settings`, {
      headers: { apikey: creds.anonKey },
      signal: controller.signal
    });
    clearTimeout(timer);

    if (res.ok) {
      const data = await res.json();
      const parsed = {
        external: data.external || {},
        passkeysEnabled: Boolean(data.passkeys_enabled),
        disableSignup: Boolean(data.disable_signup),
        supabaseCaptchaEnabled: Boolean(data.security_captcha_enabled || data.captcha_enabled),
        supabaseCaptchaProvider: data.security_captcha_provider || null
      };
      cachedAuthSettings = parsed;
      cachedAuthSettingsAt = now;
      cachedAuthSettingsUrl = creds.url;
      return parsed;
    }
  } catch (err) {
    if (cachedAuthSettings && cachedAuthSettingsUrl === creds.url) {
      return cachedAuthSettings;
    }
  }

  return {
    external: { email: true },
    passkeysEnabled: false,
    disableSignup: false,
    supabaseCaptchaEnabled: false,
    supabaseCaptchaProvider: null
  };
}

/**
 * Resolve complete public Supabase runtime config including live enabled auth providers.
 */
export async function getSupabaseRuntimeConfig({ forceRefresh = false } = {}) {
  const base = getSupabasePublicConfig();
  if (!base.isConfigured) {
    return {
      ...base,
      enabledProviders: {},
      passkeysEnabled: false,
      disableSignup: false,
      supabaseCaptchaEnabled: false
    };
  }

  const authSettings = await getSupabaseAuthSettings({ forceRefresh });
  return {
    ...base,
    enabledProviders: authSettings.external || {},
    passkeysEnabled: authSettings.passkeysEnabled,
    disableSignup: authSettings.disableSignup,
    supabaseCaptchaEnabled: authSettings.supabaseCaptchaEnabled,
    supabaseCaptchaProvider: authSettings.supabaseCaptchaProvider
  };
}

/**
 * Get the standard client (anon key)
 */
export function getSupabaseClient() {
  const creds = getSupabaseCredentials();
  if (!creds.url || !creds.anonKey) return null;

  if (cachedClient && cachedUrl === creds.url && cachedAnonKey === creds.anonKey) {
    return cachedClient;
  }

  cachedUrl = creds.url;
  cachedAnonKey = creds.anonKey;
  cachedClient = createClient(creds.url, creds.anonKey, {
    auth: {
      autoRefreshToken: true,
      persistSession: false
    }
  });

  return cachedClient;
}

/**
 * Get administrative client with service_role privileges
 */
export function getSupabaseAdmin() {
  const creds = getSupabaseCredentials();
  if (!creds.url) return null;

  const keyToUse = creds.serviceRoleKey || creds.anonKey;
  if (!keyToUse) return null;

  if (cachedAdmin && cachedUrl === creds.url && cachedServiceKey === keyToUse) {
    return cachedAdmin;
  }

  cachedServiceKey = keyToUse;
  cachedAdmin = createClient(creds.url, keyToUse, {
    auth: {
      autoRefreshToken: false,
      persistSession: false
    }
  });

  return cachedAdmin;
}

/**
 * Verify a Supabase JWT access token directly against the Supabase Auth server.
 * Returns decoded Supabase user object or null.
 */
export async function verifySupabaseToken(token) {
  if (!token) return null;
  const client = getSupabaseClient() || getSupabaseAdmin();
  if (!client) return null;

  try {
    const { data, error } = await client.auth.getUser(token);
    if (error || !data?.user) {
      return null;
    }
    return data.user;
  } catch (err) {
    console.error('Supabase token verification error:', err.message);
    return null;
  }
}

/**
 * Synchronize a Supabase Auth user with the internal application database.
 * Maps Supabase user ID, email, and metadata to organizations and users tables.
 */
export function syncSupabaseUser({ supabaseUser, role = 'recruiter', orgName = null }) {
  if (!supabaseUser || !supabaseUser.email) {
    throw new Error('Invalid Supabase user payload');
  }

  const cleanEmail = supabaseUser.email.toLowerCase().trim();
  const supabaseId = supabaseUser.id;
  const metadata = supabaseUser.user_metadata || {};
  const fullName = metadata.full_name || metadata.name || cleanEmail.split('@')[0];

  // 1. Check if user already exists by email or supabaseId
  let existingUser = db.prepare('SELECT * FROM users WHERE email = ? OR id = ?').get(cleanEmail, supabaseId);

  if (existingUser) {
    // Update verification and last login timestamp
    db.prepare(`
      UPDATE users 
      SET is_verified = 1, 
          last_login_at = CURRENT_TIMESTAMP,
          full_name = COALESCE(NULLIF(full_name, ''), ?)
      WHERE id = ?
    `).run(fullName, existingUser.id);

    let org = db.prepare('SELECT * FROM organizations WHERE id = ?').get(existingUser.org_id);
    if (!org) {
      org = { id: existingUser.org_id, name: orgName || 'My Organization', plan: 'free_trial', included_interviews: 10 };
      db.prepare(`
        INSERT OR IGNORE INTO organizations (id, name, plan, included_interviews)
        VALUES (?, ?, 'free_trial', 10)
      `).run(org.id, org.name);
    }

    return {
      user: {
        id: existingUser.id,
        email: existingUser.email,
        fullName: existingUser.full_name || fullName,
        role: existingUser.role,
        org_id: existingUser.org_id,
        is_verified: 1,
        approval_status: existingUser.approval_status || 'approved'
      },
      org
    };
  }

  // 2. New user: Provision organization and user record
  const orgId = 'org_' + crypto.randomUUID();
  const defaultOrgName = (orgName || metadata.company_name || `${fullName}'s Workspace`).trim();

  db.transaction(() => {
    db.prepare(`
      INSERT INTO organizations (id, name, plan, included_interviews)
      VALUES (?, ?, 'free_trial', 10)
    `).run(orgId, defaultOrgName);

    db.prepare(`
      INSERT INTO users (id, org_id, full_name, email, password_hash, role, org_role, is_verified, approval_status, last_login_at)
      VALUES (?, ?, ?, ?, 'supabase_managed_auth', ?, ?, 1, 'approved', CURRENT_TIMESTAMP)
    `).run(supabaseId, orgId, fullName, cleanEmail, role, role === 'superadmin' ? 'admin' : 'owner');
  })();

  const newUser = db.prepare('SELECT * FROM users WHERE id = ?').get(supabaseId);
  const newOrg = db.prepare('SELECT * FROM organizations WHERE id = ?').get(orgId);

  return {
    user: {
      id: newUser.id,
      email: newUser.email,
      fullName: newUser.full_name,
      role: newUser.role,
      org_id: newUser.org_id,
      is_verified: 1,
      approval_status: 'approved'
    },
    org: newOrg
  };
}

/**
 * Supabase Storage: Ensure bucket exists
 */
export async function ensureStorageBucket(bucketName, isPublic = true) {
  const admin = getSupabaseAdmin();
  if (!admin) return false;

  try {
    const { data: buckets, error: listErr } = await admin.storage.listBuckets();
    if (listErr) {
      console.warn('Supabase listBuckets notice:', listErr.message);
      return false;
    }
    const exists = buckets?.some(b => b.name === bucketName);
    if (!exists) {
      const { error: createErr } = await admin.storage.createBucket(bucketName, {
        public: isPublic,
        fileSizeLimit: 10485760 // 10MB
      });
      if (createErr && !createErr.message.includes('already exists')) {
        console.warn(`Supabase createBucket (${bucketName}) warning:`, createErr.message);
        return false;
      }
    }
    return true;
  } catch (err) {
    console.warn(`Supabase ensureStorageBucket exception:`, err.message);
    return false;
  }
}

/**
 * Upload a candidate resume to Supabase Storage
 */
export async function uploadCandidateResume({ candidateId, fileName, fileBuffer, mimeType = 'application/pdf' }) {
  const client = getSupabaseAdmin() || getSupabaseClient();
  if (!client) throw new Error('Supabase client not configured');

  const bucketName = 'resumes';
  await ensureStorageBucket(bucketName, true);

  const cleanExt = fileName.includes('.') ? fileName.split('.').pop() : 'pdf';
  const filePath = `resumes/${candidateId}/${Date.now()}_resume.${cleanExt}`;

  const { data, error } = await client.storage
    .from(bucketName)
    .upload(filePath, fileBuffer, {
      contentType: mimeType,
      upsert: true
    });

  if (error) {
    throw new Error(`Failed to upload resume to Supabase Storage: ${error.message}`);
  }

  const { data: publicUrlData } = client.storage.from(bucketName).getPublicUrl(filePath);
  return {
    path: filePath,
    url: publicUrlData?.publicUrl || null
  };
}

/**
 * Upload proctor webcam verification snapshot to Supabase Storage
 */
export async function uploadProctorSnapshot({ interviewId, snapshotBuffer, fileName = 'webcam.jpg' }) {
  const client = getSupabaseAdmin() || getSupabaseClient();
  if (!client) throw new Error('Supabase client not configured');

  const bucketName = 'proctor_snapshots';
  await ensureStorageBucket(bucketName, false);

  const filePath = `interviews/${interviewId}/${Date.now()}_${fileName}`;

  const { data, error } = await client.storage
    .from(bucketName)
    .upload(filePath, snapshotBuffer, {
      contentType: 'image/jpeg',
      upsert: true
    });

  if (error) {
    throw new Error(`Failed to upload proctor snapshot: ${error.message}`);
  }

  // Generate a signed URL valid for 24 hours
  const { data: signedData, error: signErr } = await client.storage
    .from(bucketName)
    .createSignedUrl(filePath, 86400);

  return {
    path: filePath,
    signedUrl: signedData?.signedUrl || null
  };
}

/**
 * Supabase Auth: Send password reset or Magic Link email via native Supabase Auth
 */
export async function sendSupabaseMagicLink(email, redirectTo = null, captchaToken = null) {
  const client = getSupabaseClient() || getSupabaseAdmin();
  if (!client) return { sent: false, error: 'Supabase client not configured' };

  try {
    const options = {
      emailRedirectTo: redirectTo || undefined
    };
    if (captchaToken) options.captchaToken = captchaToken;

    const { data, error } = await client.auth.signInWithOtp({
      email: email.trim().toLowerCase(),
      options
    });

    if (error) {
      return { sent: false, error: error.message };
    }
    return { sent: true };
  } catch (err) {
    return { sent: false, error: err.message };
  }
}
