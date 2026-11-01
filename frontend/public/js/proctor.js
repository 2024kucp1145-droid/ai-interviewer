/**
 * Live Camera & Anti-Cheating Screen Exit Proctor Engine
 * 
 * Enforces:
 * 1. Continuous Live Camera Feed (floating PIP webcam widget)
 * 2. Strict Screen Exit Monitoring (disqualifies if user switches tabs, minimizes, or navigates away)
 */

export class ProctorEngine {
  constructor(options = {}) {
    this.token = options.token || '';
    this.onWarning = options.onWarning || (() => {});
    this.onDisqualify = options.onDisqualify || (() => {});

    this.warningsCount = 0;
    this.violations = [];
    this.isActive = false;
    this.isArmed = false; // Grace period so startup events don't trigger false positives
    this.videoStream = null;
    this.videoEl = null;
    this.exitTimeoutId = null;
    this.armTimeoutId = null;
  }

  /**
   * Initializes proctoring: requests camera & mounts floating PIP preview
   */
  async initialize(containerEl) {
    try {
      this.videoStream = await navigator.mediaDevices.getUserMedia({
        video: {
          width: { ideal: 640 },
          height: { ideal: 480 },
          facingMode: 'user'
        },
        audio: false
      });
    } catch (err) {
      console.error('[ProctorEngine] Camera access error:', err);
      throw new Error('Camera permission is required for the interview. Please allow camera access and refresh.');
    }

    this.mountWidget(containerEl);
    this.bindWindowEvents();
    this.isActive = true;

    // Arm screen exit detection after 4 seconds grace period
    this.armTimeoutId = setTimeout(() => {
      this.isArmed = true;
      console.log('[ProctorEngine] Screen exit protection is now active.');
    }, 4000);
  }

  /**
   * Optional helper to request fullscreen if supported (does not disqualify on exit)
   */
  async requestFullScreen() {
    // Non-blocking, optional
  }

  /**
   * Mounts floating picture-in-picture webcam widget
   */
  mountWidget(parent = document.body) {
    const existing = document.getElementById('proctor-pip-widget');
    if (existing) existing.remove();

    const wrapper = document.createElement('div');
    wrapper.id = 'proctor-pip-widget';
    wrapper.innerHTML = `
      <div class="proctor-pip-card">
        <div class="proctor-pip-header">
          <div class="proctor-pip-status">
            <span class="proctor-pip-dot"></span>
            <span>Live Camera Active</span>
          </div>
          <span style="font-size:0.65rem; color:var(--text-muted);"><i class="bi bi-shield-check"></i> Monitored</span>
        </div>
        <div class="proctor-video-wrapper">
          <video id="proctor-webcam-feed" autoplay playsinline muted></video>
        </div>
        <div class="proctor-status-footer">
          <span id="proctor-footer-detail"><i class="bi bi-camera-video-fill"></i> Candidate Webcam Active</span>
        </div>
      </div>
    `;

    parent.appendChild(wrapper);

    this.videoEl = document.getElementById('proctor-webcam-feed');
    if (this.videoEl && this.videoStream) {
      this.videoEl.srcObject = this.videoStream;
      this.videoEl.play().catch(e => console.warn('[ProctorEngine] Video play error:', e));
    }
  }

