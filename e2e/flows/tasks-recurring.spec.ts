import type { Locator } from '@playwright/test';
import { test, expect, uniqueLabel } from '../fixtures';
import { expandAllDayOverflow } from '../helpers';
import {
  addDaysISO,
  assertChipAbsent,
  circleTimezone,
  dateInTz,
  gotoWeekContaining,
  openChip,
  uniqueSuffix,
} from '../notesFirstClassShared';
import { sqlExec, sqlStr } from '../db';
import { dbQuery } from '../unhappy';
import { apiCreateEvent } from '../unhappy/writes/_helpers';
import {
  captureJson,
  cookieLogin,
  createCircle,
  createScopedAccount,
  ownerApi,
  uniq,
} from '../unhappy/auth-invites/_helpers';

// COMPLETING ONE OCCURRENCE OF A RECURRING TASK STAMPS THAT DAY, NOT DAY ONE.
//
// `completed_at` lives on a ROW, and one row is one occurrence. A recurring
// series' later occurrences are VIRTUAL — the backend synthesises them with a
// composite id (`${parentId}_${date}`) that matches no `id` column — so the
// only addressable form they have is the series ROOT plus the occurrence's
// date. Post the root with no date and the server stamps the series' FIRST
// day: in production that mis-stamped 14 series across 7 households, leaving
// the tapped day open and an earlier one silently "done".
//
// This is the only test in the suite that can prove the right ROW was written:
// the vitest tests assert the request the client builds, and a mock will agree
// with whatever the server would have done with it. Here the completion goes
// to the real backend, and the proof is read back out of a server-backed query
// (the Tasks page's Completed filter) as the DUE DATE of the row that got
// stamped.
//
// Run-unique title; self-cleaning (the series is deleted from its own first
// occurrence with "this and future"); PHI-safe.

/** Local date + `offset` days, as YYYY-MM-DD. */
function isoDate(offset: number): string {
  const d = new Date();
  d.setDate(d.getDate() + offset);
  const mm = String(d.getMonth() + 1).padStart(2, '0');
  const dd = String(d.getDate()).padStart(2, '0');
  return `${d.getFullYear()}-${mm}-${dd}`;
}

/**
 * The due label TaskRow prints for a date that is neither today nor yesterday —
 * `Intl` on the naive date anchored at noon UTC, exactly as TaskRow builds it.
 */
