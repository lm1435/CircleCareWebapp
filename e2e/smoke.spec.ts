import { readOnlyTest as test } from './fixtures';
import { AUTH_ROUTES, circleRoutes } from './routes';
import { visitAndCheck, expectNoRuntimeErrors, checkA11y } from './helpers';
import { expect, type Page } from '@playwright/test';

// Crawl smoke test: visit every authenticated route, prove it renders without
// runtime errors / white screens, and passes an axe a11y scan. Public-route
// crawl lives in public-smoke.spec.ts (it must run WITHOUT a session).
//
// One test per route (not a loop in a single test) so routes crawl in parallel,
// each gets its own timeout, and a failure names the exact route.
//
// TARGET. This spec runs as the suite's READ-ONLY account (`readOnlyTest`),
// whose circles are cloned fresh by globalSetup and mutated by nothing — not by
// this spec, not by any other. That replaces the old arrangement, where the
// crawl resolved "the demo account's first non-E2E circle" out of the shared
// account that every flow spec was concurrently creating, renaming and
// deleting circles in.
//
// It also removes the `beforeAll` that used to do that resolution. That hook
// was the direct cause of the "N did not run" results: a `beforeAll` failure is
// reported once per worker and every remaining test in the file is then marked
// "did not run" — so one flaky lookup turned into 4 failures + 12 silently
// unexecuted tests, which is indistinguishable from a real regression in a
// summary line. The circle id now comes from a worker fixture that reads it out
// of the isolation manifest, so there is nothing left to fail.
//
// AUTHENTICATION IS ASSERTED, NOT ASSUMED. The bounce to /login is client-side:
// AuthGuard shows a spinner while the refresh-cookie bootstrap runs and only
// then redirects. So `goto(route)` followed by an immediate URL check always
// sees the route, and a crawl that only checks "#root has text" passes on the
// LOGIN page (which has text and passes axe). Every test here waits for a
// landmark only the guarded layouts render, then checks the URL is still the
// route — before the scan and again after it.

// Circle-scoped sub-paths under /circles/:circleId — derived from the shared
// `circleRoutes()` list (routes.ts) instead of a second hardcoded copy (WA5),
// so a route added there (e.g. /notes) automatically gets crawl + a11y
// coverage here too. The placeholder id is discarded — only the trailing path
// segment is kept — and the real circle id is substituted at test-run time.
const CIRCLE_SUBROUTES = circleRoutes('PLACEHOLDER_CIRCLE_ID').map(
  (route) => route.split('/').pop() as string
);

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * Prove the page is an AUTHENTICATED render of `route`.
 *
 * The account menu trigger ("Account", Header.tsx `UserMenu`) is rendered by
 * both guarded layouts (AppLayout's Header and StandalonePageLayout) and by
 * nothing public, and AuthGuard renders neither until the session resolves. It
 * is matched with `includeHidden` because at some breakpoints the header copy
 * is CSS-hidden; attachment is what proves the guard let the page through.
 */
async function expectAuthenticatedAt(page: Page, route: string): Promise<void> {
  await expect(
    page.getByRole('button', { name: 'Account', exact: true, includeHidden: true }).first(),
    `${route}: no authenticated chrome rendered — the session did not survive the load`
  ).toBeAttached({ timeout: 20_000 });
  await expect(page, `${route}: redirected away (a bounce to /login means a lost session)`).toHaveURL(
    new RegExp(`^https?://[^/]+${escapeRegExp(route)}(?:[?#].*)?$`)
  );
}

test.describe('authenticated route crawl', () => {
  // Confirm the session actually authenticated (a bounce to /login here means
  // the creds / backend are the problem, not the routes).
  test('session is valid', async ({ page }) => {
    await page.goto('/circles', { waitUntil: 'domcontentloaded' });
    await expectAuthenticatedAt(page, '/circles');
    // And the session can read data: the read-only account's two cloned
    // circles render as cards, which needs a successful authenticated GET.
    await expect(page.locator('a[href^="/circles/"]')).toHaveCount(2, { timeout: 20_000 });
    await expect(page).not.toHaveURL(/\/login/);
  });

  for (const route of AUTH_ROUTES) {
    test(`crawl ${route}`, async ({ page }, testInfo) => {
      const result = await visitAndCheck(page, route);
      await expectAuthenticatedAt(page, route);
      expectNoRuntimeErrors(result);
      await checkA11y(page, route, testInfo);
      await expectAuthenticatedAt(page, route);
    });
  }

  for (const sub of CIRCLE_SUBROUTES) {
    test(`crawl circle/${sub}`, async ({ page, circleId }, testInfo) => {
      const route = `/circles/${circleId}/${sub}`;
      const result = await visitAndCheck(page, route);
      await expectAuthenticatedAt(page, route);
      expectNoRuntimeErrors(result);
      await checkA11y(page, route, testInfo);
      await expectAuthenticatedAt(page, route);
    });
  }
});
