import { test, expect } from '../fixtures';
import { checkA11y, pinRecipientZoneToBrowser } from '../helpers';
import {
  addDays,
  localDateOf,
  mockDailyUpdate,
  mostRecentWallTime,
  readTipsPref,
  setTipsPref,
} from '../dailyUpdateShared';

/**
 * DAILY UPDATE — Home card + full/dated view (docs/plans/daily-update.md §6, §8.3).
 *
 * Real backend for auth, the circle, members and preferences; the daily-update
 * read itself is answered from a §4.1-shaped fixture (see dailyUpdateShared.ts for
 * why). The clock is Playwright's, installed at a recipient wall time at or before
 * the real now, with the recipient's zone pinned to the browser's.
 *
 * NOT RUN in the web lane that added it: it needs the local backend. Run with
 *   npx playwright test e2e/flows/daily-update.spec.ts e2e/flows/daily-update-es.spec.ts --project=chromium
 */

const TZ = 'America/New_York';
test.use({ timezoneId: TZ });

const NAV_TIMEOUT = 20_000;

test.describe('daily update', () => {
  test.beforeEach(async ({ page, account, circleId }) => {
    await pinRecipientZoneToBrowser(page, account, circleId);
    setTipsPref(account.userId, true);
  });

  test.afterEach(({ account }) => {
    setTipsPref(account.userId, true);
  });

  test('card shows at 20:00 recipient time with both sections, and passes axe', async ({
    page,
    circleId,
  }, testInfo) => {
    const at = mostRecentWallTime('20:00', TZ);
    const today = localDateOf(at, TZ);
    const asked = await mockDailyUpdate(page, TZ, today);
    await page.clock.install({ time: at });
    await page.goto(`/circles/${circleId}`, { waitUntil: 'domcontentloaded' });

    const card = page.getByRole('region', { name: "Rose's day" });
    await expect(card).toBeVisible({ timeout: NAV_TIMEOUT });
    await expect(card.getByRole('heading', { name: 'Today so far' })).toBeVisible();
    await expect(card.getByRole('heading', { name: 'Still to do' })).toBeVisible();
    await expect(card.getByText('3 doses taken')).toBeVisible();
    await expect(card.getByText('1 dose skipped')).toBeVisible();
    await expect(card.getByText('7:30 PM · Lisinopril · Not marked')).toBeVisible();
    // The unmarked dose is mentioned once (the item above), never also as a count.
    await expect(card.getByText(/not marked/i)).toHaveCount(1);
    expect(asked).toContain(today);

    await checkA11y(page, `/circles/${circleId} (daily update card)`, testInfo);
  });

  test('hidden at 18:59 — no daily-update request at all', async ({ page, circleId }) => {
    const at = mostRecentWallTime('18:59', TZ);
    const asked = await mockDailyUpdate(page, TZ, localDateOf(at, TZ));
    await page.clock.install({ time: at });
    await page.goto(`/circles/${circleId}`, { waitUntil: 'domcontentloaded' });
    await expect(page.getByRole('heading', { name: 'Quick access' })).toBeVisible({
      timeout: NAV_TIMEOUT,
    });
    await expect(page.getByTestId('daily-update-card')).toHaveCount(0);
    expect(asked).toEqual([]);
  });

  test('disappears at the recipient\'s midnight while the tab stays open', async ({
    page,
    circleId,
  }) => {
    const at = mostRecentWallTime('23:58:30', TZ);
    await mockDailyUpdate(page, TZ, localDateOf(at, TZ));
    await page.clock.install({ time: at });
    await page.goto(`/circles/${circleId}`, { waitUntil: 'domcontentloaded' });
    await expect(page.getByTestId('daily-update-card')).toBeVisible({ timeout: NAV_TIMEOUT });

    await page.clock.runFor('02:00');
    await expect(page.getByTestId('daily-update-card')).toHaveCount(0);
  });

  test('X hides it for the rest of the evening, across a reload', async ({ page, circleId }) => {
    const at = mostRecentWallTime('20:00', TZ);
    await mockDailyUpdate(page, TZ, localDateOf(at, TZ));
    await page.clock.install({ time: at });
    await page.goto(`/circles/${circleId}`, { waitUntil: 'domcontentloaded' });
    await page.getByRole('button', { name: 'Hide until tomorrow' }).click({ timeout: NAV_TIMEOUT });
    await expect(page.getByTestId('daily-update-card')).toHaveCount(0);

    await page.reload({ waitUntil: 'domcontentloaded' });
    await expect(page.getByRole('heading', { name: 'Quick access' })).toBeVisible({
      timeout: NAV_TIMEOUT,
    });
    await expect(page.getByTestId('daily-update-card')).toHaveCount(0);
  });

  test('Turn off: confirm, preference saved off, Profile shows the renamed group off', async ({
    page,
    circleId,
    account,
  }) => {
    const at = mostRecentWallTime('20:00', TZ);
    await mockDailyUpdate(page, TZ, localDateOf(at, TZ));
    await page.clock.install({ time: at });
    await page.goto(`/circles/${circleId}`, { waitUntil: 'domcontentloaded' });

    await page.getByRole('button', { name: 'Turn off' }).click({ timeout: NAV_TIMEOUT });
    const dialog = page.getByRole('dialog');
    await expect(
      dialog.getByText(
        'This also turns off tips. You can turn both back on in Profile, under Notifications.'
      )
    ).toBeVisible();
    await dialog.getByRole('button', { name: 'Turn off' }).click();
    await expect(page.getByText('Daily update turned off')).toBeVisible();
    await expect(page.getByTestId('daily-update-card')).toHaveCount(0);
    await expect.poll(() => readTipsPref(account.userId)).toBe(false);

    await page.goto('/profile', { waitUntil: 'domcontentloaded' });
    await expect(page.getByRole('switch', { name: /^Daily update & tips/ })).toHaveAttribute(
      'aria-checked',
      'false',
      { timeout: NAV_TIMEOUT }
    );
  });

  test('full update and dated view', async ({ page, circleId }, testInfo) => {
    const at = mostRecentWallTime('20:00', TZ);
    const today = localDateOf(at, TZ);
    const yesterday = addDays(today, -1);
    await mockDailyUpdate(page, TZ, today);
    await page.clock.install({ time: at });

    await page.goto(`/circles/${circleId}`, { waitUntil: 'domcontentloaded' });
    await page.getByRole('link', { name: 'See the full update' }).click({ timeout: NAV_TIMEOUT });
    await expect(page).toHaveURL(new RegExp(`/circles/${circleId}/daily-update$`));
    await expect(page.getByRole('heading', { level: 1, name: "Rose's day" })).toBeVisible({
      timeout: NAV_TIMEOUT,
    });

    await page.goto(`/circles/${circleId}/daily-update/${yesterday}`, {
      waitUntil: 'domcontentloaded',
    });
    await expect(page.getByRole('heading', { name: 'What happened' })).toBeVisible({
      timeout: NAV_TIMEOUT,
    });
    await expect(page.getByRole('heading', { name: 'Not done that day' })).toBeVisible();
    await checkA11y(page, `/circles/${circleId}/daily-update/<yesterday>`, testInfo);

    await page.goto(`/circles/${circleId}/daily-update/${addDays(today, -8)}`, {
      waitUntil: 'domcontentloaded',
    });
    await expect(page.getByText('This update is no longer available.')).toBeVisible({
      timeout: NAV_TIMEOUT,
    });
  });

  test('phone width: the card fits without horizontal scroll', async ({ page, circleId }) => {
    await page.setViewportSize({ width: 375, height: 812 });
    const at = mostRecentWallTime('20:00', TZ);
    await mockDailyUpdate(page, TZ, localDateOf(at, TZ));
    await page.clock.install({ time: at });
    await page.goto(`/circles/${circleId}`, { waitUntil: 'domcontentloaded' });
    await expect(page.getByTestId('daily-update-card')).toBeVisible({ timeout: NAV_TIMEOUT });
    const overflow = await page.evaluate(
      () => document.documentElement.scrollWidth - document.documentElement.clientWidth
    );
    expect(overflow).toBeLessThanOrEqual(0);
  });

  test('invite modal carries the daily update line while the feature is on', async ({
    page,
    circleId,
  }) => {
    await mockDailyUpdate(page, TZ, localDateOf(new Date(), TZ));
    await page.goto(`/circles/${circleId}/members`, { waitUntil: 'domcontentloaded' });
    await page.getByRole('button', { name: 'Invite member' }).first().click({ timeout: NAV_TIMEOUT });
    await expect(page.getByTestId('invite-daily-update-line')).toContainText(
      /The people you invite get a daily update on (your day|.+)\./
    );
  });

  test('invite modal omits the line while rollout is off', async ({ page, circleId }) => {
    await mockDailyUpdate(page, TZ, localDateOf(new Date(), TZ), { enabled: false });
    await page.goto(`/circles/${circleId}/members`, { waitUntil: 'domcontentloaded' });
    await page.getByRole('button', { name: 'Invite member' }).first().click({ timeout: NAV_TIMEOUT });
    await expect(page.getByLabel('Email address')).toBeVisible();
    await expect(page.getByTestId('invite-daily-update-line')).toHaveCount(0);
  });
});
