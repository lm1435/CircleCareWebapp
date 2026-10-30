import type { Locator, Page } from '@playwright/test';
import { test, expect } from '../fixtures';
import { checkA11y } from '../helpers';

// Notifications inbox, PER CIRCLE (web): the circle list's "N new" counts, the scoped
// inbox at /circles/:id/notifications, the scoped in-circle bell, and the scoped
// "Mark all read". The /api/inbox endpoints are stubbed with page.route (same as
// notifications-inbox.spec.ts) so the counts are deterministic; the two circles are
// the persona's real ones (circleId + secondCircleId).

interface StubItem {
  id: string;
  type: string;
  circle_id: string;
  circle_name: string;
  title: string;
  body: string;
  data: Record<string, string>;
  state: null;
  read_at: string | null;
  created_at: string;
  updated_at: string;
  target_status: 'ok';
}

function item(circleId: string, title: string): StubItem {
  const now = new Date().toISOString();
  return {
    id: crypto.randomUUID(),
    type: 'note_added',
    circle_id: circleId,
    circle_name: 'Circle',
    title,
    body: 'Slept well',
    data: {},
    state: null,
    read_at: null,
    created_at: now,
    updated_at: now,
    target_status: 'ok',
  };
}

/** Mirrors backend/src/routes/inbox.ts: by_circle, ?circle_id= and { all, circle_id }. */
async function stubInbox(page: Page, items: StubItem[]): Promise<{ readBodies: unknown[] }> {
  const readBodies: unknown[] = [];
  await page.route(/\/api\/inbox(\/|\?|$)/, async (route) => {
    const req = route.request();
    const url = new URL(req.url());
    const unread = (list: StubItem[]) => list.filter((i) => !i.read_at);
    if (req.method() === 'POST') {
      const body = req.postDataJSON() as { ids?: string[]; all?: boolean; circle_id?: string };
      readBodies.push(body);
      for (const i of items) {
        const hit = body.all ? !body.circle_id || i.circle_id === body.circle_id : body.ids?.includes(i.id);
        if (hit) i.read_at = new Date().toISOString();
      }
      return route.fulfill({ json: { success: true, data: { updated: 1 } } });
    }
    if (url.pathname.endsWith('/unread-count')) {
      const byCircle: Record<string, number> = {};
      for (const i of unread(items)) byCircle[i.circle_id] = (byCircle[i.circle_id] ?? 0) + 1;
      return route.fulfill({
        json: { success: true, data: { unread_count: unread(items).length, by_circle: byCircle } },
      });
    }
    const scope = url.searchParams.get('circle_id');
    const list = scope ? items.filter((i) => i.circle_id === scope) : items;
    return route.fulfill({ json: { success: true, data: { items: list, unread_count: unread(list).length } } });
  });
  return { readBodies };
}

/** The picker <li> for a circle (holds the card link and, as a sibling, its count). */
function cardItem(page: Page, circleId: string): Locator {
  return page.locator('li', { has: page.locator(`a[href="/circles/${circleId}"]`) });
}

async function openPicker(page: Page): Promise<void> {
  await page.goto('/circles', { waitUntil: 'domcontentloaded' });
  await expect(page.locator('li a[href^="/circles/"]').first()).toBeVisible({ timeout: 20_000 });
}

