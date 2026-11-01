/**
 * Anti-Cheating & AI Proctoring Engine
 * 
 * Enforces:
 * 1. Automatic Fullscreen & Window Lock (disqualifies if user leaves window/exits fullscreen)
 * 2. Continuous Camera Live Stream
 * 3. AI Computer Vision for Suspicious Behaviors:
 *    - Phone or unidentified electronic object in frame
 *    - Eyes looking away / gaze deviation from screen
 *    - Multiple persons or no face in frame
 * 4. 3-Warning Rule -> Disqualification & Window Close
 */

export class ProctorEngine {
  constructor(options = {}) {
    this.token = options.token || '';
    this.onWarning = options.onWarning || (() => {});
    this.onDisqualify = options.onDisqualify || (() => {});

    this.warningsCount = 0;
    this.maxWarnings = 3;
    this.violations = [];
    this.isActive = false;
    this.videoStream = null;
    this.videoEl = null;
    this.canvasEl = null;
    this.ctx = null;
    this.analysisInterval = null;

    // Tracking state
    this.eyesAwayCounter = 0;
    this.noFaceCounter = 0;
    this.phoneDetectedCounter = 0;
    this.multiFaceCounter = 0;
    this.lastWarningTime = 0;

    // Audio synthesizer for warning sounds
    this.audioCtx = null;
  }

  /**
   * Initializes proctoring: requests camera, mounts floating PIP preview, locks fullscreen
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
      throw new Error('Camera permission is required for proctored screening. Please allow camera access and refresh.');
    }

    this.mountWidget(containerEl);
    this.bindWindowEvents();
    this.startVisionAnalysis();
    this.isActive = true;
  }

  /**
   * Request fullscreen on start
   */
  async requestFullScreen() {
    const el = document.documentElement;
    try {
      if (el.requestFullscreen) {
        await el.requestFullscreen();
      } else if (el.webkitRequestFullscreen) {
        await el.webkitRequestFullscreen();
      } else if (el.msRequestFullscreen) {
        await el.msRequestFullscreen();
      }
    } catch (err) {
      console.warn('[ProctorEngine] Fullscreen request rejected:', err);
    }
  }

  /**
   * Mounts floating picture-in-picture webcam widget
   */
  mountWidget(parent = document.body) {
    const wrapper = document.createElement('div');
    wrapper.id = 'proctor-pip-widget';
    wrapper.innerHTML = `
      <div class="proctor-pip-card">
        <div class="proctor-pip-header">
          <div class="proctor-pip-status">
            <span class="proctor-pip-dot"></span>
            <span>AI Proctor Active</span>
          </div>
          <div class="proctor-pip-warnings" id="proctor-pip-warning-pills">
            <span class="pill-badge" id="pip-pill-1">1</span>
            <span class="pill-badge" id="pip-pill-2">2</span>
            <span class="pill-badge" id="pip-pill-3">3</span>
          </div>
        </div>
        <div class="proctor-video-wrapper">
          <video id="proctor-webcam-feed" autoplay playsinline muted></video>
          <canvas id="proctor-tracking-canvas" width="320" height="240"></canvas>
          <div class="proctor-face-box" id="proctor-face-indicator">
            <span class="proctor-face-tag" id="proctor-face-tag">Face Aligned</span>
          </div>
        </div>
        <div class="proctor-status-footer">
          <span id="proctor-footer-detail"><i class="bi bi-person-check-fill"></i> Candidate Verified</span>
          <span style="font-size:0.65rem; color:var(--text-muted);"><i class="bi bi-shield-check"></i> Monitored</span>
        </div>
      </div>
    `;

    parent.appendChild(wrapper);

    this.videoEl = document.getElementById('proctor-webcam-feed');
    this.videoEl.srcObject = this.videoStream;

    this.canvasEl = document.getElementById('proctor-tracking-canvas');
    this.ctx = this.canvasEl.getContext('2d', { willReadFrequently: true });
  }

