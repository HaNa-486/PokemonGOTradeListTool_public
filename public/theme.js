// Runs before the page renders. Only this browser's display preference is stored.
(() => {
  const key = 'trade-color-mode';
  const root = document.documentElement;
  const media = window.matchMedia('(prefers-color-scheme: dark)');
  const normalize = value => ['light', 'dark'].includes(value) ? value : 'system';
  let preference = 'system';
  try { preference = normalize(localStorage.getItem(key)); } catch { /* Storage may be disabled. */ }
  function apply() {
    root.dataset.themePreference = preference;
    root.dataset.theme = preference === 'system' ? (media.matches ? 'dark' : 'light') : preference;
    window.dispatchEvent(new Event('trade-theme-updated'));
  }
  apply();
  media.addEventListener('change', apply);
  window.addEventListener('trade-theme-select', event => {
    preference = normalize(event.detail);
    try { localStorage.setItem(key, preference); } catch { /* Keep selection for this page. */ }
    apply();
  });
  window.addEventListener('storage', event => {
    if (event.key === key || event.key === null) {
      preference = normalize(event.newValue);
      apply();
    }
  });
})();
