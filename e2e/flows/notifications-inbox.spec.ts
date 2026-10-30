import type { Page } from '@playwright/test';
import { test, expect } from '../fixtures';
import { checkA11y } from '../helpers';

// Notifications inbox (web). The /api/inbox endpoints are stubbed with page.route so
// this spec is deterministic and independent of the backend build: it proves the
// bell, the page, row navigation, the removed state, the empty state and phone width.

const GONE_EVENT = '00000000-0000-4000-8000-00000000dead';

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
  target_status: 'ok' | 'removed' | 'ended' | 'no_access';
}

function item(circleId: string, over: Partial<StubItem>): StubItem {
  const now = new Date().toISOString();
  return {
    id: crypto.randomUUID(),
    type: 'note_added',
    circle_id: circleId,
    circle_name: 'Circle',
    title: 'Ana added a note',
    body: 'Slept well',
    data: {},
    state: null,
    read_at: null,
    created_at: now,
    updated_at: now,
    target_status: 'ok',
    ...over,
  };
}

async function stubInbox(page: Page, items: StubItem[]): Promise<{ readBodies: unknown[] }> {
  const readBodies: unknown[] = [];
  // Regex, not a glob: '**/api/inbox**' would also swallow Vite's /src/api/inbox.ts module.
  await page.route(/\/api\/inbox(\/|\?|$)/, async (route) => {
    const req = route.request();
    const url = req.url();
    const unread = () => items.filter((i) => !i.read_at).length;
    if (req.method() === 'POST') {
      const body = req.postDataJSON() as { ids?: string[]; all?: boolean };
      readBodies.push(body);
      for (const i of items) if (body.all || body.ids?.includes(i.id)) i.read_at = new Date().toISOString();
      return route.fulfill({ json: { success: true, data: { updated: 1 } } });
    }
    if (url.includes('/unread-count')) {
      return route.fulfill({ json: { success: true, data: { unread_count: unread() } } });
    }
    return route.fulfill({ json: { success: true, data: { items, unread_count: unread() } } });
  });
  return { readBodies };
}

test.describe('notifications inbox', () => {
  test('bell shows the unread count on a circle page and opens the inbox', async ({ page, circleId }) => {
    await stubInbox(page, [item(circleId, {}), item(circleId, { title: 'Second', read_at: null })]);
    await page.goto(`/circles/${circleId}`, { waitUntil: 'domcontentloaded' });
    const bell = page.getByRole('link', { name: 'Notifications, 2 unread' });
    await expect(bell).toBeVisible({ timeout: 20_000 });
    const box = await bell.boundingBox();
    expect(box!.width).toBeGreaterThanOrEqual(44);
    expect(box!.height).toBeGreaterThanOrEqual(44);
    await bell.click();
    await expect(page).toHaveURL(/\/notifications$/);
    await expect(page.getByRole('heading', { level: 1, name: 'Notifications' })).toBeVisible();
    await expect(page.getByRole('heading', { level: 2, name: 'Today' })).toBeVisible();
    await expect(page.getByTestId('inbox-row')).toHaveCount(2);
  });

  test('row tap marks read and lands on the same place a push would; mark all read works', async ({
    page,
    circleId,
  }, testInfo) => {
    const rows = [
      item(circleId, { title: 'Open the notes', type: 'care_note_added', data: { noteDate: '2026-10-28' } }),
      item(circleId, { title: 'Other one' }),
    ];
    const { readBodies } = await stubInbox(page, rows);
    await page.goto('/notifications', { waitUntil: 'domcontentloaded' });
    await expect(page.getByTestId('inbox-row')).toHaveCount(2, { timeout: 20_000 });
    await checkA11y(page, '/notifications', testInfo);

    await page.getByRole('button', { name: /Open the notes/ }).click();
    await expect(page).toHaveURL(new RegExp(`/circles/${circleId}/notes\\?date=2026-10-28`));
    expect(readBodies[0]).toEqual({ ids: [rows[0].id] });

    await page.goto('/notifications', { waitUntil: 'domcontentloaded' });
    await page.getByRole('button', { name: 'Mark all read' }).click();
    await expect(page.locator('[data-testid="inbox-row"][data-unread="true"]')).toHaveCount(0);
    expect(readBodies.some((b) => (b as { all?: boolean }).all === true)).toBe(true);
  });

  test('a row whose target is gone shows the removed state, never a blank page', async ({ page, circleId }) => {
    await stubInbox(page, [
      item(circleId, {
        title: 'Metformin reminder',
        body: 'It was scheduled',
        type: 'medication_reminder',
        data: { eventId: GONE_EVENT, scheduledDate: '2026-10-28' },
        target_status: 'removed',
      }),
    ]);
    await page.goto('/notifications', { waitUntil: 'domcontentloaded' });
    await page.getByRole('button', { name: /Metformin reminder/ }).click({ timeout: 20_000 });
    const gone = page.getByTestId('inbox-gone');
    await expect(gone.getByTestId('inbox-gone-title')).toHaveText('Metformin reminder');
    await expect(gone.getByText('It was scheduled')).toBeVisible();
    await expect(gone.getByRole('heading', { name: 'This was removed' })).toBeVisible();
    await expect(page).toHaveURL(/\/notifications$/);
    await gone.getByRole('button', { name: 'OK' }).click();
    await expect(page.getByTestId('inbox-row')).toBeVisible();
  });

  test('empty state', async ({ page }, testInfo) => {
    await stubInbox(page, []);
    await page.goto('/notifications', { waitUntil: 'domcontentloaded' });
    await expect(page.getByTestId('inbox-empty')).toContainText('show up here for 3 days', {
      timeout: 20_000,
    });
    await checkA11y(page, '/notifications', testInfo);
  });

  test.describe('phone width', () => {
    test.use({ viewport: { width: 375, height: 740 } });

    test('bell is in the header and the inbox stacks without horizontal scroll', async ({
      page,
      circleId,
    }, testInfo) => {
      await stubInbox(page, [item(circleId, {})]);
      await page.goto(`/circles/${circleId}/calendar`, { waitUntil: 'domcontentloaded' });
      const bell = page.getByRole('link', { name: 'Notifications, 1 unread' });
      await expect(bell).toBeVisible({ timeout: 20_000 });
      await bell.click();
      await expect(page.getByTestId('inbox-row')).toHaveCount(1);
      await expect(page.getByTestId('inbox-side-card')).toBeVisible();
      const overflow = await page.evaluate(
        () => document.documentElement.scrollWidth > document.documentElement.clientWidth
      );
      expect(overflow).toBe(false);
      await checkA11y(page, '/notifications', testInfo);
    });
  });
});
