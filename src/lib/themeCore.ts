/**
 * Theme core: the pure, import-light half of dark mode (no store, no analytics),
 * so `lib/posthog.ts` can read it without an import cycle.
 *
 * Model (owner decisions 2026-10-18): the preference is System (default, follows
 * the device LIVE) / Light / Dark, stored per device in localStorage under
 * `cc.themePreference.v1`, never synced to the backend. The EFFECTIVE theme is
 * what actually paints; `data-theme="light|dark"` on <html> carries it and every
 * dark token hangs off `:root[data-theme='dark']` (styles/globals.css).
 *
 * BUILD FLAG. `VITE_DARK_MODE` (vite.config.ts sets it: ON for `vite` dev, OFF
 * for `vite build` unless the env var says otherwise). When off the app is
 * forced light, the stored preference is ignored and the Settings selector is
 * hidden. Mobile ships behind the same switch; both flip ON together in 1.3.0.
 *
 * PRE-PAINT. The same decision is made BEFORE first paint by the classic script
 * public/theme-init.js (external, so the CSP's `script-src 'self'` holds). That
 * file cannot import this one, so it re-implements `resolveEffectiveTheme` in ~25
 * lines; `__tests__/themeInitScript.test.ts` runs both against the same matrix.
 */

export type ThemePreference = 'system' | 'light' | 'dark';
export type EffectiveTheme = 'light' | 'dark';

export const THEME_PREFERENCES: readonly ThemePreference[] = ['system', 'light', 'dark'];
export const THEME_STORAGE_KEY = 'cc.themePreference.v1';
export const DEFAULT_THEME_PREFERENCE: ThemePreference = 'system';

/** `<meta name="theme-color">` per scheme: the page background (--color-bg). */
export const THEME_COLORS: Record<EffectiveTheme, string> = {
  light: '#fbf9f5',
  dark: '#1a1815',
};

/** Build-time switch. Read at call time so tests can stub the env. */
export function isDarkModeEnabled(): boolean {
  return import.meta.env.VITE_DARK_MODE === 'true';
}

export function isThemePreference(value: unknown): value is ThemePreference {
  return value === 'system' || value === 'light' || value === 'dark';
}

/** The stored preference, or System. Every storage access is guarded. */
export function readStoredThemePreference(): ThemePreference {
  if (!isDarkModeEnabled()) return DEFAULT_THEME_PREFERENCE;
  try {
    const raw = localStorage.getItem(THEME_STORAGE_KEY);
    return isThemePreference(raw) ? raw : DEFAULT_THEME_PREFERENCE;
  } catch {
    return DEFAULT_THEME_PREFERENCE;
  }
}

export function writeStoredThemePreference(preference: ThemePreference): void {
  try {
    localStorage.setItem(THEME_STORAGE_KEY, preference);
  } catch {
    // Storage blocked (private mode, quota): the choice still applies for this page view.
  }
}

export function systemPrefersDark(): boolean {
  try {
    return typeof window.matchMedia === 'function'
      ? window.matchMedia('(prefers-color-scheme: dark)').matches
      : false;
  } catch {
    return false;
  }
}

export function resolveEffectiveTheme(
  preference: ThemePreference,
  systemDark: boolean,
  enabled: boolean = isDarkModeEnabled()
): EffectiveTheme {
  if (!enabled) return 'light';
  if (preference === 'system') return systemDark ? 'dark' : 'light';
  return preference;
}

/**
 * Paint a theme: `data-theme` on <html>, `<meta name="color-scheme">` and the
 * `theme-color` metas. System keeps the browser's own media-query behaviour for
 * the chrome (`light dark`, each theme-color meta keeps its own scheme's colour);
 * an explicit choice pins both to that scheme.
 */
export function applyTheme(
  effective: EffectiveTheme,
  preference: ThemePreference,
  enabled: boolean = isDarkModeEnabled()
): void {
  try {
    const root = document.documentElement;
    root.setAttribute('data-theme', effective);
    const followsSystem = enabled && preference === 'system';
    document
      .querySelector('meta[name="color-scheme"]')
      ?.setAttribute('content', !enabled ? 'light' : followsSystem ? 'light dark' : effective);
    document.querySelectorAll('meta[name="theme-color"]').forEach((meta) => {
      const own: EffectiveTheme = /dark/.test(meta.getAttribute('media') ?? '') ? 'dark' : 'light';
      meta.setAttribute('content', THEME_COLORS[followsSystem ? own : effective]);
    });
  } catch {
    // No DOM (tests, SSR): nothing to paint.
  }
}

/**
 * The two analytics super properties. Enums only: `theme` is what is painted,
 * `theme_preference` what the person chose.
 */
export function getThemeSuperProperties(): {
  theme: EffectiveTheme;
  theme_preference: ThemePreference;
} {
  const theme_preference = readStoredThemePreference();
  return {
    theme: resolveEffectiveTheme(theme_preference, systemPrefersDark()),
    theme_preference,
  };
}
