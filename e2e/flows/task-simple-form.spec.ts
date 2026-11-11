import type { Locator, Page } from '@playwright/test';
import { test, expect } from '../fixtures';
import { sqlExec } from '../db';
import { checkA11y, fillSimpleDate, fillSimpleTime, refuseZoneSync, unfoldSimpleEnd } from '../helpers';
import { dbQuery, sqlStr } from '../unhappy';
import { cookieLogin, createCircle, createScopedAccount, ownerApi, uniq } from '../unhappy/auth-invites/_helpers';
import { uniqueSuffix } from '../notesFirstClassShared';

// THE NEW / EDIT TASK FORM IN THE SIMPLE STYLE (owner 1.4.0, mockup Task.dc.html, mobile parity), against the
// real backend and database: "What needs doing? / When? / How often? / Who's doing it? / More details", every
// day on the RECIPIENT's calendar and every time on the recipient's clock.
//
// The browser is pinned to America/Denver; the circle's zone is Pacific/Auckland (the owner's, no care-recipient
// account), so the recipient's "Tomorrow" and "7:15 AM" are a different day and clock from the browser's.
// Unit twin: src/components/calendar/__tests__/AddEventModal.taskSimple.test.tsx (+ taskPayloadEquality).

const VIEWER_TZ = 'America/Denver';
const RECIPIENT_TZ = 'Pacific/Auckland';
test.use({ storageState: { cookies: [], origins: [] }, timezoneId: VIEWER_TZ });
// 1.4.0: the account / recipient zone here differs from the browser's on purpose; keep the session-start sync from
// rewriting it (helpers.ts refuseZoneSync).
test.beforeEach(async ({ page }) => {
  await refuseZoneSync(page);
});
test.setTimeout(120_000);

