/**
 * Platform Super Admin Controller
 * Manages unrestricted multi-admin operations, Unique Admin ID auth,
 * user approvals, real-time activity stream, and global interview oversight.
 */

const API_BASE = '/api/admin';
let adminToken = localStorage.getItem('platform_admin_token') || null;
let currentAdmin = (() => {
  try {
    return JSON.parse(localStorage.getItem('platform_admin_user') || 'null');
  } catch {
    return null;
  }
})();
let currentTab = 'overview';
let cachedUsers = [];
let cachedInterviews = [];
let activityPollInterval = null;

// Temporary states for multi-step auth
let pendingLoginAdminId = '';
let pendingLoginOtpToken = '';
let pendingRegData = {};
let pendingRegOtpToken = '';
let generatedAdminUid = '';

function getSavedAdminProfiles() {
  try {
    return JSON.parse(localStorage.getItem('roundone_admin_profiles') || '{}') || {};
  } catch {
    return {};
  }
}

function saveAdminProfileReceipt(adminUid, profileToken) {
  if (!adminUid || !profileToken) return;
  const map = getSavedAdminProfiles();
  map[String(adminUid).toUpperCase()] = profileToken;
  localStorage.setItem('roundone_admin_profiles', JSON.stringify(map));
}

function getAdminProfileReceipt(adminUid) {
  if (!adminUid) return '';
  const map = getSavedAdminProfiles();
  return map[String(adminUid).toUpperCase()] || '';
}

function getLocalSmtpProfile() {
  try {
    return JSON.parse(localStorage.getItem('roundone_admin_smtp_profile') || '{}') || {};
  } catch {
    return {};
  }
}

function saveLocalSmtpProfile(payload) {
  if (!payload) return;
  const safeProfile = {
    email_provider: payload.email_provider || 'smtp',
    smtp_host: payload.smtp_host || 'smtp.gmail.com',
    smtp_port: payload.smtp_port || '587',
    smtp_user: payload.smtp_user || '',
    smtp_from_name: payload.smtp_from_name || 'RoundOne AI Platform',
    smtp_from_email: payload.smtp_from_email || '',
    smtp_secure: payload.smtp_secure || '0'
  };
  localStorage.setItem('roundone_admin_smtp_profile', JSON.stringify(safeProfile));
}

// DOM Elements
const authView = document.getElementById('auth-view');
const dashboardView = document.getElementById('dashboard-view');
const authControls = document.getElementById('auth-controls');
const adminNameEl = document.getElementById('admin-name');
const seatsTextEl = document.getElementById('seats-text');

// ─────────────────────────────────────────────────────────────────────────────
// INITIALIZATION
// ─────────────────────────────────────────────────────────────────────────────

window.addEventListener('DOMContentLoaded', async () => {
  initTheme();
  await checkSeatsStatus();

  if (adminToken) {
    await verifyAdminSession();
  } else {
    showAuthView();
  }

  // Setup tab listeners and auto-refresh
  setupPolling();
});

function initTheme() {
  const savedTheme = localStorage.getItem('admin_theme') || 'dark';
  document.documentElement.setAttribute('data-theme', savedTheme);
  const btnTheme = document.getElementById('btn-theme-toggle');
  if (btnTheme) {
    btnTheme.innerHTML = savedTheme === 'dark' ? '<i class="bi bi-sun-fill"></i>' : '<i class="bi bi-moon-stars"></i>';
    btnTheme.addEventListener('click', () => {
      const current = document.documentElement.getAttribute('data-theme');
      const next = current === 'dark' ? 'light' : 'dark';
      document.documentElement.setAttribute('data-theme', next);
      localStorage.setItem('admin_theme', next);
      btnTheme.innerHTML = next === 'dark' ? '<i class="bi bi-sun-fill"></i>' : '<i class="bi bi-moon-stars"></i>';
    });
  }
}

async function checkSeatsStatus() {
  try {
    const res = await fetch(`${API_BASE}/auth/status`);
    const data = await res.json();
    if (data.success) {
      if (seatsTextEl) {
        seatsTextEl.textContent = `Active Admins: ${data.registeredAdmins} (Unlimited Access)`;
      }

      // If database has zero admins yet and visitor is unauthenticated, open Sign Up automatically
      if (!adminToken && data.registeredAdmins === 0) {
        window.switchAuthMode('register');
      }
    }
  } catch (err) {
    console.warn('Could not fetch admin status:', err);
  }
}

async function verifyAdminSession() {
  try {
    const res = await fetch(`${API_BASE}/auth/me`, {
      headers: { 'Authorization': `Bearer ${adminToken}` }
    });
    const data = await res.json().catch(() => ({}));
    if (res.ok && data.success) {
      currentAdmin = data.user;
      localStorage.setItem('platform_admin_user', JSON.stringify(data.user));
      showDashboardView();
      loadAllDashboardData();
    } else if (res.status === 401 || res.status === 403) {
      logoutAdmin(true);
      if (data.error) showToast(data.error, 'info');
    } else {
      // Transient 5xx error: do NOT log out or clear adminToken
      if (currentAdmin) {
        showDashboardView();
      }
      showToast('Server temporarily unavailable — keeping session active.', 'warning');
    }
  } catch (err) {
    console.error('Session verify failed:', err);
    // Network blip or server reload: do NOT destroy token
    if (currentAdmin) {
      showDashboardView();
    }
  }
}

function showAuthView() {
  if (authView) authView.style.display = 'block';
  if (dashboardView) dashboardView.style.display = 'none';
  if (authControls) authControls.style.display = 'none';
}

function showDashboardView() {
  if (authView) authView.style.display = 'none';
  if (dashboardView) dashboardView.style.display = 'block';
  if (authControls) authControls.style.display = 'flex';
  if (adminNameEl && currentAdmin) {
    const uidPart = currentAdmin.admin_uid ? ` (${currentAdmin.admin_uid})` : '';
    adminNameEl.textContent = `${currentAdmin.full_name || currentAdmin.email}${uidPart}`;
  }
}

function setupPolling() {
  if (activityPollInterval) clearInterval(activityPollInterval);
  // Auto-poll activities every 15 seconds when on overview or activities tab
  activityPollInterval = setInterval(() => {
    if (adminToken && (currentTab === 'overview' || currentTab === 'activities')) {
      loadDashboardStats(true);
      loadActivityStream(true);
    }
  }, 15000);
}

// ─────────────────────────────────────────────────────────────────────────────
// AUTHENTICATION LOGIC (HASH CODE SIGNUP & 2FA LOGIN)
// ─────────────────────────────────────────────────────────────────────────────

window.switchAuthMode = function(mode) {
  const tabLogin = document.getElementById('tab-auth-login');
  const tabRegister = document.getElementById('tab-auth-register');
  const flowLogin = document.getElementById('flow-login');
  const flowRegister = document.getElementById('flow-register');

  if (mode === 'login') {
    tabLogin.classList.add('active');
    tabRegister.classList.remove('active');
    flowLogin.style.display = 'block';
    flowRegister.style.display = 'none';
  } else {
    tabLogin.classList.remove('active');
    tabRegister.classList.add('active');
    flowLogin.style.display = 'none';
    flowRegister.style.display = 'block';
  }
};

window.handleLoginRequest = async function() {
  const nameInput = document.getElementById('login-name');
  const idInput = document.getElementById('login-admin-id');
  const btn = document.getElementById('btn-login-request');

  const name = nameInput.value.trim();
  const adminId = idInput.value.trim().toUpperCase();

  if (!name || !adminId) {
    showToast('Please enter both your Admin Name and Unique Admin ID.', 'warning');
    return;
  }

  btn.disabled = true;
  btn.innerHTML = '<i class="bi bi-arrow-repeat spin"></i> Verifying Name &amp; ID...';

  try {
    const profileToken = getAdminProfileReceipt(adminId);
    const res = await fetch(`${API_BASE}/auth/login-request`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name, adminId, profileToken })
    });
    const data = await res.json();

    if (!res.ok) {
      throw new Error(data.error || 'Login verification failed');
    }

    pendingLoginAdminId = data.adminUid || adminId;
    pendingLoginOtpToken = data.otpToken || '';
    if (data.profileToken) saveAdminProfileReceipt(pendingLoginAdminId, data.profileToken);
    document.getElementById('login-step-1').style.display = 'none';
    document.getElementById('login-step-2').style.display = 'block';
    document.getElementById('login-target-email').textContent = data.emailHint || 'your registered email';

    if (data.forwardedTo) {
      showToast(`✓ Login OTP dispatched (sandbox forwarded to ${data.forwardedTo}).`, 'success');
    } else if (data.emailSent) {
      showToast(`✓ Login OTP sent to ${data.emailHint || 'your registered email'}!`, 'success');
    } else {
      showToast('ℹ️ Email delivery fallback: Enter code 000000 (or check console) to log in.', 'info');
      const otpInput = document.getElementById('login-otp');
      if (otpInput) otpInput.value = '000000';
    }
  } catch (err) {
    showToast(err.message, 'danger');
  } finally {
    btn.disabled = false;
    btn.innerHTML = 'Verify Name &amp; ID &rarr; Send Email OTP';
  }
};

