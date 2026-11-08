import type { APIRequestContext, Page } from '@playwright/test';
import { test, expect } from '../fixtures';
import { checkA11y } from '../helpers';
import { cookieLogin, createCircle, createScopedAccount, uniq } from '../unhappy/auth-invites/_helpers';
import { apiSession, dbQuery, sqlStr, type ApiSession } from '../unhappy';
import { circleTimezone, dateInTz, weekOffset } from '../notesFirstClassShared';

// Shift tasks (docs/plans/shift-tasks.md): add a task to a shift from the saved dialog and from the
// detail, complete it on the detail / Today / Tasks, and delete the shift by every scope while
// proving what remains: a linked task goes with its shift's days, a regular task that merely
// overlaps the shift is never touched, and the count the confirm states equals what was removed.
// Run-scoped accounts and circles. Any console error or page error fails the test.

test.use({ storageState: { cookies: [], origins: [] } });
test.setTimeout(240_000);

// Noise that is not an app bug (same list as e2e/helpers.ts CONSOLE_IGNORE, kept tight).
const CONSOLE_IGNORE: RegExp[] = [
  /favicon/i,
  /Download the React DevTools/i,
  /React Router Future Flag/i,
  /ResizeObserver loop/i,
  /\[vite\]/i,
  /Failed to load resource.*401/i,
];

const problems: string[] = [];
test.beforeEach(async ({ page }) => {
  problems.length = 0;
  page.on('console', (msg) => {
    if (msg.type() !== 'error') return;
    const text = msg.text();
    if (CONSOLE_IGNORE.some((re) => re.test(text))) return;
    problems.push(`console: ${text}`);
  });
  page.on('pageerror', (err) => problems.push(`pageerror: ${err.message}`));
  page.on('response', (res) => {
    if (res.status() === 404) problems.push(`404 ${res.request().method()} ${new URL(res.url()).pathname}`);
  });
});
test.afterEach(() => {
  expect(problems, 'no console errors or page errors').toEqual([]);
});

interface Scene {
  session: ApiSession;
  circleId: string;
  tz: string;
  today: string;
  owner: Awaited<ReturnType<typeof createScopedAccount>>;
}

async function premiumScene(request: APIRequestContext): Promise<Scene> {
  const owner = await createScopedAccount('shifttasks');
  const session = await apiSession(request, owner);
  const circleId = await createCircle(session, uniq('shifttasks'));
  const tz = await circleTimezone(session, circleId);
  return { session, circleId, tz, today: dateInTz(tz, 0), owner };
}

/** A shift that covers the WHOLE day (00:00 for 24 h): no time of day can make it "ended" mid-run. */
async function seedShift(
  s: Scene,
  over: Record<string, unknown> = {}
): Promise<{ id: string }> {
  const res = await s.session.post(`/api/circles/${s.circleId}/events`, {
    event_type: 'shift',
    title: 'Afternoons',
    scheduled_date: s.today,
    scheduled_time: '00:00',
    duration_minutes: 1440,
    reminder_lead_minutes: null,
    assigned_to: s.owner.userId,
    recurrence_rule: 'daily',
    ...over,
  });
  expect(res.ok(), `seed shift: ${await res.text()}`).toBeTruthy();
  return ((await res.json()) as { data: { event: { id: string } } }).data.event;
}

async function addShiftTask(
  s: Scene,
  shiftId: string,
  title: string,
  time: string,
  opts: { date?: string; onlyThisDay?: boolean } = {}
): Promise<void> {
  const res = await s.session.post(`/api/circles/${s.circleId}/events/${shiftId}/shift/tasks`, {
    scheduledDate: opts.date ?? s.today,
    title,
    scheduled_time: time,
    ...(opts.onlyThisDay ? { only_this_day: true } : {}),
  });
  expect(res.status(), `add shift task ${title}: ${await res.text()}`).toBe(201);
}

async function seedRegularTask(
  s: Scene,
  title: string,
  time: string,
  over: Record<string, unknown> = {}
): Promise<void> {
  const res = await s.session.post(`/api/circles/${s.circleId}/events`, {
    event_type: 'task',
    title,
    scheduled_date: s.today,
    scheduled_time: time,
    ...over,
  });
  expect(res.ok(), `seed task ${title}: ${await res.text()}`).toBeTruthy();
}

