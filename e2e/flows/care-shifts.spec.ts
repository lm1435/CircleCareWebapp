import type { APIRequestContext, Page } from '@playwright/test';
import { test, expect } from '../fixtures';
import { checkA11y } from '../helpers';
import {
  authUser,
  cookieLogin,
  createCircle,
  createScopedAccount,
  uniq,
} from '../unhappy/auth-invites/_helpers';
import { apiSession, dbQuery, sqlStr, type ApiSession } from '../unhappy';
import { sqlExec } from '../db';
import { circleTimezone, dateInTz } from '../notesFirstClassShared';
import { ACCOUNT_PASSWORD, createAccount, runScopedEmail } from '../isolation';
import { addMembership, createRunAccount, ensureManagerSwitchOn, waitForViewer } from '../managerRole';

// Care shifts T9 (docs/plans/care-shifts.md): the Schedule | Shifts control, the
// shift create flow with "Add the next shift", take / drop by a member, the
// free-circle teaser, and the roles that see nothing. Axe on the Shifts view and
// every dialog, in light and dark. Run-scoped accounts and circles throughout.

test.use({ storageState: { cookies: [], origins: [] } });
test.setTimeout(150_000);

interface Scene {
  session: ApiSession;
  circleId: string;
  tz: string;
  today: string;
  owner: Awaited<ReturnType<typeof createScopedAccount>>;
}

/** A premium owner with a fresh circle (premium tier = the owner's). */
async function premiumScene(request: APIRequestContext): Promise<Scene> {
  const owner = await createScopedAccount('shifts');
  const session = await apiSession(request, owner);
  const circleId = await createCircle(session, uniq('shifts'));
  const tz = await circleTimezone(session, circleId);
  return { session, circleId, tz, today: dateInTz(tz, 0), owner };
}

async function seedShift(
  s: Scene,
  over: Record<string, unknown> = {}
): Promise<{ id: string }> {
  const res = await s.session.post(`/api/circles/${s.circleId}/events`, {
    event_type: 'shift',
    title: 'Night',
    scheduled_date: s.today,
    scheduled_time: '20:00',
    duration_minutes: 720,
    reminder_lead_minutes: 60,
    ...over,
  });
  expect(res.ok(), `seed shift: ${await res.text()}`).toBeTruthy();
  return ((await res.json()) as { data: { event: { id: string } } }).data.event;
}

async function openShifts(page: Page, circleId: string, view: 'Day' | 'Week' | 'Month' = 'Week'): Promise<void> {
  await page.goto(`/circles/${circleId}/calendar`, { waitUntil: 'domcontentloaded' });
  const modes = page.getByRole('tablist', { name: 'Calendar mode' });
  await expect(modes).toBeVisible({ timeout: 20_000 });
  await modes.getByRole('tab', { name: /^Shifts/ }).click();
  await expect(modes.getByRole('tab', { name: /^Shifts/ })).toHaveAttribute('aria-selected', 'true');
  if (view !== 'Week') {
    await page.getByRole('tablist', { name: 'Calendar view' }).getByRole('tab', { name: view }).click();
  }
}

function sqlShiftRows(
  circleId: string
): Array<{ title: string; assigned_to: string | null; parent: string | null; reminder: number | null }> {
  return dbQuery(`
    select title, assigned_to::text as assigned_to, parent_event_id::text as parent,
           reminder_lead_minutes as reminder
      from calendar_events
     where circle_id = ${sqlStr(circleId)}::uuid and event_type = 'shift'
     order by created_at`);
}

