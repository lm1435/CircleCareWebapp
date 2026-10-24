import type { APIRequestContext, Page } from '@playwright/test';
import { test, expect } from '../fixtures';
import { checkA11y } from '../helpers';
import { cookieLogin, createCircle, createScopedAccount, uniq } from '../unhappy/auth-invites/_helpers';
import {
  apiSession,
  circleTimezone,
  createDailyMedication,
  dateInTz,
  deleteSeries,
  escapeRegExp,
  uniqueSuffix,
  type ApiSession,
} from '../notesFirstClassShared';

// Care shifts T9b — the web Day view (docs/plans/care-shifts.md, W10/W11):
//   Day | Week | Month underline tabs, Day prev / next / Today, confirm a med
//   dose and complete a task FROM Day, Week header -> Day, Month cell -> Day,
//   axe in light and dark. Run-scoped account + circle, cleaned up at the end.

test.use({ storageState: { cookies: [], origins: [] } });
test.setTimeout(120_000);

const WEEKDAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

/** Long weekday name of a YYYY-MM-DD (calendar date, no zone maths). */
function weekdayOf(date: string): string {
  return WEEKDAYS[new Date(`${date}T12:00:00Z`).getUTCDay()];
}

/** "Month D" of a YYYY-MM-DD, as Intl en-US prints it (matches the aria-labels). */
function longDate(date: string): string {
  return new Intl.DateTimeFormat('en-US', {
    timeZone: 'UTC',
    weekday: 'long',
    month: 'long',
    day: 'numeric',
  }).format(new Date(`${date}T12:00:00Z`));
}

interface Scene {
  session: ApiSession;
  circleId: string;
  tz: string;
  today: string;
  medName: string;
  medRoot: string;
  taskTitle: string;
  owner: Awaited<ReturnType<typeof createScopedAccount>>;
}

async function arrange(request: APIRequestContext): Promise<Scene> {
  const owner = await createScopedAccount('dayview');
  const session = await apiSession(request, owner);
  const circleId = await createCircle(session, uniq('dayview'));
  const tz = await circleTimezone(session, circleId);
  const today = dateInTz(tz, 0);
  const medName = `ZZ_E2E_DAY_${uniqueSuffix()}`;
  // Daily from 2 days ago at 08:00: today, yesterday and the day before all have a dose.
  const medRoot = await createDailyMedication(session, circleId, medName, dateInTz(tz, -2), {
    time: '08:00',
  });
  const taskTitle = `ZZ_E2E_DAYTASK_${uniqueSuffix()}`;
  const res = await session.post(`/api/circles/${circleId}/events`, {
    event_type: 'task',
    title: taskTitle,
    scheduled_date: today,
  });
  expect(res.ok(), `create task: ${await res.text()}`).toBeTruthy();
  return { session, circleId, tz, today, medName, medRoot, taskTitle, owner };
}

async function openDay(page: Page, circleId: string): Promise<void> {
  await page.goto(`/circles/${circleId}/calendar`, { waitUntil: 'domcontentloaded' });
  const tabs = page.getByRole('tablist', { name: 'Calendar view' });
  await expect(tabs).toBeVisible({ timeout: 20_000 });
  await tabs.getByRole('tab', { name: 'Day' }).click();
  await expect(page.getByTestId('day-view')).toBeVisible({ timeout: 20_000 });
}

const title = (page: Page) => page.getByTestId('day-view-title');

