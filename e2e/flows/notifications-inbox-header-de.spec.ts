import type { Page } from '@playwright/test';
import { test, expect } from '../fixtures';

// Notifications inbox header in German (1.4.0). On mobile "Benachrichtigungen" broke mid-word
// beside "Alle als gelesen markieren"; on web the action sits beside the EYEBROW, which it
// squeezed into two lines at phone width (the dot on one line, the word on the next) while the
// action itself wrapped. Rule on both platforms (useRowFit / mobile useTitleActionFit): when the
// heading line and the action do not fit on one row unwrapped, the action moves to its own line
// under the title. Real browser geometry (memory: jsdom geometry blind), both inbox pages, phone
// (390px) and desktop. German forced like i18n-de.spec: locale 'de' + GET /users/me rewritten;
// the /api/inbox endpoints are stubbed (notifications-inbox.spec) so 2 rows are unread.

test.use({ locale: 'de' });

async function stub(page: Page, circleId: string): Promise<void> {
  await page.route('**/api/users/me', async (route) => {
    if (route.request().method() !== 'GET') return route.continue();
    try {
      const res = await route.fetch();
      const body = JSON.parse(await res.text());
      if (body?.data?.user) body.data.user.language = 'de';
      await route.fulfill({ status: res.status(), contentType: 'application/json', body: JSON.stringify(body) });
    } catch {
      try {
        await route.continue();
      } catch {
        /* request already gone */
      }
    }
  });
  const now = new Date().toISOString();
  const items = [1, 2].map((n) => ({
    id: crypto.randomUUID(),
    type: 'note_added',
    circle_id: circleId,
    circle_name: 'Mama',
    title: `Ana hat eine Notiz hinzugefügt ${n}`,
    body: 'Gut geschlafen',
    data: {},
    state: null,
    read_at: null as string | null,
    created_at: now,
    updated_at: now,
    target_status: 'ok',
  }));
  // Regex, not a glob: '**/api/inbox**' would also swallow Vite's /src/api/inbox.ts module.
  const unread = (): number => items.filter((i) => !i.read_at).length;
  await page.route(/\/api\/inbox(\/|\?|$)/, (route) => {
    const req = route.request();
    if (req.method() === 'POST') {
      for (const i of items) i.read_at = new Date().toISOString();
      return route.fulfill({ json: { success: true, data: { updated: items.length } } });
    }
    return req.url().includes('/unread-count')
      ? route.fulfill({ json: { success: true, data: { unread_count: unread() } } })
      : route.fulfill({ json: { success: true, data: { items, unread_count: unread() } } });
  });
}

/** Lines a box holds at its own computed line height. */
async function lines(selector: ReturnType<Page['locator']>): Promise<number> {
  const box = (await selector.boundingBox())!;
  const lh = await selector.evaluate((el) => parseFloat(getComputedStyle(el).lineHeight));
  return Math.round(box.height / lh);
}

async function expectHeaderFits(page: Page): Promise<void> {
  const title = page.getByRole('heading', { level: 1, name: 'Benachrichtigungen' });
  await expect(title).toBeVisible({ timeout: 20_000 });
  const action = page.getByRole('button', { name: 'Alle als gelesen markieren' });
  await expect(action).toBeVisible();
  const eyebrow = page.getByTestId('inbox-header-row').getByText('Benachrichtigungen', { exact: true });
  // Nothing in the header wraps: title, eyebrow and the action's own label are one line each.
  expect(await lines(title)).toBe(1);
  expect(await lines(eyebrow)).toBe(1);
  // The button is min-height 44, so count its label's line boxes instead of dividing heights.
  const actionLines = await action.evaluate((el) => {
    const r = document.createRange();
    r.selectNodeContents(el);
    return new Set(Array.from(r.getClientRects(), (rect) => Math.round(rect.top))).size;
  });
  expect(actionLines).toBe(1);
  // The action is beside the eyebrow (above the title) or on its own line under the title,
  // never over either; and there is no horizontal page scroll.
  const t = (await title.boundingBox())!;
  const a = (await action.boundingBox())!;
  expect(a.y + a.height <= t.y + 1 || a.y >= t.y + t.height - 1).toBe(true);
  const [scrollW, innerW] = await page.evaluate(() => [document.documentElement.scrollWidth, window.innerWidth]);
  expect(scrollW).toBeLessThanOrEqual(innerW);
}

for (const vp of [
  { width: 390, height: 844, name: 'phone', stacked: true },
  { width: 1440, height: 900, name: 'desktop', stacked: false },
]) {
  test.describe(`German inbox header, ${vp.name}`, () => {
    test.use({ viewport: { width: vp.width, height: vp.height } });

    for (const scoped of [false, true]) {
      test(`${scoped ? 'circle' : 'all-circles'} inbox`, async ({ page, circleId }, testInfo) => {
        await stub(page, circleId);
        await page.goto(scoped ? `/circles/${circleId}/notifications` : '/notifications', {
          waitUntil: 'domcontentloaded',
        });
        await expectHeaderFits(page);
        const action = page.getByRole('button', { name: 'Alle als gelesen markieren' });
        // Phone: German does not fit beside the eyebrow, so it is under the title; desktop: it fits.
        if (vp.stacked) await expect(page.getByTestId('inbox-header-row')).not.toContainText('Alle als gelesen');
        else await expect(page.getByTestId('inbox-header-row').getByRole('button')).toBeVisible();
        await testInfo.attach(`inbox-header-de-${vp.name}-${scoped ? 'circle' : 'all'}`, {
          body: await page.screenshot(),
          contentType: 'image/png',
        });
        await action.click();
        await expect(action).toHaveAttribute('aria-disabled', 'true');
      });
    }
  });
}
