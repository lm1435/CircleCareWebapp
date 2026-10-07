import type { Page } from '@playwright/test';
import { test, expect } from '../fixtures';

// SIGNUP LANGUAGE follows the browser locale through the locale registry.
//
// The bug this pins (A10): the signup payload's `language` was derived with a
// strict compare, so an es-MX / es-419 browser (UI rendered in Spanish from the
// base `es` bundle) registered the account as 'en' and every later email/push
// went out in the wrong language. The request is intercepted with page.route and
// FULFILLED by the stub, so nothing reaches the backend and NO real email is
// ever sent. No account is created and no session is needed.
//
// Run (needs the dev server, no backend):
//   cd webapp && npx playwright test e2e/flows/signup-locale.spec.ts --project=chromium

test.use({ storageState: { cookies: [], origins: [] }, viewport: { width: 1280, height: 900 } });

const SIGNUP = '**/api/auth/signup';
const PASSWORD = 'Str0ng!Passw0rd';

interface Captured {
  language?: string;
  email?: string;
}

/** Stub POST /api/auth/signup and capture the JSON body the page sends. */
async function captureSignup(page: Page): Promise<() => Captured | null> {
  let body: Captured | null = null;
  await page.route(SIGNUP, async (route) => {
    const req = route.request();
    if (req.method() !== 'POST') {
      await route.fallback();
      return;
    }
    body = req.postDataJSON() as Captured;
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        success: true,
        data: {
          user: { id: 'stub-user', email: body.email ?? '', first_name: 'Ada', last_name: 'Lang' },
          message: 'sent',
        },
      }),
    });
  });
  return () => body;
}

async function submitSignup(page: Page): Promise<void> {
  await page.goto('/signup', { waitUntil: 'domcontentloaded' });
  await expect(page.locator('#first_name')).toBeVisible({ timeout: 20_000 });
  await page.locator('#first_name').fill('Ada');
  await page.locator('#last_name').fill('Lang');
  await page.locator('#email').fill('locale-check@example.com');
  await page.locator('#password').fill(PASSWORD);
  await page.locator('#confirmPassword').fill(PASSWORD);
  const terms = page.locator('#termsAccepted');
  await terms.check({ force: true });
  await expect(terms).toBeChecked();
  await page.locator('form button[type="submit"]').click();
}

test.describe('browser locale es-MX', () => {
  test.use({ locale: 'es-MX' });

  test('renders Spanish and sends language "es" in the signup payload', async ({ page }) => {
    const captured = await captureSignup(page);
    await submitSignup(page);

    await expect.poll(() => captured()?.language, { timeout: 15_000 }).toBe('es');
    // The UI really was Spanish (the base `es` bundle served an es-MX browser).
    await expect(page.locator('html')).toHaveAttribute('lang', /^es/);
  });
});

// 1.2.2: the six Stage 1 locales are registered. A registered VARIANT is sent as
// itself (fr-CA, pt-PT); any other region of a registered language is sent as its
// base (fr-BE -> fr, pt-BR -> pt, de-AT -> de). Variant selection follows the tag only.
for (const [locale, expected] of [
  ['fr-CA', 'fr-CA'],
  ['fr-BE', 'fr'],
  ['de-AT', 'de'],
  ['it-IT', 'it'],
  ['pt-BR', 'pt'],
  ['pt-PT', 'pt-PT'],
] as const) {
  test.describe(`browser locale ${locale}`, () => {
    test.use({ locale });

    test(`renders ${expected} and sends language "${expected}"`, async ({ page }) => {
      const captured = await captureSignup(page);
      await submitSignup(page);

      await expect.poll(() => captured()?.language, { timeout: 15_000 }).toBe(expected);
      const primary = expected.split('-')[0] as string;
      await expect(page.locator('html')).toHaveAttribute('lang', new RegExp(`^${primary}`));
    });
  });
}

test.describe('browser locale ja-JP (not shipped)', () => {
  test.use({ locale: 'ja-JP' });

  test('falls back to English and sends language "en"', async ({ page }) => {
    const captured = await captureSignup(page);
    await submitSignup(page);

    await expect.poll(() => captured()?.language, { timeout: 15_000 }).toBe('en');
    await expect(page.locator('html')).toHaveAttribute('lang', /^en/);
  });
});
