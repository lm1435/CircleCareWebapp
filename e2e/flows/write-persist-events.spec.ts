import type { BrowserContext, Page, Request } from '@playwright/test';
import { test, expect } from '../fixtures';
import { sqlExec } from '../db';
import { dbQuery, sqlStr } from '../unhappy';
import { apiCreateEvent } from '../unhappy/writes/_helpers';
import {
  cookieLogin,
  createCircle,
  createScopedAccount,
  ownerApi,
  uniq,
} from '../unhappy/auth-invites/_helpers';
import {
  addDaysISO,
  assertChipPresent,
  circleTimezone,
  createAppointment,
  createDailyMedication,
  dateInTz,
  deleteSeries,
  escapeRegExp,
  gotoWeekContaining,
  openChip,
  uniqueSuffix,
  weekOffset,
} from '../notesFirstClassShared';

// WRITE-PERSISTENCE PROOFS for the calendar_events / medication_confirmations /
// activity_feed paths (the tables the backend writes through the caller's
// USER-SCOPED client). Every test drives the write for REAL through the UI and
// then proves it PERSISTED two ways: the database row(s), read with psql, and a
// fresh read the page or the API makes afterwards (a navigation / reload, or
// GET /events/:id). A toast, a closed dialog or a vanished chip proves nothing
// here: each of those is rendered from the app's own cache before (or without)
// the server having kept anything.
//
//   (a) Recurring TASK "this and all future tasks": the root's
//       `recurrence_end_date` becomes the day BEFORE the chosen occurrence, the
//       physical children dated on/after it are gone, the one before it and the
//       root survive, and the feed has the `task_updated` "Stopped recurrence"
//       row. After a reload the earlier occurrences are listed, the later ones
//       are not. (Existing coverage of this path: UI-only, tasks-recurring.)
//   (b) One-off APPOINTMENT delete: the row is HARD-deleted (no confirmations
//       exist for an appointment), plus the `appointment_deleted` feed row.
//   (c) One-off MEDICATION delete with NO recorded dose: also a hard delete
//       (backend: a medication entered by mistake leaves no trace), plus the
//       `medication_deleted` feed row.
//   (d) One-off MEDICATION delete WITH a recorded dose: a SOFT delete (PK3) --
//       `deleted_at` + `discontinued_at` stamped, the confirmation kept, the
//       response says `history_kept`, the row is invisible to the calendar and
//       to GET /events/:id (404), and the feed row is written.
//   (e) Refill decrement on a UI dose confirmation: the 5 s undo window elapses,
//       the confirm lands, and the series root's `quantity_remaining` really is
//       29 (DB and GET /events/:rootId), with `refill_applied_at` stamped on the
//       confirmation row (the claim that makes the decrement once-only).
//   (f) Task completion KEEPALIVE flush: Mark complete on the Tasks page, then a
//       full navigation INSIDE the 5 s undo window. The page timer dies with the
//       page, so the only thing that can write `completed_at` is the pagehide
//       keepalive POST (hooks/useTaskCompletion.ts, PK11) -- and the `task_completed`
//       feed row, exactly once. The task then lists under the Completed filter.
//
// Scoped owner + fresh circle per test (purged by globalTeardown), so nothing
// here can touch the worker account's seeded circles. Every date is computed in
// the care RECIPIENT's zone (the frame the calendar renders in), never from the
// runner's clock. Tests that need a dose "due today" skip within 5 minutes of
// the recipient's midnight.
//
// TIMEZONES (env, default Denver/Denver, same knobs as todays-meds-undo):
//   DOSE_VIEWER_TZ     the BROWSER's timezoneId
//   DOSE_RECIPIENT_TZ  the OWNER's profile zone = the care recipient's
//
// FALSIFY. PW_FALSIFY=write-persist-events (all) or write-persist-events:<name>
// (one of task-future, appt-delete, med-delete, med-delete-history, refill,
// task-keepalive) answers the write with a fake 2xx from the network layer, so
// the UI behaves exactly as if it saved while NOTHING reaches the backend. The
// UI-side assertions stay green and the database / reload assertions must go red.
// The SECONDARY assertions (feed row, pruned children, kept confirmation, refill
// claim, bottle count) are each falsified on their own by
// PW_FALSIFY=write-persist-events:<name>-<part> (e.g. task-future-nofeed,
// task-future-noprune, med-delete-history-noconf, refill-claim, refill-quantity):
// the real write lands, then psql undoes that one part, as if the backend had
// silently dropped it. Those fire only when named exactly (not by the umbrella).