interface Occurrence {
  date: string;
  assigned_to: string | null;
  shift: { status: string; assignee: { first_name: string | null } | null; title: string } | null;
  completed: boolean;
}

/** Every occurrence of the tasks called `title` in [from, to], by date (what the calendar would draw). */
async function occurrences(s: Scene, title: string, from: string, to: string): Promise<Occurrence[]> {
  const res = await s.session.get(`/api/circles/${s.circleId}/events?start_date=${from}&end_date=${to}`);
  expect(res.ok(), await res.text()).toBeTruthy();
  const rows = ((await res.json()) as { data: { events: Array<Record<string, any>> } }).data.events;
  return rows
    .filter((e) => e.event_type === 'task' && e.title === title)
    .map((e) => ({
      date: e.scheduled_date as string,
      assigned_to: (e.assigned_to as string | null) ?? null,
      shift: e.shift ?? null,
      completed: !!e.completed_at,
    }))
    .sort((a, b) => (a.date < b.date ? -1 : 1));
}

const datesOf = (list: Occurrence[]): string[] => list.map((o) => o.date);

async function openShifts(page: Page, circleId: string, view: 'Day' | 'Week' = 'Week'): Promise<void> {
  await page.goto(`/circles/${circleId}/calendar`, { waitUntil: 'domcontentloaded' });
  const modes = page.getByRole('tablist', { name: 'Calendar mode' });
  await expect(modes).toBeVisible({ timeout: 20_000 });
  await modes.getByRole('tab', { name: /^Shifts/ }).click();
  await expect(modes.getByRole('tab', { name: /^Shifts/ })).toHaveAttribute('aria-selected', 'true');
  if (view !== 'Week') {
    await page.getByRole('tablist', { name: 'Calendar view' }).getByRole('tab', { name: view }).click();
  }
}

/**
 * Step the Shifts week view to the week holding `date`. The view opens on ITS OWN idea of today (the
 * viewer's clock), which can be a day off the recipient's around midnight, so the offset is read from
 * the week on screen (every day section carries `data-date`), never assumed from `today`.
 */
async function showWeekOf(page: Page, _today: string, date: string): Promise<void> {
  const first = page.locator('[data-testid="shifts-week-view"] section[data-date]').first();
  await expect(first).toBeVisible({ timeout: 20_000 });
  const shown = (await first.getAttribute('data-date')) as string;
  const weeks = weekOffset(shown, date);
  const range = page.getByRole('heading', { level: 2, name: /\d{4}$/ });
  for (let i = 0; i < Math.abs(weeks); i++) {
    await expect(range).toBeVisible({ timeout: 20_000 });
    const from = (await range.textContent())?.trim() ?? '';
    await page.getByRole('button', { name: weeks < 0 ? 'Previous week' : 'Next week', exact: true }).click();
    await expect(range, `week range moved off "${from}"`).not.toHaveText(from, { timeout: 20_000 });
  }
  await expect(dayRegion(page, date)).toBeVisible({ timeout: 20_000 });
}

function dayRegion(page: Page, date: string) {
  return page.locator(`[data-testid="shifts-week-view"] section[data-date="${date}"]`);
}

async function openShiftDetail(page: Page, s: Scene, date: string, title: string) {
  await showWeekOf(page, s.today, date);
  await dayRegion(page, date).getByRole('button', { name: new RegExp(`^${title}, `) }).click();
  const detail = page.getByRole('dialog', { name: title });
  await expect(detail).toBeVisible({ timeout: 20_000 });
  return detail;
}

function shortDate(date: string): string {
  return new Date(`${date}T12:00:00Z`).toLocaleDateString('en-US', {
    timeZone: 'UTC',
    weekday: 'short',
    month: 'short',
    day: 'numeric',
  });
}

