import { test as base, expect, type Browser, type BrowserContext } from '@playwright/test';

// Shared fixtures for flow specs.
//
// AUTH: each test logs in FRESH (per-test) instead of reusing one saved session.
// The web uses single-use refresh-token rotation, so a shared cookie gets
// invalidated once any context refreshes — fine at full speed (within Supabase's
// reuse-grace window) but flaky when slowed down (headed/--slowMo watching) or
// under contention. A fresh login per test removes that entirely: every test
// gets its own unrotated session. Login is a fast API call (cookie mode), not a
// UI round-trip.

const ORIGIN = process.env.PW_BASE_URL ?? 'http://localhost:5173';
const DEMO_EMAIL = process.env.PW_DEMO_EMAIL ?? 'demo@circlecare.app';
const DEMO_PASSWORD = process.env.PW_DEMO_PASSWORD ?? 'DemoPass123!';

/** Establish a fresh cookie-mode session in `context` via POST /auth/login. */
async function apiLogin(context: BrowserContext): Promise<void> {
  const res = await context.request.post('/api/auth/login', {
    headers: { 'X-Session-Mode': 'cookie', Origin: ORIGIN },
    data: { email: DEMO_EMAIL, password: DEMO_PASSWORD },
  });
  if (!res.ok()) {
    throw new Error(`E2E apiLogin failed: ${res.status()} ${await res.text()}`);
  }
}

async function resolveCircleId(browser: Browser): Promise<string> {
  const context = await browser.newContext();
  await apiLogin(context);
  const page = await context.newPage();
  await page.goto('/circles', { waitUntil: 'domcontentloaded' });
  await page.waitForLoadState('networkidle', { timeout: 8_000 }).catch(() => {});
  // Exclude transient "E2E …" circles (the circle-lifecycle spec creates one
  // briefly) so concurrent tests always resolve a real seed circle.
  // Circle cards now link to the circle overview (`/circles/:id`), not the
  // calendar. The brand link is exactly `/circles` (no trailing slash), so the
  // `/circles/` substring matches card links only.
  const firstCircle = page
    .locator('a[href*="/circles/"]')
    .filter({ hasNotText: 'E2E' })
    .first();
  await expect(firstCircle, 'demo account has no (non-E2E) circle').toBeVisible({ timeout: 15_000 });
  const href = await firstCircle.getAttribute('href');
  await context.close();
  const match = href?.match(/\/circles\/([^/?#]+)/);
  expect(match, `could not parse circle id from href: ${href}`).toBeTruthy();
  return match![1];
}

export const test = base.extend<object, { circleId: string }>({
  // Fresh login per test (see header note). Runs before the test body uses the
  // page, so navigations land authenticated.
  page: async ({ page, context }, use) => {
    await apiLogin(context);
    await use(page);
  },
  circleId: [
    async ({ browser }, use) => {
      const id = await resolveCircleId(browser);
      await use(id);
    },
    { scope: 'worker' },
  ],
});

export { expect };

/** A run-unique label so parallel/repeat runs never collide and cleanup is easy. */
export function uniqueLabel(prefix: string): string {
  return `E2E ${prefix} ${Date.now()}-${Math.floor(Math.random() * 1e4)}`;
}
