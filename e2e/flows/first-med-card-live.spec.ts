import type { Page } from '@playwright/test';
import { test, expect } from '../fixtures';
import { dbQuery, sqlStr } from '../unhappy';
import { createAccount, runScopedEmail, ACCOUNT_PASSWORD } from '../isolation';
import { sqlExec } from '../db';
import { cookieLogin, stubJson, uniq } from '../unhappy/auth-invites/_helpers';

// prod 1.4.1, 2026-11-14 (owner): Today's first-med card was a SNAPSHOT of the save. Ibuprofen
// saved at 8:29 AM (already past -> rolled to tomorrow), then edited to 8:29 PM: the database held
// one dose at 20:29 TODAY and Next up said so, while the card still said "8:29 AM · Starts
// tomorrow · Already taken today? Mark it". The card now reads the LIVE root (GET /events/:id)
// and shows only while the medication is still scheduled, active and starting after today.
//
// Against the real backend. The "edit" is applied to the stored root (the state the owner's edit
// left behind), then Today is reloaded; the in-app invalidation path is pinned by the unit suite
// (FirstMedMarkIt.test.tsx P6). Mobile twin: mobile/.maestro/parity/onboarding/first-med-card-live.yaml.

async function freeAccount(prefix: string) {
  const email = runScopedEmail(uniq(prefix));
  const userId = await createAccount(email, 'free');
  return { email, password: ACCOUNT_PASSWORD, userId };
}

const wizard = (page: Page) => page.getByRole('dialog', { name: 'Circle created' });
const card = (page: Page) => page.getByTestId('first-med-mark-it');

interface RootRow {
  id: string;
  scheduled_date: string;
  scheduled_time: string;
  recurrence_rule: string | null;
  tz: string;
  local_today: string;
  local_time: string;
  /** Ten minutes from now on the circle's clock: a dose still ahead today. */
  later_time: string;
}

function rootMed(circleId: string): RootRow {
  const rows = dbQuery<RootRow>(
    `select e.id, e.scheduled_date::text as scheduled_date, e.scheduled_time::text as scheduled_time,
            e.recurrence_rule,
            coalesce(c.timezone, 'America/New_York') as tz,
            (now() at time zone coalesce(c.timezone, 'America/New_York'))::date::text as local_today,
            to_char(now() at time zone coalesce(c.timezone, 'America/New_York'), 'HH24:MI') as local_time,
            to_char((now() at time zone coalesce(c.timezone, 'America/New_York')) + interval '10 minutes', 'HH24:MI:00') as later_time
       from calendar_events e join care_circles c on c.id = e.circle_id
      where e.circle_id = ${sqlStr(circleId)}::uuid and e.event_type = 'medication'
        and e.parent_event_id is null`
  );
  expect(rows).toHaveLength(1);
  return rows[0];
}

function updateRoot(id: string, set: string): void {
  sqlExec(`update calendar_events set ${set}, updated_at = now() where id = ${sqlStr(id)}::uuid;`);
}

/** Owner, first circle, Setup skipped, first med saved from the add menu at 00:01 (past -> rolled). */
async function rolledFirstMed(page: Page, context: any, baseURL: string | undefined, prefix: string) {
  await stubJson(page, 'GET', '/api/drugs/search', { body: { success: true, data: { drugs: [] } } });
  const a = await freeAccount(prefix);
  await cookieLogin(context, a, baseURL);
  await page.goto('/circles', { waitUntil: 'domcontentloaded' });
  await page.getByRole('button', { name: 'Create circle' }).first().click();
  const modal = page.getByRole('dialog');
  await modal.locator('#recipient_name').fill(uniq('Live'));
  await modal.getByRole('button', { name: 'Create circle' }).click();
  await page.waitForURL(/\/circles\/[0-9a-f-]{36}$/, { timeout: 30_000 });
  const circleId = /\/circles\/([0-9a-f-]{36})/.exec(page.url())![1];
  await expect(wizard(page)).toBeVisible({ timeout: 20_000 });
  await wizard(page).getByRole('button', { name: 'Skip for now' }).click();
  await page.waitForURL(/\/upgrade$/, { timeout: 30_000 });
  await page.getByRole('button', { name: /Continue with free plan/ }).click();
  await page.waitForURL(new RegExp(`/circles/${circleId}$`), { timeout: 30_000 });

  const next = page.getByTestId('next-step-card');
  await expect(next).toBeVisible({ timeout: 20_000 });
  await next.getByRole('button', { name: 'Add medication' }).click();
  const form = page.getByRole('dialog').last();
  await form.getByLabel(/Medication name/i).fill('Ibuprofen');
  await form.locator('#scheduled_time').fill('00:01');
  await expect(form.getByTestId('dose-past-time-note')).toBeVisible();
  await form.getByRole('button', { name: 'Add medication' }).click();

  await expect(card(page)).toBeVisible({ timeout: 20_000 });
  await expect(card(page).getByTestId('mark-it-next-sub')).toContainText('Starts tomorrow');
  const root = rootMed(circleId);
  expect(root.scheduled_date > root.local_today).toBe(true);
  return { circleId, root };
}

async function reloadToday(page: Page): Promise<void> {
  await page.reload({ waitUntil: 'domcontentloaded' });
  await expect(page.getByRole('heading', { level: 1 }).first()).toBeVisible({ timeout: 20_000 });
}

/** Today has settled: Next up has answered, so a card that is coming would be on screen. */
async function todaySettled(page: Page): Promise<void> {
  await expect(page.getByTestId('today-grid')).toBeVisible({ timeout: 20_000 });
  await page.waitForLoadState('networkidle');
}

