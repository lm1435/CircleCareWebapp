import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  THEME_COLORS,
  THEME_STORAGE_KEY,
  applyTheme,
  getThemeSuperProperties,
  isDarkModeEnabled,
  readStoredThemePreference,
  resolveEffectiveTheme,
  systemPrefersDark,
  writeStoredThemePreference,
} from '@/lib/themeCore';

function setHead(): void {
  document.head.innerHTML = `
    <meta name="color-scheme" content="light" />
    <meta name="theme-color" content="#fbf9f5" media="(prefers-color-scheme: light)" />
    <meta name="theme-color" content="#1a1815" media="(prefers-color-scheme: dark)" />`;
}
const content = (sel: string): string[] =>
  Array.from(document.querySelectorAll(sel)).map((m) => m.getAttribute('content') ?? '');

function stubMatchMedia(dark: boolean): void {
  vi.stubGlobal(
    'matchMedia',
    vi.fn().mockImplementation((query: string) => ({
      matches: query.includes('dark') ? dark : false,
      media: query,
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
    }))
  );
  window.matchMedia = globalThis.matchMedia;
}

beforeEach(() => {
  localStorage.clear();
  setHead();
  document.documentElement.removeAttribute('data-theme');
});
afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
  // @ts-expect-error jsdom has no matchMedia by default
  delete window.matchMedia;
});

describe('resolveEffectiveTheme', () => {
  it.each([
    ['system', false, 'light'],
    ['system', true, 'dark'],
    ['light', true, 'light'],
    ['light', false, 'light'],
    ['dark', false, 'dark'],
    ['dark', true, 'dark'],
  ] as const)('preference %s, device dark=%s -> %s', (pref, sys, expected) => {
    expect(resolveEffectiveTheme(pref, sys, true)).toBe(expected);
  });

  it('is ALWAYS light when the build flag is off', () => {
    expect(resolveEffectiveTheme('dark', true, false)).toBe('light');
    expect(resolveEffectiveTheme('system', true, false)).toBe('light');
  });
});

describe('stored preference', () => {
  it('defaults to system and round-trips through cc.themePreference.v1', () => {
    expect(readStoredThemePreference()).toBe('system');
    writeStoredThemePreference('dark');
    expect(localStorage.getItem(THEME_STORAGE_KEY)).toBe('dark');
    expect(THEME_STORAGE_KEY).toBe('cc.themePreference.v1');
    expect(readStoredThemePreference()).toBe('dark');
  });

  it('ignores garbage values', () => {
    localStorage.setItem(THEME_STORAGE_KEY, 'sepia');
    expect(readStoredThemePreference()).toBe('system');
  });

  it('survives storage that throws on read and on write', () => {
    const getItem = vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
      throw new Error('blocked');
    });
    const setItem = vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new Error('blocked');
    });
    expect(readStoredThemePreference()).toBe('system');
    expect(() => writeStoredThemePreference('dark')).not.toThrow();
    getItem.mockRestore();
    setItem.mockRestore();
  });

  it('ignores a stored dark preference while the build flag is off', () => {
    localStorage.setItem(THEME_STORAGE_KEY, 'dark');
    vi.stubEnv('VITE_DARK_MODE', 'false');
    expect(isDarkModeEnabled()).toBe(false);
    expect(readStoredThemePreference()).toBe('system');
    expect(getThemeSuperProperties()).toEqual({ theme: 'light', theme_preference: 'system' });
  });
});

describe('systemPrefersDark', () => {
  it('is false without matchMedia and follows it when present', () => {
    expect(systemPrefersDark()).toBe(false);
    stubMatchMedia(true);
    expect(systemPrefersDark()).toBe(true);
    stubMatchMedia(false);
    expect(systemPrefersDark()).toBe(false);
  });
});

describe('applyTheme', () => {
  it('System keeps the browser in charge of chrome: light dark + per-scheme theme-color', () => {
    applyTheme('dark', 'system', true);
    expect(document.documentElement.getAttribute('data-theme')).toBe('dark');
    expect(content('meta[name="color-scheme"]')).toEqual(['light dark']);
    expect(content('meta[name="theme-color"]')).toEqual([THEME_COLORS.light, THEME_COLORS.dark]);
  });

  it('an explicit choice pins the chrome to that scheme', () => {
    applyTheme('dark', 'dark', true);
    expect(content('meta[name="color-scheme"]')).toEqual(['dark']);
    expect(content('meta[name="theme-color"]')).toEqual([THEME_COLORS.dark, THEME_COLORS.dark]);
    applyTheme('light', 'light', true);
    expect(document.documentElement.getAttribute('data-theme')).toBe('light');
    expect(content('meta[name="color-scheme"]')).toEqual(['light']);
    expect(content('meta[name="theme-color"]')).toEqual([THEME_COLORS.light, THEME_COLORS.light]);
  });

  it('flag off: light everywhere, whatever the preference', () => {
    applyTheme('light', 'dark', false);
    expect(document.documentElement.getAttribute('data-theme')).toBe('light');
    expect(content('meta[name="color-scheme"]')).toEqual(['light']);
    expect(content('meta[name="theme-color"]')).toEqual([THEME_COLORS.light, THEME_COLORS.light]);
  });

  it('the theme-color constants are the real page backgrounds (globals.css --color-bg)', async () => {
    const { readFileSync } = await import('node:fs');
    const css = readFileSync('src/styles/globals.css', 'utf8');
    const light = /@theme\s*\{[\s\S]*?--color-bg:\s*(#[0-9a-f]{6})/i.exec(css)?.[1];
    const dark = /data-theme='dark'\]\s*\{[\s\S]*?--color-bg:\s*(#[0-9a-f]{6})/i.exec(css)?.[1];
    expect(THEME_COLORS.light).toBe(light);
    expect(THEME_COLORS.dark).toBe(dark);
  });
});