test.describe('Day view', () => {
  let s: Scene;

  test.beforeEach(async ({ request, context, baseURL }) => {
    s = await arrange(request);
    await cookieLogin(context, s.owner, baseURL);
  });

  test.afterEach(async () => {
    await deleteSeries(s.session, s.circleId, s.medRoot);
  });

  test('tabs: Day | Week | Month, Week is the default, arrow keys move between them', async ({ page }) => {
    await page.goto(`/circles/${s.circleId}/calendar`, { waitUntil: 'domcontentloaded' });
    const tabs = page.getByRole('tablist', { name: 'Calendar view' });
    await expect(tabs.getByRole('tab')).toHaveText(['Day', 'Week', 'Month'], { timeout: 20_000 });
    await expect(tabs.getByRole('tab', { name: 'Week' })).toHaveAttribute('aria-selected', 'true');

    await tabs.getByRole('tab', { name: 'Week' }).focus();
    await page.keyboard.press('ArrowLeft');
    await expect(tabs.getByRole('tab', { name: 'Day' })).toHaveAttribute('aria-selected', 'true');
    await expect(page.getByTestId('day-view')).toBeVisible();
    await page.keyboard.press('End');
    await expect(tabs.getByRole('tab', { name: 'Month' })).toHaveAttribute('aria-selected', 'true');
    await expect(page.getByRole('grid', { name: 'Month view calendar' })).toBeVisible();
  });

  test('Day: hero is Today, prev / next / Today navigate and the shared date survives a tab switch', async ({
    page,
  }) => {
    await openDay(page, s.circleId);
    await expect(title(page)).toHaveText(`Today, ${weekdayOf(s.today)}`);
    await expect(page.getByTestId('day-view-summary')).toHaveText('1 dose · 1 task');
    await expect(page.getByRole('button', { name: 'Today' })).toBeDisabled();

    await page.getByRole('button', { name: 'Next day' }).click();
    await expect(title(page)).toHaveText(`Tomorrow, ${weekdayOf(dateInTz(s.tz, 1))}`);
    await expect(page.getByRole('button', { name: 'Today' })).toBeEnabled();
    await page.getByRole('button', { name: 'Previous day' }).click();
    await page.getByRole('button', { name: 'Previous day' }).click();
    await expect(title(page)).toHaveText(`Yesterday, ${weekdayOf(dateInTz(s.tz, -1))}`);

    // The shared date: Day -> Week -> Day lands on the same day.
    const tabs = page.getByRole('tablist', { name: 'Calendar view' });
    await tabs.getByRole('tab', { name: 'Week' }).click();
    await expect(page.getByRole('grid', { name: 'Week view calendar' })).toBeVisible();
    await tabs.getByRole('tab', { name: 'Day' }).click();
    await expect(title(page)).toHaveText(`Yesterday, ${weekdayOf(dateInTz(s.tz, -1))}`);

    await page.getByRole('button', { name: 'Today' }).click();
    await expect(title(page)).toHaveText(`Today, ${weekdayOf(s.today)}`);
  });

  test('Day: confirm a medication dose from the row (same modal as Week)', async ({ page }) => {
    await openDay(page, s.circleId);
    const row = page.getByTestId('day-event').filter({ hasText: s.medName });
    await row.click();
    const detail = page.getByRole('dialog');
    await expect(detail).toBeVisible({ timeout: 10_000 });
    await detail.getByRole('button', { name: 'Mark taken' }).click();
    const confirm = page.getByRole('dialog', { name: 'Confirm medication' });
    await expect(confirm).toBeVisible({ timeout: 10_000 });
    await confirm.getByRole('button', { name: 'Save' }).click();
    await expect(confirm).toBeHidden({ timeout: 20_000 });
    await expect(row).toHaveAttribute('data-med-status', 'taken', { timeout: 20_000 });
  });

  test('Day: complete a task from the row', async ({ page }) => {
    await openDay(page, s.circleId);
    await page.getByTestId('day-event').filter({ hasText: s.taskTitle }).click();
    const detail = page.getByRole('dialog');
    await expect(detail).toBeVisible({ timeout: 10_000 });
    await detail.getByRole('button', { name: 'Mark complete' }).click();
    await expect(detail.getByRole('button', { name: 'Mark complete' })).toHaveCount(0, {
      timeout: 20_000,
    });
  });

  test('Week: a day header opens Day for that date', async ({ page }) => {
    await page.goto(`/circles/${s.circleId}/calendar`, { waitUntil: 'domcontentloaded' });
    const target = s.today;
    await page
      .getByRole('button', { name: new RegExp(`^${escapeRegExp(longDate(target))}$`) })
      .click({ timeout: 20_000 });
    await expect(page.getByRole('tab', { name: 'Day' })).toHaveAttribute('aria-selected', 'true');
    await expect(title(page)).toHaveText(`Today, ${weekdayOf(target)}`);
  });

  test('Month: a day cell opens Day for that date', async ({ page }) => {
    await page.goto(`/circles/${s.circleId}/calendar`, { waitUntil: 'domcontentloaded' });
    await page
      .getByRole('tablist', { name: 'Calendar view' })
      .getByRole('tab', { name: 'Month' })
      .click({ timeout: 20_000 });
    await expect(page.getByRole('grid', { name: 'Month view calendar' })).toBeVisible();
    const yesterday = dateInTz(s.tz, -1);
    // The cell label is "<weekday>, <month> <day>, <N events>"; address the cell by its data-date.
    await page.locator(`button[data-date="${yesterday}"]`).click();
    await expect(page.getByRole('tab', { name: 'Day' })).toHaveAttribute('aria-selected', 'true');
    await expect(title(page)).toHaveText(`Yesterday, ${weekdayOf(yesterday)}`);
    await expect(page.getByTestId('day-event').filter({ hasText: s.medName })).toBeVisible();
  });

  test('axe: Day view (light)', async ({ page }, testInfo) => {
    await openDay(page, s.circleId);
    await expect(page.getByTestId('day-event').first()).toBeVisible();
    await checkA11y(page, 'calendar-day-light', testInfo);
  });

  test('axe: empty Day (light)', async ({ page }, testInfo) => {
    await openDay(page, s.circleId);
    // The daily med repeats forever, so go BEFORE the series start (2 days ago).
    for (let i = 0; i < 5; i++) await page.getByRole('button', { name: 'Previous day' }).click();
    await expect(page.getByText('Nothing scheduled for this day')).toBeVisible({ timeout: 20_000 });
    await expect(page.getByRole('button', { name: 'Add event' }).last()).toBeVisible();
    await checkA11y(page, 'calendar-day-empty-light', testInfo);
  });

  test.describe('dark', () => {
    test.use({ colorScheme: 'dark' });

    test('axe: Day view (dark)', async ({ page }, testInfo) => {
      await openDay(page, s.circleId);
      await expect(page.getByTestId('day-event').first()).toBeVisible();
      await checkA11y(page, 'calendar-day-dark', testInfo);
    });
  });
});