window.handleLoginVerify = async function() {
  const otpInput = document.getElementById('login-otp');
  const btn = document.getElementById('btn-login-verify');
  const otp = otpInput.value.trim();

  if (!otp || otp.length < 6) {
    showToast('Please enter the 6-digit OTP code.', 'warning');
    return;
  }

  btn.disabled = true;
  btn.innerHTML = '<i class="bi bi-arrow-repeat spin"></i> Authenticating...';

  try {
    const res = await fetch(`${API_BASE}/auth/login-verify`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        adminId: pendingLoginAdminId,
        otp,
        otpToken: pendingLoginOtpToken,
        profileToken: getAdminProfileReceipt(pendingLoginAdminId)
      })
    });
    const data = await res.json();

    if (!res.ok) {
      throw new Error(data.error || 'Authentication failed');
    }

    adminToken = data.token;
    currentAdmin = data.user;
    if (data.profileToken) saveAdminProfileReceipt(data.user?.admin_uid || pendingLoginAdminId, data.profileToken);
    localStorage.setItem('platform_admin_token', adminToken);
    localStorage.setItem('platform_admin_user', JSON.stringify(data.user));

    showToast(`Welcome back, ${data.user.fullName || 'Admin'}!`, 'success');
    resetLoginStep();
    showDashboardView();
    loadAllDashboardData();
    checkSeatsStatus();
  } catch (err) {
    showToast(err.message, 'danger');
  } finally {
    btn.disabled = false;
    btn.innerHTML = '<i class="bi bi-unlock-fill"></i> Verify OTP &amp; Enter Admin Portal';
  }
};

window.resetLoginStep = function() {
  document.getElementById('login-step-1').style.display = 'block';
  document.getElementById('login-step-2').style.display = 'none';
  document.getElementById('login-otp').value = '';
};

window.copyLoginDevOtp = function() {
  const code = document.getElementById('login-dev-otp-code')?.textContent;
  if (!code) return;
  navigator.clipboard.writeText(code);
  showToast('Copied OTP to clipboard!', 'info');
};

// --- Open Admin Sign Up (Name, Email, Password + OTP -> Unique Admin ID) ---
window.handleRegisterRequest = async function() {
  const fullName = document.getElementById('reg-name').value.trim();
  const email = document.getElementById('reg-email').value.trim();
  const password = document.getElementById('reg-password').value;
  const btn = document.getElementById('btn-register-request');

  if (!fullName || fullName.length < 2 || !email || !password) {
    showToast('Full Name, Email, and Password (min 8 chars) are required.', 'warning');
    return;
  }

  btn.disabled = true;
  btn.innerHTML = '<i class="bi bi-arrow-repeat spin"></i> Sending OTP...';

  try {
    const res = await fetch(`${API_BASE}/auth/register-request`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ fullName, email, password })
    });
    const data = await res.json();

    if (!res.ok) {
      if (data.isAlreadyRegistered) {
        showToast(data.error, 'info');
        setTimeout(() => {
          window.switchAuthMode('login');
          const nameEl = document.getElementById('login-name');
          const idEl = document.getElementById('login-admin-id');
          if (nameEl && data.fullName) nameEl.value = data.fullName;
          if (idEl && data.adminUid) idEl.value = data.adminUid;
        }, 1200);
        return;
      }
      throw new Error(data.error || 'Registration request failed');
    }

    pendingRegData = { fullName, email, password };
    pendingRegOtpToken = data.otpToken || '';
    document.getElementById('register-step-1').style.display = 'none';
    document.getElementById('register-step-2').style.display = 'block';
    document.getElementById('reg-target-email').textContent = email;

    if (data.forwardedTo) {
      showToast(`✓ OTP sent! (Resend sandbox forwarded it to ${data.forwardedTo})`, 'success');
    } else if (data.emailSent) {
      showToast(`✓ Verification OTP sent to ${email}!`, 'success');
    } else {
      showToast('⚠️ Email delivery fallback: Enter 000000 (or check console) to continue.', 'warning');
      const regOtpEl = document.getElementById('reg-otp');
      if (regOtpEl) regOtpEl.value = '000000';
    }
  } catch (err) {
    showToast(err.message, 'danger');
  } finally {
    btn.disabled = false;
    btn.innerHTML = 'Send Verification OTP &rarr;';
  }
};

window.handleRegisterVerify = async function() {
  const otpInput = document.getElementById('reg-otp');
  const btn = document.getElementById('btn-register-verify');
  const otp = otpInput.value.trim();

  if (!otp || otp.length < 6) {
    showToast('Please enter the 6-digit OTP code.', 'warning');
    return;
  }

  btn.disabled = true;
  btn.innerHTML = '<i class="bi bi-arrow-repeat spin"></i> Creating Admin Account...';

  try {
    const res = await fetch(`${API_BASE}/auth/register-verify`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        ...pendingRegData,
        otp,
        otpToken: pendingRegOtpToken
      })
    });
    const data = await res.json();

    if (!res.ok) {
      throw new Error(data.error || 'Account activation failed');
    }

    adminToken = data.token;
    currentAdmin = data.user;
    generatedAdminUid = data.adminUid || data.user?.admin_uid || '';
    if (data.profileToken) saveAdminProfileReceipt(generatedAdminUid, data.profileToken);
    localStorage.setItem('platform_admin_token', adminToken);
    localStorage.setItem('platform_admin_user', JSON.stringify(data.user));

    document.getElementById('register-step-2').style.display = 'none';
    document.getElementById('register-step-3').style.display = 'block';
    document.getElementById('reg-generated-uid').textContent = generatedAdminUid;
    document.getElementById('reg-confirmed-email').textContent = data.user?.email || pendingRegData.email;

    showToast(`✓ Admin created! Save your Unique ID: ${generatedAdminUid}`, 'success');
    checkSeatsStatus();
  } catch (err) {
    showToast(err.message, 'danger');
  } finally {
    btn.disabled = false;
    btn.innerHTML = '<i class="bi bi-check-circle-fill"></i> Verify OTP &amp; Generate Unique Admin ID';
  }
};

window.copyGeneratedAdminUid = function() {
  if (!generatedAdminUid) return;
  navigator.clipboard.writeText(generatedAdminUid);
  showToast(`Copied Unique Admin ID: ${generatedAdminUid}`, 'success');
};

window.enterPortalAfterSignup = function() {
  document.getElementById('register-step-3').style.display = 'none';
  document.getElementById('register-step-1').style.display = 'block';
  document.getElementById('reg-otp').value = '';
  showDashboardView();
  loadAllDashboardData();
};

window.resetRegisterStep = function() {
  document.getElementById('register-step-1').style.display = 'block';
  document.getElementById('register-step-2').style.display = 'none';
  const step3 = document.getElementById('register-step-3');
  if (step3) step3.style.display = 'none';
  document.getElementById('reg-otp').value = '';
};

window.copyRegDevOtp = function() {
  const code = document.getElementById('reg-dev-otp-code').textContent;
  navigator.clipboard.writeText(code);
  showToast('Copied OTP to clipboard!', 'info');
};

// --- Forgot / Reset Admin Password ---
let pendingResetEmail = '';
let pendingResetOtpToken = '';

window.openResetPasswordFlow = function() {
  document.getElementById('flow-login').style.display = 'none';
  document.getElementById('flow-register').style.display = 'none';
  document.getElementById('flow-reset').style.display = 'block';
  document.getElementById('reset-step-1').style.display = 'block';
  document.getElementById('reset-step-2').style.display = 'none';
  const emailInput = document.getElementById('login-email');
  if (emailInput && emailInput.value) {
    document.getElementById('reset-email').value = emailInput.value.trim();
  }
};

window.cancelResetPassword = function() {
  document.getElementById('flow-reset').style.display = 'none';
  document.getElementById('flow-login').style.display = 'block';
};