  /**
   * Bind screen exit monitoring (tab switch, window minimize, navigating away)
   */
  bindWindowEvents() {
    const triggerExitDisqualification = (reason) => {
      if (!this.isActive || !this.isArmed) return;
      console.warn('[ProctorEngine] Screen exit confirmed:', reason);
      this.handleDisqualification(reason);
    };

    // 1. Tab switch or minimize check (visibilitychange)
    document.addEventListener('visibilitychange', () => {
      if (!this.isActive || !this.isArmed) return;

      if (document.hidden) {
        console.warn('[ProctorEngine] Candidate tab hidden / minimized. Starting exit timer...');
        // 2.5 second confirmation buffer
        if (!this.exitTimeoutId) {
          this.exitTimeoutId = setTimeout(() => {
            if (this.isActive && document.hidden) {
              triggerExitDisqualification('Security Breach: Candidate exited the active interview screen / switched tabs.');
            }
          }, 2500);
        }
      } else {
        // Returned to tab within buffer
        if (this.exitTimeoutId) {
          clearTimeout(this.exitTimeoutId);
          this.exitTimeoutId = null;
        }
      }
    });

    // 2. Window blur (clicking outside or switching windows)
    window.addEventListener('blur', () => {
      if (!this.isActive || !this.isArmed) return;

      // Check if candidate actually left the page
      if (!this.exitTimeoutId) {
        this.exitTimeoutId = setTimeout(() => {
          if (this.isActive && (document.hidden || !document.hasFocus())) {
            triggerExitDisqualification('Security Breach: Candidate navigated away from the active interview window.');
          }
        }, 3000);
      }
    });

    // When window regains focus, clear pending exit timeout
    window.addEventListener('focus', () => {
      if (this.exitTimeoutId) {
        clearTimeout(this.exitTimeoutId);
        this.exitTimeoutId = null;
      }
    });
  }

  /**
   * Disqualify Candidate and Terminate Session
   */
  async handleDisqualification(reason) {
    if (!this.isActive) return;
    this.isActive = false;
    this.isArmed = false;

    if (this.exitTimeoutId) clearTimeout(this.exitTimeoutId);
    if (this.armTimeoutId) clearTimeout(this.armTimeoutId);

    if (this.videoStream) {
      this.videoStream.getTracks().forEach(t => t.stop());
    }

    console.warn('[ProctorEngine] Candidate Disqualified:', reason);

    this.violations.push({
      reason,
      time: new Date().toLocaleTimeString('en-US', { hour12: false }),
      timestamp: new Date().toISOString()
    });

    // Submit disqualification to backend
    try {
      await fetch(`/i/${this.token}/disqualify`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          reason,
          warnings: this.warningsCount,
          violations: this.violations
        })
      });
    } catch (err) {
      console.error('Failed to notify backend of disqualification:', err);
    }

    if (this.onDisqualify) {
      this.onDisqualify(reason, this.violations);
    }

    // Render locked disqualification screen
    this.renderDisqualifiedScreen(reason);
  }

  /**
   * Renders the terminal Disqualification Screen
   */
  renderDisqualifiedScreen(reason) {
    document.body.innerHTML = `
      <div class="proctor-disqualified-view">
        <div class="proctor-disqualified-card">
          <div class="disqualified-header">
            <i class="bi bi-shield-x"></i>
            <h1>ASSESSMENT DISQUALIFIED</h1>
            <p>Session Terminated for Leaving Interview Screen</p>
          </div>
          <div class="disqualified-body">
            <div class="disqualified-reason-box">
              <strong>Primary Reason for Disqualification:</strong>
              <p>${reason}</p>
            </div>
            <div class="disqualified-notice">
              This screening session has been locked and permanently recorded as <strong>NOT RECOMMENDED (DISQUALIFIED)</strong> in the recruiting company dashboard. Your camera stream and input access have been terminated.
            </div>
          </div>
          <div class="disqualified-footer">
            <button class="btn btn-secondary" onclick="window.close()" style="width: auto; padding: 0.6rem 1.5rem; background:#fff; color:#000;">
              Close Window
            </button>
          </div>
        </div>
      </div>
    `;
  }

  /**
   * Stop proctoring cleanly when interview completes normally
   */
  stop() {
    this.isActive = false;
    this.isArmed = false;
    if (this.exitTimeoutId) clearTimeout(this.exitTimeoutId);
    if (this.armTimeoutId) clearTimeout(this.armTimeoutId);
    if (this.videoStream) {
      this.videoStream.getTracks().forEach(t => t.stop());
    }
    const pip = document.getElementById('proctor-pip-widget');
    if (pip) pip.remove();
  }
}
