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
    var heroArt = document.querySelector('.wp-hero-art-card');
    var heroContour = document.querySelector('.wp-contour-bg');
    var topPill = document.querySelector('.wp-hero-art-pill.top-left');
    var botPill = document.querySelector('.wp-hero-art-pill.bottom-right');

    if (typeof M.scroll === 'function') {
      try {
        M.scroll(function (progress) {
          var clamped = Math.max(0, Math.min(1, progress || 0));
          if (heroBackdrop) {
            var shiftY = -(clamped * 28).toFixed(2);
            var scale = (1 + clamped * 0.06).toFixed(4);
            heroBackdrop.style.transform = 'translate3d(0, ' + shiftY + 'px, 0) scale(' + scale + ')';
          }
          if (heroContour) {
            heroContour.style.transform = 'translate3d(0, ' + (clamped * 22).toFixed(2) + 'px, 0)';
          }
          if (heroArt) {
            var artTilt = Math.min(8, clamped * 16).toFixed(2);
            heroArt.style.transform = 'translate3d(0, ' + (-(clamped * 20)).toFixed(2) + 'px, 0) rotateX(' + artTilt + 'deg)';
          }
          if (topPill) {
            topPill.style.transform = 'translate3d(0, ' + (-(clamped * 14)).toFixed(2) + 'px, 0)';
          }
          if (botPill) {
            botPill.style.transform = 'translate3d(0, ' + (clamped * 14).toFixed(2) + 'px, 0)';
          }
        });
      } catch (e) {
        // Safe fallback
      }

      // Dedicated Scroll-Scrubbed Storyboard Scene (#wp-scroll-scene)
      var sceneEl = document.getElementById('wp-scroll-scene');
      if (sceneEl) {
        var cards = sceneEl.querySelectorAll('.wp-scene-card');
        var lineFill = document.getElementById('wp-scroll-line-fill');
        var pctEl = document.getElementById('wp-scroll-pct');
        try {
          M.scroll(function (progress) {
            // Map visible traversal smoothly [0.10..0.48] -> [0..1]
            var rawT = Math.max(0, Math.min(1, (progress - 0.10) / 0.38));
            var t = 1 - Math.pow(1 - rawT, 3);
            var mobile = window.innerWidth <= 860;

            if (pctEl) pctEl.textContent = Math.round(t * 100) + '% Synced';
            if (lineFill) {
              lineFill.style.strokeDashoffset = String(Math.round(900 * (1 - t)));
            }

            cards.forEach(function (card, idx) {
              var spreadX = mobile ? 0 : (idx === 0 ? 48 * (1 - t) : (idx === 2 ? -48 * (1 - t) : 0));
              var rotZ = mobile ? 0 : (idx === 0 ? -3.5 * (1 - t) : (idx === 2 ? 3.5 * (1 - t) : 0));
              var liftY = (1 - t) * (idx === 1 ? 28 : 16);
              var sc = (0.93 + 0.07 * t).toFixed(4);
              card.style.opacity = (0.55 + 0.45 * t).toFixed(3);
              card.style.transform = 'translate3d(' + spreadX.toFixed(2) + 'px, ' + liftY.toFixed(2) + 'px, 0) rotate(' + rotZ.toFixed(2) + 'deg) scale(' + sc + ')';
              if (t >= 0.15 + idx * 0.30) {
                card.classList.add('is-active');
              } else {
                card.classList.remove('is-active');
              }
            });
          }, { target: sceneEl, offset: ['start end', 'end start'] });
        } catch (e) {
          // Graceful fallback if target scroll unsupported
        }
      }

      // Orbital ring gentle scroll spin
      var orbitStage = document.querySelector('.wp-orbital-stage');
      var orbitRings = document.querySelector('.wp-orbital-rings');
      if (orbitStage && orbitRings) {
        try {
          M.scroll(function (progress) {
            var deg = ((progress || 0) * 52).toFixed(2);
            orbitRings.style.transform = 'rotate(' + deg + 'deg)';
          }, { target: orbitStage, offset: ['start end', 'end start'] });
        } catch (e) {
          // Safe fallback
        }
      }
    }

    // Brush-stroke SVG auto-draw on viewport enter
    if (typeof M.inView === 'function') {
      var brushPaths = document.querySelectorAll('.wp-brush-svg path');
      if (brushPaths.length > 0) {
        M.inView(brushPaths, function (pathEl) {
          if (pathEl.dataset.drawn === '1') return;
          pathEl.dataset.drawn = '1';
          try {
            var len = pathEl.getTotalLength ? Math.ceil(pathEl.getTotalLength()) : 280;
            pathEl.style.strokeDasharray = String(len);
            pathEl.style.strokeDashoffset = String(len);
            animeCall(pathEl, {
              strokeDashoffset: [len, 0],
              duration: 720,
              ease: 'outCubic'
            });
          } catch (e) {
            // Safe fallback
          }
        }, { amount: 0.4 });
      }
    }

    // Animated equalizer bars inside Scene Card 2
    var sceneBars = document.querySelectorAll('.wp-scene-eq span');
    if (sceneBars.length > 0) {
      sceneBars.forEach(function (bar, idx) {
        animeCall(bar, {
          height: ['7px', (15 + (idx % 3) * 5) + 'px', '8px'],
          duration: 620 + idx * 110,
          loop: true,
          ease: 'inOutSine'
        });
      });
    }
  }

  function initMotionRevealsAndGestures() {
    if (!hasMotion() || reducedMotion()) return;
    var M = window.Motion;

    if (typeof M.inView === 'function') {
      var revealTargets = document.querySelectorAll(
        '.telemetry-card, .workflow-step, .bolt-bottom-banner, .front-pricing-card, .front-stat-card, .about-pipe-node, .plan-card, .article-card, .wp-plan-card, .wp-testimonial-card, .wp-code-showcase-frame, .wp-orbital-stage'
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
      var liftCards = document.querySelectorAll('.hero-metric-pill, .workflow-step, .telemetry-card, .about-pipe-node, .wp-plan-card, .wp-testimonial-card, .wp-orbit-node, .wp-scene-card');
      if (liftCards.length > 0) {
        M.hover(liftCards, function (el) {
          M.animate(el, { y: -4 }, { type: 'spring', stiffness: 360, damping: 24 });
          return function () {
            M.animate(el, { y: 0 }, { type: 'spring', stiffness: 360, damping: 26 });
          };
        });
      }
    }

    var orbitNodes = document.querySelectorAll('.wp-orbit-node');
    if (orbitNodes.length > 0 && !reducedMotion()) {
      orbitNodes.forEach(function (node, idx) {
        animeCall(node, {
          translateY: [0, idx % 2 === 0 ? -6 : 6, 0],
          duration: 2800 + idx * 350,
          loop: true,
          ease: 'inOutSine'
        });
      });
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
