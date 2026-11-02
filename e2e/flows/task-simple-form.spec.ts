import type { Locator, Page } from '@playwright/test';
import { test, expect } from '../fixtures';
import { sqlExec } from '../db';
import { checkA11y } from '../helpers';
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
function shortDay(day: string): string {
  return new Intl.DateTimeFormat('en-US', { timeZone: 'UTC', weekday: 'short', month: 'short', day: 'numeric' }).format(
    new Date(`${day}T12:00:00Z`)
  );
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
    // The questions, in the mockup's order.
    await expect(dialog.getByRole('heading', { level: 3 })).toHaveText([
      'What needs doing?',
      'When?',
      'How often?',
      "Who's doing it?",
    ]);
    const when = dialog.getByRole('radiogroup', { name: 'When?' });
    await expect(when.getByRole('radio', { name: `Today, ${shortDay(recipientDay(0))}` })).toBeChecked();
    await expect(dialog.getByRole('radio', { name: 'Any time' })).toBeChecked();
    await expect(dialog.getByRole('radio', { name: 'Once' })).toBeChecked();
    await expect(dialog.getByRole('radio', { name: 'Anyone' })).toBeChecked();
    await expect(dialog.getByRole('button', { name: /^More details/ })).toHaveAttribute('aria-expanded', 'false');
    await checkA11y(page, 'task-simple-form-new', testInfo);

    await dialog.locator('#title').fill(title);
    await when.getByRole('radio', { name: `Tomorrow, ${shortDay(tomorrow)}` }).click();
    await dialog.getByRole('button', { name: 'Pick a time' }).click();
    await expect(dialog.getByLabel(/^Time in Auckland/)).toBeVisible();
    await dialog.locator('#scheduled_time').fill('07:15');
    await expect(dialog.getByRole('button', { name: 'Pick a time, 7:15 AM' })).toBeVisible();
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
    await expect(editor.getByRole('radio', { name: `Tomorrow, ${shortDay(tomorrow)}` })).toBeChecked();
    await expect(editor.getByRole('button', { name: 'Pick a time, 7:15 AM' })).toBeVisible();
    await expect(editor.locator('#scheduled_time')).toHaveValue('07:15');
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
    await dialog.getByRole('radiogroup', { name: 'When?' }).getByRole('radio', { name: `Tomorrow, ${shortDay(tomorrow)}` }).click();
    await dialog.getByRole('button', { name: 'Pick a time' }).click();
    await dialog.locator('#scheduled_time').fill(start);
    await dialog.getByRole('button', { name: /^More details/ }).click();
    await dialog.getByRole('radio', { name: '2 hrs' }).click();
    await expect(dialog.getByRole('radio', { name: '2 hrs' })).toBeChecked();
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
    await dialog.getByRole('radiogroup', { name: 'When?' }).getByRole('radio', { name: `Tomorrow, ${shortDay(tomorrow)}` }).click();
    await dialog.getByRole('button', { name: 'Pick a time' }).click();
    await dialog.locator('#scheduled_time').fill('22:30');
    await dialog.getByRole('button', { name: /^More details/ }).click();
    await dialog.getByRole('radio', { name: '2 hrs' }).click();
    await expect(dialog.getByRole('radio', { name: '2 hrs' })).toBeChecked();
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
    await dialog.getByRole('button', { name: /^Other day/ }).click();
    for (const id of ['task-day-row', 'task-time-row']) {
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
