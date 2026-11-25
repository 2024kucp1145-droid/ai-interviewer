/* ==========================================================================
   RoundOne AI - Hybrid Motion.dev (v12) + Anime.js (v4) Visual Telemetry
   Powers scroll-linked parallax, viewport springs, interactive ROI bars,
   screening funnel animations, and About-tab SVG allocation gauges.
   ========================================================================== */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) {
    module.exports = factory();
  } else {
    root.RoundOneTelemetry = factory();
  }
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  var currentVolume = 100;
  var chartsAnimatedOnce = false;
  var aboutAnimatedOnce = false;
  var initialized = false;

  function reducedMotion() {
    return typeof window !== 'undefined' &&
      window.matchMedia &&
      window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  }

  function hasMotion() {
    return typeof window !== 'undefined' && window.Motion && typeof window.Motion.animate === 'function';
  }

  function animeCall(targets, opts) {
    if (window.RoundOneMotion && typeof window.RoundOneMotion.animeRun === 'function') {
      return window.RoundOneMotion.animeRun(targets, opts);
    }
    if (typeof window !== 'undefined' && window.anime) {
      if (typeof window.anime.animate === 'function') {
        return window.anime.animate(targets, opts);
      }
      if (typeof window.anime === 'function') {
        return window.anime(Object.assign({ targets: targets }, opts));
      }
    }
    return null;
  }

  function animateNumber(el, targetVal, formatter, durationMs) {
    if (!el) return;
    if (reducedMotion()) {
      el.textContent = formatter(targetVal);
      return;
    }
    var state = { value: parseFloat(el.dataset.lastVal || '0') || 0 };
    el.dataset.lastVal = String(targetVal);
    animeCall(state, {
      value: targetVal,
      duration: durationMs || 850,
      ease: 'outExpo',
      onUpdate: function () {
        el.textContent = formatter(state.value);
      },
      onComplete: function () {
        el.textContent = formatter(targetVal);
      }
    });
  }

  function initScrollAndParallax() {
    if (!hasMotion() || reducedMotion()) return;
    var M = window.Motion;

    var progressBar = document.querySelector('.motion-scroll-bar');
    if (progressBar && typeof M.scroll === 'function') {
      try {
        M.scroll(M.animate(progressBar, { scaleX: [0, 1] }, { ease: 'linear' }));
      } catch (e) {
        // Fallback if scroll binding unsupported
      }
    }

    var heroBackdrop = document.querySelector('.nano-hero-backdrop');
    if (heroBackdrop && typeof M.scroll === 'function') {
      try {
        M.scroll(function (progress) {
          var clamped = Math.max(0, Math.min(1, progress || 0));
          var shiftY = -(clamped * 28).toFixed(2);
          var scale = (1 + clamped * 0.06).toFixed(4);
          heroBackdrop.style.transform = 'translate3d(0, ' + shiftY + 'px, 0) scale(' + scale + ')';
        });
      } catch (e) {
        // Safe fallback
      }
    }
  }

  function initMotionRevealsAndGestures() {
    if (!hasMotion() || reducedMotion()) return;
    var M = window.Motion;

    if (typeof M.inView === 'function') {
      var revealTargets = document.querySelectorAll(
        '.telemetry-card, .workflow-step, .bolt-bottom-banner, .front-pricing-card, .front-stat-card, .about-pipe-node, .plan-card, .article-card'
      );
      if (revealTargets.length > 0) {
        M.inView(revealTargets, function (el) {
          if (el.dataset.motionRevealed === '1') return;
          el.dataset.motionRevealed = '1';
          M.animate(
            el,
            { y: [18, 0], opacity: [0.45, 1] },
            { duration: 0.52, ease: [0.16, 1, 0.3, 1] }
          );
        }, { amount: 0.14 });
      }

      var suiteEl = document.getElementById('visual-telemetry-suite');
      if (suiteEl) {
        M.inView(suiteEl, function () {
          if (!chartsAnimatedOnce) {
            chartsAnimatedOnce = true;
            animateTelemetryCharts();
          }
        }, { amount: 0.18 });
      }
    }

    if (typeof M.hover === 'function') {
      var liftCards = document.querySelectorAll('.hero-metric-pill, .workflow-step, .telemetry-card, .about-pipe-node');
      if (liftCards.length > 0) {
        M.hover(liftCards, function (el) {
          M.animate(el, { y: -3 }, { type: 'spring', stiffness: 360, damping: 24 });
          return function () {
            M.animate(el, { y: 0 }, { type: 'spring', stiffness: 360, damping: 26 });
          };
        });
      }
    }

    if (typeof M.press === 'function') {
      var pressBtns = document.querySelectorAll('.telemetry-vol-btn, .hero-cta-row .btn, .bolt-bottom-banner .btn');
      if (pressBtns.length > 0) {
        M.press(pressBtns, function (el) {
          M.animate(el, { scale: 0.96 }, { duration: 0.1 });
          return function () {
            M.animate(el, { scale: 1 }, { type: 'spring', stiffness: 420, damping: 22 });
          };
        });
      }
    }
  }

  function animateTelemetryCharts() {
    var fills = document.querySelectorAll('#visual-telemetry-suite .viz-bar-fill, #visual-telemetry-suite .funnel-bar-fill');
    fills.forEach(function (bar, i) {
      var targetWidth = bar.getAttribute('data-target-width') || '50%';
      if (reducedMotion()) {
        bar.style.width = targetWidth;
        return;
      }
      animeCall(bar, {
        width: targetWidth,
        duration: 850,
        delay: i * 65,
        ease: 'outExpo'
      });
    });

    var arc = document.getElementById('telemetry-donut-arc');
    if (arc) {
      var targetOffset = parseFloat(arc.getAttribute('data-offset') || '17');
      arc.setAttribute('stroke-dashoffset', reducedMotion() ? String(targetOffset) : '289');
      if (reducedMotion()) {
        arc.style.strokeDashoffset = String(targetOffset);
      } else {
        animeCall(arc, {
          strokeDashoffset: [289, targetOffset],
          duration: 1150,
          ease: 'outExpo',
          onComplete: function () {
            arc.style.strokeDashoffset = String(targetOffset);
          }
        });
      }
    }

    var scoreEl = document.getElementById('telemetry-donut-score');
    if (scoreEl) {
      animateNumber(scoreEl, 94, function (v) { return String(Math.round(v)); }, 1000);
    }

    setVolume(currentVolume, true);
  }

  function setVolume(vol, skipTabUpdate) {
    currentVolume = Number(vol) || 100;

    if (!skipTabUpdate) {
      document.querySelectorAll('.telemetry-vol-btn').forEach(function (btn) {
        var btnVol = Number(btn.getAttribute('data-vol'));
        if (btnVol === currentVolume) btn.classList.add('active');
        else btn.classList.remove('active');
      });
    }

    var roundOneCost = Math.round(currentVolume * 0.5);
    var manualCost = Math.round(currentVolume * 185);
    var savedDollars = Math.max(0, manualCost - roundOneCost);
    var savedHours = Math.round(currentVolume * 1.48);

    animateNumber(
      document.getElementById('viz-kpi-saved-usd'),
      savedDollars,
      function (v) { return '$' + Math.round(v).toLocaleString('en-US'); },
      780
    );
    animateNumber(
      document.getElementById('viz-kpi-saved-hrs'),
      savedHours,
      function (v) { return Math.round(v).toLocaleString('en-US') + ' hrs'; },
      780
    );

    var r1Label = document.getElementById('viz-cost-roundone');
    var karatLabel = document.getElementById('viz-cost-karat');
    var manualLabel = document.getElementById('viz-cost-manual');
    if (r1Label) r1Label.textContent = '$' + roundOneCost.toLocaleString('en-US') + ' ($0.50/ea)';
    if (karatLabel) karatLabel.textContent = '$' + (currentVolume * 150).toLocaleString('en-US');
    if (manualLabel) manualLabel.textContent = '$' + manualCost.toLocaleString('en-US');
  }

  function animateAboutCharts() {
    var ring = document.getElementById('about-efficiency-arc');
    if (ring) {
      var target = parseFloat(ring.getAttribute('data-offset') || '18');
      if (reducedMotion()) {
        ring.style.strokeDashoffset = String(target);
      } else {
        animeCall(ring, {
          strokeDashoffset: [289, target],
          duration: 1100,
          ease: 'outExpo',
          onComplete: function () {
            ring.style.strokeDashoffset = String(target);
          }
        });
      }
    }

    document.querySelectorAll('#front-tab-about .viz-bar-fill').forEach(function (bar, i) {
      var targetWidth = bar.getAttribute('data-target-width') || '50%';
      if (reducedMotion()) {
        bar.style.width = targetWidth;
      } else {
        animeCall(bar, {
          width: targetWidth,
          duration: 850,
          delay: i * 90,
          ease: 'outExpo'
        });
      }
    });
  }

  function refreshTab(tabName) {
    if (tabName === 'about') {
      aboutAnimatedOnce = true;
      setTimeout(animateAboutCharts, 60);
    } else if (tabName === 'home') {
      setTimeout(animateTelemetryCharts, 60);
    }
  }

  function init() {
    if (initialized) return;
    initialized = true;
    initScrollAndParallax();
    initMotionRevealsAndGestures();

    // Ensure funnel/bar charts display gracefully if visible or fallback after short delay
    setTimeout(function () {
      if (!chartsAnimatedOnce && document.getElementById('visual-telemetry-suite')) {
        var rect = document.getElementById('visual-telemetry-suite').getBoundingClientRect();
        if (rect.top < window.innerHeight * 1.15) {
          chartsAnimatedOnce = true;
          animateTelemetryCharts();
        }
      }
    }, 350);
  }

  if (typeof document !== 'undefined') {
    if (document.readyState === 'loading') {
      document.addEventListener('DOMContentLoaded', init);
    } else {
      init();
    }
  }

  return {
    init: init,
    setVolume: setVolume,
    animateTelemetryCharts: animateTelemetryCharts,
    animateAboutCharts: animateAboutCharts,
    refreshTab: refreshTab
  };
});