window.handleResetPasswordRequest = async function() {
  const email = document.getElementById('reset-email').value.trim();
  const btn = document.getElementById('btn-reset-request');
  if (!email) {
    showToast('Please enter your administrator email.', 'warning');
    return;
  }

  btn.disabled = true;
  btn.innerHTML = '<i class="bi bi-arrow-repeat spin"></i> Sending Recovery OTP...';

  try {
    const res = await fetch(`${API_BASE}/auth/forgot-password-request`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email })
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || 'Failed to request password reset');

    pendingResetEmail = email;
    pendingResetOtpToken = data.otpToken || '';
    document.getElementById('reset-step-1').style.display = 'none';
    document.getElementById('reset-step-2').style.display = 'block';
    document.getElementById('reset-target-email').textContent = email;

    if (data.emailSent) {
      showToast('✓ Password reset code dispatched to your email inbox!', 'success');
    } else {
      showToast('⚠️ Email service not configured yet: Your reset OTP code is printed in the server terminal console!', 'warning');
    }
  } catch (err) {
    showToast(err.message, 'danger');
  } finally {
    btn.disabled = false;
    btn.innerHTML = 'Send Reset Code &rarr;';
  }
};

window.handleResetPasswordVerify = async function() {
  const otp = document.getElementById('reset-otp').value.trim();
  const newPassword = document.getElementById('reset-new-password').value;
  const btn = document.getElementById('btn-reset-verify');

  if (!otp || !newPassword) {
    showToast('Please enter the OTP code and new password.', 'warning');
    return;
  }
  if (newPassword.length < 8) {
    showToast('Password must be at least 8 characters.', 'warning');
    return;
  }

  btn.disabled = true;
  btn.innerHTML = '<i class="bi bi-arrow-repeat spin"></i> Resetting Password...';

  try {
    const res = await fetch(`${API_BASE}/auth/forgot-password-verify`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        email: pendingResetEmail,
        otp,
        newPassword,
        otpToken: pendingResetOtpToken
      })
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || 'Failed to reset password');

    showToast('Password updated successfully! You can now log in.', 'success');
    cancelResetPassword();
    document.getElementById('login-email').value = pendingResetEmail;
    document.getElementById('login-password').value = newPassword;
  } catch (err) {
    showToast(err.message, 'danger');
  } finally {
    btn.disabled = false;
    btn.innerHTML = '<i class="bi bi-check-lg"></i> Update Password &amp; Proceed to Login';
  }
};

document.getElementById('btn-admin-logout')?.addEventListener('click', () => {
  logoutAdmin();
});

function logoutAdmin(isSilent = false) {
  adminToken = null;
  currentAdmin = null;
  localStorage.removeItem('platform_admin_token');
  localStorage.removeItem('platform_admin_user');
  showAuthView();
  if (!isSilent) {
    showToast('Signed out of admin portal.', 'info');
  }
  checkSeatsStatus();
}

// ─────────────────────────────────────────────────────────────────────────────
// DASHBOARD NAVIGATION & TABS
// ─────────────────────────────────────────────────────────────────────────────

window.switchDashboardTab = function(tabName) {
  currentTab = tabName;
  const tabs = ['overview', 'activities', 'users', 'interviews', 'orders', 'invites', 'settings'];

  tabs.forEach(t => {
    const content = document.getElementById(`tab-content-${t}`);
    if (content) content.style.display = (t === tabName) ? 'block' : 'none';
  });

  const buttons = document.querySelectorAll('.nav-tab-btn');
  buttons.forEach(btn => {
    if (btn.getAttribute('onclick')?.includes(tabName)) {
      btn.classList.add('active');
    } else {
      btn.classList.remove('active');
    }
  });

  if (tabName === 'overview') loadDashboardStats();
  if (tabName === 'activities') loadActivityStream();
  if (tabName === 'users') loadRecruitersDirectory();
  if (tabName === 'interviews') loadInterviewsList();
  if (tabName === 'orders') loadOrdersDirectory();
  if (tabName === 'invites') loadAdminInvites();
  if (tabName === 'settings') loadPlatformSettings();
};

function loadAllDashboardData() {
  loadDashboardStats();
  loadActivityStream();
  loadRecruitersDirectory();
  loadInterviewsList();
  loadOrdersDirectory();
  loadAdminInvites();
  loadPlatformSettings();
}

// ─────────────────────────────────────────────────────────────────────────────
// TAB 1: DASHBOARD STATS & METRICS
// ─────────────────────────────────────────────────────────────────────────────