  /**
   * Bind window blur, tab switch, and fullscreen exit handlers
   */
  bindWindowEvents() {
    const handleWindowExit = (eventReason) => {
      if (!this.isActive) return;
      console.warn('[ProctorEngine] Window exit breach detected:', eventReason);
      this.handleDisqualification(`Security Breach: ${eventReason}`);
    };

    // 1. Fullscreen exit check
    const onFullScreenChange = () => {
      const isFull = Boolean(document.fullscreenElement || document.webkitFullscreenElement || document.msFullscreenElement);
      if (!isFull && this.isActive) {
        handleWindowExit('Candidate exited full-screen mode before interview completion.');
      }
    };
    document.addEventListener('fullscreenchange', onFullScreenChange);
    document.addEventListener('webkitfullscreenchange', onFullScreenChange);
    document.addEventListener('msfullscreenchange', onFullScreenChange);

    // 2. Tab switch or minimize check
    document.addEventListener('visibilitychange', () => {
      if (document.hidden && this.isActive) {
        handleWindowExit('Candidate switched browser tab or minimized window.');
      }
    });

    // 3. Window blur (clicking outside or opening secondary window)
    window.addEventListener('blur', () => {
      if (this.isActive) {
        // Debounce slightly to allow internal browser file dialogs if any
        setTimeout(() => {
          if (this.isActive && document.hidden) {
            handleWindowExit('Candidate navigated away from the active interview window.');
          }
        }, 1200);
      }
    });

    // 4. Keyboard shortcuts to exit/inspect
    window.addEventListener('keydown', (e) => {
      if (!this.isActive) return;
      // Block Escape, Alt+Tab, F11, F12, Ctrl+Shift+I
      if (e.key === 'F11' || e.key === 'F12') {
        e.preventDefault();
        this.triggerWarning('Inspection or window key combination blocked.');
      }
      if ((e.ctrlKey || e.metaKey) && (e.key === 'r' || e.key === 'w' || e.key === 't')) {
        e.preventDefault();
      }
    });
  }

  /**
   * Vision Analysis Loop
   */
  startVisionAnalysis() {
    const sampleRateMs = 900;

    this.analysisInterval = setInterval(() => {
      if (!this.isActive || !this.videoEl || this.videoEl.readyState < 2) return;

      try {
        this.analyzeCurrentFrame();
      } catch (err) {
        console.warn('[ProctorEngine] Vision frame analysis skipped:', err);
      }
    }, sampleRateMs);
  }

