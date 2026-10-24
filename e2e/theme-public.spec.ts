import { test, expect, type Page } from '@playwright/test';

// Dark mode runtime, BACKEND-FREE: every assertion is on the logged-out /login
// page (project `theme-public`, no session, no database). The authenticated half
// (pick Dark in Profile > Appearance) is e2e/flows/theme.spec.ts.
//
// What this proves that jsdom cannot: the real pre-paint script against a real
// `prefers-color-scheme`, the real computed colours of the real stylesheet, and
// that the page is not painted light first.

test.use({ storageState: { cookies: [], origins: [] } });

const KEY = 'cc.themePreference.v1';
const BG_LIGHT = 'rgb(251, 249, 245)'; // --color-bg
const BG_DARK = 'rgb(26, 24, 21)'; // dark --color-bg

const theme = (page: Page): Promise<string | null> =>
  page.evaluate(() => document.documentElement.getAttribute('data-theme'));
const bodyBg = (page: Page): Promise<string> =>
  page.evaluate(() => getComputedStyle(document.body).backgroundColor);
const metaContent = (page: Page, sel: string): Promise<string[]> =>
  page.evaluate(
    (s) => Array.from(document.querySelectorAll(s)).map((m) => m.getAttribute('content') ?? ''),
    sel
  );

test.describe('System (the default) follows the device', () => {
  test('dark device paints dark, light device paints light', async ({ page }) => {
    await page.emulateMedia({ colorScheme: 'dark' });
    await page.goto('/login');
    expect(await theme(page)).toBe('dark');
    expect(await bodyBg(page)).toBe(BG_DARK);

    await page.emulateMedia({ colorScheme: 'light' });
    await page.goto('/login');
    expect(await theme(page)).toBe('light');
    expect(await bodyBg(page)).toBe(BG_LIGHT);
  });

  test('flips LIVE when the device flips, with no reload', async ({ page }) => {
    await page.emulateMedia({ colorScheme: 'light' });
    await page.goto('/login');
    await expect.poll(() => theme(page)).toBe('light');

    await page.emulateMedia({ colorScheme: 'dark' });
    await expect.poll(() => theme(page)).toBe('dark');
    expect(await bodyBg(page)).toBe(BG_DARK);

    await page.emulateMedia({ colorScheme: 'light' });
    await expect.poll(() => theme(page)).toBe('light');
    expect(await bodyBg(page)).toBe(BG_LIGHT);
  });

  test('the browser chrome follows too: color-scheme light dark, theme-color per scheme', async ({
    page,
  }) => {
    await page.emulateMedia({ colorScheme: 'dark' });
    await page.goto('/login');
    expect(await metaContent(page, 'meta[name="color-scheme"]')).toEqual(['light dark']);
    expect(await metaContent(page, 'meta[name="theme-color"]')).toEqual(['#fbf9f5', '#1a1815']);
  });
});

test.describe('pre-paint', () => {
  test('data-theme is set by the external script BEFORE the app bundle runs', async ({ page }) => {
    // Kill the app entry: if the attribute is still there, only public/theme-init.js
    // (a classic script in <head>, CSP-safe because it is external) could have set it.
    await page.route('**/src/main.tsx*', (route) => route.abort());
    await page.route('**/assets/index-*.js', (route) => route.abort());
    await page.emulateMedia({ colorScheme: 'dark' });
    await page.goto('/login', { waitUntil: 'domcontentloaded' });
    expect(await theme(page)).toBe('dark');
    // (No colour assertion here: in dev the stylesheet is injected BY the bundle we aborted.)
    expect(await metaContent(page, 'meta[name="color-scheme"]')).toEqual(['light dark']);
  });

  test('a stored Dark wins over a light device, before the bundle runs', async ({ page }) => {
    await page.addInitScript((k) => localStorage.setItem(k, 'dark'), KEY);
    await page.route('**/src/main.tsx*', (route) => route.abort());
    await page.route('**/assets/index-*.js', (route) => route.abort());
    await page.emulateMedia({ colorScheme: 'light' });
    await page.goto('/login', { waitUntil: 'domcontentloaded' });
    expect(await theme(page)).toBe('dark');
    expect(await metaContent(page, 'meta[name="color-scheme"]')).toEqual(['dark']);
    expect(await metaContent(page, 'meta[name="theme-color"]')).toEqual(['#1a1815', '#1a1815']);
  });
});