test.describe('shift tasks', () => {
  let s: Scene;
  test.beforeEach(async ({ request, context, baseURL }) => {
    s = await premiumScene(request);
    await cookieLogin(context, s.owner, baseURL);
  });

  test('add a task from the saved dialog and from the detail', async ({ page }, testInfo) => {
    await openShifts(page, s.circleId);
    const empty = page.getByTestId('shifts-empty-state');
    await expect(empty).toBeVisible({ timeout: 20_000 });
    await empty.getByRole('button', { name: 'Add a shift' }).click();

    const form = page.getByRole('dialog', { name: 'New shift' });
    await form.locator('#shift_name').fill('Afternoons');
    await form.getByTestId('shift-start-tile').click();
    await form.locator('#shift_start').fill('00:00');
    await form.getByTestId('shift-end-tile').click();
    await form.locator('#shift_end').fill('00:00');
    await form.getByRole('radiogroup', { name: 'How often?' }).getByRole('radio', { name: 'Every day' }).click();
    await form.getByRole('button', { name: 'Save shift' }).click();

    // The saved dialog: Done is the primary, the two follow-ups are outlines, no checkmark.
    const saved = page.getByRole('dialog', { name: '"Afternoons" saved' });
    await expect(saved).toBeVisible({ timeout: 20_000 });
    const addTask = saved.getByRole('button', { name: 'Add a task to this shift' });
    await expect(addTask).toBeVisible();
    await expect(saved.getByRole('button', { name: 'Done' })).toHaveClass(/bg-primary-fill/);
    await expect(addTask).not.toHaveClass(/bg-primary-fill/);
    await expect(addTask.locator('svg')).toHaveCount(0); // no checkmark (owner 2026-11-07)
    await expect(saved.getByRole('button', { name: 'Done' }).locator('svg')).toHaveCount(0);
    await checkA11y(page, 'shift-tasks-saved-light', testInfo);

    await addTask.click();
    const taskForm = page.getByRole('dialog', { name: 'Add a task' });
    await expect(taskForm.getByLabel(/^Time/)).toHaveValue('00:00');
    await expect(taskForm.getByText('Between 12:00 AM and 12:00 AM')).toBeVisible();
    // An empty name is refused inline.
    await taskForm.getByRole('button', { name: 'Add task' }).click();
    await expect(taskForm.getByText('Enter a task name.')).toBeVisible();
    await taskForm.getByLabel(/Task name/).fill('Lunch');
    await taskForm.getByLabel(/^Time/).fill('12:00');
    await expect(taskForm.getByRole('checkbox', { name: `Only ${shortDate(s.today)}` })).not.toBeChecked();
    await taskForm.getByRole('button', { name: 'Add task' }).click();

    // Back on the saved dialog, with the toast.
    await expect(saved).toBeVisible({ timeout: 20_000 });
    await expect(page.getByText('Task added')).toBeVisible();
    await saved.getByRole('button', { name: 'Done' }).click();

    const linked = () =>
      dbQuery<{ title: string; rule: string | null; linked: boolean }>(`
        select title, recurrence_rule as rule, shift_event_id is not null as linked
          from calendar_events
         where circle_id = ${sqlStr(s.circleId)}::uuid and event_type = 'task' and parent_event_id is null
         order by created_at`);
    expect(linked()).toEqual([{ title: 'Lunch', rule: 'daily', linked: true }]);

    // The card counts it; the detail lists it, and an OPEN shift says so.
    await openShifts(page, s.circleId, 'Day');
    const card = page.getByTestId('shifts-day-list').getByTestId('shift-card');
    await expect(card.getByTestId('shift-card-task-count')).toHaveText('1 task · 0 done', { timeout: 20_000 });
    await card.getByRole('button', { name: /^Afternoons, / }).click();
    const detail = page.getByRole('dialog', { name: 'Afternoons' });
    await expect(detail.getByTestId('shift-task-list-title')).toHaveText("This shift's list · 0 of 1 done");
    await expect(detail.getByTestId('shift-task-row')).toHaveCount(1);
    // ONE filled button per screen: on an open shift that is Take, so the task's Done is an outline.
    await expect(detail.getByRole('button', { name: 'Take', exact: true })).toHaveClass(/bg-primary-fill/);
    await expect(detail.getByTestId('shift-task-done')).toHaveAttribute('data-variant', 'outline');

    // Add from the detail: a one-off ("Only <date>").
    await detail.getByRole('button', { name: 'Add a task to this shift' }).click();
    const second = page.getByRole('dialog', { name: 'Add a task' });
    await second.getByLabel(/Task name/).fill('Walk');
    await second.getByLabel(/^Time/).fill('15:00');
    await second.getByRole('checkbox', { name: `Only ${shortDate(s.today)}` }).click();
    await second.getByRole('button', { name: 'Add task' }).click();

    // Back on the detail, where the new task is on the list in time order.
    const back = page.getByRole('dialog', { name: 'Afternoons' });
    await expect(back.getByTestId('shift-task-list-title')).toHaveText("This shift's list · 0 of 2 done", {
      timeout: 20_000,
    });
    await expect(back.getByTestId('shift-task-row').locator('p').filter({ hasText: /^(Lunch|Walk)$/ })).toHaveText([
      'Lunch',
      'Walk',
    ]);
    await checkA11y(page, 'shift-tasks-detail-light', testInfo);
    expect(linked().map((r) => [r.title, r.rule])).toEqual([
      ['Lunch', 'daily'],
      ['Walk', null],
    ]);
    await back.getByRole('button', { name: 'Close' }).last().click();
    await expect(card.getByTestId('shift-card-task-count')).toHaveText('2 tasks · 0 done', { timeout: 20_000 });

    // The Tasks tab names the open shift on both.
    await page.goto(`/circles/${s.circleId}/tasks`, { waitUntil: 'domcontentloaded' });
    await expect(page.getByTestId('task-shift-meta').first()).toHaveText('Task · Open shift · Afternoons', {
      timeout: 20_000,
    });
  });

  test('complete a shift task on the detail, on Today and on the Tasks tab', async ({ page }) => {
    const shift = await seedShift(s);
    await addShiftTask(s, shift.id, 'Detail task', '09:00');
    await addShiftTask(s, shift.id, 'Today task', '10:00');
    await addShiftTask(s, shift.id, 'Tasks task', '11:00');

    const completedRows = (title: string) =>
      dbQuery<{ n: number }>(`
        select count(*)::int as n from calendar_events
         where circle_id = ${sqlStr(s.circleId)}::uuid and event_type = 'task' and title = ${sqlStr(title)}
           and completed_at is not null`)[0]?.n ?? 0;

    // 1) the shift detail: one filled Done, the rest outlines.
    await openShifts(page, s.circleId, 'Day');
    const day = page.getByTestId('shifts-day-list');
    await expect(day.getByTestId('shift-card-task-count')).toHaveText('3 tasks · 0 done', { timeout: 20_000 });
    await day.getByRole('button', { name: /^Afternoons, / }).click();
    const detail = page.getByRole('dialog', { name: 'Afternoons' });
    await expect(detail.getByTestId('shift-task-list-title')).toHaveText('Your list · 0 of 3 done');
    const buttons = detail.getByTestId('shift-task-done');
    await expect(buttons).toHaveCount(3);
    await expect(buttons.nth(0)).toHaveAttribute('data-variant', 'primary');
    await expect(buttons.nth(1)).toHaveAttribute('data-variant', 'outline');
    await expect(buttons.nth(2)).toHaveAttribute('data-variant', 'outline');
    await detail.getByRole('button', { name: 'Done, Detail task' }).click();
    await expect(detail.getByRole('button', { name: /Undo/ })).toBeVisible();
    await expect(detail.getByTestId('shift-task-list-title')).toHaveText('Your list · 1 of 3 done', {
      timeout: 30_000,
    });
    await expect.poll(() => completedRows('Detail task'), { timeout: 20_000 }).toBeGreaterThan(0);
    // The next open task is now the filled one.
    await expect(detail.getByTestId('shift-task-done').first()).toHaveAttribute('data-variant', 'primary');
    await detail.getByRole('button', { name: 'Close' }).last().click();

    // 2) Today: the label names the coverer and the shift; Done completes it.
    await page.goto(`/circles/${s.circleId}`, { waitUntil: 'domcontentloaded' });
    const nextUp = page.getByTestId('next-up-row').filter({ hasText: 'Today task' });
    await expect(nextUp).toBeVisible({ timeout: 20_000 });
    await expect(nextUp).toContainText('Task · E2E · Afternoons');
    await nextUp.getByRole('button', { name: /^Done, Today task/ }).click();
    await expect.poll(() => completedRows('Today task'), { timeout: 30_000 }).toBeGreaterThan(0);

    // 3) the Tasks tab.
    await page.goto(`/circles/${s.circleId}/tasks`, { waitUntil: 'domcontentloaded' });
    const row = page.getByRole('listitem').filter({ hasText: 'Tasks task' });
    await expect(row.getByTestId('task-shift-meta')).toHaveText('Task · E2E · Afternoons', { timeout: 20_000 });
    await row.getByRole('button', { name: /Done|Mark/ }).first().click();
    await expect.poll(() => completedRows('Tasks task'), { timeout: 30_000 }).toBeGreaterThan(0);
  });

  test('delete this one, this and future, and all: what remains, and the count equals what was removed', async ({
    page,
  }) => {
    const d = (n: number) => dateInTz(s.tz, n);
    const D0 = d(0);
    const horizon = d(5);
    const owner = s.owner.userId;

    // The owner's fixture, in miniature: a repeating shift covered by the owner, a LINKED repeating task,
    // a LINKED one-off, a REGULAR task for the owner overlapping the shift, a REGULAR repeating task for
    // Anyone overlapping every day. A second, one-off shift with its own linked and regular task.
    const afternoons = await seedShift(s);
    await addShiftTask(s, afternoons.id, 'A repeating', '14:00');
    await addShiftTask(s, afternoons.id, 'B one-off', '15:00', { onlyThisDay: true });
    await seedRegularTask(s, 'C regular owner', '14:30', { assigned_to: owner });
    await seedRegularTask(s, 'E regular anyone', '13:00', { recurrence_rule: 'daily' });
    const late = await seedShift(s, { title: 'Late', recurrence_rule: null });
    await addShiftTask(s, late.id, 'L linked', '16:00');
    await seedRegularTask(s, 'L regular', '16:00', { assigned_to: owner });

    const snapshot = async () => ({
      a: datesOf(await occurrences(s, 'A repeating', D0, horizon)),
      b: datesOf(await occurrences(s, 'B one-off', D0, horizon)),
      c: await occurrences(s, 'C regular owner', D0, horizon),
      e: datesOf(await occurrences(s, 'E regular anyone', D0, horizon)),
      l: datesOf(await occurrences(s, 'L linked', D0, horizon)),
      lr: await occurrences(s, 'L regular', D0, horizon),
    });
    const days = (from: number, to: number) => Array.from({ length: to - from + 1 }, (_, i) => d(from + i));

    const before = await snapshot();
    expect(before.a).toEqual(days(0, 5));
    expect(before.b).toEqual([D0]);
    expect(before.e).toEqual(days(0, 5));
    expect(before.l).toEqual([D0]);

    /** "This also removes its N upcoming tasks" -> N, or 0 when the line is hidden. */
    async function impactShown(confirm: ReturnType<Page['getByRole']>): Promise<number> {
      const line = confirm.getByTestId('shift-delete-impact');
      if ((await line.count()) === 0) return 0;
      const match = /its (\d+) upcoming tasks?/.exec((await line.textContent()) ?? '');
      return match ? Number(match[1]) : 0;
    }
    /** Task roots that lost at least one occurrence between two snapshots. */
    const shrunk = (a: string[], b: string[]): boolean => b.length < a.length;

    // ---- 1) THIS SHIFT (today): the repeating task loses today only, the one-off goes. ----
    await openShifts(page, s.circleId);
    let detail = await openShiftDetail(page, s, D0, 'Afternoons');
    await detail.getByRole('button', { name: 'Delete' }).click();
    let confirm = page.getByRole('dialog', { name: 'Delete shift' });
    await expect(confirm.getByRole('radio', { name: 'This shift' })).toBeChecked();
    await expect(confirm.getByTestId('shift-delete-impact')).toContainText(
      'Completed tasks stay in history.',
      { timeout: 20_000 }
    );
    const n1 = await impactShown(confirm);
    await confirm.getByRole('button', { name: 'Delete' }).click();
    await expect(confirm).toBeHidden({ timeout: 20_000 });
    await expect.poll(async () => (await snapshot()).b, { timeout: 20_000 }).toEqual([]);
    const afterOne = await snapshot();
    expect(afterOne.a).toEqual(days(1, 5));
    const removedOne = [shrunk(before.a, afterOne.a), shrunk(before.b, afterOne.b)].filter(Boolean).length;
    expect(n1, 'the confirm count equals the tasks that lost a day').toBe(removedOne);
    expect(n1).toBe(2);
    // The overlapping REGULAR tasks are untouched: rows, assignee, recurrence.
    expect(afterOne.c).toEqual(before.c);
    expect(afterOne.c[0].assigned_to).toBe(owner);
    expect(afterOne.e).toEqual(before.e);
    // The other shift's tasks too.
    expect(afterOne.l).toEqual(before.l);
    expect(afterOne.lr).toEqual(before.lr);

    // ---- 2) THIS AND FUTURE (day 2): the repeating task is cut short, not removed. ----
    detail = await openShiftDetail(page, s, d(2), 'Afternoons');
    await detail.getByRole('button', { name: 'Delete' }).click();
    confirm = page.getByRole('dialog', { name: 'Delete shift' });
    await confirm.getByRole('radio', { name: 'This and future shifts' }).click();
    await expect(confirm.getByTestId('shift-delete-impact')).toBeVisible({ timeout: 20_000 });
    const n2 = await impactShown(confirm);
    await confirm.getByRole('button', { name: 'Delete' }).click();
    await expect(confirm).toBeHidden({ timeout: 20_000 });
    await expect.poll(async () => (await snapshot()).a, { timeout: 20_000 }).toEqual([d(1)]);
    const afterTwo = await snapshot();
    expect(n2, 'the confirm count equals the tasks cut short').toBe(
      [shrunk(afterOne.a, afterTwo.a), shrunk(afterOne.b, afterTwo.b)].filter(Boolean).length
    );
    expect(n2).toBe(1);
    expect(afterTwo.c).toEqual(before.c);
    expect(afterTwo.e).toEqual(before.e); // still on every day, including the deleted shifts' days
    expect(afterTwo.l).toEqual(before.l);

    // ---- 3) ALL (a one-off shift): its linked task goes, the regular one at the same time stays. ----
    detail = await openShiftDetail(page, s, D0, 'Late');
    await detail.getByRole('button', { name: 'Delete' }).click();
    confirm = page.getByRole('dialog', { name: 'Delete shift' });
    await expect(confirm.getByRole('radio')).toHaveCount(0); // a one-off has no scope question
    await expect(confirm.getByTestId('shift-delete-impact')).toBeVisible({ timeout: 20_000 });
    const n3 = await impactShown(confirm);
    await confirm.getByRole('button', { name: 'Delete' }).click();
    await expect(confirm).toBeHidden({ timeout: 20_000 });
    await expect.poll(async () => (await snapshot()).l, { timeout: 20_000 }).toEqual([]);
    const afterThree = await snapshot();
    expect(n3, 'the confirm count equals the linked tasks removed').toBe(shrunk(afterTwo.l, afterThree.l) ? 1 : 0);
    expect(n3).toBe(1);
    expect(afterThree.lr).toEqual(before.lr);
    expect(afterThree.lr[0].assigned_to).toBe(owner);
    expect(afterThree.c).toEqual(before.c);
    expect(afterThree.e).toEqual(before.e);

    // No linked task is left pointing at a shift that no longer exists.
    const orphans = dbQuery<{ n: number }>(`
      select count(*)::int as n from calendar_events c
       where c.circle_id = ${sqlStr(s.circleId)}::uuid and c.shift_event_id is not null
         and not exists (select 1 from calendar_events x where x.id = c.shift_event_id and x.deleted_at is null)`);
    expect(orphans[0].n).toBe(0);
  });
});
