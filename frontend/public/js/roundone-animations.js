/**
 * RoundOne AI - Enterprise Motion & Animation Engine
 * Powered by Anime.js v4
 *
 * Micro-interaction suites:
 * 1. Live Voice Audio Waveform & AI Avatar Pulse (Voice Room)
 * 2. Proctor Vision Anti-Cheat Warning Shake & Alert Modal Spring (Proctoring)
 * 3. Executive Report Score Roll-Up & Staggered Skill Gauges (Results & Reports)
 * 4. Recruiter Dashboard KPI Count-Up & Card Stagger Transitions (Dashboard)
 */

(function (root, factory) {
  if (typeof exports === 'object' && typeof module !== 'undefined') {
    module.exports = factory();
  } else if (typeof define === 'function' && define.amd) {
    define([], factory);
  } else {
    root = typeof globalThis !== 'undefined' ? globalThis : root || self;
    root.RoundOneMotion = factory();
  }
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  /**
   * Universal Anime.js v3 & v4 Bridge
   * Works seamlessly whether Anime.js v4 UMD or v3 is loaded on the page
   */
  function animeRun(targets, options = {}) {
    try {
      if (typeof window !== 'undefined' && window.anime) {
        if (typeof window.anime.animate === 'function') {
          // Anime.js v4 API: anime.animate(targets, options)
          return window.anime.animate(targets, options);
        } else if (typeof window.anime === 'function') {
          // Anime.js v3 API: anime({ targets, ...options })
          return window.anime({ targets, ...options });
        }
      }
    } catch (err) {
      console.warn('[RoundOne Motion] Animation notice:', err.message);
    }
    return null;
  }

  function animeStagger(value, options = {}) {
    if (typeof window !== 'undefined' && window.anime && typeof window.anime.stagger === 'function') {
      return window.anime.stagger(value, options);
    }
    return function (idx) { return idx * value; };
  }

  /* ==============================================================================
     1. CANDIDATE VOICE ROOM: Audio Equalizer Waveform, Avatar Glow & Question Reveal
     ============================================================================== */
  let activeWaveAnim = null;
  let activeAvatarPulse = null;

  /**
   * Starts fluid, natural equalizer waveform in floating HUD dynamic island
   */
  function startVoiceEqualizer(containerSelector = '#hud-soundwave .bar') {
    if (typeof document === 'undefined') return;
    const bars = document.querySelectorAll(containerSelector);
    if (!bars.length) return;

    if (activeWaveAnim && typeof activeWaveAnim.pause === 'function') {
      activeWaveAnim.pause();
    }

    // Disable static CSS keyframe animation while Anime.js runs
    bars.forEach(function (bar) {
      bar.style.animation = 'none';
      bar.style.transformOrigin = 'bottom center';
    });

    activeWaveAnim = animeRun(bars, {
      scaleY: [
        { value: 2.8, duration: 250, ease: 'inOutQuad' },
        { value: 0.35, duration: 250, ease: 'inOutQuad' }
      ],
      delay: animeStagger(65, { from: 'center' }),
      loop: true,
      alternate: true
    });
  }

  /**
   * Smoothly settles the audio equalizer down to resting baseline
   */
  function stopVoiceEqualizer(containerSelector = '#hud-soundwave .bar') {
    if (typeof document === 'undefined') return;
    if (activeWaveAnim && typeof activeWaveAnim.pause === 'function') {
      activeWaveAnim.pause();
      activeWaveAnim = null;
    }
    const bars = document.querySelectorAll(containerSelector);
    if (!bars.length) return;

    animeRun(bars, {
      scaleY: 0.4,
      duration: 320,
      ease: 'outQuad',
      onComplete: function () {
        bars.forEach(function (bar) {
          bar.style.transform = '';
        });
      }
    });
  }

  /**
   * Breathing glow and scale pulse when AI avatar is speaking TTS audio
   */
  function startAiAvatarPulse(selector = '.ai-avatar, #avatar') {
    if (typeof document === 'undefined') return;
    const targets = document.querySelectorAll(selector);
    if (!targets.length) return;

    if (activeAvatarPulse && typeof activeAvatarPulse.pause === 'function') {
      activeAvatarPulse.pause();
    }

    activeAvatarPulse = animeRun(targets, {
      scale: [
        { value: 1.12, duration: 650, ease: 'inOutSine' },
        { value: 1.0, duration: 650, ease: 'inOutSine' }
      ],
      boxShadow: [
        { value: '0 0 24px rgba(16, 185, 129, 0.75)', duration: 650 },
        { value: '0 0 6px rgba(16, 185, 129, 0.25)', duration: 650 }
      ],
      loop: true,
      alternate: true
    });
  }

  function stopAiAvatarPulse(selector = '.ai-avatar, #avatar') {
    if (typeof document === 'undefined') return;
    if (activeAvatarPulse && typeof activeAvatarPulse.pause === 'function') {
      activeAvatarPulse.pause();
      activeAvatarPulse = null;
    }
    const targets = document.querySelectorAll(selector);
    if (!targets.length) return;

    animeRun(targets, {
      scale: 1,
      boxShadow: '0 0 10px rgba(37, 99, 235, 0.25)',
      duration: 350,
      ease: 'outQuad'
    });
  }

  /**
   * Slide-in reveal with subtle scale spring for new technical questions
   */
  function animateQuestionEntrance(selector = '.question-box, #ai-question-text') {
    if (typeof document === 'undefined') return;
    const el = document.querySelectorAll(selector);
    if (!el.length) return;

    animeRun(el, {
      translateY: [18, 0],
      opacity: [0, 1],
      duration: 480,
      ease: 'outCubic'
    });
  }

  /**
   * Floating Dynamic Island HUD entrance animation
   */
  function animateHudEntrance(selector = '#floating-ai-hud') {
    if (typeof document === 'undefined') return;
    const el = document.querySelector(selector);
    if (!el) return;

    animeRun(el, {
      translateY: [35, 0],
      opacity: [0, 1],
      duration: 600,
      ease: 'outBack'
    });
  }

  /* ==============================================================================
     2. PROCTOR SECURITY: Warning Elastic Camera Shake & Alert Modal Spring
     ============================================================================== */
  /**
   * Elastic physical camera shake on security infraction
   */
  function shakeProctorCamera(containerSelector = '#proctor-pip-widget, .proctor-camera-card') {
    if (typeof document === 'undefined') return;
    const el = document.querySelectorAll(containerSelector);
    if (!el.length) return;

    animeRun(el, {
      translateX: [-14, 14, -10, 10, -5, 5, -2, 0],
      borderColor: ['#10b981', '#ef4444', '#ef4444', '#10b981'],
      duration: 700,
      ease: 'inOutSine'
    });
  }

  /**
   * Spring pop-in for proctoring warning modal or disqualification alert
   */
  function animateProctorModal(modalContentSelector = '.proctor-alert-box, .proctor-disqualified-card') {
    if (typeof document === 'undefined') return;
    const el = document.querySelectorAll(modalContentSelector);
    if (!el.length) return;

    animeRun(el, {
      scale: [0.82, 1],
      opacity: [0, 1],
      duration: 450,
      ease: 'outBack'
    });
  }

  /**
   * Elastic pulse on warning pill badge (#pip-pill-1, #pip-pill-2, #pip-pill-3)
   */
  function animateWarningPill(pillSelector) {
    if (typeof document === 'undefined') return;
    const pill = typeof pillSelector === 'string' ? document.querySelector(pillSelector) : pillSelector;
    if (!pill) return;

    animeRun(pill, {
      scale: [1, 1.5, 1],
      duration: 500,
      ease: 'outElastic(1, .5)'
    });
  }

  /* ==============================================================================
     3. EXECUTIVE REPORT: Number Count-Up & Staggered Skill Gauges
     ============================================================================== */
  /**
   * Exponential count-up animation for scores (e.g. 0 -> 87/100)
   */
  function animateScoreCounter(targetElementId, targetScore, duration = 1400, suffix = '') {
    if (typeof document === 'undefined') return;
    const el = typeof targetElementId === 'string' ? document.getElementById(targetElementId) : targetElementId;
    if (!el) return;

    const num = parseInt(targetScore, 10);
    if (isNaN(num)) {
      el.textContent = `${targetScore}${suffix}`;
      return;
    }

    const holder = { val: 0 };
    animeRun(holder, {
      val: num,
      duration: duration,
      ease: 'outExpo',
      onUpdate: function () {
        el.textContent = `${Math.round(holder.val)}${suffix}`;
      }
    });
  }

  /**
   * Staggered slide for skill cards AND smooth width animation for progress fill bars
   */
  function animateSkillCards(selector = '.evaluated-skill-item, .report-skill-card') {
    if (typeof document === 'undefined') return;
    const cards = document.querySelectorAll(selector);
    if (!cards.length) return;

    // 1. Staggered card entrance
    animeRun(cards, {
      translateY: [16, 0],
      opacity: [0, 1],
      delay: animeStagger(65, { start: 100 }),
      duration: 550,
      ease: 'outQuart'
    });

    // 2. Animate progress bar fills from 0 to their target data-percent
    const fills = document.querySelectorAll(`${selector} .skill-meter-fill`);
    fills.forEach(function (fill, idx) {
      const targetPercent = fill.getAttribute('data-percent') || '100';
      animeRun(fill, {
        width: ['0%', `${targetPercent}%`],
        delay: 200 + (idx * 75),
        duration: 750,
        ease: 'outQuart'
      });
    });
  }

  /* ==============================================================================
     4. RECRUITER DASHBOARD: KPI Counters & Staggered Row/Card Loading
     ============================================================================== */
  /**
   * Animated roll-up for dashboard KPI metrics
   */
  function animateDashboardStats(counterSelector = '.kpi-stat-number, [data-stat-counter]') {
    if (typeof document === 'undefined') return;
    const counters = document.querySelectorAll(counterSelector);
    counters.forEach(function (el) {
      const rawVal = el.getAttribute('data-count') || el.textContent.replace(/[^0-9]/g, '');
      const targetVal = parseInt(rawVal, 10);
      if (isNaN(targetVal) || targetVal <= 0) return;

      const holder = { n: 0 };
      animeRun(holder, {
        n: targetVal,
        duration: 1200,
        ease: 'outExpo',
        onUpdate: function () {
          el.textContent = Math.round(holder.n).toLocaleString();
        }
      });
    });
  }

  /**
   * Staggered entrance for candidate merit cards, table rows, and job positions
   */
  function animateStaggeredEntrance(selector, delayStep = 35, startDelay = 40) {
    if (typeof document === 'undefined') return;
    const items = document.querySelectorAll(selector);
    if (!items.length) return;

    animeRun(items, {
      opacity: [0, 1],
      translateY: [14, 0],
      delay: animeStagger(delayStep, { start: startDelay }),
      duration: 500,
      ease: 'outCubic'
    });
  }

  return {
    animeRun,
    animeStagger,
    startVoiceEqualizer,
    stopVoiceEqualizer,
    startAiAvatarPulse,
    stopAiAvatarPulse,
    animateQuestionEntrance,
    animateHudEntrance,
    shakeProctorCamera,
    animateProctorModal,
    animateWarningPill,
    animateScoreCounter,
    animateSkillCards,
    animateDashboardStats,
    animateStaggeredEntrance
  };
});