test.describe('explicit preference (per device, localStorage)', () => {
  test('Dark persists across reloads and ignores the device', async ({ page }) => {
    await page.emulateMedia({ colorScheme: 'light' });
    await page.goto('/login');
    await page.evaluate((k) => localStorage.setItem(k, 'dark'), KEY);
    await page.reload();
    expect(await theme(page)).toBe('dark');
    // The device flipping must not move an explicit choice.
    await page.emulateMedia({ colorScheme: 'dark' });
    await page.emulateMedia({ colorScheme: 'light' });
    expect(await theme(page)).toBe('dark');
  });

  test('Light beats a dark device', async ({ page }) => {
    await page.emulateMedia({ colorScheme: 'dark' });
    await page.goto('/login');
    await page.evaluate((k) => localStorage.setItem(k, 'light'), KEY);
    await page.reload();
    expect(await theme(page)).toBe('light');
    expect(await bodyBg(page)).toBe(BG_LIGHT);
  });

  test('a garbage stored value falls back to System', async ({ page }) => {
    await page.emulateMedia({ colorScheme: 'dark' });
    await page.goto('/login');
    await page.evaluate((k) => localStorage.setItem(k, 'sepia'), KEY);
    await page.reload();
    expect(await theme(page)).toBe('dark');
  });
});

test.describe('dark rendering of real surfaces', () => {
  test.use({ viewport: { width: 1280, height: 800 } });

  test('the primary button is warm white with a charcoal label; Apple is black with a light outline', async ({
    page,
  }) => {
    await page.emulateMedia({ colorScheme: 'dark' });
    await page.goto('/login');
    const primary = page.getByRole('button', { name: /^Sign in$/i }).first();
    await expect(primary).toBeVisible();
    expect(await primary.evaluate((el) => getComputedStyle(el).backgroundColor)).toBe(
      'rgb(239, 233, 222)'
    );
    expect(await primary.evaluate((el) => getComputedStyle(el).color)).toBe('rgb(35, 32, 25)');

    const apple = page.getByRole('button', { name: /apple/i }).first();
    await expect(apple).toBeVisible();
    expect(await apple.evaluate((el) => getComputedStyle(el).backgroundColor)).toBe('rgb(0, 0, 0)');
    expect(await apple.evaluate((el) => getComputedStyle(el).boxShadow)).toContain('rgba(255, 255, 255, 0.42)');
  });

  test('the hero photo is dimmed under the scrim and its copy stays light', async ({ page }) => {
    await page.emulateMedia({ colorScheme: 'dark' });
    await page.goto('/login');
    const img = page.locator('aside img').first();
    await expect(img).toBeVisible();
    expect(await img.evaluate((el) => getComputedStyle(el).filter)).toContain('brightness(0.7)');
    const headline = page.locator('aside p').nth(1);
    expect(await headline.evaluate((el) => getComputedStyle(el).color)).toBe('rgb(251, 249, 245)');
  });

  test('LIGHT is untouched: sage primary, white label, black Apple, undimmed photo', async ({
    page,
  }) => {
    await page.emulateMedia({ colorScheme: 'light' });
    await page.goto('/login');
    const primary = page.getByRole('button', { name: /^Sign in$/i }).first();
    expect(await primary.evaluate((el) => getComputedStyle(el).backgroundColor)).toBe(
      'rgb(92, 107, 78)'
    );
    expect(await primary.evaluate((el) => getComputedStyle(el).color)).toBe('rgb(255, 255, 255)');
    const apple = page.getByRole('button', { name: /apple/i }).first();
    expect(await apple.evaluate((el) => getComputedStyle(el).backgroundColor)).toBe(
      'rgb(26, 25, 22)'
    );
    const img = page.locator('aside img').first();
    expect(await img.evaluate((el) => getComputedStyle(el).filter)).toBe('none');
  });
});

test.describe('print is ALWAYS light', () => {
  test('a dark app prints on the light palette', async ({ page }) => {
    await page.emulateMedia({ colorScheme: 'dark' });
    await page.goto('/login');
    expect(await bodyBg(page)).toBe(BG_DARK);
    await page.emulateMedia({ colorScheme: 'dark', media: 'print' });
    expect(await bodyBg(page)).toBe(BG_LIGHT);
    expect(await page.evaluate(() => getComputedStyle(document.documentElement).colorScheme)).toBe(
      'light'
    );
  });
});