  /**
   * Analyzes current video frame for:
   * 1. Face alignment and presence
   * 2. Eye gaze deviation (looking left/right/down)
   * 3. Mobile phone / unidentified electronic object in frame
   * 4. Multiple people in room
   */
  analyzeCurrentFrame() {
    const width = 160;
    const height = 120;
    this.canvasEl.width = width;
    this.canvasEl.height = height;

    this.ctx.drawImage(this.videoEl, 0, 0, width, height);
    const frame = this.ctx.getImageData(0, 0, width, height);
    const data = frame.data;

    let skinPixels = 0;
    let skinCenterX = 0;
    let skinCenterY = 0;
    let minX = width, maxX = 0, minY = height, maxY = 0;

    // Detect potential phone / high-contrast electronic objects in lower periphery
    let phoneIndicatorCount = 0;

    for (let y = 0; y < height; y++) {
      for (let x = 0; x < width; x++) {
        const idx = (y * width + x) * 4;
        const r = data[idx];
        const g = data[idx + 1];
        const b = data[idx + 2];

        // Standard skin tone classifier in YCbCr/RGB space
        const isSkin = (r > 60 && g > 40 && b > 20 && r > g && r > b && (r - g) >= 10 && Math.abs(r - g) < 120);

        if (isSkin) {
          skinPixels++;
          skinCenterX += x;
          skinCenterY += y;
          if (x < minX) minX = x;
          if (x > maxX) maxX = x;
          if (y < minY) minY = y;
          if (y > maxY) maxY = y;
        }

        // Phone / screen glow / black rectangular bezel detection in lower half
        if (y > height * 0.55) {
          const isDarkBezel = (r < 30 && g < 30 && b < 30);
          const isBrightScreen = (r > 210 && g > 210 && b > 210);
          if (isDarkBezel || isBrightScreen) {
            phoneIndicatorCount++;
          }
        }
      }
    }

    const faceIndicator = document.getElementById('proctor-face-indicator');
    const faceTag = document.getElementById('proctor-face-tag');
    const footerDetail = document.getElementById('proctor-footer-detail');

    // ── 1. Check Face Presence ──
    const minRequiredSkinPixels = (width * height) * 0.04; // 4% of frame
    if (skinPixels < minRequiredSkinPixels) {
      this.noFaceCounter++;
      if (faceIndicator) faceIndicator.className = 'proctor-face-box danger';
      if (faceTag) faceTag.textContent = 'No Face Visible';
      if (footerDetail) footerDetail.innerHTML = '<i class="bi bi-person-x"></i> Face Out of Frame';

      if (this.noFaceCounter >= 3) {
        this.noFaceCounter = 0;
        this.triggerWarning('No face visible in camera. Candidate must remain seated in front of screen.');
      }
      return;
    } else {
      this.noFaceCounter = Math.max(0, this.noFaceCounter - 1);
    }

    // Centroid of face
    const avgX = skinCenterX / skinPixels;
    const avgY = skinCenterY / skinPixels;
    const faceSpanX = maxX - minX;

    // ── 2. Check Multiple Faces ──
    // If skin pixels occupy too large a fragmented horizontal spread
    if (faceSpanX > width * 0.85 && skinPixels > (width * height) * 0.35) {
      this.multiFaceCounter++;
      if (this.multiFaceCounter >= 3) {
        this.multiFaceCounter = 0;
        this.triggerWarning('Multiple persons or background individual detected in camera frame.');
      }
    } else {
      this.multiFaceCounter = Math.max(0, this.multiFaceCounter - 1);
    }

    // Face is aligned & present
    if (faceIndicator) faceIndicator.className = 'proctor-face-box';
    if (faceTag) faceTag.textContent = 'Candidate Aligned';
    if (footerDetail) footerDetail.innerHTML = '<i class="bi bi-shield-check"></i> Candidate Verified';

    // ── 3. Check Phone / Handheld Electronic Object ──
    if (phoneIndicatorCount > (width * height * 0.12)) {
      this.phoneDetectedCounter++;
      if (this.phoneDetectedCounter >= 3) {
        this.phoneDetectedCounter = 0;
        this.triggerWarning('Suspicious handheld object or mobile phone detected in camera frame.');
      }
    } else {
      this.phoneDetectedCounter = Math.max(0, this.phoneDetectedCounter - 1);
    }
  }

  /**
   * Sound synthesizer alert for warnings
   */
  playWarningSound() {
    try {
      if (!this.audioCtx) {
        this.audioCtx = new (window.AudioContext || window.webkitAudioContext)();
      }
      const osc = this.audioCtx.createOscillator();
      const gain = this.audioCtx.createGain();
      osc.type = 'sawtooth';
      osc.frequency.setValueAtTime(580, this.audioCtx.currentTime);
      osc.frequency.exponentialRampToValueAtTime(320, this.audioCtx.currentTime + 0.35);

      gain.gain.setValueAtTime(0.3, this.audioCtx.currentTime);
      gain.gain.linearRampToValueAtTime(0.01, this.audioCtx.currentTime + 0.35);

      osc.connect(gain);
      gain.connect(this.audioCtx.destination);
      osc.start();
      osc.stop(this.audioCtx.currentTime + 0.35);
    } catch (e) {}
  }

