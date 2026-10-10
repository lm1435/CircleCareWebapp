import { test, expect } from '../fixtures';
import { checkA11y, pinRecipientZoneToBrowser } from '../helpers';
import {
  addDays,
  DATELESS,
  localDateOf,
  mockDailyUpdate,
  mostRecentWallTime,
  readTipsPref,
  setTipsPref,
} from '../dailyUpdateShared';

/**
 * DAILY UPDATE, design v2 "B2" — Home card, full/dated page with day arrows, tap
 * targets, the way back (Quick access + Activity feed) (docs/plans/daily-update.md).
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

  test('card at 20:00: B2 sentence, clause line and rows, and passes axe', async ({
    page,
    circleId,
  }, testInfo) => {
    const at = mostRecentWallTime('20:00', TZ);
    const today = localDateOf(at, TZ);
    const asked = await mockDailyUpdate(page, TZ, today);
    await page.clock.install({ time: at });
    await page.goto(`/circles/${circleId}`, { waitUntil: 'domcontentloaded' });

    const card = page.getByRole('region', { name: 'A steady day for Rose.' });
    await expect(card).toBeVisible({ timeout: NAV_TIMEOUT });
    await expect(card.getByText('This evening')).toBeVisible();
    await expect(
      card.getByText('Most doses taken · 2 tasks done · an appointment · Ana left a note')
    ).toBeVisible();
    await expect(card.getByRole('link', { name: /^2 tasks done/ })).toHaveAttribute(
      'href',
      `/circles/${circleId}/daily-update#tasks`
    );
    await expect(card.getByRole('link', { name: /^Dr\. Patel, cardiology follow-up/ })).toHaveAttribute(
      'href',
      `/circles/${circleId}/calendar?date=${today}&eventId=a1`
    );
    await expect(card.getByRole('link', { name: /^A note from Ana/ })).toHaveAttribute(
      'href',
      `/circles/${circleId}/notes?date=${today}`
    );
    // No dose list on the card (Home's Medications card is that).
    await expect(card.getByText('Sertraline')).toHaveCount(0);
    expect(asked).toContain(today);

    await checkA11y(page, `/circles/${circleId} (daily update card)`, testInfo);
  });

  test('"2 tasks done" opens the full update at its Tasks section', async ({ page, circleId }) => {
    const at = mostRecentWallTime('20:00', TZ);
    await mockDailyUpdate(page, TZ, localDateOf(at, TZ));
    await page.clock.install({ time: at });
    await page.goto(`/circles/${circleId}`, { waitUntil: 'domcontentloaded' });
    await page.getByRole('link', { name: /^2 tasks done/ }).click({ timeout: NAV_TIMEOUT });
    await expect(page).toHaveURL(new RegExp(`/circles/${circleId}/daily-update#tasks$`));
    const heading = page.getByRole('heading', { level: 2, name: 'Tasks' });
    await expect(heading).toBeFocused({ timeout: NAV_TIMEOUT });
    await expect(heading).toBeInViewport();
  });

  test('hidden at 18:59 — no dated daily-update request', async ({ page, circleId }) => {
    const at = mostRecentWallTime('18:59', TZ);
    const asked = await mockDailyUpdate(page, TZ, localDateOf(at, TZ));
    await page.clock.install({ time: at });
    await page.goto(`/circles/${circleId}`, { waitUntil: 'domcontentloaded' });
    await expect(page.getByRole('heading', { name: 'Quick access' })).toBeVisible({
      timeout: NAV_TIMEOUT,
    });
    await expect(page.getByTestId('daily-update-card')).toHaveCount(0);
    // The card asks for no DATED update; the date-less read is the Quick access
    // way back (rollout check), which shows all day.
    expect(asked.filter((d) => d !== DATELESS)).toEqual([]);
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

  test('no Turn off on the card; the Profile "Daily update & tips" switch hides and restores it', async ({
    page,
    circleId,
    account,
  }) => {
    const at = mostRecentWallTime('20:00', TZ);
    await mockDailyUpdate(page, TZ, localDateOf(at, TZ));
    await page.clock.install({ time: at });
    await page.goto(`/circles/${circleId}`, { waitUntil: 'domcontentloaded' });

    const card = page.getByTestId('daily-update-card');
    await expect(card).toBeVisible({ timeout: NAV_TIMEOUT });
    // The card's "Turn off" link was removed (owner, 2026-10-09): the X and
    // Profile's switch are the only controls.
    await expect(card.getByRole('button', { name: 'Turn off' })).toHaveCount(0);
    await expect(card.getByText('Turn off')).toHaveCount(0);
    await expect(card.getByRole('button', { name: 'Hide until tomorrow' })).toBeVisible();

    await page.goto('/profile', { waitUntil: 'domcontentloaded' });
    const tipsSwitch = page.getByRole('switch', { name: /^Daily update & tips/ });
    await expect(tipsSwitch).toHaveAttribute('aria-checked', 'true', { timeout: NAV_TIMEOUT });
    await tipsSwitch.click();
    await expect(tipsSwitch).toHaveAttribute('aria-checked', 'false');
    await expect.poll(() => readTipsPref(account.userId)).toBe(false);

    await page.goto(`/circles/${circleId}`, { waitUntil: 'domcontentloaded' });
    await expect(page.getByRole('heading', { name: 'Quick access' })).toBeVisible({
      timeout: NAV_TIMEOUT,
    });
    await expect(page.getByTestId('daily-update-card')).toHaveCount(0);

    await page.goto('/profile', { waitUntil: 'domcontentloaded' });
    await expect(tipsSwitch).toHaveAttribute('aria-checked', 'false', { timeout: NAV_TIMEOUT });
    await tipsSwitch.click();
    await expect.poll(() => readTipsPref(account.userId)).toBe(true);

    await page.goto(`/circles/${circleId}`, { waitUntil: 'domcontentloaded' });
    await expect(page.getByTestId('daily-update-card')).toBeVisible({ timeout: NAV_TIMEOUT });
  });

  test('full update: date title, arrows across the 7-day range, sections, axe', async ({
    page,
    circleId,
  }, testInfo) => {
    const at = mostRecentWallTime('20:00', TZ);
    const today = localDateOf(at, TZ);
    const yesterday = addDays(today, -1);
    await mockDailyUpdate(page, TZ, today);
    await page.clock.install({ time: at });

    await page.goto(`/circles/${circleId}`, { waitUntil: 'domcontentloaded' });
    await page.getByRole('link', { name: 'See the full update' }).click({ timeout: NAV_TIMEOUT });
    await expect(page).toHaveURL(new RegExp(`/circles/${circleId}/daily-update$`));
    await expect(page.getByText('A steady day for Rose.')).toBeVisible({ timeout: NAV_TIMEOUT });
    await expect(page.getByTestId('daily-update-glance')).toHaveText(
      '2 of 3 doses taken so far · 1 skipped · 1 to come'
    );
    await expect(page.getByRole('heading', { level: 2 })).toHaveText([
      'Still to do',
      'Medications',
      'Tasks',
      'Appointments',
      'Notes',
    ]);
    const nav = page.getByRole('navigation', { name: 'Other days' });
    await expect(nav.getByText('Today')).toBeVisible();
    await expect(nav.getByRole('link', { name: /^Next day/ })).toHaveCount(0);
    await checkA11y(page, `/circles/${circleId}/daily-update (today)`, testInfo);

    // ‹ yesterday
    await nav.getByRole('link', { name: /^Previous day/ }).click();
    await expect(page).toHaveURL(new RegExp(`/daily-update/${yesterday}$`));
    await expect(page.getByTestId('daily-update-glance')).toHaveText('2 of 3 doses taken · 1 not marked', {
      timeout: NAV_TIMEOUT,
    });
    await expect(page.getByRole('heading', { name: 'Still to do' })).toHaveCount(0);
    await expect(nav.getByRole('link', { name: /^Next day/ })).toHaveAttribute(
      'href',
      `/circles/${circleId}/daily-update/${today}`
    );
    await checkA11y(page, `/circles/${circleId}/daily-update/<yesterday>`, testInfo);

    // The range edge (today - 7) has no previous arrow.
    await page.goto(`/circles/${circleId}/daily-update/${addDays(today, -7)}`, {
      waitUntil: 'domcontentloaded',
    });
    await expect(page.getByTestId('daily-update-lead')).toBeVisible({ timeout: NAV_TIMEOUT });
    await expect(nav.getByRole('link', { name: /^Previous day/ })).toHaveCount(0);
    await expect(nav.getByRole('link', { name: /^Next day/ })).toBeVisible();

    await page.goto(`/circles/${circleId}/daily-update/${addDays(today, -8)}`, {
      waitUntil: 'domcontentloaded',
    });
    await expect(page.getByText('This update is no longer available.')).toBeVisible({
      timeout: NAV_TIMEOUT,
    });
  });

  test('a dose row whose medication is gone lands gently on Medications', async ({
    page,
    circleId,
  }) => {
    const at = mostRecentWallTime('20:00', TZ);
    await mockDailyUpdate(page, TZ, localDateOf(at, TZ));
    await page.clock.install({ time: at });
    await page.goto(`/circles/${circleId}/daily-update`, { waitUntil: 'domcontentloaded' });
    await page
      .getByRole('region', { name: 'Medications' })
      .getByRole('link', { name: /Sertraline/ })
      .click({ timeout: NAV_TIMEOUT });
    await expect(page.getByText('This item is no longer available. Someone may have deleted it.')).toBeVisible({
      timeout: NAV_TIMEOUT,
    });
    await expect(page).toHaveURL(new RegExp(`/circles/${circleId}/meds$`));
  });

  test('way back: Quick access and the Activity feed open the latest update', async ({
    page,
    circleId,
  }, testInfo) => {
    // Daytime: the latest update is yesterday's.
    const at = mostRecentWallTime('12:00', TZ);
    const today = localDateOf(at, TZ);
    await mockDailyUpdate(page, TZ, today);
    await page.clock.install({ time: at });
    await page.goto(`/circles/${circleId}`, { waitUntil: 'domcontentloaded' });
    const quick = page.getByRole('navigation', { name: 'Quick access' });
    const row = quick.getByRole('link', { name: 'Daily updates' });
    await expect(row).toBeVisible({ timeout: NAV_TIMEOUT });
    await expect(quick.getByRole('link')).toHaveText([
      'Notes',
      'Calendar',
      'Meds',
      /^Tasks/,
      'Vitals',
      'Daily updates',
      'Activity feed',
      'Care info',
    ]);
    await checkA11y(page, `/circles/${circleId} (Quick access with Daily updates)`, testInfo);
    await row.click();
    await expect(page).toHaveURL(
      new RegExp(`/circles/${circleId}/daily-update/${addDays(today, -1)}$`)
    );

    await page.goto(`/circles/${circleId}/activity`, { waitUntil: 'domcontentloaded' });
    const feedLink = page.getByTestId('activity-daily-updates-link');
    await expect(feedLink).toHaveAttribute(
      'href',
      `/circles/${circleId}/daily-update/${addDays(today, -1)}`,
      { timeout: NAV_TIMEOUT }
    );
    await checkA11y(page, `/circles/${circleId}/activity (Daily updates link)`, testInfo);
  });

  test('way back is hidden while rollout is off', async ({ page, circleId }) => {
    await mockDailyUpdate(page, TZ, localDateOf(new Date(), TZ), { enabled: false });
    await page.goto(`/circles/${circleId}`, { waitUntil: 'domcontentloaded' });
    await expect(page.getByRole('heading', { name: 'Quick access' })).toBeVisible({
      timeout: NAV_TIMEOUT,
    });
    await expect(page.getByRole('link', { name: 'Activity feed' }).first()).toBeVisible();
    await expect(page.getByRole('link', { name: 'Daily updates' })).toHaveCount(0);
    await page.goto(`/circles/${circleId}/activity`, { waitUntil: 'domcontentloaded' });
    await expect(page.getByRole('heading', { level: 1 })).toBeVisible({ timeout: NAV_TIMEOUT });
    await expect(page.getByTestId('activity-daily-updates-link')).toHaveCount(0);
  });

  test('keyboard: an arrow press keeps focus on the arrows (also at both range edges) and announces the day (WCAG 2.4.3, 4.1.3)', async ({
    page,
    circleId,
  }) => {
    const at = mostRecentWallTime('20:00', TZ);
    const today = localDateOf(at, TZ);
    await mockDailyUpdate(page, TZ, today);
    await page.clock.install({ time: at });
    const focused = () => page.evaluate(() => document.activeElement?.getAttribute('data-testid') ?? 'body');

    // Mid-range: Previous day lands on the new page's Previous day arrow.
    await page.goto(`/circles/${circleId}/daily-update/${addDays(today, -2)}`, { waitUntil: 'domcontentloaded' });
    await page.getByTestId('daily-update-prev').focus();
    const before = (await page.locator('h1').first().innerText()).trim();
    await page.keyboard.press('Enter');
    await expect(page).toHaveURL(new RegExp(`/daily-update/${addDays(today, -3)}$`));
    await expect.poll(focused, { timeout: NAV_TIMEOUT }).toBe('daily-update-prev');
    // Focus sits on the arrow (named for the NEXT day back), so the shown day is
    // announced through a status region: the page's own title (WCAG 4.1.3).
    // Read the title only once it shows the new day (it can lag the URL by a render).
    await expect(page.locator('h1').first()).not.toHaveText(before);
    const title = (await page.locator('h1').first().innerText()).trim();
    await expect(page.getByTestId('daily-update-day-announcement')).toHaveText(title);
    await expect(page.getByTestId('daily-update-day-announcement')).toHaveAttribute('role', 'status');

    // Next day into today: "Today" replaces the next arrow, so focus takes the previous one.
    await page.goto(`/circles/${circleId}/daily-update/${addDays(today, -1)}`, { waitUntil: 'domcontentloaded' });
    await page.getByTestId('daily-update-next').focus();
    await page.keyboard.press('Enter');
    await expect(page).toHaveURL(new RegExp(`/daily-update/${today}$`));
    await expect.poll(focused, { timeout: NAV_TIMEOUT }).toBe('daily-update-prev');

    // Previous day onto the oldest day (today - 7): no previous arrow, focus takes the next one.
    await page.goto(`/circles/${circleId}/daily-update/${addDays(today, -6)}`, { waitUntil: 'domcontentloaded' });
    await page.getByTestId('daily-update-prev').focus();
    await page.keyboard.press('Enter');
    await expect(page).toHaveURL(new RegExp(`/daily-update/${addDays(today, -7)}$`));
    await expect.poll(focused, { timeout: NAV_TIMEOUT }).toBe('daily-update-next');
  });

  test('phone width (390): card and full page fit without horizontal scroll', async ({ page, circleId }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    const at = mostRecentWallTime('20:00', TZ);
    await mockDailyUpdate(page, TZ, localDateOf(at, TZ));
    await page.clock.install({ time: at });
    await page.goto(`/circles/${circleId}`, { waitUntil: 'domcontentloaded' });
    await expect(page.getByTestId('daily-update-card')).toBeVisible({ timeout: NAV_TIMEOUT });
    const overflow = () =>
      page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
    expect(await overflow()).toBeLessThanOrEqual(0);
    await page.getByRole('link', { name: 'See the full update' }).click();
    await expect(page.getByTestId('daily-update-lead')).toBeVisible({ timeout: NAV_TIMEOUT });
    expect(await overflow()).toBeLessThanOrEqual(0);
  });

  test('invite modal carries the daily update line while the feature is on', async ({
    page,
    circleId,
  }, testInfo) => {
    await mockDailyUpdate(page, TZ, localDateOf(new Date(), TZ));
    await page.goto(`/circles/${circleId}/members`, { waitUntil: 'domcontentloaded' });
    await page.getByRole('button', { name: 'Invite member' }).first().click({ timeout: NAV_TIMEOUT });
    await expect(page.getByTestId('invite-daily-update-line')).toContainText(
      /The people you invite get a daily update on (your day|.+)\./
    );
    await checkA11y(page, `/circles/${circleId}/members [Invite member open, daily update line]`, testInfo, {
      wcag22: true,
    });
  });

  test('invite modal omits the line while rollout is off', async ({ page, circleId }) => {
    await mockDailyUpdate(page, TZ, localDateOf(new Date(), TZ), { enabled: false });
    await page.goto(`/circles/${circleId}/members`, { waitUntil: 'domcontentloaded' });
    await page.getByRole('button', { name: 'Invite member' }).first().click({ timeout: NAV_TIMEOUT });
    await expect(page.getByLabel('Email address')).toBeVisible();
    await expect(page.getByTestId('invite-daily-update-line')).toHaveCount(0);
  });
});