test.describe('first-med card follows the live medication (web)', () => {
  test.setTimeout(150_000);

  test('POSITIVE: an edit that keeps the start rolled shows the NEW name, dose and time; the owner case (moved to later today) hides the card', async ({
    page,
    context,
    baseURL,
  }) => {
    const { root } = await rolledFirstMed(page, context, baseURL, 'fmlive');
    test.skip(root.local_time < '00:05' || root.local_time > '23:45', 'needs a past 00:03 and a later-today slot in the circle zone');

    // Still rolled, edited: name, dose and an earlier (still past) time.
    updateRoot(
      root.id,
      `title = 'Losartan', medication_name = 'Losartan', medication_dosage = '25 mg', scheduled_time = '00:03:00'`
    );
    await reloadToday(page);
    await expect(card(page)).toBeVisible({ timeout: 20_000 });
    await expect(card(page).getByText('Losartan')).toBeVisible();
    await expect(card(page).getByTestId('mark-it-next-sub')).toHaveText('25 mg · Starts tomorrow');
    await expect(card(page).getByTestId('mark-it-next-label')).toHaveText(/^12:03\sAM/);
    await expect(card(page)).not.toContainText('Ibuprofen');
    await expect(card(page)).not.toContainText('12:01');

    // The owner's case: the dose moved onto TODAY, later than now. The card must not say "Starts
    // tomorrow" or offer Mark it; Next up owns the dose.
    updateRoot(
      root.id,
      `scheduled_date = ${sqlStr(root.local_today)}::date, scheduled_time = ${sqlStr(root.later_time)}::time`
    );
    await reloadToday(page);
    await todaySettled(page);
    await expect(card(page)).toHaveCount(0);
    await expect(page.getByTestId('mark-it-line')).toHaveCount(0);
    await expect(page.getByText('Starts tomorrow')).toHaveCount(0);
    await expect(page.getByTestId('today-grid').getByText('Losartan').first()).toBeVisible();
  });

  test('POSITIVE + NEGATIVE: Mark it confirms the LIVE time, never the time saved; and the root is read once, not in a loop', async ({
    page,
    context,
    baseURL,
  }) => {
    const { root } = await rolledFirstMed(page, context, baseURL, 'fmmark');
    test.skip(root.local_time < '00:05', 'needs a past 00:03 in the circle zone');
    updateRoot(root.id, `scheduled_time = '00:03:00'`);

    const rootReads: string[] = [];
    page.on('request', (r) => {
      if (r.method() === 'GET' && new URL(r.url()).pathname.endsWith(`/events/${root.id}`)) rootReads.push(r.url());
    });
    await reloadToday(page);
    await expect(card(page).getByTestId('mark-it-next-label')).toHaveText(/^12:03\sAM/, { timeout: 20_000 });
    await todaySettled(page);
    await page.waitForTimeout(3000);
    // NEGATIVE (fetch storm): one read for the page load, nothing more while it sits there.
    expect(rootReads.length).toBe(1);

    await card(page).getByTestId('mark-it-button').click();
    await expect(card(page).getByText('Taken by you', { exact: false })).toBeVisible({ timeout: 20_000 });
    const confirmations = () =>
      dbQuery<{ status: string; scheduled_time: string }>(
        `select status, scheduled_time::text as scheduled_time from medication_confirmations
          where event_id = ${sqlStr(root.id)}::uuid`
      );
    await expect.poll(() => confirmations().length).toBe(1);
    expect(confirmations()[0]).toEqual({ status: 'taken', scheduled_time: '00:03:00' });
    // NEGATIVE: never a dose at the time the note was written with.
    expect(confirmations().map((c) => c.scheduled_time)).not.toContain('00:01:00');
    // The Mark it refresh is a bounded refetch, not a loop.
    await page.waitForTimeout(3000);
    expect(rootReads.length).toBeLessThanOrEqual(3);
  });

  test('NEGATIVE: discontinued/paused, made as-needed, moved to a time still ahead today, and deleted medications show no card', async ({
    page,
    context,
    baseURL,
  }) => {
    const { root } = await rolledFirstMed(page, context, baseURL, 'fmneg');

    updateRoot(root.id, `discontinued_at = now()`);
    await reloadToday(page);
    await todaySettled(page);
    await expect(card(page)).toHaveCount(0);

    // Back to active: the card returns (so the hide above was the discontinue, not a broken page).
    updateRoot(root.id, `discontinued_at = null`);
    await reloadToday(page);
    await expect(card(page)).toBeVisible({ timeout: 20_000 });

    updateRoot(root.id, `as_needed = true, scheduled_time = null, recurrence_rule = null`);
    await reloadToday(page);
    await todaySettled(page);
    await expect(card(page)).toHaveCount(0);

    updateRoot(
      root.id,
      `as_needed = false, scheduled_time = ${sqlStr(root.scheduled_time)}::time, recurrence_rule = ${sqlStr(root.recurrence_rule)}`
    );
    await reloadToday(page);
    await expect(card(page)).toBeVisible({ timeout: 20_000 });

    // Still rolled, but moved to a time still AHEAD today: no "Already given today?" (the server would refuse the mark).
    if (root.local_time <= '23:45') {
      updateRoot(root.id, `scheduled_time = ${sqlStr(root.later_time)}::time`);
      await reloadToday(page);
      await todaySettled(page);
      await expect(card(page)).toHaveCount(0);
      updateRoot(root.id, `scheduled_time = ${sqlStr(root.scheduled_time)}::time`);
      await reloadToday(page);
      await expect(card(page)).toBeVisible({ timeout: 20_000 });
    }

    updateRoot(root.id, `deleted_at = now()`);
    await reloadToday(page);
    await todaySettled(page);
    await expect(card(page)).toHaveCount(0);
    await expect(page.getByTestId('mark-it-line')).toHaveCount(0);
  });
});
