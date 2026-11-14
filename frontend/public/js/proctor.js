/**
 * Continuous Camera & Anti-Cheating AI Proctor Engine (Production-Grade)
 * 
 * Enforces:
 * 1. Continuous Live Webcam Feed (Floating PIP widget with status indicator & warning pills)
 * 2. 15-Second Grace / Warmup Period (zero false positives on startup)
 * 3. Screen Exit Protection (tab switch or window minimize triggers disqualification after 2.5s buffer)
 * 4. Vision AI Object & Multi-Person Detection:
 *    - Mobile phone / electronic device detection
 *    - Multiple persons in frame detection
 *    - Absence / leaving seat detection
 * 5. 3-Warning Progressive Enforcement:
 *    - Warning 1: Audio chime + banner alert
 *    - Warning 2: Urgent audio chime + alert modal
 *    - Warning 3: Immediate disqualification & session lock
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
    this.isArmed = false; // Remains false during 15s warmup

    this.videoStream = null;
    this.videoEl = null;
    this.canvasEl = null;
    this.ctx = null;

    // Timeouts and Intervals
    this.exitTimeoutId = null;
    this.warmupIntervalId = null;
    this.visionIntervalId = null;

    // AI Models
    this.cocoModel = null;
    this.faceDetector = null;
    this.modelLoading = false;

    // Consecutive detection streaks (for zero false positives)
    this.phoneStreak = 0;
    this.multiPersonStreak = 0;
    this.noPersonStreak = 0;
    this.lastWarningTime = 0;
    this.warmupRemaining = 15;
  }

  /**
   * Initializes camera, PIP widget, screen exit monitoring, and starts 15s warmup
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
      throw new Error('Camera access is mandatory for proctored screening. Please allow camera permissions and refresh.');
    }

    this.mountWidget(containerEl);
    this.bindWindowEvents();
    this.isActive = true;

    // Start 15s warmup period
    this.startWarmupPeriod();

    // Asynchronously load Vision AI model in background
    this.initVisionModels();

    // Start frame analysis loop
    this.startVisionLoop();
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
            <span class="proctor-pip-dot" id="proctor-status-dot" style="background: #3b82f6; box-shadow: 0 0 8px #3b82f6;"></span>
            <span id="proctor-status-title">Warmup (15s)</span>
          </div>
          <div style="display: flex; align-items: center; gap: 0.4rem;">
            <div class="proctor-pip-warnings" id="proctor-pip-warning-pills">
              <span class="pill-badge" id="pip-pill-1">1</span>
              <span class="pill-badge" id="pip-pill-2">2</span>
              <span class="pill-badge" id="pip-pill-3">3</span>
            </div>
            <button type="button" id="btn-minimize-pip" style="background: none; border: none; color: #94a3b8; cursor: pointer; padding: 0 0.15rem; font-size: 0.75rem;" title="Minimize / Restore Camera">
              <i class="bi bi-dash-lg" id="pip-toggle-icon"></i>
            </button>
          </div>
        </div>
        <div class="proctor-video-wrapper">
          <video id="proctor-webcam-feed" autoplay playsinline muted></video>
          <canvas id="proctor-tracking-canvas" width="320" height="240" style="display: none;"></canvas>
          <div class="proctor-face-box" id="proctor-face-indicator">
            <span class="proctor-face-tag" id="proctor-face-tag">Warming Up</span>
          </div>
        </div>
        <div class="proctor-status-footer">
          <span id="proctor-footer-detail"><i class="bi bi-camera-video-fill"></i> Camera Initializing...</span>
          <span id="proctor-model-badge" style="font-size:0.65rem; color:var(--text-muted);"><i class="bi bi-shield-check"></i> Vision AI</span>
        </div>
      </div>
    `;

    parent.appendChild(wrapper);

    const minBtn = wrapper.querySelector('#btn-minimize-pip');
    if (minBtn) {
      minBtn.addEventListener('click', () => {
        const isMin = wrapper.classList.toggle('minimized');
        const icon = wrapper.querySelector('#pip-toggle-icon');
        if (icon) {
          icon.className = isMin ? 'bi bi-plus-lg' : 'bi bi-dash-lg';
        }
      });
    }

    this.videoEl = document.getElementById('proctor-webcam-feed');
    if (this.videoEl && this.videoStream) {
      this.videoEl.srcObject = this.videoStream;
      this.videoEl.play().catch(e => console.warn('[ProctorEngine] Video play error:', e));
    }

    this.canvasEl = document.getElementById('proctor-tracking-canvas');
    if (this.canvasEl) {
      this.ctx = this.canvasEl.getContext('2d', { willReadFrequently: true });
    }
  }

  /**
   * 15-Second Grace / Warmup Period
   * Prevents startup false alarms while candidate adjusts chair or lighting
   */
  startWarmupPeriod() {
    this.warmupRemaining = 15;
    const titleEl = document.getElementById('proctor-status-title');
    const dotEl = document.getElementById('proctor-status-dot');
    const footerEl = document.getElementById('proctor-footer-detail');
    const faceTag = document.getElementById('proctor-face-tag');

    this.warmupIntervalId = setInterval(() => {
      this.warmupRemaining--;

      if (titleEl) {
        titleEl.textContent = `Warmup (${this.warmupRemaining}s)`;
      }

      if (this.warmupRemaining <= 0) {
        clearInterval(this.warmupIntervalId);
        this.warmupIntervalId = null;
        this.isArmed = true;

        if (titleEl) titleEl.textContent = 'AI Proctor Active';
        if (dotEl) {
          dotEl.style.background = '#10b981';
          dotEl.style.boxShadow = '0 0 8px #10b981';
        }
        if (footerEl) {
          footerEl.innerHTML = '<i class="bi bi-shield-fill-check" style="color:#10b981;"></i> Candidate Monitored';
        }
        if (faceTag) {
          faceTag.textContent = 'Candidate Verified';
        }
        console.log('[ProctorEngine] Warmup completed. Anti-cheating vision AI is now armed.');
      }
    }, 1000);
  }

  /**
   * Initialize TensorFlow.js COCO-SSD model or native FaceDetector API
   */
  async initVisionModels() {
    // 1. Try TensorFlow COCO-SSD
    if (window.cocoSsd && !this.cocoModel && !this.modelLoading) {
      try {
        this.modelLoading = true;
        console.log('[ProctorEngine] Loading COCO-SSD lightweight model...');
        this.cocoModel = await window.cocoSsd.load({ base: 'lite_mobilenet_v2' });
        console.log('[ProctorEngine] COCO-SSD model loaded successfully.');
        const modelBadge = document.getElementById('proctor-model-badge');
        if (modelBadge) {
          modelBadge.innerHTML = '<i class="bi bi-cpu-fill" style="color:#2563eb;"></i> Neural Vision';
        }
      } catch (err) {
        console.warn('[ProctorEngine] Could not load COCO-SSD from CDN, fallback active:', err);
      } finally {
        this.modelLoading = false;
      }
    }

    // 2. Fallback to native Chrome FaceDetector API if available
    if (!this.cocoModel && 'FaceDetector' in window) {
      try {
        this.faceDetector = new window.FaceDetector({ fastMode: true, maxDetectedFaces: 4 });
        console.log('[ProctorEngine] Native FaceDetector initialized.');
        const modelBadge = document.getElementById('proctor-model-badge');
        if (modelBadge) {
          modelBadge.innerHTML = '<i class="bi bi-person-bounding-box" style="color:#059669;"></i> Face Vision';
        }
      } catch (err) {
        console.warn('[ProctorEngine] FaceDetector init error:', err);
      }
    }
  }

  /**
   * Periodic vision frame analysis loop (every 1.3 seconds)
   */
  startVisionLoop() {
    this.visionIntervalId = setInterval(async () => {
      if (!this.isActive || !this.isArmed || !this.videoEl || this.videoEl.readyState < 2) return;

      try {
        await this.analyzeCurrentFrame();
      } catch (err) {
        console.warn('[ProctorEngine] Frame analysis error (gracefully skipped):', err);
      }
    }, 1300);
  }

  /**
   * Analyzes camera frame for:
   * 1. Mobile phone / electronic devices
   * 2. Multiple persons
   * 3. Candidate absence
   */
  async analyzeCurrentFrame() {
    let hasPhone = false;
    let multiplePersons = false;
    let hasPerson = true;

    // Strategy 1: TensorFlow COCO-SSD
    if (this.cocoModel) {
      try {
        const predictions = await this.cocoModel.detect(this.videoEl);
        
        // Mobile phone detection with high confidence threshold
        const phone = predictions.find(p => 
          (p.class === 'cell phone' || p.class === 'remote') && p.score >= 0.65
        );
        if (phone) hasPhone = true;

        // Person count detection
        const persons = predictions.filter(p => p.class === 'person' && p.score >= 0.50);
        if (persons.length >= 2) multiplePersons = true;
        if (persons.length === 0) hasPerson = false;
      } catch (err) {
        // Fall through to fallback
      }
    } 
    // Strategy 2: Native Browser FaceDetector API
    else if (this.faceDetector) {
      try {
        const faces = await this.faceDetector.detect(this.videoEl);
        if (faces.length >= 2) multiplePersons = true;
        if (faces.length === 0) hasPerson = false;

        // Check for phone contrast in lower half of video
        hasPhone = this.checkLowerFrameContrast();
      } catch (err) {}
    } 
    // Strategy 3: Canvas Pixel Density & Luminance Fallback
    else {
      const fallbackResult = this.checkCanvasFallback();
      hasPerson = fallbackResult.hasPerson;
      multiplePersons = fallbackResult.multiplePersons;
      hasPhone = fallbackResult.hasPhone;
    }

    // ── Update Visual UI Indicators ──
    const faceIndicator = document.getElementById('proctor-face-indicator');
    const faceTag = document.getElementById('proctor-face-tag');
    const footerDetail = document.getElementById('proctor-footer-detail');

    if (hasPhone) {
      if (faceIndicator) faceIndicator.className = 'proctor-face-box danger';
      if (faceTag) faceTag.textContent = 'Phone Detected';
      if (footerDetail) footerDetail.innerHTML = '<i class="bi bi-phone-vibrate-fill" style="color:#ef4444;"></i> Mobile Device Flagged';
    } else if (multiplePersons) {
      if (faceIndicator) faceIndicator.className = 'proctor-face-box warning';
      if (faceTag) faceTag.textContent = 'Multiple People';
      if (footerDetail) footerDetail.innerHTML = '<i class="bi bi-people-fill" style="color:#f59e0b;"></i> Multiple Persons Flagged';
    } else if (!hasPerson) {
      if (faceIndicator) faceIndicator.className = 'proctor-face-box danger';
      if (faceTag) faceTag.textContent = 'Face Absent';
      if (footerDetail) footerDetail.innerHTML = '<i class="bi bi-person-x-fill" style="color:#ef4444;"></i> Candidate Away';
    } else {
      if (faceIndicator) faceIndicator.className = 'proctor-face-box';
      if (faceTag) faceTag.textContent = 'Candidate Verified';
      if (footerDetail) footerDetail.innerHTML = '<i class="bi bi-person-check-fill" style="color:#10b981;"></i> Candidate Verified';
    }

    // ── Debounced Streak Accumulators (Prevents Single-Frame Glitches) ──
    // 1. Mobile Phone (requires 3 consecutive detections over ~4.5 seconds)
    if (hasPhone) {
      this.phoneStreak++;
    } else {
      this.phoneStreak = Math.max(0, this.phoneStreak - 1);
    }

    // 2. Multiple Persons (requires 3 consecutive detections over ~4.5 seconds)
    if (multiplePersons) {
      this.multiPersonStreak++;
    } else {
      this.multiPersonStreak = Math.max(0, this.multiPersonStreak - 1);
    }

    // 3. Candidate Absent (requires 8 consecutive detections over ~10 seconds)
    if (!hasPerson) {
      this.noPersonStreak++;
    } else {
      this.noPersonStreak = Math.max(0, this.noPersonStreak - 1);
    }

    // Check Cooldown (at least 12 seconds between warnings)
    const now = Date.now();
    if (now - this.lastWarningTime < 12000) return;

    // Trigger Warning based on confirmed sustained streak
    if (this.phoneStreak >= 3) {
      this.phoneStreak = 0;
      this.issueWarning('Mobile phone or electronic device detected in camera frame.');
    } else if (this.multiPersonStreak >= 3) {
      this.multiPersonStreak = 0;
      this.issueWarning('Multiple individuals detected in camera frame. Only the registered candidate may be present.');
    } else if (this.noPersonStreak >= 8) {
      this.noPersonStreak = 0;
      this.issueWarning('Candidate not detected in camera frame. You must remain seated facing the screen.');
    }
  }

  /**
   * Helper: Fallback contrast check in lower quadrant for electronic devices
   */
  checkLowerFrameContrast() {
    if (!this.canvasEl || !this.ctx || !this.videoEl) return false;
    const w = 120, h = 90;
    this.canvasEl.width = w;
    this.canvasEl.height = h;
    this.ctx.drawImage(this.videoEl, 0, 0, w, h);

    const frame = this.ctx.getImageData(0, Math.floor(h * 0.6), w, Math.floor(h * 0.4));
    const data = frame.data;
    let highContrastBezels = 0;

    for (let i = 0; i < data.length; i += 16) {
      const r = data[i], g = data[i + 1], b = data[i + 2];
      if ((r < 25 && g < 25 && b < 25) || (r > 230 && g > 230 && b > 230)) {
        highContrastBezels++;
      }
    }
    // High density threshold (must cover 35%+ of sample region)
    return (highContrastBezels / (data.length / 16)) > 0.35;
  }

  /**
   * Helper: Fallback canvas analysis when neither COCO nor FaceDetector is available
   */
  checkCanvasFallback() {
    if (!this.canvasEl || !this.ctx || !this.videoEl) {
      return { hasPerson: true, multiplePersons: false, hasPhone: false };
    }
    const w = 100, h = 75;
    this.canvasEl.width = w;
    this.canvasEl.height = h;
    this.ctx.drawImage(this.videoEl, 0, 0, w, h);

    const frame = this.ctx.getImageData(0, 0, w, h);
    const data = frame.data;
    let skinPixels = 0;
    let minX = w, maxX = 0;

    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        const idx = (y * w + x) * 4;
        const r = data[idx], g = data[idx + 1], b = data[idx + 2];
        const isSkin = (r > 65 && g > 45 && b > 25 && r > g && r > b && (r - g) >= 12 && Math.abs(r - g) < 110);
        if (isSkin) {
          skinPixels++;
          if (x < minX) minX = x;
          if (x > maxX) maxX = x;
        }
      }
    }

    const totalPixels = w * h;
    const hasPerson = (skinPixels / totalPixels) > 0.05;
    const multiplePersons = ((maxX - minX) > w * 0.90) && ((skinPixels / totalPixels) > 0.45);
    const hasPhone = this.checkLowerFrameContrast();

    return { hasPerson, multiplePersons, hasPhone };
  }

  /**
   * Synthesize Warning Chime via Web Audio API (Zero external audio file dependencies)
   */
  playWarningSound(count) {
    try {
      const AudioCtxClass = window.AudioContext || window.webkitAudioContext;
      if (!AudioCtxClass) return;
      const ctx = new AudioCtxClass();
      
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = count >= 2 ? 'sawtooth' : 'triangle';
      osc.frequency.setValueAtTime(count >= 2 ? 880 : 587.33, ctx.currentTime);
      
      if (count >= 2) {
        // Double pulse for final warning
        osc.frequency.setValueAtTime(880, ctx.currentTime);
        osc.frequency.setValueAtTime(660, ctx.currentTime + 0.15);
        osc.frequency.setValueAtTime(880, ctx.currentTime + 0.3);
      }

      gain.gain.setValueAtTime(0.25, ctx.currentTime);
      gain.gain.exponentialRampToValueAtTime(0.01, ctx.currentTime + (count >= 2 ? 0.6 : 0.4));
      
      osc.connect(gain);
      gain.connect(ctx.destination);
      osc.start();
      osc.stop(ctx.currentTime + (count >= 2 ? 0.65 : 0.45));
    } catch (e) {
      console.warn('[ProctorEngine] Audio alert tone error:', e);
    }
  }

  /**
   * Issues a Proctoring Warning (Up to 3 Max)
   */
  async issueWarning(reason) {
    if (!this.isActive || !this.isArmed) return;

    this.warningsCount++;
    this.lastWarningTime = Date.now();

    const timestamp = new Date().toLocaleTimeString('en-US', { hour12: false });
    this.violations.push({
      warningNumber: this.warningsCount,
      reason,
      time: timestamp,
      timestamp: new Date().toISOString()
    });

    console.warn(`[ProctorEngine] WARNING ${this.warningsCount} OF ${this.maxWarnings}: ${reason}`);

    // Trigger Anime.js elastic camera shake and warning pill pulse
    if (window.RoundOneMotion) {
      window.RoundOneMotion.shakeProctorCamera('#proctor-pip-widget');
      window.RoundOneMotion.animateWarningPill(`#pip-pill-${this.warningsCount}`);
    }

    // Update PIP Warning Pills
    this.updateWarningPills(this.warningsCount);

    // Play synthesized alert chime
    this.playWarningSound(this.warningsCount);

    // Log to backend
    try {
      await fetch(`/i/${this.token}/proctor-event`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          type: 'vision_warning',
          reason,
          warningsCount: this.warningsCount
        })
      });
    } catch (err) {
      console.warn('[ProctorEngine] Failed to notify backend of warning event:', err);
    }

    // Capture compressed webcam snapshot for proctor evidence audit
    this.captureAndUploadSnapshot(reason);

    if (this.onWarning) {
      this.onWarning(reason, this.warningsCount, this.violations);
    }

    // If warnings reach 3, trigger disqualification
    if (this.warningsCount >= this.maxWarnings) {
      this.handleDisqualification(`Exceeded 3 Anti-Cheating Warnings: ${reason}`);
      return;
    }

    // Otherwise show Warning Modal Alert to candidate
    this.showWarningOverlay(reason, this.warningsCount);
  }

  /**
   * Capture a compressed 320x240 JPEG frame from webcam and upload to backend proctor_snapshots
   */
  captureAndUploadSnapshot(reason) {
    try {
      if (!this.token || !this.videoEl || this.videoEl.readyState < 2) return;
      const canvas = document.createElement('canvas');
      canvas.width = 320;
      canvas.height = 240;
      const ctx = canvas.getContext('2d');
      if (!ctx) return;
      ctx.drawImage(this.videoEl, 0, 0, canvas.width, canvas.height);
      const imageData = canvas.toDataURL('image/jpeg', 0.55);
      fetch(`/i/${this.token}/snapshot`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ reason, imageData })
      }).catch(() => {});
    } catch (_) {}
  }

  /**
   * Updates warning indicator pills in floating PIP widget
   */
  updateWarningPills(count) {
    for (let i = 1; i <= 3; i++) {
      const pill = document.getElementById(`pip-pill-${i}`);
      if (pill) {
        if (i <= count) {
          pill.classList.add('active');
        } else {
          pill.classList.remove('active');
        }
      }
    }
  }

  /**
   * High-Visibility Warning Alert Modal (Warning 1 & 2)
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
        <div class="proctor-alert-icon" style="font-size: 2.5rem; color: ${isFinal ? '#ef4444' : '#f59e0b'}; margin-bottom: 0.5rem;">
          <i class="bi bi-exclamation-triangle-fill"></i>
        </div>
        <div class="proctor-alert-title" style="font-size: 1.15rem; font-weight: 800; color: #000; margin-bottom: 0.4rem;">
          PROCTORING WARNING ${count} OF 3
        </div>
        <div class="proctor-alert-desc" style="font-size: 0.85rem; color: #374151; background: #fef2f2; border: 1px solid #fecaca; border-radius: 6px; padding: 0.75rem; margin-bottom: 0.85rem;">
          <strong>Security Violation Detected:</strong><br>
          ${reason}
        </div>
        <div class="proctor-alert-rules" style="font-size: 0.75rem; color: #6b7280; text-align: left; line-height: 1.6; margin-bottom: 1.25rem;">
          • Keep camera unobstructed and remain seated facing your screen.<br>
          • Mobile phones, secondary screens, or earphones are strictly prohibited.<br>
          • Only the registered candidate may be present in the room.<br>
          <strong style="color: #dc2626; display: block; margin-top: 0.35rem;">
            ⚠️ Warning 3 will result in IMMEDIATE DISQUALIFICATION and session termination.
          </strong>
        </div>
        <button class="btn" style="width: 100%; padding: 0.65rem; font-weight: 700; background: #000; color: #fff;" onclick="document.getElementById('proctor-warning-modal').remove()">
          I Understand & Resume Interview
        </button>
      </div>
    `;

    document.body.appendChild(modal);

    if (window.RoundOneMotion) {
      window.RoundOneMotion.animateProctorModal('.proctor-alert-box');
    }

    // Auto-dismiss after 8 seconds if candidate does not click
    setTimeout(() => {
      const el = document.getElementById('proctor-warning-modal');
      if (el) el.remove();
    }, 8000);
  }

  /**
   * Bind screen exit monitoring (tab switch, window minimize)
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
    if (this.warmupIntervalId) clearInterval(this.warmupIntervalId);
    if (this.visionIntervalId) clearInterval(this.visionIntervalId);

    if (this.videoStream) {
      this.videoStream.getTracks().forEach(t => t.stop());
    }

    console.warn('[ProctorEngine] Candidate Disqualified:', reason);

    this.violations.push({
      reason,
      warningNumber: Math.max(3, this.warningsCount),
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
          warnings: Math.max(3, this.warningsCount),
          violations: this.violations
        })
      });
    } catch (err) {
      console.error('Failed to notify backend of disqualification:', err);
    }

    if (this.onDisqualify) {
      this.onDisqualify(reason, this.violations);
    }

    // Render locked terminal disqualification screen
    this.renderDisqualifiedScreen(reason);
  }

  /**
   * Renders the terminal Disqualification Screen with Violation History
   */
  renderDisqualifiedScreen(reason) {
    const existingModal = document.getElementById('proctor-warning-modal');
    if (existingModal) existingModal.remove();

    const pip = document.getElementById('proctor-pip-widget');
    if (pip) pip.remove();

    document.body.innerHTML = `
      <div class="proctor-disqualified-view">
        <div class="proctor-disqualified-card">
          <div class="disqualified-header">
            <i class="bi bi-shield-x"></i>
            <h1>ASSESSMENT DISQUALIFIED</h1>
            <p>Session Terminated for Anti-Cheating &amp; Proctoring Violation</p>
          </div>
          <div class="disqualified-body">
            <div class="disqualified-reason-box">
              <strong>Primary Reason for Disqualification:</strong>
              <p>${reason}</p>
            </div>
            
            <div style="background: rgba(0,0,0,0.5); border: 1px solid #334155; border-radius: 6px; padding: 0.75rem 1rem; margin-bottom: 1rem; font-size: 0.75rem; text-align: left;">
              <strong style="color: #f87171; display: block; margin-bottom: 0.35rem;">
                <i class="bi bi-clipboard-x-fill"></i> Recorded Security Violations (${this.violations.length}):
              </strong>
              <ul style="margin: 0; padding-left: 1.25rem; color: #cbd5e1; line-height: 1.5;">
                ${this.violations.map(v => `<li>[${v.time || 'Logged'}] Warning ${v.warningNumber || 1}: ${v.reason}</li>`).join('')}
              </ul>
            </div>

            <div class="disqualified-notice">
              This screening session has been locked and permanently recorded as <strong>NOT RECOMMENDED (DISQUALIFIED)</strong> in the recruiting company dashboard. Your camera stream and input access have been terminated.
            </div>
          </div>
          <div class="disqualified-footer">
            <button class="btn btn-secondary" onclick="window.close()" style="width: auto; padding: 0.6rem 1.75rem; background: #ffffff; color: #000000; font-weight: 700; border-radius: 6px;">
              Close Window
            </button>
          </div>
        </div>
      </div>
    `;

    if (window.RoundOneMotion) {
      window.RoundOneMotion.animateProctorModal('.proctor-disqualified-card');
    }
  }

  /**
   * Stop proctoring cleanly when interview completes normally
   */
  stop() {
    this.isActive = false;
    this.isArmed = false;
    if (this.exitTimeoutId) clearTimeout(this.exitTimeoutId);
    if (this.warmupIntervalId) clearInterval(this.warmupIntervalId);
    if (this.visionIntervalId) clearInterval(this.visionIntervalId);
    if (this.videoStream) {
      this.videoStream.getTracks().forEach(t => t.stop());
    }
    const pip = document.getElementById('proctor-pip-widget');
    if (pip) pip.remove();
  }
}
