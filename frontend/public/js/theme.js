// Theme Manager for Dark and Light Mode
(function initTheme() {
  const saved = localStorage.getItem('ai_interviewer_theme') || 
    (window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light');
  document.documentElement.setAttribute('data-theme', saved);
})();

window.toggleTheme = function() {
  const current = document.documentElement.getAttribute('data-theme') || 'light';
  const next = current === 'dark' ? 'light' : 'dark';
  document.documentElement.setAttribute('data-theme', next);
  localStorage.setItem('ai_interviewer_theme', next);
  window.syncThemeUI(next);
};

window.syncThemeUI = function(theme) {
  const currentTheme = theme || document.documentElement.getAttribute('data-theme') || 'light';
  const isDark = currentTheme === 'dark';
  
  document.querySelectorAll('.theme-toggle-icon').forEach(icon => {
    icon.className = isDark ? 'bi bi-sun-fill theme-toggle-icon' : 'bi bi-moon-stars-fill theme-toggle-icon';
  });
  
  document.querySelectorAll('.theme-toggle-btn').forEach(btn => {
    btn.setAttribute('title', isDark ? 'Switch to Light Mode' : 'Switch to Dark Mode');
    btn.setAttribute('aria-label', isDark ? 'Switch to Light Mode' : 'Switch to Dark Mode');
  });
};

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', () => window.syncThemeUI());
} else {
  window.syncThemeUI();
}