/** The recipient's calendar day `offset` days from today: today in the zone FIRST, then string arithmetic. */
function recipientDay(offset: number): string {
  const today = new Intl.DateTimeFormat('en-CA', {
    timeZone: RECIPIENT_TZ,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(new Date());
  const d = new Date(`${today}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + offset);
  return d.toISOString().slice(0, 10);
}
async function arrange(
  request: import('@playwright/test').APIRequestContext,
  label: string,
  zone: string = RECIPIENT_TZ
) {
  const owner = await createScopedAccount(label);
  sqlExec(`update users set timezone = ${sqlStr(zone)} where id = ${sqlStr(owner.userId)}::uuid;`);
  const session = await ownerApi(request, owner);
  const circleId = await createCircle(session, uniq(label));
  return { owner, circleId };
}

interface Row {
  scheduled_date: string;
  scheduled_time: string | null;
  duration_minutes: number | null;
  recurrence_rule: string | null;
  assigned_to: string | null;
}
function taskRows(circleId: string, title: string): Row[] {
  return dbQuery<Row>(
    `select scheduled_date::text, scheduled_time::text, duration_minutes, recurrence_rule, assigned_to::text
       from calendar_events
      where circle_id = ${sqlStr(circleId)}::uuid and event_type = 'task' and title = ${sqlStr(title)}
        and parent_event_id is null`
  );
}

async function openNewTask(page: Page, circleId: string): Promise<Locator> {
  await page.goto(`/circles/${circleId}/tasks`, { waitUntil: 'domcontentloaded' });
  await expect(page.getByRole('heading', { name: 'Tasks', exact: true })).toBeVisible({ timeout: 20_000 });
  await page.getByRole('button', { name: 'Add task' }).first().click();
  const dialog = page.getByRole('dialog', { name: 'New task' });
  await expect(dialog).toBeVisible();
  return dialog;
}

test('create a task on the recipient\'s tomorrow at 7:15 AM their time, weekly, mine; the edit reopens it the same', async ({
  page,
  context,
  request,
  baseURL,
}, testInfo) => {
  const a = await arrange(request, 'tasksimple');
  await cookieLogin(context, a.owner, baseURL);
  const title = `ZZ_E2E_TASK_SIMPLE_${uniqueSuffix()}`;
  const tomorrow = recipientDay(1);
  try {
    const dialog = await openNewTask(page, a.circleId);
    // The questions, in the build-11 order (When? holds Starts | Repeats until and How often?).
    await expect(dialog.getByRole('heading', { level: 3 })).toHaveText([
      'What needs doing?',
      /^When\?\s*\*$/,
      'What time?',
      "Who's doing it?",
    ]);
    // The Starts tile, holding the recipient's today; Repeats until disabled while it is Once.
    await expect(dialog.locator('#scheduled_date')).toHaveValue(recipientDay(0));
    await expect(dialog.getByTestId('repeats-until-tile')).toBeDisabled();
    await expect(dialog.getByTestId('repeats-until-tile')).toContainText("Doesn't repeat");
    await expect(dialog.getByRole('radio', { name: 'Any time' })).toBeChecked();
    await expect(dialog.getByRole('radio', { name: 'Once' })).toBeChecked();
    await expect(dialog.getByRole('radio', { name: 'Anyone' })).toBeChecked();
    await expect(dialog.getByRole('button', { name: /^More details/ })).toHaveAttribute('aria-expanded', 'false');
    await checkA11y(page, 'task-simple-form-new', testInfo);

    await dialog.locator('#title').fill(title);
    await fillSimpleDate(dialog, 'scheduled_date', tomorrow);
    await fillSimpleTime(dialog, '07:15');
    // From | To are on the recipient's (Auckland) clock; To starts at the default 30 minutes (optional on a task:
    // its picker's "No end" clears it).
    await expect(dialog.getByTestId('task-from-tile')).toContainText('7:15 AM');
    await expect(dialog.getByTestId('task-to-tile')).toContainText('7:45 AM');
    // The caption gives the browser's own clock.
    await expect(dialog.getByTestId('time-zone-caption')).toHaveText(/^Auckland time · .+ your time \(Denver\)$/);
    await dialog.getByRole('radio', { name: 'Every week' }).click();
    await dialog.getByRole('radio', { name: 'Me', exact: true }).click();
    await dialog.getByRole('button', { name: 'Add task' }).click();
    await expect(dialog).toBeHidden({ timeout: 20_000 });

    await expect.poll(() => taskRows(a.circleId, title).length, { timeout: 15_000 }).toBe(1);
    const [row] = taskRows(a.circleId, title);
    expect(row.scheduled_date).toBe(tomorrow);
    expect(row.scheduled_time?.slice(0, 5)).toBe('07:15');
    expect(row.duration_minutes).toBe(30);
    expect(row.recurrence_rule).toBe('weekly');
    expect(row.assigned_to).toBe(a.owner.userId);

    // The edit is the same form, prefilled; an untouched save keeps the row exactly.
    await page.getByRole('button', { name: `Edit "${title}"` }).first().click();
    const editor = page.getByRole('dialog', { name: 'Edit task' });
    await expect(editor).toBeVisible();
    await expect(editor.locator('#title')).toHaveValue(title, { timeout: 15_000 });
    await expect(editor.locator('#scheduled_date')).toHaveValue(tomorrow);
    await expect(editor.getByRole('radio', { name: 'Pick a time' })).toBeChecked();
    await expect(editor.getByTestId('task-from-tile')).toContainText('7:15 AM');
    await expect(editor.locator('#scheduled_time')).toHaveValue('07:15');
    await expect(editor.locator('#endTime')).toHaveValue('07:45');
    await expect(editor.getByRole('radio', { name: 'Every week' })).toBeChecked();
    await expect(editor.getByRole('radio', { name: 'Me', exact: true })).toBeChecked();
    await checkA11y(page, 'task-simple-form-edit', testInfo);
    await editor.getByRole('button', { name: 'Save changes' }).click();
    await expect(editor).toBeHidden({ timeout: 20_000 });
    await expect.poll(() => taskRows(a.circleId, title)[0], { timeout: 15_000 }).toEqual(row);
  } finally {
    sqlExec(`delete from calendar_events where circle_id = ${sqlStr(a.circleId)}::uuid and title = ${sqlStr(title)};`);
  }
});

/** Minutes the recipient's clock runs ahead of the viewer's at the instant `day` 12:00Z (wrapped to 0..1439). */
function recipientAheadMinutes(day: string): number {
  const at = new Date(`${day}T12:00:00Z`);
  const clock = (zone: string) => {
    const p = Object.fromEntries(
      new Intl.DateTimeFormat('en-US', { timeZone: zone, hourCycle: 'h23', hour: 'numeric', minute: 'numeric' })
        .formatToParts(at)
        .map((x) => [x.type, x.value])
    );
    return (+p.hour % 24) * 60 + +p.minute;
  };
  return (((clock(RECIPIENT_TZ) - clock(VIEWER_TZ)) % 1440) + 1440) % 1440;
}

test('"2 hrs" on a start that is the BROWSER\'s 10:30 PM saves the full 120 minutes (was capped at the browser\'s 23:59: 89)', async ({
  page,
  context,
  request,
  baseURL,
}) => {
  const a = await arrange(request, 'taskdur');
  await cookieLogin(context, a.owner, baseURL);
  const title = `ZZ_E2E_TASK_DURATION_${uniqueSuffix()}`;
  const tomorrow = recipientDay(1);
  // The recipient clock that reads as the browser's 22:30 (today: Auckland 18:30 = Denver 22:30).
  const total = (22 * 60 + 30 + recipientAheadMinutes(tomorrow)) % 1440;
  const start = `${String(Math.floor(total / 60)).padStart(2, '0')}:${String(total % 60).padStart(2, '0')}`;
  try {
    const dialog = await openNewTask(page, a.circleId);
    await dialog.locator('#title').fill(title);
    await fillSimpleDate(dialog, 'scheduled_date', tomorrow);
    await fillSimpleTime(dialog, start);
    // No length chips (build 11): "2 hrs" is the To tile two hours after From (the recipient clock).
    const endTotal = (Number(start.slice(0, 2)) * 60 + Number(start.slice(3)) + 120) % 1440;
    const end = `${String(Math.floor(endTotal / 60)).padStart(2, '0')}:${String(endTotal % 60).padStart(2, '0')}`;
    await (await unfoldSimpleEnd(dialog)).fill(end);
    await dialog.getByRole('button', { name: 'Add task' }).click();
    await expect(dialog).toBeHidden({ timeout: 20_000 });

    await expect.poll(() => taskRows(a.circleId, title).length, { timeout: 15_000 }).toBe(1);
    const [row] = taskRows(a.circleId, title);
    expect(row.scheduled_date).toBe(tomorrow);
    expect(row.scheduled_time?.slice(0, 5)).toBe(start);
    expect(row.duration_minutes).toBe(120);
  } finally {
    sqlExec(`delete from calendar_events where circle_id = ${sqlStr(a.circleId)}::uuid and title = ${sqlStr(title)};`);
  }
});

test('same zone: 10:30 PM + "2 hrs" saves the full 120 minutes, carried past midnight (mobile parity; was 89)', async ({
  page,
  context,
  request,
  baseURL,
}) => {
  // Circle in the browser's own zone (Denver): no recipient/viewer gap. The phone saves 120 here; web used to
  // keep the legacy 23:59 cap for the same zone and saved 89.
  const a = await arrange(request, 'taskdursame', VIEWER_TZ);
  await cookieLogin(context, a.owner, baseURL);
  const title = `ZZ_E2E_TASK_DURATION_SAME_${uniqueSuffix()}`;
  const today = new Intl.DateTimeFormat('en-CA', { timeZone: VIEWER_TZ }).format(new Date());
  const d = new Date(`${today}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + 1);
  const tomorrow = d.toISOString().slice(0, 10);
  try {
    const dialog = await openNewTask(page, a.circleId);
    await dialog.locator('#title').fill(title);
    await fillSimpleDate(dialog, 'scheduled_date', tomorrow);
    await fillSimpleTime(dialog, '22:30');
    // No length chips (build 11): the To tile, two hours on, past midnight.
    await (await unfoldSimpleEnd(dialog)).fill('00:30');
    await dialog.getByRole('button', { name: 'Add task' }).click();
    await expect(dialog).toBeHidden({ timeout: 20_000 });

    await expect.poll(() => taskRows(a.circleId, title).length, { timeout: 15_000 }).toBe(1);
    const [row] = taskRows(a.circleId, title);
    expect(row.scheduled_date).toBe(tomorrow);
    expect(row.scheduled_time?.slice(0, 5)).toBe('22:30');
    expect(row.duration_minutes).toBe(120);

    // The edit reopens the past-midnight end and an untouched save keeps the full length.
    await page.getByRole('button', { name: `Edit "${title}"` }).first().click();
    const editor = page.getByRole('dialog', { name: 'Edit task' });
    await expect(editor).toBeVisible();
    await expect(editor.locator('#title')).toHaveValue(title, { timeout: 15_000 });
    await editor.getByRole('button', { name: 'Save changes' }).click();
    await expect(editor).toBeHidden({ timeout: 20_000 });
    await expect.poll(() => taskRows(a.circleId, title)[0], { timeout: 15_000 }).toEqual(row);
  } finally {
    sqlExec(`delete from calendar_events where circle_id = ${sqlStr(a.circleId)}::uuid and title = ${sqlStr(title)};`);
  }
});

test('the task To is optional: its × clears the default to "No end" and the task saves without a length', async ({
  page,
  context,
  request,
  baseURL,
}) => {
  const a = await arrange(request, 'tasknoend');
  await cookieLogin(context, a.owner, baseURL);
  const title = `ZZ_E2E_TASK_NOEND_${uniqueSuffix()}`;
  const tomorrow = recipientDay(1);
  try {
    const dialog = await openNewTask(page, a.circleId);
    await dialog.locator('#title').fill(title);
    await fillSimpleDate(dialog, 'scheduled_date', tomorrow);
    await fillSimpleTime(dialog, '09:00');
    const to = dialog.getByTestId('task-to-tile');
    await expect(to).toContainText('9:30 AM');
    // Clear in the tile (Fix13): its own × button, 44px.
    const clear = dialog.getByRole('button', { name: 'Clear end time' });
    const box = await clear.boundingBox();
    expect(box && box.width >= 44 && box.height >= 44).toBe(true);
    await clear.click();
    await expect(to).toContainText('No end');
    await expect(clear).toHaveCount(0);
    await dialog.getByRole('button', { name: 'Add task' }).click();
    await expect(dialog).toBeHidden({ timeout: 20_000 });
    await expect.poll(() => taskRows(a.circleId, title).length, { timeout: 15_000 }).toBe(1);
    const [row] = taskRows(a.circleId, title);
    expect(row.scheduled_time?.slice(0, 5)).toBe('09:00');
    expect(row.duration_minutes).toBeNull();
  } finally {
    sqlExec(`delete from calendar_events where circle_id = ${sqlStr(a.circleId)}::uuid and title = ${sqlStr(title)};`);
  }
});

test.describe('at phone width', () => {
  test.use({ viewport: { width: 375, height: 812 } });

  test('the tile rows wrap inside the dialog: no tile wider than its row, no sideways scroll', async ({
    page,
    context,
    request,
    baseURL,
  }) => {
    const a = await arrange(request, 'tasksimple375');
    await cookieLogin(context, a.owner, baseURL);
    const dialog = await openNewTask(page, a.circleId);
    // What time? (Pick a time | Any time), the date tiles and the How often grid.
    await dialog.getByRole('radio', { name: 'Pick a time' }).click();
    for (const id of ['when-date-tiles', 'task-from-to']) {
      const row = dialog.getByTestId(id);
      const box = await row.boundingBox();
      expect(box).not.toBeNull();
      for (const tile of await row.locator('button').all()) {
        const t = await tile.boundingBox();
        expect(t!.x).toBeGreaterThanOrEqual(box!.x - 1);
        expect(t!.x + t!.width).toBeLessThanOrEqual(box!.x + box!.width + 1);
        expect(t!.height).toBeGreaterThanOrEqual(44);
      }
    }
    const scroller = dialog.locator('#add-event-form').locator('xpath=..');
    expect(await scroller.evaluate((el) => el.scrollWidth <= el.clientWidth + 1)).toBe(true);
  });
});