function dueDateLabel(date: string): string {
  return new Intl.DateTimeFormat('en', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
    timeZone: 'UTC',
  }).format(new Date(`${date}T12:00:00Z`));
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * Reveal every all-day chip in ONE day column.
 *
 * `expandAllDayOverflow` matches only the PLURAL label ("N more all-day
 * events"), and a day hiding exactly one chip is labelled "1 more all-day
 * event on 8 Tue" — the common case for a fresh daily series, and the reason
 * the chip lookup below was intermittently empty.
 */
async function expandDay(cell: Locator): Promise<void> {
  const overflow = cell.getByRole('button', { name: /more all-day event/i });
  if ((await overflow.count()) > 0) await overflow.first().click();
}

test('completing a later occurrence of a recurring task stamps THAT day, not the series start', async ({
  page,
  circleId,
}) => {
  const title = uniqueLabel('Recurring');
  const startDate = isoDate(0);
  // TWO days out, not one: `getRelativeDateLabel` collapses today/yesterday
  // into words, and the care recipient's timezone can be a day off the
  // runner's. At +2 the row can only ever print the formatted date, so the
  // assertion below cannot be satisfied by the wrong row wearing a relative
  // label.
  const occurrenceDate = isoDate(2);

  await page.goto(`/circles/${circleId}/tasks`, { waitUntil: 'domcontentloaded' });
  await expect(page.getByRole('heading', { name: 'Tasks' })).toBeVisible({ timeout: 15_000 });

  // --- Create a DAILY series starting today ---
  await page.getByRole('button', { name: 'Add task' }).first().click();
  const dialog = page.getByRole('dialog');
  await expect(dialog).toBeVisible();
  await dialog.locator('#title').fill(title);
  await dialog.locator('#scheduled_date').fill(startDate);
  await dialog.locator('#recurrence_rule').selectOption('daily');
  await dialog.getByRole('button', { name: 'Create' }).click();
  await expect(dialog).toBeHidden({ timeout: 20_000 });

  // --- Complete the occurrence two days out, from the calendar ---
  await page.goto(`/circles/${circleId}/calendar`, { waitUntil: 'domcontentloaded' });
  await expect(page.getByRole('grid')).toBeVisible({ timeout: 15_000 });

  // The week view is anchored on today, so +2 can fall into next week. Page
  // forward when the day is not on screen rather than assuming it is.
  let dayCell = page.locator(`[data-date="${occurrenceDate}"]`).first();
  if ((await page.locator(`[data-date="${occurrenceDate}"]`).count()) === 0) {
    await page.getByRole('button', { name: 'Next week' }).click();
    dayCell = page.locator(`[data-date="${occurrenceDate}"]`).first();
  }
  await expect(dayCell).toBeAttached({ timeout: 15_000 });

  // Task chips are all-day; heavy re-run traffic can push ours past the week
  // view's per-day overflow cap.
  await expandAllDayOverflow(page);
  await expandDay(dayCell);

  const titleRe = new RegExp(escapeRegExp(title));
  const occurrenceChip = dayCell.getByRole('button', { name: titleRe }).first();
  await expect(occurrenceChip).toBeVisible({ timeout: 20_000 });
  await occurrenceChip.click();

  const detail = page.getByRole('dialog');
  await expect(detail).toBeVisible();
  await detail.getByRole('button', { name: 'Mark complete' }).click();
  // The completion is a plain POST with no undo window on this surface, so the
  // toast is the commit signal.
  await expect(page.getByText('Marked complete')).toBeVisible({ timeout: 20_000 });

  // --- THE OPEN MODAL MUST SHOW IT, WITHOUT A CLOSE/REOPEN ---
  // The detail modal renders from a SNAPSHOT the page set when the chip was
  // clicked. The write always landed (the section below proves the right row
  // got stamped), but until the snapshot was restamped the dialog still said
  // nothing about completion and still offered Mark complete — a working fix
  // that reads as broken, and an invitation to click it a second time.
  //
  // Deliberately asserted on the SAME `detail` locator, with no reload and no
  // close in between. This is also the only place the VIRTUAL path is checked
  // against a real server: the occurrence completed above may have had no
  // physical row at all, in which case the response carries a row the client
  // has never seen — the only thing that can refresh this dialog.
  await expect(detail.getByText(/^Completed (on|by)$/)).toBeVisible({ timeout: 20_000 });
  await expect(detail.getByRole('button', { name: 'Mark complete' })).toHaveCount(0);

  // --- WHICH ROW GOT STAMPED? ---
  // The Completed filter is a server-backed read of PHYSICAL rows. The stamped
  // row's own due date is printed in its accessible name, so this says which
  // occurrence the server wrote — not merely that something completed.
  await page.goto(`/circles/${circleId}/tasks`, { waitUntil: 'domcontentloaded' });
  await page.getByRole('button', { name: /^Status:/ }).click();
  const statusMenu = page.getByRole('menu');
  await expect(statusMenu).toBeVisible({ timeout: 10_000 });
  await statusMenu.getByRole('menuitem', { name: 'Completed', exact: true }).click();

  const completedRow = page.getByRole('button', {
    name: new RegExp(`View details for "${escapeRegExp(title)}"`),
  });
  await expect(completedRow.first()).toBeVisible({ timeout: 25_000 });
  // THE ASSERTION. The stamped row is dated the day that was clicked. Stamping
  // the series root instead prints the START date here, which is the bug.
  await expect(completedRow.first()).toHaveAccessibleName(
    new RegExp(escapeRegExp(dueDateLabel(occurrenceDate)))
  );
  await expect(completedRow.first()).not.toHaveAccessibleName(/Today/);
  // Exactly one occurrence was completed — the click did not stamp two rows.
  await expect(completedRow).toHaveCount(1);

  // --- Delete the whole series (cleanup) ---
  await page.goto(`/circles/${circleId}/calendar`, { waitUntil: 'domcontentloaded' });
  await expect(page.getByRole('grid')).toBeVisible({ timeout: 15_000 });
  await expandAllDayOverflow(page);
  const startCell = page.locator(`[data-date="${startDate}"]`).first();
  await expandDay(startCell);
  await startCell.getByRole('button', { name: titleRe }).first().click();
  const detailForDelete = page.getByRole('dialog');
  await expect(detailForDelete).toBeVisible();
  // An OPEN task keeps Edit, so Edit + Delete overflow into the More menu (a
  // completed task's solo Delete renders inline instead — which is why
  // tasks.spec.ts can click Delete directly and this cannot). Scoped to the
  // dialog and `exact`: the week view's all-day overflow toggle behind it is
  // also named "…more all-day event…".
  await detailForDelete.getByRole('button', { name: 'More', exact: true }).click();
  await page.getByRole('menuitem', { name: 'Delete', exact: true }).click();
  // Recurring → a scope picker. "This and all future tasks" from the FIRST
  // occurrence removes the root and every child, including the one completed
  // above, so the run leaves nothing behind.
  const confirm = page.getByRole('dialog');
  await confirm.getByRole('radio', { name: /future/i }).check();
  await confirm.getByRole('button', { name: 'Delete', exact: true }).click();

  await expect(page.locator(`[data-date="${startDate}"]`).getByRole('button', { name: titleRe })).toHaveCount(
    0,
    { timeout: 20_000 }
  );
});

// PK20 (docs/plans/appointment-delete-single-occurrence.md): "This task only" on
// a recurring task used to be refused by the backend (400 NOT_SUPPORTED, the
// row stayed). It now tombstones exactly that occurrence.
//
// The Tasks page lists PHYSICAL rows only (the series root and any materialized
// children), so the occurrences are materialized here the way the hourly
// materializer does (a child row at (root, date)); the assertion that matters is
// that the SAME child row is the one tombstoned and its siblings are untouched.
// An OPEN task on the Tasks page opens the editor (no Delete), so the delete is
// driven from the Calendar detail modal (same picker, same request) and the Tasks
// page is where the removal is observed. A scoped owner (never the worker's account); dates are computed in
// the care recipient's zone, not the runner's clock.
test('"This task only" removes just that occurrence of a recurring task and leaves its siblings', async ({
  page,
  context,
  request,
  baseURL,
}) => {
  test.setTimeout(120_000);
  const owner = await createScopedAccount('taskonly');
  const api = await ownerApi(request, owner);
  const circleId = await createCircle(api, uniq('taskonly'));
  const tz = await circleTimezone(api, circleId);
  const today = dateInTz(tz, 0);
  const at = (n: number) => addDaysISO(today, n);
  const title = `ZZ_E2E_TASKONLY_${uniqueSuffix()}`;
  const titleRe = new RegExp(escapeRegExp(title));

  const root = await apiCreateEvent(api, circleId, {
    event_type: 'task',
    title,
    scheduled_date: at(-1),
    recurrence_rule: 'daily',
  });
  const mint = (date: string): string => {
    sqlExec(
      `insert into calendar_events (circle_id, parent_event_id, event_type, title, scheduled_date, scheduled_time, created_by)
       select circle_id, id, event_type, title, ${sqlStr(date)}::date, scheduled_time, created_by
         from calendar_events where id = ${sqlStr(root.id)}::uuid`
    );
    return dbQuery<{ id: string }>(
      `select id::text as id from calendar_events
        where parent_event_id = ${sqlStr(root.id)}::uuid and scheduled_date = ${sqlStr(date)}::date`
    )[0].id;
  };
  const child1 = mint(at(1));
  const child2 = mint(at(2));

  await cookieLogin(context, owner, baseURL);

  // The Tasks page lists PHYSICAL rows: the series root (yesterday) and the two
  // materialized children. An OPEN task there opens the editor (no Delete), so the
  // delete is driven from the Calendar's detail modal -- the same picker, the same
  // request -- and the Tasks page is the place the removal is OBSERVED.
  const taskRows = () =>
    page.getByRole('button', { name: new RegExp(`Edit "${escapeRegExp(title)}"`) });
  const openTasksPage = async () => {
    await page.goto(`/circles/${circleId}/tasks`, { waitUntil: 'domcontentloaded' });
    await expect(page.getByRole('heading', { name: 'Tasks' })).toBeVisible({ timeout: 15_000 });
  };
  await openTasksPage();
  await expect(taskRows()).toHaveCount(3, { timeout: 25_000 });

  await gotoWeekContaining(page, circleId, today, at(2));
  const detail = await openChip(page, at(2), titleRe);
  await detail.getByRole('button', { name: 'More', exact: true }).click();
  await page.getByRole('menuitem', { name: 'Delete', exact: true }).click();
  const del = page.getByRole('dialog', { name: 'Delete task' });
  await expect(del).toBeVisible({ timeout: 10_000 });
  await del.getByRole('radio', { name: 'This task only' }).check();
  const responses = await captureJson(page, 'DELETE', '/api/circles/:id/events/:eventId');
  await del.getByRole('button', { name: 'Delete', exact: true }).click();
  const res = await responses.next();
  expect(res.status).toBe(200);
  expect(res.json?.data?.message).toBe('Instance removed successfully');
  await responses.dispose();
  await expect(del).toBeHidden({ timeout: 10_000 });

  // Gone from the calendar day; the neighbouring occurrence is still there.
  await assertChipAbsent(page, at(2), titleRe);

  // Gone from the Tasks list (3 -> 2 rows); the other two are still listed.
  await openTasksPage();
  await expect(taskRows()).toHaveCount(2, { timeout: 25_000 });

  // DB: the SAME child row is the one tombstoned; nothing else was.
  const tombstones = dbQuery<{ id: string; scheduled_date: string }>(
    `select id::text as id, scheduled_date::text as scheduled_date from calendar_events
      where parent_event_id = ${sqlStr(root.id)}::uuid and removed_at is not null`
  );
  expect(tombstones).toEqual([{ id: child2, scheduled_date: at(2) }]);
  const live = dbQuery<{ id: string }>(
    `select id::text as id from calendar_events
      where (id = ${sqlStr(root.id)}::uuid or parent_event_id = ${sqlStr(root.id)}::uuid) and removed_at is null`
  ).map((r) => r.id);
  expect(live.sort()).toEqual([root.id, child1].sort());
  expect(
    dbQuery(`select 1 from calendar_events where id = ${sqlStr(root.id)}::uuid and recurrence_end_date is not null`),
    'a single delete must not end the series'
  ).toHaveLength(0);
});