async function loadDashboardStats(isSilent = false) {
  try {
    const res = await fetch(`${API_BASE}/stats`, {
      headers: { 'Authorization': `Bearer ${adminToken}` }
    });
    if (res.status === 401) {
      await verifyAdminSession();
      return;
    }
    if (!res.ok) return;

    const data = await res.json();
    if (!data.success) return;

    const s = data.stats;
    document.getElementById('kpi-total-users').textContent = s.users.total;
    document.getElementById('kpi-users-sub').textContent = `${s.users.pending} Pending Approval · ${s.users.approved} Active`;

    document.getElementById('kpi-total-orgs').textContent = s.orgs;
    document.getElementById('kpi-total-jobs').textContent = s.jobs;

    document.getElementById('kpi-total-interviews').textContent = s.interviews.total;
    document.getElementById('kpi-interviews-sub').textContent = `${s.interviews.completed} Done · ${s.interviews.inProgress} Live · ${s.interviews.disqualified} Disqualified`;

    document.getElementById('kpi-token-cost').textContent = `₹${Math.round(s.tokens.estCostInr)}`;
    document.getElementById('kpi-tokens-sub').textContent = `${(s.tokens.inputTokens + s.tokens.outputTokens).toLocaleString()} Tokens ($${s.tokens.estCostUsd})`;

    document.getElementById('kpi-today-events').textContent = s.activitiesToday;

    // Badges in tabs
    const pendingBadge = document.getElementById('pending-users-badge');
    if (pendingBadge) {
      if (s.users.pending > 0) {
        pendingBadge.textContent = `${s.users.pending} Pending`;
        pendingBadge.style.display = 'inline-block';
      } else {
        pendingBadge.style.display = 'none';
      }
    }

    if (seatsTextEl) {
      seatsTextEl.textContent = `Active Admins: ${s.admins.occupied} (Unlimited Access)`;
    }
  } catch (err) {
    if (!isSilent) console.error('Failed to load stats:', err);
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// TAB 2: REAL-TIME ACTIVITY STREAM
// ─────────────────────────────────────────────────────────────────────────────

window.loadActivityStream = async function(isSilent = false) {
  const container = document.getElementById('full-activity-stream');
  const previewContainer = document.getElementById('overview-recent-activities-list');
  const actionFilter = document.getElementById('filter-activity-action')?.value || '';

  try {
    let url = `${API_BASE}/activities?limit=40`;
    if (actionFilter) url += `&action=${encodeURIComponent(actionFilter)}`;

    const res = await fetch(url, {
      headers: { 'Authorization': `Bearer ${adminToken}` }
    });
    const data = await res.json();

    if (!data.success) return;

    const activitiesBadge = document.getElementById('activities-badge');
    if (activitiesBadge) activitiesBadge.textContent = data.total;

    if (data.activities.length === 0) {
      if (container) container.innerHTML = '<p style="color:var(--text-muted); text-align:center; padding: 2rem;">No platform activities recorded yet.</p>';
      if (previewContainer) previewContainer.innerHTML = '<p style="color:var(--text-muted); font-size:0.8rem;">No events recorded yet.</p>';
      return;
    }

    const html = data.activities.map(a => renderActivityItem(a)).join('');
    if (container) container.innerHTML = html;

    // First 5 for preview on Overview Tab
    if (previewContainer) {
      previewContainer.innerHTML = data.activities.slice(0, 5).map(a => renderActivityItem(a, true)).join('');
    }
  } catch (err) {
    if (!isSilent) console.error('Failed to load activities:', err);
  }
};

function renderActivityItem(act, isCompact = false) {
  const actionStyles = {
    USER_SIGNUP: { icon: 'bi-person-plus-fill', color: '#6366f1', label: 'New Recruiter Signup' },
    USER_LOGIN: { icon: 'bi-box-arrow-in-right', color: '#3b82f6', label: 'Recruiter Login' },
    USER_VERIFIED: { icon: 'bi-patch-check-fill', color: '#10b981', label: 'Email Verified' },
    COMPANY_PROFILE_UPDATED: { icon: 'bi-building', color: '#8b5cf6', label: 'Company Profile Set' },
    JOB_CREATED: { icon: 'bi-plus-square-fill', color: '#0ea5e9', label: 'Job Role Created' },
    JOB_DELETED: { icon: 'bi-trash3-fill', color: '#ef4444', label: 'Job Deleted' },
    INTERVIEW_DISPATCHED: { icon: 'bi-send-fill', color: '#10b981', label: 'Interview Invitation Dispatched' },
    INTERVIEW_STARTED: { icon: 'bi-play-circle-fill', color: '#f59e0b', label: 'Candidate Started Screening' },
    INTERVIEW_COMPLETED: { icon: 'bi-check-all', color: '#10b981', label: 'Interview Completed' },
    INTERVIEW_DISQUALIFIED: { icon: 'bi-shield-x', color: '#ef4444', label: 'Proctoring Disqualification' },
    USER_STATUS_UPDATED: { icon: 'bi-person-gear', color: '#ec4899', label: 'Admin Status Override' },
    CREDITS_ADJUSTED: { icon: 'bi-coin', color: '#eab308', label: 'Credits Modified' },
    ADMIN_REGISTERED: { icon: 'bi-shield-lock-fill', color: '#a855f7', label: 'New Superadmin Activated' },
    ADMIN_LOGIN: { icon: 'bi-shield-check', color: '#6366f1', label: 'Superadmin Logged In' },
  };

  const style = actionStyles[act.action] || { icon: 'bi-circle-fill', color: '#71717a', label: act.action };
  const timeFormatted = formatTimeAgo(act.created_at);

  let detailsText = '';
  if (act.details) {
    if (typeof act.details === 'object') {
      const parts = [];
      if (act.details.companyName) parts.push(`Company: <strong>${escapeHtml(act.details.companyName)}</strong>`);
      if (act.details.jobTitle) parts.push(`Job: <strong>${escapeHtml(act.details.jobTitle)}</strong>`);
      if (act.details.title) parts.push(`Role: <strong>${escapeHtml(act.details.title)}</strong>`);
      if (act.details.candidateEmail) parts.push(`Candidate: <strong>${escapeHtml(act.details.candidateEmail)}</strong>`);
      if (act.details.newStatus) parts.push(`Status &rarr; <span class="badge badge-primary">${act.details.newStatus}</span>`);
      if (act.details.newCredits !== undefined) parts.push(`Credits set to <strong>${act.details.newCredits}</strong>`);
      if (act.details.reason) parts.push(`<span style="color:var(--danger)">Violation: ${escapeHtml(act.details.reason)}</span>`);
      if (act.details.score !== undefined) parts.push(`Score: <strong>${act.details.score}/100</strong>`);
      detailsText = parts.join(' &middot; ');
    } else {
      detailsText = escapeHtml(String(act.details));
    }
  }

  const actorLabel = act.actor_email 
    ? `<span style="font-weight:600; color:var(--text);">${escapeHtml(act.actor_name || act.actor_email)}</span> <span style="color:var(--text-subtle);">(${escapeHtml(act.actor_email)})</span>`
    : `<span style="color:var(--text-subtle);">Anonymous / Candidate</span>`;

  return `
    <div class="activity-item">
      <div class="activity-icon" style="background-color: ${style.color}20; color: ${style.color};">
        <i class="bi ${style.icon}"></i>
      </div>
      <div class="activity-main">
        <div class="activity-title">
          <span>${style.label}</span>
          <span style="font-weight: 400; color: var(--text-muted); font-size: 0.75rem;">&middot; ${actorLabel}</span>
        </div>
        ${detailsText ? `<div class="activity-desc">${detailsText}</div>` : ''}
      </div>
      <div class="activity-time">${timeFormatted}</div>
    </div>
  `;
}

// ─────────────────────────────────────────────────────────────────────────────
// TAB 3: RECRUITER & USER MANAGEMENT
// ─────────────────────────────────────────────────────────────────────────────

window.loadRecruitersDirectory = async function() {
  const tbody = document.getElementById('recruiters-table-body');
  try {
    const res = await fetch(`${API_BASE}/users`, {
      headers: { 'Authorization': `Bearer ${adminToken}` }
    });
    const data = await res.json();
    if (!data.success) return;

    cachedUsers = data.users || [];
    renderUsersTable();

    // Render pending users list on Overview
    const pendingListEl = document.getElementById('overview-pending-users-list');
    if (pendingListEl) {
      const pending = cachedUsers.filter(u => u.approval_status === 'pending_approval');
      if (pending.length === 0) {
        pendingListEl.innerHTML = '<p style="color: var(--success); font-size: 0.8rem;"><i class="bi bi-check-circle-fill"></i> All recruiter accounts are reviewed and approved.</p>';
      } else {
        pendingListEl.innerHTML = pending.map(u => `
          <div style="display: flex; align-items: center; justify-content: space-between; padding: 0.6rem 0; border-bottom: 1px solid var(--border);">
            <div>
              <strong style="display:block; font-size:0.82rem;">${escapeHtml(u.full_name || 'Recruiter')}</strong>
              <span style="font-size:0.75rem; color:var(--text-muted);">${escapeHtml(u.email)} &middot; ${escapeHtml(u.org_name || 'No Org')}</span>
            </div>
            <button class="btn btn-success btn-sm" onclick="quickUpdateUserStatus('${u.id}', 'approved')">
              <i class="bi bi-check2"></i> Approve
            </button>
          </div>
        `).join('');
      }
    }
  } catch (err) {
    console.error('Failed to load recruiters:', err);
    if (tbody) tbody.innerHTML = `<tr><td colspan="7" style="color:var(--danger); padding:2rem; text-align:center;">Failed to load recruiters: ${err.message}</td></tr>`;
  }
};

window.renderUsersTable = function() {
  const tbody = document.getElementById('recruiters-table-body');
  if (!tbody) return;

  const filter = (document.getElementById('search-users-input')?.value || '').toLowerCase().trim();

  let list = cachedUsers;
  if (filter) {
    list = list.filter(u => 
      (u.full_name && u.full_name.toLowerCase().includes(filter)) ||
      (u.email && u.email.toLowerCase().includes(filter)) ||
      (u.org_name && u.org_name.toLowerCase().includes(filter)) ||
      (u.approval_status && u.approval_status.toLowerCase().includes(filter))
    );
  }

  if (list.length === 0) {
    tbody.innerHTML = `<tr><td colspan="7" style="text-align:center; padding: 2rem; color: var(--text-muted);">No recruiters match the search filter.</td></tr>`;
    return;
  }

  tbody.innerHTML = list.map(u => {
    let statusBadge = '<span class="badge badge-success">Approved</span>';
    if (u.approval_status === 'pending_approval') {
      statusBadge = '<span class="badge badge-warning">Pending Review</span>';
    } else if (u.approval_status === 'suspended') {
      statusBadge = '<span class="badge badge-danger">Suspended</span>';
    } else if (u.approval_status === 'rejected') {
      statusBadge = '<span class="badge badge-neutral">Rejected</span>';
    }

    const lastLogin = u.last_login_at ? formatTimeAgo(u.last_login_at) : 'Never';

    return `
      <tr>
        <td>
          <strong style="color:var(--text); display:block;">${escapeHtml(u.full_name || 'Hiring Manager')}</strong>
          <span style="font-size:0.75rem; color:var(--text-muted); font-family:var(--mono);">${escapeHtml(u.email)}</span>
          ${u.phone ? `<div style="font-size:0.7rem; color:var(--text-subtle);"><i class="bi bi-telephone"></i> ${escapeHtml(u.phone)}</div>` : ''}
        </td>
        <td>
          <strong style="display:block;">${escapeHtml(u.org_name || 'My Organization')}</strong>
          <span style="font-size:0.72rem; color:var(--text-muted);">${escapeHtml(u.org_industry || 'Tech')} &middot; ${escapeHtml(u.org_country || 'India')}</span>
        </td>
        <td>${statusBadge}</td>
        <td>
          <strong style="color:var(--primary); font-size:0.95rem;">${u.org_credits || 0}</strong>
          <span style="font-size:0.7rem; color:var(--text-subtle); display:block; text-transform:uppercase;">${u.org_plan || 'free_trial'}</span>
        </td>
        <td>
          <span style="font-size:0.8rem;">${u.total_jobs || 0} Jobs</span>
          <span style="font-size:0.72rem; color:var(--text-muted); display:block;">${u.total_interviews || 0} Interviews</span>
        </td>
        <td style="font-size:0.75rem; color:var(--text-muted); font-family:var(--mono);">${lastLogin}</td>
        <td style="text-align: right;">
          <div style="display:inline-flex; gap:0.4rem;">
            ${u.approval_status !== 'approved' ? `
              <button class="btn btn-success btn-sm" title="Approve Recruiter" onclick="quickUpdateUserStatus('${u.id}', 'approved')">
                <i class="bi bi-check2"></i> Approve
              </button>
            ` : `
              <button class="btn btn-secondary btn-sm" title="Suspend Recruiter" onclick="quickUpdateUserStatus('${u.id}', 'suspended')" style="color:var(--danger);">
                <i class="bi bi-slash-circle"></i> Suspend
              </button>
            `}
            <button class="btn btn-secondary btn-sm" onclick="openManageUserModal('${u.id}')">
              <i class="bi bi-sliders2"></i> Edit &amp; Credits
            </button>
          </div>
        </td>
      </tr>
    `;
  }).join('');
};

window.quickUpdateUserStatus = async function(userId, status) {
  try {
    const res = await fetch(`${API_BASE}/users/${userId}/status`, {
      method: 'PUT',
      headers: { 
        'Authorization': `Bearer ${adminToken}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({ status })
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || 'Failed to update status');

    showToast(data.message, 'success');
    loadRecruitersDirectory();
    loadDashboardStats(true);
    loadActivityStream(true);
  } catch (err) {
    showToast(err.message, 'danger');
  }
};

window.openManageUserModal = function(userId) {
  const user = cachedUsers.find(u => u.id === userId);
  if (!user) return;

  document.getElementById('manage-user-id').value = user.id;
  document.getElementById('manage-user-email').textContent = user.email;
  document.getElementById('manage-user-org').textContent = user.org_name || 'Organization';
  document.getElementById('manage-user-status-select').value = user.approval_status || 'approved';
  document.getElementById('manage-user-notes').value = user.admin_notes || '';
  document.getElementById('manage-user-set-credits').value = user.org_credits || 10;
  document.getElementById('manage-user-plan-select').value = user.org_plan || 'free_trial';

  document.getElementById('modal-manage-user').classList.add('show');
};

window.closeManageUserModal = function() {
  document.getElementById('modal-manage-user').classList.remove('show');
};

window.quickAddCredits = function(delta) {
  const input = document.getElementById('manage-user-set-credits');
  const current = parseInt(input.value || '0', 10);
  input.value = current + delta;
};

window.submitUserManagement = async function() {
  const userId = document.getElementById('manage-user-id').value;
  const status = document.getElementById('manage-user-status-select').value;
  const notes = document.getElementById('manage-user-notes').value.trim();
  const setCredits = document.getElementById('manage-user-set-credits').value;
  const plan = document.getElementById('manage-user-plan-select').value;

  try {
    // 1. Update status
    await fetch(`${API_BASE}/users/${userId}/status`, {
      method: 'PUT',
      headers: { 
        'Authorization': `Bearer ${adminToken}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({ status, notes })
    });

    // 2. Update credits and plan
    await fetch(`${API_BASE}/users/${userId}/credits`, {
      method: 'PUT',
      headers: { 
        'Authorization': `Bearer ${adminToken}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({ setCredits, plan })
    });

    showToast('Recruiter profile, credits, and status updated!', 'success');
    closeManageUserModal();
    loadRecruitersDirectory();
    loadDashboardStats(true);
    loadActivityStream(true);
  } catch (err) {
    showToast(err.message, 'danger');
  }
};

// ─────────────────────────────────────────────────────────────────────────────
// TAB 4: GLOBAL CANDIDATE INTERVIEWS OVERSIGHT
// ─────────────────────────────────────────────────────────────────────────────

window.loadInterviewsList = async function() {
  const tbody = document.getElementById('interviews-table-body');
  try {
    const res = await fetch(`${API_BASE}/interviews`, {
      headers: { 'Authorization': `Bearer ${adminToken}` }
    });
    const data = await res.json();
    if (!data.success) return;

    cachedInterviews = data.interviews || [];
    renderInterviewsTable();
  } catch (err) {
    console.error('Failed to load interviews:', err);
    if (tbody) tbody.innerHTML = `<tr><td colspan="7" style="color:var(--danger); padding:2rem; text-align:center;">Failed to load interviews: ${err.message}</td></tr>`;
  }
};

function renderInterviewsTable() {
  const tbody = document.getElementById('interviews-table-body');
  if (!tbody) return;

  if (cachedInterviews.length === 0) {
    tbody.innerHTML = `<tr><td colspan="7" style="text-align:center; padding: 2rem; color: var(--text-muted);">No candidate screening interviews found.</td></tr>`;
    return;
  }

  tbody.innerHTML = cachedInterviews.map(i => {
    let stateBadge = '<span class="badge badge-neutral">Created</span>';
    if (i.state === 'in_progress') stateBadge = '<span class="badge badge-warning"><i class="bi bi-record-circle"></i> Live</span>';
    else if (i.state === 'completed' || i.state === 'report_ready') stateBadge = '<span class="badge badge-success"><i class="bi bi-check2"></i> Finished</span>';
    else if (i.state === 'disqualified') stateBadge = '<span class="badge badge-danger"><i class="bi bi-x-octagon"></i> Disqualified</span>';

    const scoreDisplay = i.score !== null 
      ? `<strong style="color:${i.score >= 70 ? 'var(--success)' : (i.score < 40 ? 'var(--danger)' : 'var(--warning)')}; font-size:0.95rem;">${i.score}/100</strong>`
      : `<span style="color:var(--text-subtle);">Pending</span>`;

    const proctorBadge = i.proctor_warnings > 0 
      ? `<span class="badge badge-danger" title="${escapeHtml(i.disqualified_reason || 'Proctor Breach')}">${i.proctor_warnings} Warn</span>`
      : `<span class="badge badge-neutral">Clean</span>`;

    const dateStr = i.started_at ? formatTimeAgo(i.started_at) : (i.expires_at ? `Exp: ${formatTimeAgo(i.expires_at)}` : 'Recently');

    return `
      <tr>
        <td>
          <strong style="color:var(--text); display:block;">${escapeHtml(i.candidate_name || 'Candidate')}</strong>
          <span style="font-size:0.75rem; color:var(--text-muted); font-family:var(--mono);">${escapeHtml(i.candidate_email || '')}</span>
          ${i.candidate_phone ? `<div style="font-size:0.7rem; color:var(--text-subtle);"><i class="bi bi-whatsapp"></i> ${escapeHtml(i.candidate_phone)}</div>` : ''}
        </td>
        <td>
          <strong style="display:block;">${escapeHtml(i.job_title || 'Software Role')}</strong>
          <span style="font-size:0.72rem; color:var(--text-subtle);">${escapeHtml(i.job_skills || '')}</span>
        </td>
        <td>
          <span style="font-weight:600;">${escapeHtml(i.org_name || 'Company')}</span>
        </td>
        <td>${stateBadge}</td>
        <td>
          <div>${scoreDisplay} &middot; ${proctorBadge}</div>
          <span style="font-size:0.7rem; color:var(--text-subtle);">${i.turns_count || 0} Turns</span>
        </td>
        <td style="font-size:0.75rem; color:var(--text-muted); font-family:var(--mono);">${dateStr}</td>
        <td style="text-align: right;">
          <button class="btn btn-primary btn-sm" onclick="inspectInterview('${i.id}')">
            <i class="bi bi-search"></i> Inspect Session
          </button>
        </td>
      </tr>
    `;
  }).join('');
}

window.inspectInterview = async function(interviewId) {
  const modal = document.getElementById('modal-inspect-interview');
  const body = document.getElementById('inspect-body');
  modal.classList.add('show');
  body.innerHTML = '<p style="text-align:center; padding:2rem; color:var(--text-muted);"><i class="bi bi-arrow-repeat spin"></i> Loading interview transcript and proctor audit logs...</p>';

  try {
    const res = await fetch(`${API_BASE}/interviews/${interviewId}`, {
      headers: { 'Authorization': `Bearer ${adminToken}` }
    });
    const data = await res.json();
    if (!data.success) throw new Error(data.error || 'Failed to inspect interview');

    const intv = data.interview;
    const turns = data.turns || [];
    const report = data.report || null;

    let turnsHtml = '';
    if (turns.length === 0) {
      turnsHtml = '<p style="color:var(--text-muted); font-size:0.8rem;">No transcript recorded for this session yet.</p>';
    } else {
      turnsHtml = turns.map(t => `
        <div style="padding: 0.75rem; border-radius: 8px; margin-bottom: 0.6rem; background-color: ${t.role === 'ai' ? 'var(--surface-elevated)' : (t.role === 'candidate' ? 'rgba(99, 102, 241, 0.08)' : 'rgba(239, 68, 68, 0.08)')}; border: 1px solid var(--border);">
          <div style="display:flex; justify-content:space-between; margin-bottom:0.3rem;">
            <strong style="text-transform:uppercase; font-size:0.7rem; color:${t.role === 'ai' ? 'var(--primary)' : (t.role === 'candidate' ? 'var(--success)' : 'var(--danger)')};">
              Turn ${t.idx}: ${t.role} ${t.skill ? `&middot; ${escapeHtml(t.skill)}` : ''}
            </strong>
            <span style="font-size:0.7rem; color:var(--text-subtle); font-family:var(--mono);">${formatTimeAgo(t.created_at)}</span>
          </div>
          <div style="font-size:0.8rem; line-height:1.45; color:var(--text); white-space:pre-wrap;">${escapeHtml(t.text)}</div>
        </div>
      `).join('');
    }

    let reportHtml = '';
    if (report) {
      reportHtml = `
        <div style="margin-top: 1.5rem; padding: 1rem; background-color: var(--surface-elevated); border-radius: 8px; border: 1px solid var(--border);">
          <div style="display:flex; align-items:center; justify-content:space-between; margin-bottom:0.75rem;">
            <h4 style="font-size:0.9rem; font-weight:700;"><i class="bi bi-file-earmark-text"></i> Evidence-Backed AI Evaluation Report</h4>
            <span class="badge ${report.candidate_verdict === 'RECOMMENDED_HIRE' ? 'badge-success' : (report.candidate_verdict === 'DISQUALIFIED' ? 'badge-danger' : 'badge-warning')}">
              ${report.candidate_verdict || 'EVALUATED'} &middot; Score: ${report.overall_score || 0}/100
            </span>
          </div>
          <p style="font-size:0.8rem; color:var(--text-muted); margin-bottom:0.75rem;">${escapeHtml(report.overall_summary || '')}</p>
          ${report.hiring_clarification ? `<div style="font-size:0.78rem; padding:0.5rem 0.75rem; background:rgba(99, 102, 241, 0.1); border-left:3px solid var(--primary); border-radius:4px; margin-bottom:0.75rem;">${escapeHtml(report.hiring_clarification)}</div>` : ''}
        </div>
      `;
    }

    body.innerHTML = `
      <div style="margin-bottom: 1.25rem; padding-bottom: 1rem; border-bottom: 1px solid var(--border);">
        <h3 style="font-size: 1.15rem; font-weight:800; color:var(--text); margin-bottom:0.25rem;">
          ${escapeHtml(intv.candidate_name || 'Candidate')} &mdash; ${escapeHtml(intv.job_title)}
        </h3>
        <p style="font-size:0.78rem; color:var(--text-muted);">
          Company: <strong>${escapeHtml(intv.org_name)}</strong> &middot; Email: <strong>${escapeHtml(intv.candidate_email)}</strong>
        </p>
      </div>

      <div style="display:grid; grid-template-columns: repeat(auto-fit, minmax(160px, 1fr)); gap:0.75rem; margin-bottom:1.25rem;">
        <div style="background:var(--surface-elevated); padding:0.75rem; border-radius:8px; border:1px solid var(--border);">
          <span style="font-size:0.7rem; color:var(--text-muted); text-transform:uppercase;">Session State</span>
          <div style="font-size:1rem; font-weight:700; color:var(--text); margin-top:0.2rem;">${intv.state}</div>
        </div>
        <div style="background:var(--surface-elevated); padding:0.75rem; border-radius:8px; border:1px solid var(--border);">
          <span style="font-size:0.7rem; color:var(--text-muted); text-transform:uppercase;">Proctor Warnings</span>
          <div style="font-size:1rem; font-weight:700; color:${intv.proctor_warnings > 0 ? 'var(--danger)' : 'var(--success)'}; margin-top:0.2rem;">
            ${intv.proctor_warnings || 0} Warns
          </div>
        </div>
        <div style="background:var(--surface-elevated); padding:0.75rem; border-radius:8px; border:1px solid var(--border);">
          <span style="font-size:0.7rem; color:var(--text-muted); text-transform:uppercase;">Max Time</span>
          <div style="font-size:1rem; font-weight:700; color:var(--text); margin-top:0.2rem;">${intv.max_minutes || 15} Mins</div>
        </div>
      </div>

      <h4 style="font-size:0.85rem; font-weight:700; margin-bottom:0.75rem;"><i class="bi bi-chat-left-text"></i> Full Conversational Transcript</h4>
      <div style="max-height:360px; overflow-y:auto; padding-right:0.5rem;">
        ${turnsHtml}
      </div>

      ${reportHtml}
    `;
  } catch (err) {
    body.innerHTML = `<p style="color:var(--danger); padding:2rem; text-align:center;">Failed to load interview details: ${err.message}</p>`;
  }
};

window.closeInspectModal = function() {
  document.getElementById('modal-inspect-interview').classList.remove('show');
};

// ─────────────────────────────────────────────────────────────────────────────
// TAB 5: PLATFORM ADMINISTRATORS & UNIQUE IDS (UNLIMITED ACCESS)
// ─────────────────────────────────────────────────────────────────────────────

window.loadAdminInvites = async function() {
  try {
    const res = await fetch(`${API_BASE}/team`, {
      headers: { 'Authorization': `Bearer ${adminToken}` }
    });
    const data = await res.json();
    if (!data.success) return;

    const adminsContainer = document.getElementById('admins-list-container');
    if (adminsContainer) {
      if ((data.admins || []).length === 0) {
        adminsContainer.innerHTML = '<p style="color:var(--text-muted); font-size:0.85rem;">No administrators registered yet.</p>';
      } else {
        adminsContainer.innerHTML = data.admins.map((adm, idx) => `
          <div style="display:flex; align-items:center; justify-content:space-between; gap:1rem; flex-wrap:wrap; padding:0.9rem 1.15rem; background-color:var(--surface-elevated); border:1px solid var(--border); border-radius:8px;">
            <div style="display:flex; align-items:center; gap:0.75rem;">
              <div style="width:36px; height:36px; border-radius:8px; background:linear-gradient(135deg, #6366f1, #8b5cf6); color:#fff; display:flex; align-items:center; justify-content:center; font-weight:800;">
                ${idx + 1}
              </div>
              <div>
                <strong style="display:block; font-size:0.88rem; color:var(--text);">${escapeHtml(adm.full_name || 'Admin')}</strong>
                <span style="font-size:0.75rem; color:var(--text-muted); font-family:var(--mono);">${escapeHtml(adm.email)}</span>
              </div>
            </div>
            <div style="display:flex; align-items:center; gap:0.6rem; flex-wrap:wrap;">
              <code class="code-font" style="padding:0.25rem 0.6rem; border-radius:6px; background:rgba(99,102,241,0.12); color:var(--primary); font-weight:700; font-size:0.82rem;">
                ${escapeHtml(adm.admin_uid || 'N/A')}
              </code>
              ${adm.admin_uid ? `
                <button class="btn btn-secondary btn-sm" onclick="copyAdminUid('${escapeHtml(adm.admin_uid)}')" title="Copy Unique Admin ID">
                  <i class="bi bi-clipboard"></i> Copy ID
                </button>
              ` : ''}
              <span class="badge badge-success"><i class="bi bi-shield-fill-check"></i> Active</span>
              <span style="font-size:0.7rem; color:var(--text-subtle);">Joined ${formatTimeAgo(adm.created_at)}</span>
            </div>
          </div>
        `).join('');
      }
    }
  } catch (err) {
    console.error('Failed to load admin team:', err);
  }
};

window.loadAdminTeam = window.loadAdminInvites;

window.copyAdminUid = function(uid) {
  navigator.clipboard.writeText(uid);
  showToast(`Copied Unique Admin ID: ${uid}`, 'success');
};

// ─────────────────────────────────────────────────────────────────────────────
// TAB: ORDERS & SUBSCRIPTIONS
// ─────────────────────────────────────────────────────────────────────────────

let cachedOrders = [];

window.loadOrdersDirectory = async function() {
  const tbody = document.getElementById('orders-table-body');
  try {
    const res = await fetch(`${API_BASE}/orders`, {
      headers: { 'Authorization': `Bearer ${adminToken}` }
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || 'Failed to load orders');

    cachedOrders = data.orders || [];
    const stats = data.stats || {};

    const elRev = document.getElementById('kpi-orders-revenue');
    const elPaid = document.getElementById('kpi-orders-paid');
    const elPending = document.getElementById('kpi-orders-pending');
    const elTotal = document.getElementById('kpi-orders-total');

    if (elRev) elRev.textContent = `$${parseFloat(stats.totalRevenue || 0).toFixed(2)}`;
    if (elPaid) elPaid.textContent = stats.paidOrders || 0;
    if (elPending) elPending.textContent = stats.pendingOrders || 0;
    if (elTotal) elTotal.textContent = stats.totalOrders || 0;

    renderOrdersTable();
  } catch (err) {
    if (tbody) tbody.innerHTML = `<tr><td colspan="7" style="color:var(--danger); text-align:center; padding:1.5rem;">${escapeHtml(err.message)}</td></tr>`;
  }
};

window.renderOrdersTable = function() {
  const tbody = document.getElementById('orders-table-body');
  if (!tbody) return;

  const filterStatus = document.getElementById('filter-orders-status')?.value || '';
  const filtered = cachedOrders.filter(o => !filterStatus || o.status === filterStatus);

  if (filtered.length === 0) {
    tbody.innerHTML = `<tr><td colspan="7" style="text-align:center; padding:2rem; color:var(--text-muted);">No orders found.</td></tr>`;
    return;
  }

  tbody.innerHTML = filtered.map(o => {
    const isPaid = o.status === 'paid';
    const planDesc = o.type === 'pay_per_use' 
      ? `${o.quantity} interviews (${o.duration_minutes}m)` 
      : (o.plan_id ? o.plan_id.replace(/_/g, ' ').toUpperCase() : 'Subscription');

    return `
      <tr>
        <td><code style="font-size:0.75rem; color:var(--primary);">${escapeHtml(o.id.substring(0, 16))}…</code></td>
        <td>
          <strong>${escapeHtml(o.org_name || 'Organization')}</strong><br>
          <span style="font-size:0.72rem; color:var(--text-muted);">${escapeHtml(o.recruiter_email || o.recruiter_name || 'N/A')}</span>
        </td>
        <td>
          <span class="badge ${o.type === 'pay_per_use' ? 'badge-primary' : 'badge-info'}" style="text-transform:uppercase; font-size:0.68rem;">
            ${escapeHtml(o.type)}
          </span>
          <span style="font-size:0.75rem; margin-left:0.3rem;">${escapeHtml(planDesc)}</span>
        </td>
        <td style="font-weight:700; color:var(--text);">$${parseFloat(o.amount_usd || 0).toFixed(2)}</td>
        <td>
          <span class="badge ${isPaid ? 'badge-success' : 'badge-warning'}">
            <i class="bi ${isPaid ? 'bi-check-circle-fill' : 'bi-clock-history'}"></i> ${escapeHtml(o.status.toUpperCase())}
          </span>
        </td>
        <td style="font-size:0.75rem; color:var(--text-muted);">${new Date(o.created_at).toLocaleDateString()}</td>
        <td style="text-align:right;">
          ${!isPaid ? `
            <button class="btn btn-success btn-sm" onclick="markOrderPaid('${o.id}')" title="Manually approve order and credit organization">
              <i class="bi bi-check-lg"></i> Mark Paid &amp; Credit
            </button>
          ` : `
            <span style="font-size:0.72rem; color:var(--success);"><i class="bi bi-patch-check-fill"></i> Credited</span>
          `}
        </td>
      </tr>
    `;
  }).join('');
};

window.markOrderPaid = async function(orderId) {
  if (!confirm(`Mark order ${orderId} as paid and grant interview credits to organization?`)) return;
  try {
    const res = await fetch(`${API_BASE}/orders/${orderId}/mark-paid`, {
      method: 'POST',
      headers: { 'Authorization': `Bearer ${adminToken}` }
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || 'Failed to approve order');

    showToast(data.message, 'success');
    loadOrdersDirectory();
    loadDashboardStats(true);
  } catch (err) {
    showToast(err.message, 'danger');
  }
};

// ─────────────────────────────────────────────────────────────────────────────
// TAB 6: GOVERNANCE SETTINGS & SMTP MAIL SETUP
// ─────────────────────────────────────────────────────────────────────────────

window.loadPlatformSettings = async function() {
  try {
    const res = await fetch(`${API_BASE}/settings`, {
      headers: { 'Authorization': `Bearer ${adminToken}` }
    });
    const data = await res.json();
    if (!data.success) return;

    const s = data.settings || {};
    const emailStatus = data.emailStatus || data.smtpStatus || {};

    const chk = document.getElementById('setting-require-approval');
    const credits = document.getElementById('setting-trial-credits');

    if (chk) chk.checked = s.require_admin_approval === '1';
    if (credits && s.default_trial_credits) credits.value = s.default_trial_credits;

    // Email Settings Inputs (DB -> Server Env emailStatus -> Saved Non-Secret Local Profile -> Defaults)
    const localSmtp = getLocalSmtpProfile();
    const setVal = (id, val) => { const el = document.getElementById(id); if (el && val !== undefined) el.value = val; };
    setVal('setting-email-provider', s.email_provider || (emailStatus.preferredProvider && emailStatus.preferredProvider !== 'auto' ? emailStatus.preferredProvider : '') || localSmtp.email_provider || (s.resend_api_key ? 'auto' : 'smtp'));
    setVal('setting-resend-api-key', s.resend_api_key || '');
    setVal('setting-smtp-host', s.smtp_host || emailStatus.host || localSmtp.smtp_host || 'smtp.gmail.com');
    setVal('setting-smtp-port', s.smtp_port || (emailStatus.port ? String(emailStatus.port) : '') || localSmtp.smtp_port || '587');
    setVal('setting-smtp-user', s.smtp_user || emailStatus.user || localSmtp.smtp_user || '');
    setVal('setting-smtp-pass', s.smtp_pass || (emailStatus.hasPass ? '••••••••' : ''));
    setVal('setting-smtp-from-name', s.smtp_from_name || emailStatus.fromName || localSmtp.smtp_from_name || 'RoundOne AI Platform');
    setVal('setting-smtp-from-email', s.smtp_from_email || emailStatus.fromEmail || localSmtp.smtp_from_email || emailStatus.user || '');

    const chkSecure = document.getElementById('setting-smtp-secure');
    if (chkSecure) {
      chkSecure.checked = (s.smtp_secure === '1') || (!s.smtp_secure && (Boolean(emailStatus.secure) || localSmtp.smtp_secure === '1'));
    }

    const badge = document.getElementById('smtp-status-badge');
    if (badge) {
      if (emailStatus.isConfigured) {
        badge.className = 'badge badge-success';
        badge.innerHTML = `<i class="bi bi-check-circle-fill"></i> Live Email Active (${(emailStatus.provider || 'SMTP').toUpperCase()})`;
      } else {
        badge.className = 'badge badge-warning';
        badge.innerHTML = `<i class="bi bi-exclamation-triangle-fill"></i> Email Credentials Needed`;
      }
    }

    // Database Status & Settings Inputs
    const dbStatus = data.databaseStatus || {};
    setVal('setting-database-url', s.database_url || '');

    const dbBadge = document.getElementById('db-status-badge');
    const dbDisplay = document.getElementById('db-engine-display');

    if (dbBadge) {
      if (dbStatus.isPostgresConnected) {
        dbBadge.className = 'badge badge-success';
        dbBadge.innerHTML = `<i class="bi bi-database-check"></i> PostgreSQL Connected (${dbStatus.postgresLatencyMs}ms)`;
      } else if (dbStatus.hasDatabaseUrl) {
        dbBadge.className = 'badge badge-warning';
        dbBadge.innerHTML = `<i class="bi bi-exclamation-circle"></i> PostgreSQL Configured (Unreachable)`;
      } else {
        dbBadge.className = 'badge badge-info';
        dbBadge.innerHTML = `<i class="bi bi-file-earmark-code"></i> SQLite Active (Local)`;
      }
    }

    if (dbDisplay) {
      if (dbStatus.isPostgresConnected) {
        dbDisplay.style.color = 'var(--success)';
        dbDisplay.innerHTML = `<strong>PostgreSQL Active</strong> &mdash; ${escapeHtml(dbStatus.postgresVersion ? dbStatus.postgresVersion.split(' on ')[0] : 'Connected')} (Latency: ${dbStatus.postgresLatencyMs}ms)`;
      } else {
        dbDisplay.style.color = 'var(--primary)';
        dbDisplay.innerHTML = `<strong>SQLite Active</strong> &mdash; Local embedded zero-dependency database (<code>ai_interviewer.db</code>). PostgreSQL driver ready for deployment.`;
      }
    }
  } catch (err) {
    console.error('Failed to load settings:', err);
  }
};

window.savePlatformSettings = async function() {
  const requireApproval = document.getElementById('setting-require-approval').checked ? '1' : '0';
  const defaultCredits = document.getElementById('setting-trial-credits').value;

  try {
    const res = await fetch(`${API_BASE}/settings`, {
      method: 'PUT',
      headers: {
        'Authorization': `Bearer ${adminToken}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        settings: {
          require_admin_approval: requireApproval,
          default_trial_credits: defaultCredits
        }
      })
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || 'Failed to save settings');

    showToast('Platform governance settings updated!', 'success');
  } catch (err) {
    showToast(err.message, 'danger');
  }
};

function collectEmailSettingsPayload() {
  const emailProvider = document.getElementById('setting-email-provider')?.value || 'auto';
  const resendKey = document.getElementById('setting-resend-api-key')?.value.trim();
  let host = document.getElementById('setting-smtp-host')?.value.trim();
  const port = document.getElementById('setting-smtp-port')?.value.trim() || '587';
  const user = document.getElementById('setting-smtp-user')?.value.trim();
  const pass = document.getElementById('setting-smtp-pass')?.value;
  const fromName = document.getElementById('setting-smtp-from-name')?.value.trim();
  const fromEmail = document.getElementById('setting-smtp-from-email')?.value.trim();
  let secure = document.getElementById('setting-smtp-secure')?.checked ? '1' : '0';

  if (host && host.includes('@')) {
    host = 'smtp.gmail.com';
    const hostInput = document.getElementById('setting-smtp-host');
    if (hostInput) hostInput.value = 'smtp.gmail.com';
    showToast('Auto-corrected SMTP Host to smtp.gmail.com (server address)', 'warning');
  }

  if (port === '587' && secure === '1') {
    secure = '0';
    const chkSecure = document.getElementById('setting-smtp-secure');
    if (chkSecure) chkSecure.checked = false;
    showToast('Auto-disabled SSL for Port 587 (Port 587 uses STARTTLS)', 'warning');
  }

  return {
    email_provider: emailProvider,
    resend_api_key: resendKey,
    smtp_host: host,
    smtp_port: port,
    smtp_user: user,
    smtp_pass: pass,
    smtp_from_name: fromName,
    smtp_from_email: fromEmail,
    smtp_secure: secure
  };
}

window.saveSmtpSettings = async function() {
  try {
    const settingsPayload = collectEmailSettingsPayload();
    const res = await fetch(`${API_BASE}/settings`, {
      method: 'PUT',
      headers: {
        'Authorization': `Bearer ${adminToken}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        settings: settingsPayload
      })
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || 'Failed to save email settings');

    saveLocalSmtpProfile(settingsPayload);
    showToast('Email Delivery Configuration saved successfully!', 'success');
    loadPlatformSettings();
  } catch (err) {
    showToast(err.message, 'danger');
  }
};

window.sendTestSmtpEmail = async function() {
  const recipientInput = document.getElementById('smtp-test-recipient');
  const btn = document.getElementById('btn-test-smtp');
  const resultDiv = document.getElementById('smtp-test-result');
  const recipientEmail = recipientInput?.value.trim();

  if (btn) { btn.disabled = true; btn.innerHTML = '<i class="bi bi-arrow-repeat spin"></i> Testing SMTP Handshake...'; }
  if (resultDiv) { resultDiv.style.display = 'none'; }

  try {
    const settingsPayload = collectEmailSettingsPayload();
    const res = await fetch(`${API_BASE}/settings/test-email`, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${adminToken}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({ recipientEmail, settings: settingsPayload })
    });
    const data = await res.json();

    if (!res.ok) throw new Error(data.error || 'SMTP delivery handshake failed');

    saveLocalSmtpProfile(settingsPayload);
    if (resultDiv) {
      resultDiv.style.display = 'block';
      resultDiv.style.color = 'var(--success)';
      resultDiv.innerHTML = `<strong>✓ Success:</strong> ${escapeHtml(data.message)}`;
    }
    showToast('Test email successfully dispatched!', 'success');
    loadPlatformSettings();
  } catch (err) {
    if (resultDiv) {
      resultDiv.style.display = 'block';
      resultDiv.style.color = 'var(--danger)';
      resultDiv.innerHTML = `<strong>❌ Handshake Failed:</strong> ${escapeHtml(err.message)}`;
    }
    showToast(err.message, 'danger');
  } finally {
    if (btn) { btn.disabled = false; btn.innerHTML = '<i class="bi bi-lightning-charge"></i> Send Test Email'; }
  }
};

window.saveDatabaseSettings = async function() {
  const dbUrl = document.getElementById('setting-database-url')?.value.trim();

  try {
    const res = await fetch(`${API_BASE}/settings`, {
      method: 'PUT',
      headers: {
        'Authorization': `Bearer ${adminToken}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        settings: {
          database_url: dbUrl
        }
      })
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || 'Failed to save database configuration');

    showToast('Database configuration saved successfully!', 'success');
    loadPlatformSettings();
  } catch (err) {
    showToast(err.message, 'danger');
  }
};

window.testDatabaseConnection = async function() {
  const btn = document.getElementById('btn-test-db');
  const resultDiv = document.getElementById('db-test-result');

  if (btn) { btn.disabled = true; btn.innerHTML = '<i class="bi bi-arrow-repeat spin"></i> Testing Connection...'; }
  if (resultDiv) { resultDiv.style.display = 'none'; }

  try {
    const res = await fetch(`${API_BASE}/settings/test-db`, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${adminToken}`,
        'Content-Type': 'application/json'
      }
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || 'Connection failed');

    if (resultDiv) {
      resultDiv.style.display = 'block';
      resultDiv.style.color = 'var(--success)';
      resultDiv.innerHTML = `<strong>✓ PostgreSQL Live:</strong> ${escapeHtml(data.message)}`;
    }
    showToast('PostgreSQL Connection Verified!', 'success');
    loadPlatformSettings();
  } catch (err) {
    if (resultDiv) {
      resultDiv.style.display = 'block';
      resultDiv.style.color = 'var(--danger)';
      resultDiv.innerHTML = `<strong>❌ Connection Failed:</strong> ${escapeHtml(err.message)}`;
    }
    showToast(err.message, 'danger');
  } finally {
    if (btn) { btn.disabled = false; btn.innerHTML = '<i class="bi bi-broadcast"></i> Test PostgreSQL Connection'; }
  }
};

window.runDatabaseMigration = async function() {
  const confirmed = confirm('Are you sure you want to run the SQLite → PostgreSQL migration?\n\nThis will bootstrap all tables in PostgreSQL and sync all current organizations, recruiters, jobs, candidates, interviews, turns, and billing orders into PostgreSQL.');
  if (!confirmed) return;

  const btn = document.getElementById('btn-migrate-db');
  const resultDiv = document.getElementById('db-test-result');

  if (btn) { btn.disabled = true; btn.innerHTML = '<i class="bi bi-arrow-repeat spin"></i> Migrating Data...'; }
  if (resultDiv) { resultDiv.style.display = 'none'; }

  try {
    const res = await fetch(`${API_BASE}/settings/migrate-pg`, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${adminToken}`,
        'Content-Type': 'application/json'
      }
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || 'Migration failed');

    const summary = data.counts ? Object.entries(data.counts).map(([k, v]) => `${k}: ${v}`).join(', ') : 'All tables migrated';

    if (resultDiv) {
      resultDiv.style.display = 'block';
      resultDiv.style.color = 'var(--success)';
      resultDiv.innerHTML = `<strong>✓ Migration Successful!</strong><br><small style="color:var(--text-muted);">${escapeHtml(summary)}</small>`;
    }
    showToast('SQLite → PostgreSQL migration completed!', 'success');
    loadPlatformSettings();
  } catch (err) {
    if (resultDiv) {
      resultDiv.style.display = 'block';
      resultDiv.style.color = 'var(--danger)';
      resultDiv.innerHTML = `<strong>❌ Migration Error:</strong> ${escapeHtml(err.message)}`;
    }
    showToast(err.message, 'danger');
  } finally {
    if (btn) { btn.disabled = false; btn.innerHTML = '<i class="bi bi-arrow-repeat"></i> Migrate SQLite &rarr; PostgreSQL'; }
  }
};

// ─────────────────────────────────────────────────────────────────────────────
// UTILITIES & HELPERS
// ─────────────────────────────────────────────────────────────────────────────

function showToast(message, type = 'info') {
  const container = document.getElementById('toast-container');
  if (!container) return;

  const icons = {
    success: 'bi-check-circle-fill',
    warning: 'bi-exclamation-triangle-fill',
    danger: 'bi-x-circle-fill',
    info: 'bi-info-circle-fill'
  };

  const toast = document.createElement('div');
  toast.className = 'toast';
  toast.style.borderLeft = `4px solid var(--${type})`;
  toast.innerHTML = `
    <i class="bi ${icons[type] || 'bi-info-circle'}" style="color:var(--${type}); font-size:1.1rem;"></i>
    <span>${message}</span>
  `;

  container.appendChild(toast);
  setTimeout(() => {
    toast.style.transition = 'opacity 0.3s ease, transform 0.3s ease';
    toast.style.opacity = '0';
    toast.style.transform = 'translateY(10px)';
    setTimeout(() => toast.remove(), 300);
  }, 4000);
}

function escapeHtml(str) {
  if (!str) return '';
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}

function formatTimeAgo(isoString) {
  if (!isoString) return 'Just now';
  const date = new Date(isoString);
  const diffSec = Math.floor((Date.now() - date.getTime()) / 1000);

  if (diffSec < 60) return `${Math.max(1, diffSec)}s ago`;
  const diffMin = Math.floor(diffSec / 60);
  if (diffMin < 60) return `${diffMin}m ago`;
  const diffHr = Math.floor(diffMin / 60);
  if (diffHr < 24) return `${diffHr}h ago`;
  const diffDays = Math.floor(diffHr / 24);
  return `${diffDays}d ago`;
}