const VIEWER_TZ = process.env.DOSE_VIEWER_TZ ?? 'America/Denver';
const RECIPIENT_TZ = process.env.DOSE_RECIPIENT_TZ ?? 'America/Denver';

test.use({ storageState: { cookies: [], origins: [] }, timezoneId: VIEWER_TZ });

const FALSIFY = new Set((process.env.PW_FALSIFY ?? '').split(',').filter(Boolean));
const falsify = (name: string): boolean =>
  FALSIFY.has('write-persist-events') || FALSIFY.has(`write-persist-events:${name}`);
/** A part-undo falsifier: fires only when named exactly. */
const falsifyPart = (name: string): boolean => FALSIFY.has(`write-persist-events:${name}`);
const forgetFeed = (circleId: string, subjectId: string, actionType: string): void =>
  sqlExec(
    `delete from activity_feed where circle_id = ${sqlStr(circleId)}::uuid and subject_id = ${sqlStr(subjectId)}::uuid and action_type = ${sqlStr(actionType)};`
  );

const EVENT_DELETE_RE = /^\/api\/circles\/[^/]+\/events\/[^/]+$/;
const CONFIRM_RE = /^\/api\/circles\/[^/]+\/medications\/confirm$/;
const COMPLETE_RE = /^\/api\/circles\/[^/]+\/events\/[^/]+\/complete$/;

/** Minutes since midnight in `tz` now. */
function minutesIntoDay(tz: string): number {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: tz,
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  }).formatToParts(new Date());
  const h = Number(parts.find((p) => p.type === 'hour')?.value ?? '0') % 24;
  const m = Number(parts.find((p) => p.type === 'minute')?.value ?? '0');
  return h * 60 + m;
}

/** A scoped owner (zone = RECIPIENT_TZ) with a fresh circle. */
async function arrange(request: import('@playwright/test').APIRequestContext, label: string) {
  test.skip(
    (() => {
      const m = minutesIntoDay(RECIPIENT_TZ);
      return m < 5 || m > 24 * 60 - 5;
    })(),
    'within 5 minutes of midnight in the recipient zone'
  );
  const owner = await createScopedAccount(label);
  sqlExec(`update users set timezone = ${sqlStr(RECIPIENT_TZ)} where id = ${sqlStr(owner.userId)}::uuid;`);
  const api = await ownerApi(request, owner);
  const circleId = await createCircle(api, uniq(label));
  const tz = await circleTimezone(api, circleId);
  expect(tz, 'recipient zone follows the owner profile zone').toBe(RECIPIENT_TZ);
  const today = dateInTz(tz, 0);
  return { owner, api, circleId, tz, today, at: (n: number) => addDaysISO(today, n) };
}

/** Answer `method` + path (matched by `pathRe`) with a fake success, from the network layer. */
async function fakeWrite(
  target: Page | BrowserContext,
  method: string,
  pathRe: RegExp,
  status: number,
  body: unknown
): Promise<void> {
  await target.route(
    (url) => pathRe.test(url.pathname),
    async (route) => {
      if (route.request().method() !== method) {
        await route.fallback();
        return;
      }
      await route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(body) });
    }
  );
}

/** Resolves with the response to `method` + path (start BEFORE the click). */
function responseTo(page: Page, method: string, pathRe: RegExp, timeout = 25_000) {
  return page.waitForResponse(
    (r) => r.request().method() === method && pathRe.test(new URL(r.url()).pathname),
    { timeout }
  );
}

const WEEK_RANGE = /^[A-Z][a-z]{2} \d{1,2} – [A-Z][a-z]{2} \d{1,2}, \d{4}$/;

/**
 * Fresh load of the calendar on the week containing `date`; assert the chip is
 * NOT on that day. A week with nothing left renders "No events this week"
 * instead of a grid, which is a valid absence (`assertChipAbsent` insists on a
 * rendered day cell and would fail on the very state being asserted).
 */