test.describe('premium owner', () => {
  let s: Scene;
  test.beforeEach(async ({ request, context, baseURL }) => {
    s = await premiumScene(request);
    await cookieLogin(context, s.owner, baseURL);
  });

  test('creates a daily night shift, adds the next one from the saved sheet, and sees both on Day', async ({
    page,
  }, testInfo) => {
    await openShifts(page, s.circleId);

    // Empty state (no shifts yet) + axe.
    const empty = page.getByTestId('shifts-empty-state');
    await expect(empty.getByRole('heading', { name: 'Share the care, shift by shift' })).toBeVisible({
      timeout: 20_000,
    });
    await expect(page.getByTestId('shifts-open-badge')).toHaveCount(0);
    await checkA11y(page, 'shifts-empty-light', testInfo);

    await empty.getByRole('button', { name: 'Add a shift' }).click();
    const form = page.getByRole('dialog', { name: 'New shift' });
    await expect(form.getByText(/^Who's with E2E/)).toBeVisible();
    await form.getByLabel(/^Name/).fill('Night');
    await form.getByLabel(/^Starts/).fill('20:00');
    await form.getByLabel(/^Ends/).fill('08:00');
    await expect(form.getByText('next day')).toBeVisible();
    await expect(form.getByTestId('shift-duration')).toHaveText('12 hours');
    // DETERMINISTIC COUNTS: the series start TOMORROW (recipient zone), so no
    // occurrence can have ended "now" whatever time the suite runs: the badge
    // window is today .. today+6, i.e. exactly 6 days x 2 series = 12 open.
    const tomorrow = dateInTz(s.tz, 1);
    await form.locator('#shift_date').fill(tomorrow);
    await form.getByLabel('Repeats').selectOption('daily');
    await checkA11y(page, 'shifts-form-light', testInfo);
    await form.getByRole('button', { name: 'Save shift' }).click();

    // Saved sheet.
    const saved = page.getByRole('dialog', { name: '"Night" saved' });
    await expect(saved).toBeVisible({ timeout: 20_000 });
    await expect(saved.getByText('8:00 PM – 8:00 AM, every day. Open for anyone to take.')).toBeVisible();
    await checkA11y(page, 'shifts-saved-light', testInfo);
    const addNext = saved.getByRole('button', { name: /Add the next shift/ });
    await expect(addNext).toContainText('Starts at 8:00 AM · every day');

    // Add the next: pre-filled start = previous end, repeat + reminder kept; name and end empty.
    await addNext.click();
    const second = page.getByRole('dialog', { name: 'New shift' });
    await expect(second.getByLabel(/^Starts/)).toHaveValue('08:00');
    await expect(second.getByLabel(/^Name/)).toHaveValue('');
    await expect(second.getByLabel(/^Ends/)).toHaveValue('');
    await expect(second.getByLabel('Repeats')).toHaveValue('daily');
    await expect(second.locator('#shift_date')).toHaveValue(tomorrow);
    await second.getByLabel(/^Name/).fill('Day');
    await second.getByLabel(/^Ends/).fill('20:00');
    await second.getByRole('button', { name: 'Save shift' }).click();
    const savedTwo = page.getByRole('dialog', { name: '"Day" saved' });
    await expect(savedTwo).toBeVisible({ timeout: 20_000 });
    await savedTwo.getByRole('button', { name: 'Done' }).click();

    // Persisted as two OPEN daily series.
    const rows = sqlShiftRows(s.circleId).filter((r) => !r.parent);
    expect(rows.map((r) => r.title).sort()).toEqual(['Day', 'Night']);
    expect(rows.every((r) => r.assigned_to === null)).toBe(true);

    // Shifts view: the toggle carries no open count (owner decision 2026-10-24).
    await expect(page.getByTestId('shifts-open-badge')).toHaveCount(0);
    await expect(page.getByRole('tab', { name: 'Shifts', exact: true })).toBeVisible({ timeout: 20_000 });
    await page.getByRole('tablist', { name: 'Calendar view' }).getByRole('tab', { name: 'Day' }).click();
    // Today holds nothing (the series start tomorrow); the shifts exist tomorrow, so
    // this is the plain "No shifts on this day." line, then step to tomorrow.
    await expect(page.getByText('No shifts on this day.')).toBeVisible();
    await page.getByRole('button', { name: 'Next day', exact: true }).click();
    const list = page.getByTestId('shifts-day-list');
    await expect(list.getByTestId('shift-card')).toHaveCount(2);
    await expect(page.getByTestId('day-view-summary')).toHaveText('2 shifts · 2 open.');
    const cards = await list.getByTestId('shift-card').allTextContents();
    expect(cards[0]).toContain('Day'); // sorted by start time: 08:00 before 20:00
    expect(cards[1]).toContain('Night');
    await checkA11y(page, 'shifts-day-light', testInfo);

    // Detail dialog + axe.
    await list.getByRole('button', { name: /^Day, 8:00 AM to 8:00 PM, open$/ }).click();
    const detail = page.getByRole('dialog', { name: 'Day' });
    await expect(detail.getByTestId('shift-detail-repeat')).toHaveText('Daily');
    await expect(detail.getByTestId('shift-detail-who')).toHaveText('Nobody yet');
    await checkA11y(page, 'shifts-detail-light', testInfo);
    await detail.getByRole('button', { name: 'Close' }).last().click();

    // Week and Month renderers.
    await page.getByRole('tablist', { name: 'Calendar view' }).getByRole('tab', { name: 'Week' }).click();
    await expect(page.getByTestId('shifts-week-view')).toBeVisible();
    // Per-day count line; ONE Add shift button for the week.
    await expect(page.getByTestId('shifts-week-day-summary').first()).toHaveText('2 shifts · 2 open');
    await expect(page.getByTestId('shifts-week-view').getByRole('button', { name: 'Add shift' })).toHaveCount(1);
    await checkA11y(page, 'shifts-week-light', testInfo);
    await page.getByRole('tablist', { name: 'Calendar view' }).getByRole('tab', { name: 'Month' }).click();
    const grid = page.getByRole('grid', { name: 'Shifts month calendar' });
    await expect(grid.locator('[data-shift-dots="open"]').first()).toBeVisible();
    await expect(page.getByRole('list', { name: 'Shifts key' })).toBeVisible();
    await checkA11y(page, 'shifts-month-light', testInfo);

    // Schedule never shows a shift.
    await page.getByRole('tablist', { name: 'Calendar mode' }).getByRole('tab', { name: 'Schedule' }).click();
    await expect(page.getByTestId('shift-card')).toHaveCount(0);
    await expect(page.getByText('Night', { exact: true })).toHaveCount(0);
  });

  test('the + New menu offers Shift and opens the same form', async ({ page }) => {
    await page.goto(`/circles/${s.circleId}/calendar`, { waitUntil: 'domcontentloaded' });
    await expect(page.getByRole('tablist', { name: 'Calendar mode' })).toBeVisible({ timeout: 20_000 });
    // The nav pill's NEW cell (below xl) or the sidebar's button (xl).
    const nav = page.getByTestId('floating-nav');
    const newButton = (await nav.isVisible()) ? nav.getByRole('button', { name: 'New' }) : page.getByRole('complementary').getByRole('button', { name: 'New' });
    await newButton.click();
    await page.getByRole('menuitem', { name: 'Shift' }).click();
    await expect(page.getByRole('dialog', { name: 'New shift' })).toBeVisible();
  });

  test.describe('dark', () => {
    test.use({ colorScheme: 'dark' });

    test('axe: Shifts Day / Month and the dialogs (dark)', async ({ page }, testInfo) => {
      await seedShift(s, { recurrence_rule: 'daily' });
      await openShifts(page, s.circleId, 'Day');
      const list = page.getByTestId('shifts-day-list');
      await expect(list.getByTestId('shift-card').first()).toBeVisible({ timeout: 20_000 });
      await checkA11y(page, 'shifts-day-dark', testInfo);

      await list.getByRole('button', { name: 'Take Night' }).click();
      const take = page.getByRole('dialog', { name: 'Take "Night"' });
      await expect(take).toBeVisible();
      await checkA11y(page, 'shifts-take-dark', testInfo);
      await take.getByRole('button', { name: 'Cancel' }).click();

      await page.getByRole('tablist', { name: 'Calendar view' }).getByRole('tab', { name: 'Month' }).click();
      await expect(page.getByRole('grid', { name: 'Shifts month calendar' })).toBeVisible();
      await checkA11y(page, 'shifts-month-dark', testInfo);

      await page.getByRole('tablist', { name: 'Calendar view' }).getByRole('tab', { name: 'Day' }).click();
      await page.getByRole('button', { name: 'Add shift' }).last().click();
      await expect(page.getByRole('dialog', { name: 'New shift' })).toBeVisible();
      await checkA11y(page, 'shifts-form-dark', testInfo);
    });
  });
});

test.describe('a member takes and drops a shift', () => {
  test('Just this one, then drop it; and losing a take race names the winner', async ({
    request,
    browser,
    baseURL,
  }, testInfo) => {
    const s = await premiumScene(request);
    const member = await createRunAccount('shiftmember', 'Mia', 'Member');
    addMembership(s.circleId, member.userId, 'member');
    await seedShift(s, { recurrence_rule: 'daily' });
    await seedShift(s, { title: 'Weekend cover', scheduled_time: '09:00', duration_minutes: 480 });

    const context = await browser.newContext();
    await cookieLogin(context, member, baseURL);
    const page = await context.newPage();
    try {
      await openShifts(page, s.circleId, 'Day');
      const list = page.getByTestId('shifts-day-list');
      await expect(list.getByTestId('shift-card')).toHaveCount(2, { timeout: 20_000 });

      // Take "Just this one" of the repeating night shift.
      await list.getByRole('button', { name: 'Take Night' }).click();
      const take = page.getByRole('dialog', { name: 'Take "Night"' });
      await expect(take.getByRole('radio', { name: /Just this one/ })).toBeChecked();
      await expect(take.getByRole('radio', { name: /This and every future one/ })).toBeVisible();
      // The reminder is a picker starting at the shift's own value; the taker may change it.
      const reminder = take.getByRole('combobox', { name: 'Reminder' });
      await expect(reminder).toHaveValue('60');
      await expect(reminder.locator('option')).toHaveText(['Off', '1 hour', '2 hours', '4 hours', '1 day']);
      await checkA11y(page, 'shifts-take-light', testInfo);
      await reminder.selectOption({ label: '4 hours' });
      await take.getByRole('button', { name: 'Take shift' }).click();
      await expect(page.getByText('You\'re on the shift "Night".')).toBeVisible({ timeout: 20_000 });

      const night = list.getByRole('button', { name: /^Night, 8:00 PM to 8:00 AM, next day, you are on this shift$/ });
      await expect(night).toBeVisible();
      await expect(list.locator('[data-shift-state="filled"]')).toHaveCount(1);
      // Only today's occurrence was taken: tomorrow's is still open.
      const rows = sqlShiftRows(s.circleId);
      expect(rows.filter((r) => r.assigned_to === member.userId)).toHaveLength(1);
      // The reminder picked at take time landed on the claimed row only.
      expect(rows.find((r) => r.assigned_to === member.userId)?.reminder).toBe(240);
      expect(rows.find((r) => r.assigned_to === null && r.title === 'Night' && r.parent === null)?.reminder ?? 60).toBe(60);
      await page.getByRole('button', { name: 'Next day', exact: true }).click();
      await expect(
        page.getByTestId('shifts-day-list').getByRole('button', { name: 'Take Night' })
      ).toBeVisible();
      await page.getByRole('button', { name: 'Previous day', exact: true }).click();

      // Drop it again from the detail.
      await night.click();
      const detail = page.getByRole('dialog', { name: 'Night' });
      // Took "Just this one": the detail says so, and Drop asks no "this / future" question.
      await expect(detail.getByTestId('shift-detail-who')).toHaveText('You · this day only');
      await detail.getByRole('button', { name: 'Drop shift' }).click();
      const confirm = page.getByRole('dialog', { name: 'Drop this shift?' });
      await expect(confirm.getByRole('radio')).toHaveCount(0);
      await checkA11y(page, 'shifts-drop-light', testInfo);
      await confirm.getByRole('button', { name: 'Drop shift' }).click();
      await expect(page.getByText('You dropped "Night". It\'s open again.')).toBeVisible({
        timeout: 20_000,
      });
      await expect(
        page.getByTestId('shifts-day-list').getByRole('button', { name: 'Take Night' })
      ).toBeVisible();
      expect(sqlShiftRows(s.circleId).filter((r) => r.assigned_to === member.userId)).toHaveLength(0);

      // The owner takes "Weekend cover" first (API), then the member presses Take on a stale card.
      const weekend = (
        dbQuery<{ id: string }>(
          `select id::text from calendar_events where circle_id = ${sqlStr(s.circleId)}::uuid and title = 'Weekend cover'`
        )[0]
      ).id;
      const taken = await s.session.post(`/api/circles/${s.circleId}/events/${weekend}/shift/take`, {
        scope: 'occurrence',
        scheduledDate: s.today,
      });
      expect(taken.ok(), await taken.text()).toBeTruthy();
      await page.getByTestId('shifts-day-list').getByRole('button', { name: 'Take Weekend cover' }).click();
      await page.getByRole('dialog', { name: 'Take "Weekend cover"' }).getByRole('button', { name: 'Take shift' }).click();
      await expect(page.getByText(/^.+ just took this shift\.$/)).toBeVisible({ timeout: 20_000 });
      // The list refetched: the winner is on it, no Take left.
      await expect(
        page.getByTestId('shifts-day-list').getByRole('button', { name: 'Take Weekend cover' })
      ).toHaveCount(0, { timeout: 20_000 });
    } finally {
      await context.close();
    }
  });
});

test.describe('free circles', () => {
  async function freeScene(request: APIRequestContext) {
    const email = runScopedEmail(uniq('shfree'));
    await createAccount(email, 'free');
    const owner = { email, password: ACCOUNT_PASSWORD, userId: authUser(email).id };
    const session = await apiSession(request, owner);
    const circleId = await createCircle(session, uniq('shfree'));
    return { owner, session, circleId };
  }

  test('the free OWNER gets the control; Shifts opens the teaser, Not now closes it, See Premium goes to /upgrade', async ({
    request,
    context,
    baseURL,
    page,
  }, testInfo) => {
    const f = await freeScene(request);
    await cookieLogin(context, f.owner, baseURL);
    await page.goto(`/circles/${f.circleId}/calendar`, { waitUntil: 'domcontentloaded' });
    const modes = page.getByRole('tablist', { name: 'Calendar mode' });
    await expect(modes).toBeVisible({ timeout: 20_000 });
    await modes.getByRole('tab', { name: /^Shifts/ }).click();
    const teaser = page.getByRole('dialog', { name: 'Share the care, shift by shift' });
    await expect(teaser).toBeVisible();
    await expect(teaser.getByText('Premium', { exact: true })).toBeVisible();
    await checkA11y(page, 'shifts-teaser-light', testInfo);
    // Schedule stays selected; nothing about shifts was fetched or shown.
    await expect(modes.getByRole('tab', { name: 'Schedule' })).toHaveAttribute('aria-selected', 'true');
    await teaser.getByRole('button', { name: 'Not now' }).click();
    await expect(teaser).toHaveCount(0);

    await modes.getByRole('tab', { name: /^Shifts/ }).click();
    await page.getByRole('dialog', { name: 'Share the care, shift by shift' }).getByRole('button', { name: 'See Premium' }).click();
    await expect(page).toHaveURL(/\/upgrade/);
    await expect(page.getByText('shift by shift.')).toBeVisible({ timeout: 20_000 });
  });

  test('the free OWNER also sees Shift in the + New menu, and it opens the teaser', async ({
    request,
    context,
    baseURL,
    page,
  }) => {
    const f = await freeScene(request);
    await cookieLogin(context, f.owner, baseURL);
    await page.goto(`/circles/${f.circleId}/calendar`, { waitUntil: 'domcontentloaded' });
    await expect(page.getByRole('tablist', { name: 'Calendar view' })).toBeVisible({ timeout: 20_000 });
    const nav = page.getByTestId('floating-nav');
    const newButton = (await nav.isVisible()) ? nav.getByRole('button', { name: 'New' }) : page.getByRole('complementary').getByRole('button', { name: 'New' });
    await newButton.click();
    await page.getByRole('menuitem', { name: 'Shift' }).click();
    await expect(page.getByRole('dialog', { name: 'Share the care, shift by shift' })).toBeVisible();
    await expect(page.getByRole('dialog', { name: 'New shift' })).toHaveCount(0);
  });

  test('a free member and a free manager see no toggle and no Shift in the New menu', async ({
    request,
    browser,
    baseURL,
  }) => {
    const f = await freeScene(request);
    ensureManagerSwitchOn();
    const member = await createRunAccount('shfreemember', 'Fran', 'Member');
    addMembership(f.circleId, member.userId, 'member');
    const manager = await createRunAccount('shfreemgr', 'Max', 'Manager');
    addMembership(f.circleId, manager.userId, 'manager');
    await waitForViewer(request, manager, f.circleId, (v) => v.viewer_role === 'manager');

    for (const who of [member, manager]) {
      const context = await browser.newContext();
      await cookieLogin(context, who, baseURL);
      const page = await context.newPage();
      try {
        await page.goto(`/circles/${f.circleId}/calendar`, { waitUntil: 'domcontentloaded' });
        // The screen is the unchanged Schedule: the range control is there, the mode control is not.
        await expect(page.getByRole('tablist', { name: 'Calendar view' })).toBeVisible({ timeout: 20_000 });
        await expect(page.getByRole('tablist', { name: 'Calendar mode' })).toHaveCount(0);
        const nav = page.getByTestId('floating-nav');
        const newButton = (await nav.isVisible()) ? nav.getByRole('button', { name: 'New' }) : page.getByRole('complementary').getByRole('button', { name: 'New' });
        await newButton.click();
        await expect(page.getByRole('menuitem', { name: 'Task' })).toBeVisible();
        await expect(page.getByRole('menuitem', { name: 'Shift' })).toHaveCount(0);
      } finally {
        await context.close();
      }
    }
  });
});

test.describe('lapsed Premium: shifts stay visible, read-only', () => {
  /** A premium owner with two shifts (one open, one the owner's), downgraded to free afterwards. */
  async function lapsedScene(request: APIRequestContext): Promise<Scene> {
    const s = await premiumScene(request);
    const tomorrow = dateInTz(s.tz, 1);
    await seedShift(s, { title: 'Night', scheduled_date: tomorrow });
    await seedShift(s, {
      title: 'Morning',
      scheduled_date: tomorrow,
      scheduled_time: '08:00',
      duration_minutes: 360,
      assigned_to: s.owner.userId,
    });
    sqlExec(`update public.users set plan_tier = 'free' where id = ${sqlStr(s.owner.userId)}::uuid;`);
    return s;
  }

  test('the OWNER keeps the Shifts view with a Renew notice; no write control anywhere; Renew goes to /upgrade', async ({
    request,
    context,
    baseURL,
    page,
  }, testInfo) => {
    const s = await lapsedScene(request);
    await cookieLogin(context, s.owner, baseURL);
    await openShifts(page, s.circleId);

    // Not the teaser: the lists are there, with the notice.
    await expect(page.getByRole('dialog', { name: 'Share the care, shift by shift' })).toHaveCount(0);
    const week = page.getByTestId('shifts-week-view');
    await expect(week).toBeVisible({ timeout: 20_000 });
    await expect(week.getByRole('button', { name: /^Night, .*open/ })).toBeVisible();
    const notice = page.getByTestId('shifts-readonly-notice');
    await expect(notice).toContainText('Premium has ended. Your shifts are read-only.');
    await checkA11y(page, 'shifts-readonly-light', testInfo);

    // Every write control is gone.
    await expect(page.getByRole('button', { name: 'Add shift' })).toHaveCount(0);
    await expect(week.getByRole('button', { name: /^Take/ })).toHaveCount(0);
    await week.getByRole('button', { name: /^Morning, / }).click();
    const detail = page.getByRole('dialog', { name: 'Morning' });
    await expect(detail.getByTestId('shift-detail-who')).toBeVisible();
    for (const name of ['Drop shift', 'Assign', 'Edit', 'Delete']) {
      await expect(detail.getByRole('button', { name })).toHaveCount(0);
    }
    await page.keyboard.press('Escape');

    // The + New menu no longer offers Shift.
    const nav = page.getByTestId('floating-nav');
    const newButton = (await nav.isVisible())
      ? nav.getByRole('button', { name: 'New' })
      : page.getByRole('complementary').getByRole('button', { name: 'New' });
    await newButton.click();
    await expect(page.getByRole('menuitem', { name: 'Task' })).toBeVisible();
    await expect(page.getByRole('menuitem', { name: 'Shift' })).toHaveCount(0);
    await page.keyboard.press('Escape');

    // Renew Premium -> the paywall.
    await notice.getByRole('button', { name: 'Renew Premium' }).click();
    await expect(page).toHaveURL(/\/upgrade/);
  });

  test('a MEMBER keeps the view with the plain notice (no Renew), and the server still refuses a take', async ({
    request,
    browser,
    baseURL,
  }) => {
    const s = await lapsedScene(request);
    const member = await createRunAccount('shlapsedmember', 'Lia', 'Member');
    addMembership(s.circleId, member.userId, 'member');

    const context = await browser.newContext();
    await cookieLogin(context, member, baseURL);
    const page = await context.newPage();
    try {
      await openShifts(page, s.circleId);
      const week = page.getByTestId('shifts-week-view');
      await expect(week).toBeVisible({ timeout: 20_000 });
      await expect(page.getByTestId('shifts-readonly-notice')).toContainText('Shifts are read-only right now.');
      await expect(page.getByRole('button', { name: 'Renew Premium' })).toHaveCount(0);
      await expect(page.getByRole('button', { name: 'Add shift' })).toHaveCount(0);
      await expect(week.getByRole('button', { name: /^Take/ })).toHaveCount(0);
    } finally {
      await context.close();
    }

    // Defense in depth: the write itself is gated (403 for a member of a lapsed circle).
    const memberSession = await apiSession(request, member);
    const open = sqlShiftRows(s.circleId).find((r) => r.title === 'Night');
    expect(open).toBeTruthy();
    const night = dbQuery<{ id: string; scheduled_date: string }>(`
      select id::text, scheduled_date::text from calendar_events
       where circle_id = ${sqlStr(s.circleId)}::uuid and event_type = 'shift' and title = 'Night'`)[0];
    const res = await memberSession.post(
      `/api/circles/${s.circleId}/events/${night.id}/shift/take`,
      { scope: 'occurrence', scheduledDate: night.scheduled_date }
    );
    // A member of a lapsed circle is refused with 403 (never the owner's 402 paywall).
    expect(res.status()).toBe(403);
    expect(((await res.json()) as { error: { code: string } }).error.code).toBe('SUBSCRIPTION_REQUIRED');
    expect(sqlShiftRows(s.circleId).find((r) => r.title === 'Night')?.assigned_to).toBeNull();
    // ...while the OWNER's refusal is the 402 the paywall hangs off.
    const ownerRes = await s.session.post(
      `/api/circles/${s.circleId}/events/${night.id}/shift/take`,
      { scope: 'occurrence', scheduledDate: night.scheduled_date }
    );
    expect(ownerRes.status()).toBe(402);
  });
});
