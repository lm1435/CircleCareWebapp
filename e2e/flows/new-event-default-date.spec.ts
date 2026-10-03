import { test, expect, uniqueLabel } from '../fixtures';
import { sqlExec, sqlRows, sqlStr } from '../db';

/**
 * A NEW event defaults its date to the CARE RECIPIENT's "today".
 *
 * User-approved 2026-10-01. The default used to be the BROWSER's today, so a
 * caregiver in Kiritimati (UTC+14) adding a task for a Denver recipient got a
 * default - and a saved date-only task - a day AHEAD of the recipient's today
 * (found by the far-zone Maestro/Playwright runs).
 *
 * The browser is Pacific/Kiritimati; the isolated account's care recipient is
 * in America/Denver. The clock is pinned at 20:00 UTC (most recent such instant
 * at or before now, so it only ever moves BACKWARD - see
 * midnight-straddle.spec.ts on why): Denver is on 13:00/14:00 of day D while
 * Kiritimati is on 10:00 of D+1, so the two zones are ALWAYS on different days
 * and the test cannot pass by coincidence.
 */
test.use({ timezoneId: 'Pacific/Kiritimati', locale: 'en-US' });

function pinnedInstant(now: Date = new Date()): Date {
  const at = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate(), 20, 0));
  if (at.getTime() > now.getTime()) at.setUTCDate(at.getUTCDate() - 1);
  return at;
}

/** Independent of the app's own helper: straight from Intl. */
function dayIn(zone: string, at: Date): string {
  const p = new Intl.DateTimeFormat('en-US', {
    timeZone: zone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(at);
  const v = (t: string): string => p.find((x) => x.type === t)?.value ?? '';
  return `${v('year')}-${v('month')}-${v('day')}`;
}

const PINNED = pinnedInstant();
const RECIPIENT_TODAY = dayIn('America/Denver', PINNED);
const BROWSER_TODAY = dayIn('Pacific/Kiritimati', PINNED);

test.beforeEach(async ({ page }) => {
  // The straddle must be real inside the browser, or every assertion below
  // could pass for the wrong reason.
  expect(RECIPIENT_TODAY).not.toBe(BROWSER_TODAY);
  await page.clock.setFixedTime(PINNED);
});

test('a new TASK (Tasks page) defaults to the recipient\'s today and saves on it', async ({
  page,
  circleId,
}) => {
  const title = uniqueLabel('FarZoneTask');
  await page.goto(`/circles/${circleId}/tasks`, { waitUntil: 'domcontentloaded' });
  await expect(page.getByRole('heading', { name: 'Tasks' })).toBeVisible({ timeout: 15_000 });

  await page.getByRole('button', { name: 'Add task' }).first().click();
  const dialog = page.getByRole('dialog');
  await expect(dialog).toBeVisible();

  const date = dialog.locator('#scheduled_date');
  await expect(date).toHaveValue(RECIPIENT_TODAY);
  await expect(date).not.toHaveValue(BROWSER_TODAY);

  await dialog.locator('#title').fill(title);
  await dialog.getByRole('button', { name: 'Create' }).click();
  await expect(dialog).toBeHidden({ timeout: 20_000 });

  try {
    const rows = sqlRows<{ scheduled_date: string }>(
      `select scheduled_date::text from calendar_events where circle_id = ${sqlStr(circleId)}::uuid and title = ${sqlStr(title)}`
    );
    expect(rows.map((r) => r.scheduled_date)).toEqual([RECIPIENT_TODAY]);
  } finally {
    sqlExec(`delete from calendar_events where circle_id = ${sqlStr(circleId)}::uuid and title = ${sqlStr(title)}`);
  }
});

test('a new event from the CALENDAR "Add event" defaults to the recipient\'s today', async ({
  page,
  circleId,
}) => {
  await page.goto(`/circles/${circleId}/calendar`, { waitUntil: 'domcontentloaded' });
  await expect(page.getByRole('grid')).toBeVisible({ timeout: 15_000 });

  await page.getByRole('button', { name: 'Add event' }).first().click();
  const dialog = page.getByRole('dialog');
  await expect(dialog).toBeVisible();

  const date = dialog.locator('#scheduled_date');
  await expect(date).toHaveValue(RECIPIENT_TODAY);
  await expect(date).not.toHaveValue(BROWSER_TODAY);
});
