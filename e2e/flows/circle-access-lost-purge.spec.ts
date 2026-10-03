import { test, expect } from '../fixtures';
import { checkA11y } from '../helpers';

// PK14 (privacy): when the CIRCLE read answers 403 FORBIDDEN / 404 NOT_FOUND (the
// user was removed, or the circle is gone) the browser must stop holding and
// rendering that circle's PHI. lib/queryClient.ts's QueryCache onError purges
// every query naming the circle (lib/purgeCircleCache.ts).
//
// The server's answer is simulated at the network edge (page.route): the app,
// its QueryClient and its cache are all real. The first emergency-info read after
// access is lost still answers 200 with the marker (it races the circle read);
// every later one answers 403 like the backend. Without the purge the marker
// therefore stays on screen (cached data survives, the page never re-fetches);
// with it the marker is gone.
//
// Controls: a 500 (transient) and 403 VIEW_ONLY (still a member) must NOT purge.

const MARKER = 'PK14-Marker-Allergen';

type Mode = 'member' | 'gone' | 'notfound' | 'down' | 'viewOnly';

test.describe('circle read loses access: cached PHI is purged', () => {
  async function open(page: import('@playwright/test').Page, circleId: string) {
    let mode: Mode = 'member';
    let lostEmergencyReads = 0;
    const envelope = (code: string) => ({ success: false, error: { code, message: code } });

    await page.route(
      (url) => url.pathname === `/api/circles/${circleId}`,
      async (route) => {
        if (route.request().method() !== 'GET') return route.continue();
        if (mode === 'gone') return route.fulfill({ status: 403, json: envelope('FORBIDDEN') });
        if (mode === 'notfound') return route.fulfill({ status: 404, json: envelope('NOT_FOUND') });
        if (mode === 'down') return route.fulfill({ status: 500, json: envelope('SERVER_ERROR') });
        if (mode === 'viewOnly') return route.fulfill({ status: 403, json: envelope('VIEW_ONLY') });
        return route.continue();
      }
    );
    await page.route(
      (url) => url.pathname === `/api/circles/${circleId}/emergency-info`,
      async (route) => {
        if (route.request().method() !== 'GET') return route.continue();
        // Once access is lost the server answers 403 — but only AFTER the focus
        // refetch that is already in flight (it races the circle read). That first
        // 200 repaints the marker; only the purge can remove it afterwards.
        if ((mode === 'gone' || mode === 'notfound') && lostEmergencyReads++ > 0) {
          return route.fulfill({ status: 403, json: envelope('FORBIDDEN') });
        }
        const res = await route.fetch();
        const body = await res.json();
        const info = body?.data?.emergency_info ?? {};
        info.allergies = [MARKER];
        body.data = { ...(body.data ?? {}), emergency_info: info };
        return route.fulfill({ response: res, json: body });
      }
    );

    await page.goto(`/circles/${circleId}/emergency`, { waitUntil: 'domcontentloaded' });
    await expect(page.getByText(MARKER).first()).toBeVisible({ timeout: 30_000 });
    return {
      set: (m: Mode) => {
        mode = m;
      },
      // The same refetch the user triggers by returning to the tab.
      refocus: () =>
        page.evaluate(() => {
          for (const state of ['hidden', 'visible']) {
            Object.defineProperty(document, 'visibilityState', { value: state, configurable: true });
            document.dispatchEvent(new Event('visibilitychange', { bubbles: true }));
          }
        }),
    };
  }

  // The circle-layout access state (parity with mobile CircleDetailScreen): same copy per code.
  for (const [lost, label, title, body] of [
    [
      'gone',
      '403 FORBIDDEN (removed)',
      'Access removed',
      'You no longer have access to this circle. The owner may have removed you or deleted the circle.',
    ],
    ['notfound', '404 NOT_FOUND (deleted)', 'Circle not found', 'This circle has been deleted or no longer exists.'],
  ] as const) {
    test(`${label}: the marker allergen stops rendering and the access state shows`, async ({
      page,
      circleId,
    }, testInfo) => {
      const ctl = await open(page, circleId);
      ctl.set(lost);
      await ctl.refocus();
      await expect(page.getByText(MARKER)).toHaveCount(0, { timeout: 20_000 });
      const h1 = page.getByRole('heading', { level: 1, name: title });
      await expect(h1).toBeVisible({ timeout: 20_000 });
      await expect(h1).toBeFocused();
      await expect(page.getByText(body)).toBeVisible();
      await expect(page.getByRole('link', { name: 'Return to circles' })).toHaveAttribute('href', '/circles');
      await expect(page.locator('main')).not.toContainText(/Couldn't load|Check your connection/);
      await checkA11y(page, `/circles/${circleId}/emergency`, testInfo);
    });
  }

  test('control: a 500 on the circle read keeps the PHI on screen', async ({ page, circleId }) => {
    const ctl = await open(page, circleId);
    ctl.set('down');
    await ctl.refocus();
    await page.waitForTimeout(3_000);
    await expect(page.getByText(MARKER).first()).toBeVisible();
    await expect(page.getByRole('heading', { level: 1, name: /Access removed|Circle not found/ })).toHaveCount(0);
  });

  test('control: 403 VIEW_ONLY (still a member) keeps the PHI on screen', async ({
    page,
    circleId,
  }) => {
    const ctl = await open(page, circleId);
    ctl.set('viewOnly');
    await ctl.refocus();
    await page.waitForTimeout(3_000);
    await expect(page.getByText(MARKER).first()).toBeVisible();
    await expect(page.getByRole('heading', { level: 1, name: /Access removed|Circle not found/ })).toHaveCount(0);
  });
});