async function expectGoneOnDay(page: Page, circleId: string, today: string, date: string, titleRe: RegExp): Promise<void> {
  await page.goto(`/circles/${circleId}/calendar`, { waitUntil: 'domcontentloaded' });
  const range = page.getByRole('heading', { level: 2, name: WEEK_RANGE });
  await expect(range).toBeVisible({ timeout: 25_000 });
  const weeks = weekOffset(today, date);
  for (let i = 0; i < Math.abs(weeks); i += 1) {
    const before = (await range.textContent())?.trim() ?? '';
    await page.getByRole('button', { name: weeks < 0 ? 'Previous week' : 'Next week' }).click();
    await expect(range).not.toHaveText(before, { timeout: 25_000 });
  }
  const empty = page.getByText('No events this week');
  const cell = page.locator(`[role="gridcell"][data-date="${date}"]`).first();
  await expect(empty.or(cell)).toBeVisible({ timeout: 25_000 });
  await expect(page.locator(`[role="gridcell"][data-date="${date}"]`).getByRole('button', { name: titleRe })).toHaveCount(0);
}

/** Open the chip on `date`, More -> Delete, and return the delete dialog. */
async function openDeleteDialog(
  page: Page,
  circleId: string,
  today: string,
  date: string,
  titleRe: RegExp,
  dialogName: string
) {
  await gotoWeekContaining(page, circleId, today, date);
  const detail = await openChip(page, date, titleRe);
  await detail.getByRole('button', { name: 'More', exact: true }).click();
  await page.getByRole('menuitem', { name: 'Delete', exact: true }).click();
  const del = page.getByRole('dialog', { name: dialogName });
  await expect(del).toBeVisible({ timeout: 10_000 });
  return del;
}

interface FeedRow {
  action_type: string;
  subject_id: string;
  description: string;
  description_key: string | null;
  scheduled_date: string | null;
}

/** `activity_feed` rows of `actionType` about `subjectId` in the circle. */
const feedRows = (circleId: string, subjectId: string, actionType: string): FeedRow[] =>
  dbQuery<FeedRow>(
    `select action_type, subject_id::text, description, description_key,
            description_params->>'scheduledDate' as scheduled_date
       from activity_feed
      where circle_id = ${sqlStr(circleId)}::uuid
        and subject_id = ${sqlStr(subjectId)}::uuid
        and action_type = ${sqlStr(actionType)}`
  );

const eventRow = (id: string) =>
  dbQuery<{
    id: string;
    recurrence_end_date: string | null;
    removed_at: string | null;
    deleted_at: string | null;
    discontinued_at: string | null;
    completed_at: string | null;
    completed_by: string | null;
    quantity_remaining: number | null;
  }>(
    `select id::text, recurrence_end_date::text, removed_at::text, deleted_at::text, discontinued_at::text,
            completed_at::text, completed_by::text, quantity_remaining
       from calendar_events where id = ${sqlStr(id)}::uuid`
  )[0];

// ---------------------------------------------------------------------------
// (a) recurring task, delete "this and all future tasks"
// ---------------------------------------------------------------------------

