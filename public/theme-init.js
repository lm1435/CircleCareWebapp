/*
 * Pre-paint theme bootstrap. A CLASSIC, EXTERNAL script loaded from <head> so
 * the first paint already carries the right colours (no light flash for a dark
 * device) WITHOUT an inline script: the production CSP is `script-src 'self'`
 * with no 'unsafe-inline' and no hashes (public/.htaccess, pinned by
 * src/__tests__/securityHeaders.test.ts), and an external same-origin file
 * satisfies it untouched.
 *
 * It mirrors src/lib/themeCore.ts (resolveEffectiveTheme + applyTheme) because a
 * public/ file cannot import app code; src/lib/__tests__/themeInitScript.test.ts
 * runs both against one matrix so they cannot drift. Keep it ES5, dependency-free,
 * and wrapped so that nothing here can ever throw into the page.
 *
 * Inputs: <meta name="cc-dark-mode"> (the build flag, "1" = on), localStorage
 * `cc.themePreference.v1` (system | light | dark), prefers-color-scheme.
 */
(function () {
  try {
    var doc = document;
    var flag = doc.querySelector('meta[name="cc-dark-mode"]');
    var enabled = !!flag && flag.getAttribute('content') === '1';
    var preference = 'system';
    if (enabled) {
      try {
        var stored = localStorage.getItem('cc.themePreference.v1');
        if (stored === 'light' || stored === 'dark' || stored === 'system') preference = stored;
      } catch (e) {
        /* storage blocked: System */
      }
    }
    var systemDark = false;
    try {
      systemDark = !!window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches;
    } catch (e) {
      /* no matchMedia: light */
    }
    var effective = enabled && (preference === 'dark' || (preference === 'system' && systemDark))
      ? 'dark'
      : 'light';
    var colors = { light: '#fbf9f5', dark: '#1a1815' };
    var followsSystem = enabled && preference === 'system';
    doc.documentElement.setAttribute('data-theme', effective);
    var scheme = doc.querySelector('meta[name="color-scheme"]');
    if (scheme) {
      scheme.setAttribute('content', !enabled ? 'light' : followsSystem ? 'light dark' : effective);
    }
    var metas = doc.querySelectorAll('meta[name="theme-color"]');
    for (var i = 0; i < metas.length; i++) {
      var own = /dark/.test(metas[i].getAttribute('media') || '') ? 'dark' : 'light';
      metas[i].setAttribute('content', colors[followsSystem ? own : effective]);
    }
  } catch (e) {
    /* never block first paint */
  }
})();