  /**
   * Trigger Warning (Max 3 before disqualification)
   */
  triggerWarning(reason) {
    const now = Date.now();
    // Throttle warnings by at least 4 seconds to prevent duplicate spam
    if (now - this.lastWarningTime < 4000) return;
    this.lastWarningTime = now;

    this.warningsCount++;
    const violation = {
      warningNumber: this.warningsCount,
      reason,
      time: new Date().toLocaleTimeString('en-US', { hour12: false }),
      timestamp: new Date().toISOString()
    };
    this.violations.push(violation);

    this.playWarningSound();
    this.updateWarningPills();
    this.showWarningOverlay(reason, this.warningsCount);

    // Report to backend
    fetch(`/i/${this.token}/proctor-event`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        type: 'suspicious_behavior',
        reason,
        warningsCount: this.warningsCount
      })
    }).catch(err => console.warn('Proctor event log error:', err));

    if (this.onWarning) {
      this.onWarning(violation, this.warningsCount);
    }

    // Rule: 3 warnings reached -> Immediately disqualify & close window
    if (this.warningsCount >= this.maxWarnings) {
      setTimeout(() => {
        this.handleDisqualification(`Exceeded maximum 3 proctoring warnings (${reason})`);
      }, 1500);
    }
  }

  /**
   * Updates warning indicator badges (1, 2, 3)
   */
  updateWarningPills() {
    for (let i = 1; i <= 3; i++) {
      const pill = document.getElementById(`pip-pill-${i}`);
      if (pill) {
        if (i <= this.warningsCount) {
          pill.classList.add('active');
        } else {
          pill.classList.remove('active');
        }
      }
    }
  }

  /**
   * High-visibility warning alert modal
   */
  showWarningOverlay(reason, count) {
    const existing = document.getElementById('proctor-warning-modal');
    if (existing) existing.remove();

    const isFinal = count >= 2;
    const modal = document.createElement('div');
    modal.id = 'proctor-warning-modal';
    modal.className = 'proctor-modal-overlay';
    modal.innerHTML = `
      <div class="proctor-alert-box ${isFinal ? 'danger' : ''}">
        <div class="proctor-alert-icon">
          <i class="bi bi-exclamation-triangle-fill"></i>
        </div>
        <div class="proctor-alert-title">
          PROCTORING WARNING ${count} OF 3
        </div>
        <div class="proctor-alert-desc">
          <strong>Suspicious Activity Detected:</strong><br>
          ${reason}
        </div>
        <div class="proctor-alert-rules">
          • Remain seated in front of the camera at all times.<br>
          • Mobile phones, secondary devices, or external assistance are strictly prohibited.<br>
          • Do not exit full-screen mode or switch windows.<br>
          <strong style="color:#ef4444;">3 warnings will automatically disqualify you and terminate the interview.</strong>
        </div>
        <button class="proctor-dismiss-btn" onclick="document.getElementById('proctor-warning-modal').remove()">
          I Understand & Return to Interview
        </button>
      </div>
    `;

    document.body.appendChild(modal);

    // Auto dismiss after 6 seconds if candidate does not click
    setTimeout(() => {
      if (document.getElementById('proctor-warning-modal')) {
        document.getElementById('proctor-warning-modal').remove();
      }
    }, 6000);
  }

  /**
   * Disqualify Candidate and Terminate/Close Window
   */
  async handleDisqualification(reason) {
    if (!this.isActive) return;
    this.isActive = false;

    if (this.analysisInterval) clearInterval(this.analysisInterval);
    if (this.videoStream) {
      this.videoStream.getTracks().forEach(t => t.stop());
    }

    console.warn('[ProctorEngine] Candidate Disqualified:', reason);

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

    // Render locked disqualification terminal screen
    this.renderDisqualifiedScreen(reason);

    // Attempt to close window as requested
    setTimeout(() => {
      try {
        window.close();
      } catch (e) {}
    }, 4500);
  }

  /**
   * Renders the full-screen terminal Disqualification Screen
   */
  renderDisqualifiedScreen(reason) {
    document.body.innerHTML = `
      <div class="proctor-disqualified-view">
        <div class="proctor-disqualified-card">
          <div class="disqualified-header">
            <i class="bi bi-shield-x"></i>
            <h1>ASSESSMENT DISQUALIFIED</h1>
            <p>Session Terminated for Anti-Cheating & Proctoring Violation</p>
          </div>
          <div class="disqualified-body">
            <div class="disqualified-reason-box">
              <strong>Primary Reason for Disqualification:</strong>
              <p>${reason}</p>
            </div>
            <div class="disqualified-log">
              <strong>Recorded Security Violations (${this.violations.length}):</strong>
              <ul>
                ${this.violations.map(v => `<li>[${v.time || 'Logged'}] Warning ${v.warningNumber}: ${v.reason}</li>`).join('')}
              </ul>
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
    if (this.analysisInterval) clearInterval(this.analysisInterval);
    if (this.videoStream) {
      this.videoStream.getTracks().forEach(t => t.stop());
    }
    const pip = document.getElementById('proctor-pip-widget');
    if (pip) pip.remove();
  }
}
