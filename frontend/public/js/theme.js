// Unified Theme Manager for Dark & Light Mode
(function initTheme() {
  const saved = localStorage.getItem('ai_interviewer_theme') || 'dark';
  document.documentElement.setAttribute('data-theme', saved);
})();

window.setTheme = function(theme) {
  const next = theme === 'light' ? 'light' : 'dark';
  document.documentElement.setAttribute('data-theme', next);
  localStorage.setItem('ai_interviewer_theme', next);
  window.syncThemeUI(next);
};

window.toggleTheme = function() {
  const current = document.documentElement.getAttribute('data-theme') || 'dark';
  window.setTheme(current === 'dark' ? 'light' : 'dark');
};

window.syncThemeUI = function(theme) {
  const currentTheme = theme || document.documentElement.getAttribute('data-theme') || 'dark';
  const isDark = currentTheme === 'dark';

  document.querySelectorAll('.theme-toggle-icon').forEach(icon => {
    icon.className = isDark ? 'bi bi-sun-fill theme-toggle-icon' : 'bi bi-moon-stars-fill theme-toggle-icon';
  });

  document.querySelectorAll('.theme-toggle-btn').forEach(btn => {
    btn.setAttribute('title', isDark ? 'Switch to Light Mode' : 'Switch to Dark Mode');
    btn.setAttribute('aria-label', isDark ? 'Switch to Light Mode' : 'Switch to Dark Mode');
  });

  document.querySelectorAll('.theme-seg-btn').forEach(btn => {
    const choice = btn.getAttribute('data-theme-choice');
    const active = choice === currentTheme;
    btn.classList.toggle('active', active);
    btn.setAttribute('aria-pressed', active ? 'true' : 'false');
  });
};

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', () => window.syncThemeUI());
} else {
  window.syncThemeUI();
}