test.describe('notifications inbox: per circle', () => {
  test('card count only on the circle with unread; opens its scoped inbox; bell matches; back goes to the circle', async ({
    page,
    circleId,
    secondCircleId,
  }) => {
    await stubInbox(page, [item(circleId, 'Mine one'), item(circleId, 'Mine two'), item(secondCircleId, 'Theirs')]);
    await openPicker(page);

    const mine = cardItem(page, circleId);
    const theirs = cardItem(page, secondCircleId);
    const count = mine.getByTestId('circle-unread-count');
    await expect(count).toBeVisible({ timeout: 20_000 });
    await expect(count).toHaveText('2 new');
    await expect(theirs.getByTestId('circle-unread-count')).toHaveText('1 new');
    // No bell on the circle list.
    await expect(page.getByTestId('notification-bell')).toHaveCount(0);
    // A 44px target, and never inside the card link.
    const box = (await count.boundingBox())!;
    expect(box.height).toBeGreaterThanOrEqual(44);
    expect(box.width).toBeGreaterThanOrEqual(44);
    expect(await mine.locator(`a[href="/circles/${circleId}"] [data-testid="circle-unread-count"]`).count()).toBe(0);

    const name = (await count.getAttribute('aria-label'))!.replace(/ notifications, 2 new$/, '');
    await count.click();
    await expect(page).toHaveURL(new RegExp(`/circles/${circleId}/notifications$`));
    await expect(page.getByRole('heading', { level: 1, name: 'Notifications' })).toBeVisible();
    await expect(page.getByTestId('inbox-scoped-subtitle')).toHaveText(`${name} · 2 new`);
    await expect(page.getByTestId('inbox-row')).toHaveCount(2);
    await expect(page.getByText('Theirs')).toHaveCount(0);
    await expect(page.getByRole('link', { name: /All notifications/ })).toHaveAttribute('href', '/notifications');

    // The in-circle bell is scoped: same count as the card.
    const bell = page.getByTestId('notification-bell');
    await expect(bell).toHaveAttribute('aria-label', 'Notifications, 2 unread');
    await expect(bell).toHaveAttribute('href', `/circles/${circleId}/notifications`);

    await page.getByTestId('inbox-back').click();
    await expect(page).toHaveURL(new RegExp(`/circles/${circleId}$`));
    // Opening the circle does not clear its count.
    await expect(page.getByTestId('notification-bell')).toHaveAttribute('aria-label', 'Notifications, 2 unread');
  });

  test("scoped Mark all read clears only that circle; the other circle keeps its count", async ({
    page,
    circleId,
    secondCircleId,
  }) => {
    const { readBodies } = await stubInbox(page, [
      item(circleId, 'Mine one'),
      item(circleId, 'Mine two'),
      item(secondCircleId, 'Theirs'),
    ]);
    await page.goto(`/circles/${circleId}/notifications`, { waitUntil: 'domcontentloaded' });
    await expect(page.getByTestId('inbox-row')).toHaveCount(2, { timeout: 20_000 });
    await page.getByRole('button', { name: 'Mark all read' }).click();
    await expect(page.locator('[data-testid="inbox-row"][data-unread="true"]')).toHaveCount(0);
    expect(readBodies).toContainEqual({ all: true, circle_id: circleId });

    await openPicker(page);
    await expect(cardItem(page, secondCircleId).getByTestId('circle-unread-count')).toHaveText('1 new', {
      timeout: 20_000,
    });
    await expect(cardItem(page, circleId).getByTestId('circle-unread-count')).toHaveCount(0);
  });

  test('keyboard: the count is its own Tab stop after the card, and Enter opens it', async ({
    page,
    circleId,
    secondCircleId,
  }) => {
    await stubInbox(page, [item(circleId, 'Mine one'), item(secondCircleId, 'Theirs')]);
    await openPicker(page);
    const mine = cardItem(page, circleId);
    await expect(mine.getByTestId('circle-unread-count')).toBeVisible({ timeout: 20_000 });
    await mine.locator(`a[href="/circles/${circleId}"]`).focus();
    await page.keyboard.press('Tab');
    await expect(mine.getByTestId('circle-unread-count')).toBeFocused();
    await page.keyboard.press('Enter');
    await expect(page).toHaveURL(new RegExp(`/circles/${circleId}/notifications$`));
  });

  for (const scheme of ['light', 'dark'] as const) {
    test(`axe: the circle list with counts (${scheme})`, async ({ page, circleId, secondCircleId }, testInfo) => {
      await page.emulateMedia({ colorScheme: scheme });
      await stubInbox(page, [item(circleId, 'Mine one'), item(secondCircleId, 'Theirs'), item(secondCircleId, 'Two')]);
      await openPicker(page);
      await expect(page.getByTestId('circle-unread-count')).toHaveCount(2, { timeout: 20_000 });
      await checkA11y(page, '/circles', testInfo);
    });
  }

  test.describe('320px wide', () => {
    test.use({ viewport: { width: 320, height: 720 } });

    test('the count is a full-width bar under its card, nothing clipped, no horizontal scroll', async ({
      page,
      circleId,
      secondCircleId,
    }, testInfo) => {
      await stubInbox(page, [item(circleId, 'Mine one'), item(circleId, 'Mine two'), item(secondCircleId, 'x')]);
      await openPicker(page);
      const mine = cardItem(page, circleId);
      const bar = mine.getByTestId('circle-unread-count');
      await expect(bar).toBeVisible({ timeout: 20_000 });
      await expect(bar).toContainText('2 new');
      const card = (await mine.locator(`a[href="/circles/${circleId}"]`).boundingBox())!;
      const b = (await bar.boundingBox())!;
      expect(b.y).toBeGreaterThanOrEqual(card.y + card.height - 1);
      expect(Math.abs(b.width - card.width)).toBeLessThanOrEqual(1);
      expect(b.height).toBeGreaterThanOrEqual(64);
      // The reserved pill space is gone from inside the card at this width.
      await expect(mine.getByTestId('circle-unread-spacer')).toBeHidden();
      const clipped = await bar.evaluate((el) =>
        [el, ...Array.from(el.querySelectorAll('span'))].some(
          (n) => n.scrollWidth > n.clientWidth + 1 || n.scrollHeight > n.clientHeight + 1
        )
      );
      expect(clipped).toBe(false);
      const overflow = await page.evaluate(() => {
        const s = document.scrollingElement!;
        return s.scrollWidth > s.clientWidth;
      });
      expect(overflow).toBe(false);
      await checkA11y(page, '/circles', testInfo);
      await bar.click();
      await expect(page).toHaveURL(new RegExp(`/circles/${circleId}/notifications$`));
    });
  });
});
