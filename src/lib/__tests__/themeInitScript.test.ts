import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  THEME_STORAGE_KEY,
  applyTheme,
  resolveEffectiveTheme,
  type ThemePreference,
} from '@/lib/themeCore';

// public/theme-init.js runs BEFORE first paint (classic external script, so the
// CSP's `script-src 'self'` holds). It cannot import app code, so it re-states
// the resolve + apply logic. This test runs the REAL file and the TS module over
// one matrix and demands identical DOM output, so the two cannot drift.

const SCRIPT = readFileSync(resolve(__dirname, '../../../public/theme-init.js'), 'utf8');

const HEAD = `
  <meta name="color-scheme" content="light" />
  <meta name="theme-color" content="#fbf9f5" media="(prefers-color-scheme: light)" />
  <meta name="theme-color" content="#1a1815" media="(prefers-color-scheme: dark)" />`;

function mount(flag: '1' | '0' | null): void {
  document.head.innerHTML = HEAD + (flag === null ? '' : `<meta name="cc-dark-mode" content="${flag}" />`);
  document.documentElement.removeAttribute('data-theme');
}
function snapshot(): { theme: string | null; scheme: string[]; colors: string[] } {
  const vals = (sel: string): string[] =>
    Array.from(document.querySelectorAll(sel)).map((m) => m.getAttribute('content') ?? '');
  return {
    theme: document.documentElement.getAttribute('data-theme'),
    scheme: vals('meta[name="color-scheme"]'),
    colors: vals('meta[name="theme-color"]'),
  };
}
function runScript(): void {
  new Function(SCRIPT)();
}
function setSystemDark(dark: boolean): void {
  window.matchMedia = ((query: string) => ({
    matches: query.includes('dark') ? dark : false,
    media: query,
  })) as unknown as typeof window.matchMedia;
}

beforeEach(() => localStorage.clear());
afterEach(() => {
  // @ts-expect-error jsdom has no matchMedia by default
  delete window.matchMedia;
  vi.restoreAllMocks();
});

const MATRIX: Array<[ThemePreference | null, boolean]> = [
  [null, false],
  [null, true],
  ['system', false],
  ['system', true],
  ['light', true],
  ['light', false],
  ['dark', false],
  ['dark', true],
];

describe('public/theme-init.js', () => {
  it.each(MATRIX)('flag on, stored %s, device dark=%s: same DOM as themeCore', (stored, sysDark) => {
    if (stored) localStorage.setItem(THEME_STORAGE_KEY, stored);
    setSystemDark(sysDark);

    mount('1');
    runScript();
    const fromScript = snapshot();

    mount('1');
    const pref = stored ?? 'system';
    applyTheme(resolveEffectiveTheme(pref, sysDark, true), pref, true);
    expect(fromScript).toEqual(snapshot());
    expect(fromScript.theme).toBe(
      pref === 'dark' || (pref === 'system' && sysDark) ? 'dark' : 'light'
    );
  });

  it.each(['0', null] as const)('flag %s: forced light, a stored dark is ignored', (flag) => {
    localStorage.setItem(THEME_STORAGE_KEY, 'dark');
    setSystemDark(true);
    mount(flag);
    runScript();
    expect(snapshot()).toEqual({
      theme: 'light',
      scheme: ['light'],
      colors: ['#fbf9f5', '#fbf9f5'],
    });
  });

  it('never throws: storage blocked and no matchMedia', () => {
    vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
      throw new Error('blocked');
    });
    mount('1');
    expect(runScript).not.toThrow();
    expect(document.documentElement.getAttribute('data-theme')).toBe('light');
  });

  it('is an external-safe classic script: no module syntax, no network, no eval', () => {
    const code = SCRIPT.replace(/\/\*[\s\S]*?\*\//g, '');
    expect(code).not.toMatch(/\b(import|export)\b\s/);
    expect(code).not.toMatch(/\b(fetch|XMLHttpRequest|eval)\b|new Function/);
  });
});

describe('index.html wiring', () => {
  const html = readFileSync(resolve(__dirname, '../../../index.html'), 'utf8');

  it('loads the bootstrap as an external script in <head>, before the app bundle', () => {
    const head = html.slice(0, html.indexOf('</head>'));
    expect(head).toContain('<script src="/theme-init.js"></script>');
    expect(html.indexOf('/theme-init.js')).toBeLessThan(html.indexOf('/src/main.tsx'));
  });

  it('has NO inline script anywhere (the CSP forbids it)', () => {
    for (const m of html.matchAll(/<script\b([^>]*)>([\s\S]*?)<\/script>/g)) {
      expect(m[1], 'every script must carry src=').toMatch(/\bsrc=/);
      expect(m[2].trim()).toBe('');
    }
  });

  it('declares color-scheme, a theme-color per scheme and the flag token', () => {
    expect(html).toContain('<meta name="color-scheme" content="light" />');
    expect(html).toMatch(/theme-color" content="#fbf9f5" media="\(prefers-color-scheme: light\)"/);
    expect(html).toMatch(/theme-color" content="#1a1815" media="\(prefers-color-scheme: dark\)"/);
    expect(html).toContain('<meta name="cc-dark-mode" content="__CC_DARK_MODE__" />');
  });

  it('the un-hashed bootstrap is revalidated, not pinned by the immutable *.js rule', () => {
    const htaccess = readFileSync(resolve(__dirname, '../../../public/.htaccess'), 'utf8');
    const immutable = htaccess.indexOf('immutable');
    const own = htaccess.search(/<FilesMatch "\^theme-init\\\.js\$">\s*Header set Cache-Control "no-cache"/);
    expect(immutable).toBeGreaterThan(-1);
    // Later `Header set` wins in Apache, so the override must come AFTER the immutable rule.
    expect(own).toBeGreaterThan(immutable);
  });
});
