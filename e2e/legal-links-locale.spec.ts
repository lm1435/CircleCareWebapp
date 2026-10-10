import { readFileSync, existsSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { test, expect } from './fixtures';

// LEGAL LINKS FOLLOW THE APP LANGUAGE (785dd38).
//
// The Terms of Service and Privacy Policy links on /signup (terms checkbox + the
// Google/Apple caption) and /login (the Google/Apple caption) must open the
// marketing site's translated page for the active language:
// https://circlecare.app/<seg>/terms|privacy, English unprefixed. Source of truth:
// src/lib/legalLinks.ts (LEGAL_MIRROR_LOCALES).
//
// The language is set the way the app really picks it: i18next's detector reads
// ONLY the browser language (`detection.order: ['navigator']`, no storage), so each
// case runs in a context with Playwright's `locale` option. The link NAMES are
// taken from that locale's auth.json, which also proves the UI really rendered in
// that language. Hrefs only — nothing navigates to the external site, and no
// request reaches the backend (both pages render logged out).
//
// Run: cd webapp && npx playwright test e2e/legal-links-locale.spec.ts --project=chromium

test.use({ storageState: { cookies: [], origins: [] }, viewport: { width: 1280, height: 900 } });

const I18N_DIR = resolve(dirname(fileURLToPath(import.meta.url)), '../src/i18n');

interface Case {
  /** What the browser reports (navigator.language). */
  browserLocale: string;
  /** Registry code whose strings the UI renders. */
  appLocale: string;
  /** Path segment on circlecare.app ('' = English, unprefixed). */
  seg: string;
}

const CASES: readonly Case[] = [
  { browserLocale: 'en-US', appLocale: 'en', seg: '' },
  { browserLocale: 'es-MX', appLocale: 'es', seg: 'es' },
  { browserLocale: 'fr-FR', appLocale: 'fr', seg: 'fr' },
  { browserLocale: 'fr-CA', appLocale: 'fr-CA', seg: 'fr-CA' },
  { browserLocale: 'de-DE', appLocale: 'de', seg: 'de' },
  { browserLocale: 'it-IT', appLocale: 'it', seg: 'it' },
  { browserLocale: 'pt-BR', appLocale: 'pt', seg: 'pt' },
  { browserLocale: 'pt-PT', appLocale: 'pt-PT', seg: 'pt-PT' },
];

const BASE_OF: Record<string, string> = { 'fr-CA': 'fr', 'pt-PT': 'pt' };

type AuthJson = { socialLegal?: string; signup?: { termsCheckbox?: string } };

function readAuth(code: string): AuthJson {
  const file = resolve(I18N_DIR, code, 'auth.json');
  return existsSync(file) ? (JSON.parse(readFileSync(file, 'utf8')) as AuthJson) : {};
}

/** Resolve a string through the variant -> base -> en chain, like i18next does. */
function authString(code: string, pick: (a: AuthJson) => string | undefined): string {
  const chain = [code, BASE_OF[code], 'en'].filter((c): c is string => Boolean(c));
  for (const c of chain) {
    const s = pick(readAuth(c));
    if (s) return s;
  }
  throw new Error(`no auth string for ${code}`);
}

function tagText(s: string, tag: 'terms' | 'privacy'): string {
  const m = new RegExp(`<${tag}>(.*?)</${tag}>`).exec(s);
  if (!m?.[1]) throw new Error(`<${tag}> missing in "${s}"`);
  return m[1];
}

function expected(seg: string, page: 'terms' | 'privacy'): string {
  return seg ? `https://circlecare.app/${seg}/${page}` : `https://circlecare.app/${page}`;
}

for (const c of CASES) {
  test.describe(`browser locale ${c.browserLocale}`, () => {
    test.use({ locale: c.browserLocale });

    const social = authString(c.appLocale, (a) => a.socialLegal);
    const checkbox = authString(c.appLocale, (a) => a.signup?.termsCheckbox);

    test(`/signup legal links open the ${c.seg || 'English'} pages`, async ({ page }) => {
      await page.goto('/signup', { waitUntil: 'domcontentloaded' });
      await expect(page.locator('#first_name')).toBeVisible({ timeout: 20_000 });
      await expect(page.locator('html')).toHaveAttribute('lang', new RegExp(`^${c.appLocale.split('-')[0]}`));

      for (const kind of ['terms', 'privacy'] as const) {
        // Terms checkbox link + the Google/Apple caption link: both, same href.
        const names = new Set([tagText(checkbox, kind), tagText(social, kind)]);
        const want = expected(c.seg, kind);
        let total = 0;
        for (const name of names) {
          const links = page.getByRole('link', { name, exact: true });
          const n = await links.count();
          total += n;
          for (let i = 0; i < n; i++) await expect(links.nth(i)).toHaveAttribute('href', want);
        }
        expect(total, `${kind} links on /signup`).toBe(2);
      }
    });

    test(`/login legal links open the ${c.seg || 'English'} pages`, async ({ page }) => {
      await page.goto('/login', { waitUntil: 'domcontentloaded' });
      await expect(page.locator('form button[type="submit"]')).toBeVisible({ timeout: 20_000 });
      await expect(page.locator('html')).toHaveAttribute('lang', new RegExp(`^${c.appLocale.split('-')[0]}`));

      for (const kind of ['terms', 'privacy'] as const) {
        const link = page.getByRole('link', { name: tagText(social, kind), exact: true });
        await expect(link).toHaveCount(1);
        await expect(link).toHaveAttribute('href', expected(c.seg, kind));
      }
    });
  });
}