test('(a) recurring TASK "this and all future" ends the series the day before the chosen occurrence, prunes the later rows, and survives a reload', async ({
  page,
  context,
  request,
  baseURL,
}) => {
  test.setTimeout(180_000);
  const s = await arrange(request, 'wpfut');
  const title = `ZZ_E2E_WPFUT_${uniqueSuffix()}`;
  const titleRe = new RegExp(escapeRegExp(title));
  // Weekly from 10 days ago: occurrences -10, -3, +4, +11, +18. None of them is
  // inside the materializer's today..+2 window, so the only physical children
  // are the ones minted below. The cut is +11: +4 must survive, +11 and +18 go.
  const root = await apiCreateEvent(s.api, s.circleId, {
    event_type: 'task',
    title,
    scheduled_date: s.at(-10),
    recurrence_rule: 'weekly',
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
  const keptChild = mint(s.at(4));
  mint(s.at(11));
  mint(s.at(18));
  const childDates = () =>
    dbQuery<{ scheduled_date: string }>(
      `select scheduled_date::text as scheduled_date from calendar_events
        where parent_event_id = ${sqlStr(root.id)}::uuid order by scheduled_date`
    ).map((r) => r.scheduled_date);

  // Before: an open-ended series with three physical children.
  expect(eventRow(root.id).recurrence_end_date).toBeNull();
  expect(childDates()).toEqual([s.at(4), s.at(11), s.at(18)]);

  await cookieLogin(context, s.owner, baseURL);
  const taskRows = () => page.getByRole('button', { name: new RegExp(`Edit "${escapeRegExp(title)}"`) });
  const openTasksPage = async () => {
    await page.goto(`/circles/${s.circleId}/tasks`, { waitUntil: 'domcontentloaded' });
    await expect(page.getByRole('heading', { name: 'Tasks', exact: true })).toBeVisible({ timeout: 15_000 });
  };
  await openTasksPage();
  await expect(taskRows()).toHaveCount(4, { timeout: 25_000 });

  // --- The delete, through the UI, from the +11 occurrence ---
  const del = await openDeleteDialog(page, s.circleId, s.today, s.at(11), titleRe, 'Delete task');
  await del.getByRole('radio', { name: 'This and all future tasks' }).check();
  if (falsify('task-future')) {
    await fakeWrite(page, 'DELETE', EVENT_DELETE_RE, 200, {
      success: true,
      data: { message: 'Future events deleted successfully' },
    });
  }
  const answered = responseTo(page, 'DELETE', EVENT_DELETE_RE);
  await del.getByRole('button', { name: 'Delete', exact: true }).click();
  const res = await answered;
  expect(res.status()).toBe(200);
  expect(new URL(res.url()).search).toContain('deleteScope=future');
  expect(new URL(res.url()).search).toContain(`scheduledDate=${s.at(11)}`);
  await expect(del).toBeHidden({ timeout: 20_000 });

  if (falsifyPart('task-future-noprune')) mint(s.at(11));
  if (falsifyPart('task-future-nofeed')) forgetFeed(s.circleId, root.id, 'task_updated');
  // --- DB: the series ends the day BEFORE +11; +11 and +18 are gone; +4 and the root remain ---
  await expect
    .poll(() => eventRow(root.id)?.recurrence_end_date, { timeout: 15_000, message: 'series end date persisted' })
    .toBe(s.at(10));
  expect(eventRow(root.id).removed_at, 'the root is not tombstoned').toBeNull();
  expect(eventRow(root.id).deleted_at).toBeNull();
  expect(childDates(), 'no physical child on/after the cut survives; the earlier one does').toEqual([s.at(4)]);
  expect(eventRow(keptChild), 'the +4 child is the very same row').toBeTruthy();
  const feed = feedRows(s.circleId, root.id, 'task_updated');
  expect(feed, 'one "Stopped recurrence" feed row about the root').toHaveLength(1);
  expect(feed[0].description_key).toBe('entries.recurrenceStopped');
  expect(feed[0].scheduled_date).toBe(s.at(11));

  // --- Reload: later occurrences are gone, earlier ones still show ---
  await openTasksPage();
  await expect(taskRows(), 'the Tasks list now holds the root and the +4 child only').toHaveCount(2, {
    timeout: 25_000,
  });
  await expectGoneOnDay(page, s.circleId, s.today, s.at(11), titleRe);
  await expectGoneOnDay(page, s.circleId, s.today, s.at(18), titleRe);
  await gotoWeekContaining(page, s.circleId, s.today, s.at(4));
  await assertChipPresent(page, s.at(4), titleRe);
  await gotoWeekContaining(page, s.circleId, s.today, s.at(-3));
  await assertChipPresent(page, s.at(-3), titleRe);
});

// ---------------------------------------------------------------------------
// (b) one-off appointment delete
// ---------------------------------------------------------------------------

test('(b) deleting a one-off APPOINTMENT through the UI hard-deletes the row, writes the feed row, and stays gone after a reload', async ({
  page,
  context,
  request,
  baseURL,
}) => {
  test.setTimeout(120_000);
  const s = await arrange(request, 'wpappt');
  const title = `ZZ_E2E_WPAPPT_${uniqueSuffix()}`;
  const titleRe = new RegExp(escapeRegExp(title));
  const id = await createAppointment(s.api, s.circleId, title, s.at(1), '10:00');
  expect(eventRow(id), 'seeded').toBeTruthy();
  await cookieLogin(context, s.owner, baseURL);

  const del = await openDeleteDialog(page, s.circleId, s.today, s.at(1), titleRe, 'Delete appointment');
  if (falsify('appt-delete')) {
    await fakeWrite(page, 'DELETE', EVENT_DELETE_RE, 200, { success: true, data: { message: 'Event deleted successfully' } });
  }
  const answered = responseTo(page, 'DELETE', EVENT_DELETE_RE);
  await del.getByRole('button', { name: 'Delete', exact: true }).click();
  expect((await answered).status()).toBe(200);
  await expect(del).toBeHidden({ timeout: 20_000 });

  if (falsifyPart('appt-delete-nofeed')) forgetFeed(s.circleId, id, 'appointment_deleted');
  // DB: the row is HARD-deleted (an appointment has no history to keep).
  await expect.poll(() => eventRow(id), { timeout: 15_000, message: 'appointment row deleted' }).toBeUndefined();
  const feed = feedRows(s.circleId, id, 'appointment_deleted');
  expect(feed).toHaveLength(1);
  expect(feed[0].description).toBe(`Deleted Appointment: ${title}`);
  // A fresh API read agrees ...
  expect((await s.api.get(`/api/circles/${s.circleId}/events/${id}`)).status()).toBe(404);
  // ... and so does a fresh page load.
  if (falsifyPart('appt-delete-reappear')) {
    // As if the server still listed it: proves the reload check is not vacuous.
    sqlExec(
      `insert into calendar_events (circle_id, event_type, title, scheduled_date, scheduled_time, created_by)
       values (${sqlStr(s.circleId)}::uuid, 'appointment', ${sqlStr(title)}, ${sqlStr(s.at(1))}::date, '10:00', ${sqlStr(s.owner.userId)}::uuid);`
    );
  }
  await expectGoneOnDay(page, s.circleId, s.today, s.at(1), titleRe);
});

// ---------------------------------------------------------------------------
// (c) one-off medication, no recorded dose: hard delete
// ---------------------------------------------------------------------------

test('(c) deleting a one-off MEDICATION with no recorded dose through the UI hard-deletes the row, writes the feed row, and stays gone after a reload', async ({
  page,
  context,
  request,
  baseURL,
}) => {
  test.setTimeout(120_000);
  const s = await arrange(request, 'wpmed');
  const name = `ZZ_E2E_WPMED_${uniqueSuffix()}`;
  const nameRe = new RegExp(escapeRegExp(name));
  // Tomorrow, so the "time already passed -> starts with the next dose" rule can't move it.
  const res = await s.api.post(`/api/circles/${s.circleId}/events`, {
    event_type: 'medication',
    title: name,
    medication_name: name,
    medication_dosage: '10mg',
    scheduled_date: s.at(1),
    scheduled_time: '09:00',
  });
  expect(res.status(), await res.text()).toBe(201);
  const id = ((await res.json()) as { data: { event: { id: string } } }).data.event.id;
  expect(eventRow(id), 'seeded').toBeTruthy();
  await cookieLogin(context, s.owner, baseURL);

  const del = await openDeleteDialog(page, s.circleId, s.today, s.at(1), nameRe, 'Delete medication');
  if (falsify('med-delete')) {
    await fakeWrite(page, 'DELETE', EVENT_DELETE_RE, 200, { success: true, data: { message: 'Event deleted successfully' } });
  }
  const answered = responseTo(page, 'DELETE', EVENT_DELETE_RE);
  await del.getByRole('button', { name: 'Delete', exact: true }).click();
  const response = await answered;
  expect(response.status()).toBe(200);
  expect(((await response.json()) as { data: { history_kept?: boolean } }).data.history_kept).toBeUndefined();
  await expect(del).toBeHidden({ timeout: 20_000 });

  if (falsifyPart('med-delete-nofeed')) forgetFeed(s.circleId, id, 'medication_deleted');
  await expect.poll(() => eventRow(id), { timeout: 15_000, message: 'medication row deleted' }).toBeUndefined();
  const feed = feedRows(s.circleId, id, 'medication_deleted');
  expect(feed).toHaveLength(1);
  expect(feed[0].description).toBe(`Deleted Medication: ${name}`);
  expect((await s.api.get(`/api/circles/${s.circleId}/events/${id}`)).status()).toBe(404);
  await expectGoneOnDay(page, s.circleId, s.today, s.at(1), nameRe);
});

// ---------------------------------------------------------------------------
// (d) one-off medication WITH a recorded dose: soft delete (PK3)
// ---------------------------------------------------------------------------

test('(d) deleting a one-off MEDICATION that has a recorded dose through the UI SOFT-deletes it (history kept), writes the feed row, and stays gone after a reload', async ({
  page,
  context,
  request,
  baseURL,
}) => {
  test.setTimeout(120_000);
  const s = await arrange(request, 'wpmedh');
  const name = `ZZ_E2E_WPMEDH_${uniqueSuffix()}`;
  const nameRe = new RegExp(escapeRegExp(name));
  const doseDate = s.at(-1);
  const res = await s.api.post(`/api/circles/${s.circleId}/events`, {
    event_type: 'medication',
    title: name,
    medication_name: name,
    medication_dosage: '10mg',
    scheduled_date: doseDate,
    scheduled_time: '09:00',
  });
  expect(res.status(), await res.text()).toBe(201);
  const id = ((await res.json()) as { data: { event: { id: string } } }).data.event.id;
  // The recorded dose (a precondition, written through the real confirm route).
  const confirm = await s.api.post(`/api/circles/${s.circleId}/medications/confirm`, {
    event_id: id,
    status: 'taken',
    scheduled_time: '09:00:00',
  });
  expect(confirm.status(), await confirm.text()).toBe(201);
  const confirmations = () =>
    dbQuery<{ status: string }>(
      `select status from medication_confirmations where event_id = ${sqlStr(id)}::uuid`
    );
  expect(confirmations()).toHaveLength(1);
  await cookieLogin(context, s.owner, baseURL);

  const del = await openDeleteDialog(page, s.circleId, s.today, doseDate, nameRe, 'Delete medication');
  if (falsify('med-delete-history')) {
    await fakeWrite(page, 'DELETE', EVENT_DELETE_RE, 200, {
      success: true,
      data: { message: 'Event deleted successfully', history_kept: true },
    });
  }
  const answered = responseTo(page, 'DELETE', EVENT_DELETE_RE);
  await del.getByRole('button', { name: 'Delete', exact: true }).click();
  const response = await answered;
  expect(response.status()).toBe(200);
  expect(((await response.json()) as { data: { history_kept?: boolean } }).data.history_kept).toBe(true);
  await expect(del).toBeHidden({ timeout: 20_000 });

  if (falsifyPart('med-delete-history-noconf')) {
    sqlExec(`delete from medication_confirmations where event_id = ${sqlStr(id)}::uuid;`);
  }
  if (falsifyPart('med-delete-history-nostop')) {
    sqlExec(`update calendar_events set discontinued_at = null where id = ${sqlStr(id)}::uuid;`);
  }
  if (falsifyPart('med-delete-history-nofeed')) forgetFeed(s.circleId, id, 'medication_deleted');
  // DB: soft-deleted AND stopped, never hard-deleted; the recorded dose survives.
  await expect
    .poll(() => eventRow(id)?.deleted_at ?? null, { timeout: 15_000, message: 'deleted_at stamped' })
    .not.toBeNull();
  const row = eventRow(id);
  expect(row, 'the row is kept (history)').toBeTruthy();
  expect(row.discontinued_at, 'stopped before it was hidden').not.toBeNull();
  expect(confirmations(), 'the recorded dose is kept').toHaveLength(1);
  const feed = feedRows(s.circleId, id, 'medication_deleted');
  expect(feed).toHaveLength(1);
  expect(feed[0].description).toBe(`Deleted Medication: ${name}`);
  // Hidden from every surface that reads: a fresh API read and a fresh page load.
  expect((await s.api.get(`/api/circles/${s.circleId}/events/${id}`)).status()).toBe(404);
  await expectGoneOnDay(page, s.circleId, s.today, doseDate, nameRe);
});

// ---------------------------------------------------------------------------
// (e) refill decrement on a UI dose confirmation
// ---------------------------------------------------------------------------

test('(e) confirming today\'s dose from Home decrements the bottle: root quantity_remaining 30 -> 29 (DB + API) and the confirmation carries refill_applied_at', async ({
  page,
  context,
  request,
  baseURL,
}) => {
  test.setTimeout(90_000);
  const s = await arrange(request, 'wprefill');
  const name = `ZZ_E2E_WPREFILL_${uniqueSuffix()}`;
  // Started yesterday so today's 00:01 dose is due (a start of TODAY with a past
  // time would be rolled to tomorrow by the late-add rule).
  const root = await createDailyMedication(s.api, s.circleId, name, dateInTz(s.tz, -1), {
    time: '00:01',
    trackRefills: true,
    quantityRemaining: 30,
  });
  try {
    const apiQuantity = async (): Promise<number | null | undefined> => {
      const r = await s.api.get(`/api/circles/${s.circleId}/events/${root}`);
      expect(r.status(), await r.text()).toBe(200);
      return ((await r.json()) as { data: { event: { quantity_remaining: number | null } } }).data.event
        .quantity_remaining;
    };
    // Baseline: a full bottle, no confirmation yet.
    expect(eventRow(root).quantity_remaining).toBe(30);
    expect(await apiQuantity()).toBe(30);

    await cookieLogin(context, s.owner, baseURL);
    await page.goto(`/circles/${s.circleId}`, { waitUntil: 'domcontentloaded' });
    const list = page.locator('section[aria-labelledby="todays-meds-heading"] > ul');
    await expect(list.getByRole('button', { name: `Confirm ${name}` }).first()).toBeVisible({ timeout: 30_000 });

    if (falsify('refill')) {
      await fakeWrite(page, 'POST', CONFIRM_RE, 201, {
        success: true,
        data: {
          confirmation: { status: 'taken', confirmed_at: new Date().toISOString(), confirmed_by: s.owner.userId },
        },
      });
    }
    // The write lands after the 5 s undo window.
    const answered = responseTo(page, 'POST', CONFIRM_RE, 40_000);
    await list.getByRole('button', { name: `Confirm ${name}` }).first().click();
    await expect(list.getByRole('button', { name: `Undo ${name}` })).toBeVisible();
    expect((await answered).status()).toBe(201);
    await expect(page.getByRole('status').filter({ hasText: /^\s*Marked as taken/ })).toBeVisible();

    const confirmationRows = () =>
      dbQuery<{ status: string; refill_applied_at: string | null; refill_applied_pills: number | null }>(
        `select mc.status, mc.refill_applied_at::text, mc.refill_applied_pills
           from medication_confirmations mc join calendar_events ce on ce.id = mc.event_id
          where ce.circle_id = ${sqlStr(s.circleId)}::uuid
            and (ce.id = ${sqlStr(root)}::uuid or ce.parent_event_id = ${sqlStr(root)}::uuid)
            and ce.scheduled_date = ${sqlStr(s.today)}::date`
      );
    await expect
      .poll(() => confirmationRows().length, { timeout: 20_000, message: 'confirmation row persisted' })
      .toBe(1);
    if (falsifyPart('refill-claim')) {
      sqlExec(`update medication_confirmations set refill_applied_at = null where circle_id = ${sqlStr(s.circleId)}::uuid;`);
    }
    if (falsifyPart('refill-quantity')) {
      sqlExec(`update calendar_events set quantity_remaining = 30 where id = ${sqlStr(root)}::uuid;`);
    }
    const [confirmation] = confirmationRows();
    expect(confirmation.status).toMatch(/^taken/);
    expect(confirmation.refill_applied_at, 'the once-only refill claim is stamped').not.toBeNull();
    expect(confirmation.refill_applied_pills).toBe(1);

    // The bottle: DB and a fresh API read agree, on the series ROOT.
    await expect
      .poll(() => eventRow(root).quantity_remaining, { timeout: 20_000, message: 'quantity_remaining decremented' })
      .toBe(29);
    expect(await apiQuantity()).toBe(29);

    // A reload shows the dose answered (nothing to confirm) and the bottle did not move again.
    await page.reload({ waitUntil: 'domcontentloaded' });
    await expect(list.getByRole('listitem').first()).toBeVisible({ timeout: 30_000 });
    await expect(list.getByRole('button', { name: `Confirm ${name}` })).toHaveCount(0);
    expect(eventRow(root).quantity_remaining).toBe(29);
  } finally {
    await deleteSeries(s.api, s.circleId, root);
  }
});

// ---------------------------------------------------------------------------
// (f) task completion: keepalive flush inside the undo window
// ---------------------------------------------------------------------------

test('(f) PK11: Mark complete on the Tasks page then a full navigation INSIDE the undo window delivers the completion (keepalive): completed_at, one feed row, listed as Completed', async ({
  page,
  context,
  request,
  baseURL,
}) => {
  test.setTimeout(90_000);
  const s = await arrange(request, 'wptkeep');
  const title = `ZZ_E2E_WPTKEEP_${uniqueSuffix()}`;
  const task = await apiCreateEvent(s.api, s.circleId, {
    event_type: 'task',
    title,
    scheduled_date: s.today,
  });
  await cookieLogin(context, s.owner, baseURL);

  // Every completion request the browser makes, kept on the CONTEXT: the page
  // that sends the flush is gone by the time it is read.
  const completes: Request[] = [];
  context.on('request', (req) => {
    if (req.method() === 'POST' && COMPLETE_RE.test(new URL(req.url()).pathname)) completes.push(req);
  });
  if (falsify('task-keepalive')) {
    await fakeWrite(context, 'POST', COMPLETE_RE, 200, { success: true, data: { event: { id: task.id } } });
  }

  await page.goto(`/circles/${s.circleId}/tasks`, { waitUntil: 'domcontentloaded' });
  await expect(page.getByRole('heading', { name: 'Tasks', exact: true })).toBeVisible({ timeout: 15_000 });
  const complete = page.getByRole('button', { name: `Mark "${title}" complete` });
  await expect(complete).toBeVisible({ timeout: 20_000 });
  await complete.click();
  // Inside the 5 s window: the row is pending (Undo offered), nothing is written, nothing was sent.
  await expect(page.getByRole('button', { name: /Undo/ }).first()).toBeVisible();
  expect(eventRow(task.id).completed_at, 'nothing is written inside the undo window').toBeNull();
  expect(completes).toHaveLength(0);

  // Leave the page for good INSIDE the window: a full navigation, so the page
  // timer dies with the document and only the pagehide keepalive can deliver it.
  await page.goto(`/circles/${s.circleId}/calendar`, { waitUntil: 'domcontentloaded' });

  await expect
    .poll(() => eventRow(task.id).completed_at, { timeout: 20_000, message: 'completed_at persisted by the flush' })
    .not.toBeNull();
  expect(eventRow(task.id).completed_by).toBe(s.owner.userId);
  // The flush went out as the keepalive FETCH. (The hook also falls back to an
  // axios XHR when that fetch's promise rejects on unload; a document that is
  // going away cannot deliver it -- with the fetch aborted, nothing persists --
  // so the row above is the keepalive's doing.) No route is installed on this
  // path unless falsifying: interception of the keepalive request intermittently
  // dropped it (1 in ~8 runs), so the happy path observes only.
  expect(completes.some((r) => r.resourceType() === 'fetch')).toBe(true);
  if (falsifyPart('task-keepalive-nofeed')) forgetFeed(s.circleId, task.id, 'task_completed');
  await expect
    .poll(() => feedRows(s.circleId, task.id, 'task_completed').length, { timeout: 15_000, message: 'feed row' })
    .toBe(1);
  expect(feedRows(s.circleId, task.id, 'task_completed')[0].description).toBe(`Completed Task: ${title}`);
  // Past the original window nothing else arrives: still exactly one feed row.
  await page.waitForTimeout(6_000);
  expect(feedRows(s.circleId, task.id, 'task_completed')).toHaveLength(1);

  // Reopen Tasks: the task is listed under Completed (a server-backed read).
  await page.goto(`/circles/${s.circleId}/tasks`, { waitUntil: 'domcontentloaded' });
  await expect(page.getByRole('heading', { name: 'Tasks', exact: true })).toBeVisible({ timeout: 15_000 });
  await page.getByRole('button', { name: /^Status:/ }).click();
  const statusMenu = page.getByRole('menu');
  await expect(statusMenu).toBeVisible({ timeout: 10_000 });
  await statusMenu.getByRole('menuitem', { name: 'Completed', exact: true }).click();
  await expect(
    page.getByRole('button', { name: new RegExp(`View details for "${escapeRegExp(title)}"`) })
  ).toBeVisible({ timeout: 25_000 });
  const read = await s.api.get(`/api/circles/${s.circleId}/events/${task.id}`);
  expect(read.status(), await read.text()).toBe(200);
  const event = ((await read.json()) as { data: { event: { completed_at: string | null; completed_by: string | null } } }).data
    .event;
  expect(event.completed_at, 'a fresh API read agrees').not.toBeNull();
  expect(event.completed_by).toBe(s.owner.userId);
});
