import { test, expect, type Browser } from '@playwright/test';
import { AUTH_ROUTES } from './routes';
import { visitAndCheck, expectNoRuntimeErrors, checkA11y } from './helpers';

// Crawl smoke test: visit every authenticated route, prove it renders without
// runtime errors / white screens, and passes an axe a11y scan. Runs with the
// saved demo session (see auth.setup.ts). Public-route crawl lives in
// public-smoke.spec.ts (it must run WITHOUT the stored session).
//
// One test per route (not a loop in a single test) so routes crawl in parallel,
// each gets its own timeout, and a failure names the exact route.

const STORAGE = 'e2e/.auth/user.json';

// Circle-scoped sub-paths under /circles/:circleId — keep in sync with router.tsx.
const CIRCLE_SUBROUTES = [
  'calendar',
  'tasks',
  'activity',
  'emergency',
  'documents',
  'vitals',
  'members',
  'settings',
];

// Resolve a real circle id from the demo account's picker so circle-scoped
// routes get a valid context. Done once in beforeAll and shared.
async function resolveCircleId(browser: Browser): Promise<string> {
  const context = await browser.newContext({ storageState: STORAGE });
  const page = await context.newPage();
  await page.goto('/circles', { waitUntil: 'domcontentloaded' });
  await page.waitForLoadState('networkidle', { timeout: 8_000 }).catch(() => {});
  // Circle cards link to the overview (`/circles/:id`); the brand link is exactly
  // `/circles`, so the `/circles/` substring matches card links only.
  const firstCircle = page
    .locator('a[href*="/circles/"]')
    .filter({ hasNotText: 'E2E' })
    .first();
  await expect(firstCircle, 'demo account has no (non-E2E) circle to crawl').toBeVisible({
    timeout: 15_000,
  });
  const href = await firstCircle.getAttribute('href');
  await context.close();
  const match = href?.match(/\/circles\/([^/?#]+)/);
  expect(match, `could not parse circle id from href: ${href}`).toBeTruthy();
  return match![1];
}

test.describe('authenticated route crawl', () => {
  let circleId: string;

  test.beforeAll(async ({ browser }) => {
    circleId = await resolveCircleId(browser);
  });

  // Confirm the stored session actually authenticated (a bounce to /login here
  // means the demo creds / backend are the problem, not the routes).
  test('session is valid', async ({ page }) => {
    await page.goto('/circles', { waitUntil: 'domcontentloaded' });
    await expect(page).not.toHaveURL(/\/login/);
  });

  for (const route of AUTH_ROUTES) {
    test(`crawl ${route}`, async ({ page }, testInfo) => {
      const result = await visitAndCheck(page, route);
      expectNoRuntimeErrors(result);
      await checkA11y(page, route, testInfo);
    });
  }

  for (const sub of CIRCLE_SUBROUTES) {
    test(`crawl circle/${sub}`, async ({ page }, testInfo) => {
      const route = `/circles/${circleId}/${sub}`;
      const result = await visitAndCheck(page, route);
      expectNoRuntimeErrors(result);
      await checkA11y(page, route, testInfo);
    });
  }
});
