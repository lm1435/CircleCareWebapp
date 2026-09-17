import { execFileSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { appendFileSync, mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import type { Page } from '@playwright/test';
import { test, expect } from '../fixtures';
import type { IsolatedAccount } from '../isolation';

// ===========================================================================
// BEFORE / AFTER PROOF — "completing a recurring occurrence stamps THAT day".
//
// THE BUG. `POST /circles/:id/events/:eventId/complete` stamps exactly the row
// id it is handed. Every client addresses a recurring series by its ROOT
// (`parent_event_id || id`) because a later occurrence is often VIRTUAL — the
// backend synthesises it with a composite id (`${rootId}_${date}`) that matches
// no `id` column. So a body-less POST for Wednesday's chore stamped the
// series' FIRST day: the tapped day stayed open, and a day weeks earlier
// silently read "done". Production: 14 wrong rows across 7 households, 26% of
// all real recurring task/appointment series.
//
// THE FIX has two halves and they deploy in this order:
//   1. BACKEND (already deployed): the route accepts an optional
//      `scheduled_date`, resolves the occurrence's own physical row under that
//      root, materialises one if the day is past the horizon, and stamps THAT.
//      With no date it behaves exactly as it always did, which is what lets it
//      ship ahead of the clients.
//   2. CLIENT (EventDetailActions.tsx): post the series ROOT plus that date for
//      a VIRTUAL occurrence, and every physical row by its own id.
//
//      The rule used to be written here (and implemented) as "send the date
//      whenever the id being posted is not the row on screen". That is an
//      IDENTITY test standing in for a DISCRIMINATOR, and it is wrong in both
//      directions: a materialized child's id already is the row on screen, so
//      it sent no date and needed none, while clearing a series' recurrence
//      rule leaves past off-pattern children that must still be posted by their
//      own id. The implementation now keys on `is_virtual === true` (absent
//      means physical), which is the only flag that answers "does this id name
//      a real row?".
//
// So "before" in this spec means NEW BACKEND + OLD CLIENT — the real-world
// window between the two deploys, and the only "before" worth proving against.
// The backend is never reverted. Only the client's one-line date-passing is,
// in place, between the two runs.
//
// WHAT MAKES THIS A PROOF AND NOT A UI TEST. Every scenario is asserted against
// the DATABASE: the spec snapshots the series' rows before the click, snapshots
// them after, and reports which row's `completed_at` went from NULL to set,
// what date that row is for, whether it is the series root, and whether the
// request created a row that did not exist. A UI assertion cannot see any of
// that — and in the "before" run the UI actually LOOKS correct (the separate
// modal-staleness fix is not reverted), which is precisely why the bug survived
// in production for months.
//
// FIXTURE. Mimics the heaviest-hit production household ("Andy", created
// 2026-08-14, 6 members, 62 task rows, 134 medication rows, 4 mis-stamps over
// ten days): a 6-member circle, several daily task series and a weekly
// appointment series that all started weeks ago, plus three daily medication
// series and scattered one-offs as noise. Every row is tagged and the whole
// circle is deleted in afterAll (FKs to care_circles all cascade).
//
// RUN:
//   PW_PROOF_MODE=after  PW_PROOF_OUT=/tmp/proof-after.jsonl  \
//     npx playwright test e2e/flows/recurring-complete-proof.spec.ts \
//     --project=chromium --workers=1 --retries=0
//   (then revert the client date-passing in place, and repeat with
//    PW_PROOF_MODE=before)
//
// The mode is a LABEL plus the expectation set. In `after` each scenario
// asserts the correct row was stamped; in `before` each scenario asserts the
// BUG — the series root was stamped instead. So a `before` run that passes is
// evidence the revert really took effect, and a `before` run that fails means
// the harness never reached the old behaviour.
// ===========================================================================

type ProofMode = 'before' | 'after';

const MODE: ProofMode = process.env.PW_PROOF_MODE === 'before' ? 'before' : 'after';

const DB_URL =
  process.env.PW_DB_URL ?? 'postgresql://postgres:postgres@127.0.0.1:55322/postgres';

const OUT_PATH =
  process.env.PW_PROOF_OUT ?? `/tmp/recurring-complete-proof-${MODE}.jsonl`;

// The five seeded SATELLITE members the fixture circle is populated with. The
// OWNER is this worker's isolated account (the `account` fixture), so the
// circle, its members' rows and every event below belong to a household no
// other worker can see — the DB assertions are scoped to `CIRCLE_ID`, which is
// minted per worker process.
const SATELLITE_EMAILS = [
  'tom@demo.circlecare.app',
  'lisa@demo.circlecare.app',
  'margaret@demo.circlecare.app',
  'robert@demo.circlecare.app',
  'carlos@demo.circlecare.app',
];

/** Distinctive prefix on the circle, the care recipient and EVERY event title. */
const TAG = 'E2EAB';

// ---------------------------------------------------------------------------
// Postgres access. `psql` rather than a driver: this repo's webapp has no
// database dependency and this spec must not add one. Every read is wrapped in
// `json_agg` so the result parses as typed JSON instead of column-aligned text.
// ---------------------------------------------------------------------------

function psql(args: string[]): string {
  return execFileSync('psql', [DB_URL, '-v', 'ON_ERROR_STOP=1', ...args], {
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
  });
}

function sqlRows<T>(query: string): T[] {
  const out = psql(['-t', '-A', '-c', `select coalesce(json_agg(t), '[]'::json)::text from (${query}) t`]);
  return JSON.parse(out.trim()) as T[];
}

function sqlExec(statement: string): void {
  psql(['-q', '-c', statement]);
}

// ---------------------------------------------------------------------------
// Naive-date helpers. `scheduled_date` is a NAIVE local date in the care
// recipient's timezone, so every date here is computed as a string anchored at
// noon UTC — never device-local `Date` arithmetic, which drifts across DST.
// ---------------------------------------------------------------------------

/** IANA zone the fixture circle renders in (its members are all America/Denver). */
const CIRCLE_TZ = 'America/Denver';

function todayIn(timeZone: string): string {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(new Date());
}

function addDays(dateStr: string, days: number): string {
  const d = new Date(`${dateStr}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

function datesBetween(from: string, to: string): string[] {
  const out: string[] = [];
  for (let d = from; d <= to; d = addDays(d, 1)) out.push(d);
  return out;
}

/** 0 = Sunday, matching the `recurrence_days` convention used across the app. */
function weekdayOf(dateStr: string): number {
  return new Date(`${dateStr}T12:00:00Z`).getUTCDay();
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function monthKey(dateStr: string): string {
  return dateStr.slice(0, 7);
}

function monthsApart(from: string, to: string): number {
  const [fy, fm] = from.split('-').map(Number);
  const [ty, tm] = to.split('-').map(Number);
  return (ty * 12 + tm) - (fy * 12 + fm);
}

// ---------------------------------------------------------------------------
// Fixture shape
// ---------------------------------------------------------------------------

interface EventRow {
  id: string;
  scheduled_date: string;
  scheduled_time: string | null;
  parent_event_id: string | null;
  completed_at: string | null;
  title: string;
}

interface SeriesFixture {
  /** Stable handle used by the scenarios below. */
  key: string;
  /** The series ROOT row id (the id an old client posts for every occurrence). */
  rootId: string;
  title: string;
  eventType: 'task' | 'appointment' | 'medication';
  recurrenceRule: string | null;
  startDate: string;
  scheduledTime: string | null;
  /** Dates that already have a PHYSICAL child row (i.e. the materializer ran). */
  materialized: string[];
}

interface ProofRecord {
  mode: ProofMode;
  scenario: string;
  what: string;
  seriesTitle: string;
  seriesStartDate: string;
  clickedDate: string;
  postedEventId: string;
  postedEventIsSeriesRoot: boolean;
  requestBody: string;
  stampedRowId: string;
  stampedRowDate: string;
  stampedRowIsSeriesRoot: boolean;
  stampedRowCreatedByRequest: boolean;
  rootStamped: boolean;
  rowsCreatedByRequest: number;
  stampedRowsInSeries: number;
  correct: boolean;
}

const RUN_ID = `${Date.now()}`;
const CIRCLE_ID = randomUUID();

const TODAY = todayIn(CIRCLE_TZ);

// Series roots. Ids are minted here so every DB assertion below addresses rows
// by id, never by title lookup.
function makeSeries(): Record<string, SeriesFixture> {
  const dailyStart = addDays(TODAY, -21);
  const horizon = datesBetween(addDays(TODAY, -7), addDays(TODAY, 2));
  const apptStart = addDays(TODAY, -14);

  const daily = (key: string, name: string): SeriesFixture => ({
    key,
    rootId: randomUUID(),
    title: `${TAG} ${name} ${RUN_ID}`,
    eventType: 'task',
    recurrenceRule: 'daily',
    startDate: dailyStart,
    scheduledTime: null,
    materialized: horizon,
  });

  return {
    // Scenario 1 — today's occurrence.
    today: daily('today', 'Morning walk'),
    // Scenario 2 — one day out.
    plus1: daily('plus1', 'Blood pressure log'),
    // Scenario 2 — two days out.
    plus2: daily('plus2', 'Water the plants'),
    // Scenario 3 — thirty days out: deliberately NOT materialized.
    plus30: daily('plus30', 'Change bed linens'),
    // Scenario 5 — the series' own first day.
    rootDay: daily('rootDay', 'Evening check in'),
    // Scenario 7 — completed twice.
    doubleTap: daily('doubleTap', 'Sort the mail'),
    // Scenario 4 — a recurring APPOINTMENT, not a task.
    appointment: {
      key: 'appointment',
      rootId: randomUUID(),
      title: `${TAG} Physical therapy ${RUN_ID}`,
      eventType: 'appointment',
      recurrenceRule: 'weekly',
      startDate: apptStart,
      scheduledTime: '10:00:00',
      materialized: [addDays(TODAY, -7), TODAY],
    },
    // Scenario 6 — a ONE-OFF task, which must be untouched by any of this.
    oneOff: {
      key: 'oneOff',
      rootId: randomUUID(),
      title: `${TAG} Call the pharmacy ${RUN_ID}`,
      eventType: 'task',
      recurrenceRule: null,
      startDate: TODAY,
      scheduledTime: null,
      materialized: [],
    },
  };
}

const SERIES = makeSeries();

let memberIds: string[] = [];
let ownerId = '';

// ---------------------------------------------------------------------------
// Seed / teardown
// ---------------------------------------------------------------------------

function sqlStr(value: string | null): string {
  return value === null ? 'NULL' : `'${value.replace(/'/g, "''")}'`;
}

function seedFixture(owner: IsolatedAccount): void {
  const satellites = sqlRows<{ id: string; email: string }>(
    `select id, email from users
      where email in (${SATELLITE_EMAILS.map((e) => sqlStr(e)).join(', ')})
      order by email`
  );
  expect(satellites.length, 'seeded satellite members are present in the local database').toBe(
    SATELLITE_EMAILS.length
  );
  ownerId = owner.userId;
  memberIds = [ownerId, ...satellites.map((u) => u.id)];

  // The circle: 6 members, created ~3.5 weeks ago — the Andy household's shape.
  sqlExec(`
    insert into care_circles (id, owner_id, name, recipient_name, created_at, updated_at)
    values (${sqlStr(CIRCLE_ID)}, ${sqlStr(ownerId)},
            ${sqlStr(`${TAG} Andy ${RUN_ID}`)}, ${sqlStr(`${TAG} Andy ${RUN_ID}`)},
            now() - interval '24 days', now());
  `);

  const memberValues = memberIds
    .map((id, i) => {
      const role = i === 0 ? 'owner' : 'member';
      // One member is flagged the care recipient, so the calendar's timezone
      // resolves through the normal chain (recipient -> owner -> default)
      // rather than the fallback.
      const isRecipient = i === 3 ? 'true' : 'false';
      return `(${sqlStr(CIRCLE_ID)}, ${sqlStr(id)}, ${sqlStr(role)}, ${isRecipient})`;
    })
    .join(',\n');
  sqlExec(`
    insert into circle_memberships (circle_id, user_id, role, is_care_recipient)
    values ${memberValues};
  `);

  // Every row: notifications_enabled = false, so a fixture can never queue a push.
  const values: string[] = [];
  const pushRow = (
    id: string,
    eventType: string,
    title: string,
    date: string,
    time: string | null,
    rule: string | null,
    days: number[] | null,
    parentId: string | null,
    medName: string | null,
    medDosage: string | null,
    assignee: string
  ): void => {
    values.push(
      `(${sqlStr(id)}, ${sqlStr(CIRCLE_ID)}, ${sqlStr(eventType)}, ${sqlStr(title)}, ` +
        `${sqlStr(date)}, ${time === null ? 'NULL' : sqlStr(time)}, ` +
        `${rule === null ? 'NULL' : sqlStr(rule)}, ` +
        `${days === null ? 'NULL' : `'{${days.join(',')}}'::int[]`}, ` +
        `${parentId === null ? 'NULL' : sqlStr(parentId)}, ` +
        `${sqlStr(ownerId)}, ${sqlStr(assignee)}, ` +
        `${medName === null ? 'NULL' : sqlStr(medName)}, ` +
        `${medDosage === null ? 'NULL' : sqlStr(medDosage)}, false)`
    );
  };

  let assigneeCursor = 0;
  const nextAssignee = (): string => memberIds[assigneeCursor++ % memberIds.length];

  for (const s of Object.values(SERIES)) {
    const days = s.recurrenceRule === 'weekly' ? [weekdayOf(s.startDate)] : null;
    pushRow(
      s.rootId,
      s.eventType,
      s.title,
      s.startDate,
      s.scheduledTime,
      s.recurrenceRule,
      days,
      null,
      null,
      null,
      nextAssignee()
    );
    for (const date of s.materialized) {
      if (date === s.startDate) continue; // the root row IS its own first day
      pushRow(
        randomUUID(),
        s.eventType,
        s.title,
        date,
        s.scheduledTime,
        null,
        null,
        s.rootId,
        null,
        null,
        nextAssignee()
      );
    }
  }

  // Medication noise — the Andy household carried 134 medication rows. Three
  // daily series with materialized children; none is ever completed here (a
  // dose is confirmed, not completed), they exist so the calendar under test is
  // a busy one.
  const medDates = datesBetween(addDays(TODAY, -14), addDays(TODAY, 2));
  const meds: Array<[string, string, string]> = [
    ['Metformin', '500 mg', '08:00:00'],
    ['Lisinopril', '10 mg', '13:00:00'],
    ['Atorvastatin', '20 mg', '20:00:00'],
  ];
  for (const [name, dosage, time] of meds) {
    const rootId = randomUUID();
    const title = `${TAG} ${name} ${RUN_ID}`;
    pushRow(rootId, 'medication', title, addDays(TODAY, -21), time, 'daily', null, null, title, dosage, nextAssignee());
    for (const date of medDates) {
      pushRow(randomUUID(), 'medication', title, date, time, null, null, rootId, title, dosage, nextAssignee());
    }
  }

  // Scattered one-off noise, so no day under test holds only the row we click.
  const noise = [-10, -6, -3, -1, 1, 4, 9, 12];
  noise.forEach((offset, i) => {
    pushRow(
      randomUUID(),
      i % 2 === 0 ? 'task' : 'appointment',
      `${TAG} Errand ${i + 1} ${RUN_ID}`,
      addDays(TODAY, offset),
      i % 2 === 0 ? null : '15:30:00',
      null,
      null,
      null,
      null,
      null,
      nextAssignee()
    );
  });

  sqlExec(`
    insert into calendar_events
      (id, circle_id, event_type, title, scheduled_date, scheduled_time,
       recurrence_rule, recurrence_days, parent_event_id, created_by, assigned_to,
       medication_name, medication_dosage, notifications_enabled)
    values
      ${values.join(',\n')};
  `);
}

function fixtureRowCounts(): Record<string, number> {
  const [row] = sqlRows<Record<string, number>>(`
    select
      (select count(*) from care_circles where id = ${sqlStr(CIRCLE_ID)}) as circles,
      (select count(*) from circle_memberships where circle_id = ${sqlStr(CIRCLE_ID)}) as memberships,
      (select count(*) from calendar_events where circle_id = ${sqlStr(CIRCLE_ID)}) as events,
      (select count(*) from activity_feed where circle_id = ${sqlStr(CIRCLE_ID)}) as activity,
      (select count(*) from care_circles where name like ${sqlStr(`${TAG}%`)}) as tagged_circles,
      (select count(*) from calendar_events where title like ${sqlStr(`${TAG}%`)}) as tagged_events
  `);
  return row;
}

// ---------------------------------------------------------------------------
// Observation
// ---------------------------------------------------------------------------

function seriesRows(rootId: string): EventRow[] {
  return sqlRows<EventRow>(
    `select id, scheduled_date, scheduled_time, parent_event_id, completed_at, title
       from calendar_events
      where id = ${sqlStr(rootId)} or parent_event_id = ${sqlStr(rootId)}
      order by scheduled_date, id`
  );
}

function recordProof(record: ProofRecord): void {
  mkdirSync(dirname(OUT_PATH), { recursive: true });
  appendFileSync(OUT_PATH, `${JSON.stringify(record)}\n`, 'utf8');
}

// ---------------------------------------------------------------------------
// UI driving. Everything runs in MONTH view: its day cells carry `data-date`
// and its side panel lists that day's events as buttons, so any occurrence —
// today, +30, or three weeks back — is reached the same way, with no all-day
// overflow handling and no week paging.
// ---------------------------------------------------------------------------

const MONTH_GRID = 'Month view calendar';
const DAY_PANEL = 'Events for the selected day';

async function openMonthView(page: Page): Promise<void> {
  await page.goto(`/circles/${CIRCLE_ID}/calendar`, { waitUntil: 'domcontentloaded' });
  await page.getByRole('tab', { name: 'Month' }).click();
  await expect(page.getByRole('grid', { name: MONTH_GRID })).toBeVisible({ timeout: 30_000 });
}

/** Page the month view until `date`'s own month is the anchor. */
async function goToMonthOf(page: Page, date: string): Promise<void> {
  const delta = monthsApart(monthKey(TODAY), monthKey(date));
  const label = delta > 0 ? 'Next month' : 'Previous month';
  for (let i = 0; i < Math.abs(delta); i += 1) {
    await page.getByRole('button', { name: label }).click();
  }
  await expect(page.locator(`[data-date="${date}"]`)).toBeAttached({ timeout: 20_000 });
}

interface CompletionRequest {
  path: string;
  body: string;
  postedEventId: string;
}

/**
 * Open `date`'s occurrence of `title` and press Mark complete.
 * Returns the completion request the CLIENT actually sent — the whole point of
 * the before/after comparison, so it is captured off the wire, not inferred.
 */
async function completeOccurrence(
  page: Page,
  date: string,
  title: string
): Promise<CompletionRequest> {
  const cell = page.locator(`[data-date="${date}"]`);
  await expect(cell).toBeAttached({ timeout: 20_000 });
  await cell.click();

  const panel = page.getByLabel(DAY_PANEL);
  const row = panel.getByRole('button', { name: new RegExp(escapeRegExp(title)) }).first();
  await expect(row, `an occurrence of "${title}" is drawn on ${date}`).toBeVisible({
    timeout: 20_000,
  });
  await row.click();

  const detail = page.getByRole('dialog');
  await expect(detail).toBeVisible({ timeout: 20_000 });

  const [request] = await Promise.all([
    page.waitForRequest(
      (r) => r.method() === 'POST' && r.url().includes('/complete'),
      { timeout: 20_000 }
    ),
    detail.getByRole('button', { name: 'Mark complete' }).click(),
  ]);
  await expect(page.getByText('Marked complete')).toBeVisible({ timeout: 25_000 });

  const url = new URL(request.url());
  const match = url.pathname.match(/\/events\/([^/]+)\/complete$/);
  expect(match, `completion URL names an event id: ${url.pathname}`).toBeTruthy();

  return {
    path: url.pathname,
    body: request.postData() ?? '(no request body)',
    postedEventId: match![1],
  };
}

interface Observation {
  stamped: EventRow | null;
  created: EventRow[];
  rootStamped: boolean;
  stampedCount: number;
  /** Rows whose `completed_at` went from NULL to set between the snapshots. */
  newlyStampedCount: number;
}

function observe(rootId: string, before: EventRow[], after: EventRow[]): Observation {
  const beforeById = new Map(before.map((r) => [r.id, r]));
  const newlyStamped = after.filter(
    (r) => r.completed_at !== null && (beforeById.get(r.id)?.completed_at ?? null) === null
  );
  const created = after.filter((r) => !beforeById.has(r.id));
  const root = after.find((r) => r.id === rootId) ?? null;
  return {
    stamped: newlyStamped[0] ?? null,
    created,
    rootStamped: root?.completed_at != null,
    stampedCount: after.filter((r) => r.completed_at !== null).length,
    newlyStampedCount: newlyStamped.length,
  };
}

/**
 * Record one scenario and assert the outcome THIS MODE must produce.
 * `expectedDate` / `expectedIsRoot` are what the run under test must show; a
 * `before` run asserting the bug is what proves the revert actually took.
 */
function settle(args: {
  scenario: string;
  what: string;
  series: SeriesFixture;
  clickedDate: string;
  request: CompletionRequest;
  observation: Observation;
  expectedDate: string;
  expectedIsRoot: boolean;
  expectedCreatedRows: number;
}): void {
  const { series, observation, request } = args;
  const stamped = observation.stamped;
  // The COUNT, not just "the first newly stamped row exists": a completion that
  // stamped the tapped day AND the series root would otherwise pass, with
  // `stamped` naming whichever row happened to sort first.
  expect(
    observation.newlyStampedCount,
    `${args.scenario}: exactly one row went from open to completed`
  ).toBe(1);
  expect(stamped, `${args.scenario}: the newly completed row`).toBeTruthy();

  const record: ProofRecord = {
    mode: MODE,
    scenario: args.scenario,
    what: args.what,
    seriesTitle: series.title,
    seriesStartDate: series.startDate,
    clickedDate: args.clickedDate,
    postedEventId: request.postedEventId,
    postedEventIsSeriesRoot: request.postedEventId === series.rootId,
    requestBody: request.body,
    stampedRowId: stamped!.id,
    stampedRowDate: stamped!.scheduled_date,
    stampedRowIsSeriesRoot: stamped!.id === series.rootId,
    stampedRowCreatedByRequest: observation.created.some((r) => r.id === stamped!.id),
    rootStamped: observation.rootStamped,
    rowsCreatedByRequest: observation.created.length,
    stampedRowsInSeries: observation.stampedCount,
    correct: stamped!.scheduled_date === args.clickedDate,
  };
  recordProof(record);

  expect(stamped!.scheduled_date, `${args.scenario}: date of the row that got stamped`).toBe(
    args.expectedDate
  );
  expect(stamped!.id === series.rootId, `${args.scenario}: the stamped row is the series root`).toBe(
    args.expectedIsRoot
  );
  expect(observation.created.length, `${args.scenario}: rows created by the request`).toBe(
    args.expectedCreatedRows
  );
}

// ---------------------------------------------------------------------------

test.describe.configure({ mode: 'serial' });

test.describe(`recurring completion — DB-level proof (${MODE} the client fix)`, () => {
  test.beforeAll(({ account }) => {
    // A missing local database is a harness failure, not a passing test.
    sqlRows<{ ok: number }>('select 1 as ok');
    seedFixture(account);
  });

  test.afterAll(() => {
    // Every FK to care_circles is ON DELETE CASCADE, so one delete removes the
    // memberships, the events and the activity-feed rows the completions wrote.
    sqlExec(`delete from care_circles where id = ${sqlStr(CIRCLE_ID)};`);
    const counts = fixtureRowCounts();
    recordProof({
      mode: MODE,
      scenario: 'cleanup',
      what: 'fixture rows remaining after teardown',
      seriesTitle: `${TAG} Andy ${RUN_ID}`,
      seriesStartDate: '',
      clickedDate: '',
      postedEventId: '',
      postedEventIsSeriesRoot: false,
      requestBody: JSON.stringify(counts),
      stampedRowId: '',
      stampedRowDate: '',
      stampedRowIsSeriesRoot: false,
      stampedRowCreatedByRequest: false,
      rootStamped: false,
      rowsCreatedByRequest: 0,
      stampedRowsInSeries: 0,
      correct:
        counts.circles === 0 &&
        counts.memberships === 0 &&
        counts.events === 0 &&
        counts.activity === 0,
    });
    expect(counts.circles, 'fixture circle rows left behind').toBe(0);
    expect(counts.memberships, 'fixture membership rows left behind').toBe(0);
    expect(counts.events, 'fixture calendar_events rows left behind').toBe(0);
    expect(counts.activity, 'fixture activity_feed rows left behind').toBe(0);
  });

  // -------------------------------------------------------------------------
  // 1 + 8. Today's occurrence of a daily series that started three weeks ago,
  // and the open modal reflecting the completion with no close/reopen.
  // -------------------------------------------------------------------------
  test('1 + 8. today’s occurrence of a daily task, and the modal in place', async ({ page }) => {
    const series = SERIES.today;
    const before = seriesRows(series.rootId);
    await openMonthView(page);
    await goToMonthOf(page, TODAY);
    const request = await completeOccurrence(page, TODAY, series.title);

    // SCENARIO 8, asserted on the SAME dialog with no reload and no close: the
    // detail modal draws its "Completed on / Completed by" row from the parent
    // page's snapshot, which a completion does not refresh by itself. This half
    // of the fix is NOT reverted between runs — so in the `before` run the modal
    // says "completed" while the database has stamped a day three weeks back.
    // That is exactly how the bug stayed invisible in production.
    const detail = page.getByRole('dialog');
    await expect(detail.getByText(/^Completed (on|by)$/)).toBeVisible({ timeout: 20_000 });
    await expect(detail.getByRole('button', { name: 'Mark complete' })).toHaveCount(0);

    const observation = observe(series.rootId, before, seriesRows(series.rootId));
    settle({
      scenario: '1. today',
      what: "today's occurrence of a daily task series that started 21 days ago",
      series,
      clickedDate: TODAY,
      request,
      observation,
      expectedDate: MODE === 'after' ? TODAY : series.startDate,
      expectedIsRoot: MODE === 'before',
      expectedCreatedRows: 0,
    });
  });

  // -------------------------------------------------------------------------
  // 2. One and two days out — inside the materializer horizon, so a real child
  //    row already exists for the day being clicked.
  // -------------------------------------------------------------------------
  for (const [offset, key, scenario] of [
    [1, 'plus1', '2a. +1 day'],
    [2, 'plus2', '2b. +2 days'],
  ] as Array<[number, keyof typeof SERIES, string]>) {
    test(`${scenario} out, with a materialized row already on the day`, async ({ page }) => {
      const series = SERIES[key];
      const target = addDays(TODAY, offset);
      expect(series.materialized, 'the fixture materialized this day').toContain(target);

      const before = seriesRows(series.rootId);
      await openMonthView(page);
      await goToMonthOf(page, target);
      const request = await completeOccurrence(page, target, series.title);
      const observation = observe(series.rootId, before, seriesRows(series.rootId));

      settle({
        scenario,
        what: `occurrence ${offset} day(s) out; a physical row for that day already existed`,
        series,
        clickedDate: target,
        request,
        observation,
        expectedDate: MODE === 'after' ? target : series.startDate,
        expectedIsRoot: MODE === 'before',
        expectedCreatedRows: 0,
      });
    });
  }

  // -------------------------------------------------------------------------
  // 3. Thirty days out — well past the materializer horizon. No row exists for
  //    that day at all; the calendar drew a VIRTUAL occurrence whose id
  //    (`${rootId}_${date}`) matches no row, so the server has to create one.
  // -------------------------------------------------------------------------
  test('3. +30 days, past the horizon — the server must create the row', async ({ page }) => {
    const series = SERIES.plus30;
    const target = addDays(TODAY, 30);
    const before = seriesRows(series.rootId);
    expect(
      before.some((r) => r.scheduled_date === target),
      'the fixture deliberately left this day unmaterialized'
    ).toBe(false);

    await openMonthView(page);
    await goToMonthOf(page, target);
    const request = await completeOccurrence(page, target, series.title);
    const observation = observe(series.rootId, before, seriesRows(series.rootId));

    settle({
      scenario: '3. +30 days (virtual)',
      what: 'occurrence 30 days out; NO row existed for that day beforehand',
      series,
      clickedDate: target,
      request,
      observation,
      expectedDate: MODE === 'after' ? target : series.startDate,
      expectedIsRoot: MODE === 'before',
      // The fixed client's date makes the server materialize the day it is
      // stamping. The old client creates nothing — it just re-stamps the root.
      expectedCreatedRows: MODE === 'after' ? 1 : 0,
    });
  });

  // -------------------------------------------------------------------------
  // 4. A recurring APPOINTMENT, not a task — same code path, different type,
  //    and the type production mis-stamped alongside tasks.
  // -------------------------------------------------------------------------
  test('4. a recurring appointment occurrence', async ({ page }) => {
    const series = SERIES.appointment;
    const target = TODAY;
    const before = seriesRows(series.rootId);

    await openMonthView(page);
    await goToMonthOf(page, target);
    const request = await completeOccurrence(page, target, series.title);
    const observation = observe(series.rootId, before, seriesRows(series.rootId));

    settle({
      scenario: '4. appointment',
      what: "today's occurrence of a WEEKLY appointment series that started 14 days ago",
      series,
      clickedDate: target,
      request,
      observation,
      expectedDate: MODE === 'after' ? target : series.startDate,
      expectedIsRoot: MODE === 'before',
      expectedCreatedRows: 0,
    });
  });

  // -------------------------------------------------------------------------
  // 5. The series' OWN first day. The root row IS that occurrence, so the fixed
  //    client sends no date at all and the request is byte-identical to the old
  //    one. Both modes must stamp the root and create NO child — a child there
  //    would leave the day holding two rows, one done and one open.
  // -------------------------------------------------------------------------
  test('5. the series’ own first day — stamps the root, creates no child', async ({ page }) => {
    const series = SERIES.rootDay;
    const target = series.startDate;
    const before = seriesRows(series.rootId);

    await openMonthView(page);
    await goToMonthOf(page, target);
    const request = await completeOccurrence(page, target, series.title);
    const observation = observe(series.rootId, before, seriesRows(series.rootId));

    expect(request.body, 'no date is sent for the row that IS the occurrence').toBe(
      '(no request body)'
    );

    settle({
      scenario: '5. series first day',
      what: "the series' own start date, 21 days ago — the root row IS that occurrence",
      series,
      clickedDate: target,
      request,
      observation,
      expectedDate: target,
      expectedIsRoot: true,
      expectedCreatedRows: 0,
    });
  });

  // -------------------------------------------------------------------------
  // 6. A ONE-OFF task. Nothing about it is recurring, so both clients post its
  //    own id with no body and stamp itself. This is the no-regression check.
  // -------------------------------------------------------------------------
  test('6. a one-off task is unaffected', async ({ page }) => {
    const series = SERIES.oneOff;
    const before = seriesRows(series.rootId);

    await openMonthView(page);
    await goToMonthOf(page, series.startDate);
    const request = await completeOccurrence(page, series.startDate, series.title);
    const observation = observe(series.rootId, before, seriesRows(series.rootId));

    expect(request.postedEventId, 'a one-off posts its own id').toBe(series.rootId);
    expect(request.body, 'a one-off sends no body, in either mode').toBe('(no request body)');

    settle({
      scenario: '6. one-off task',
      what: 'a non-recurring task due today',
      series,
      clickedDate: series.startDate,
      request,
      observation,
      expectedDate: series.startDate,
      expectedIsRoot: true,
      expectedCreatedRows: 0,
    });
  });

  // -------------------------------------------------------------------------
  // 7. Idempotence / double tap.
  //
  //    HONESTY NOTE. A second tap cannot be reached through the UI: once the
  //    first completion lands, EventDetailActions drops "Mark complete" from
  //    the modal in place. So the second tap is REPLAYED at the network level —
  //    the exact URL and body the client just sent, re-posted with the same
  //    account's bearer token. That is what a double-tap would put on the wire
  //    if the button were still there, and it is also what a retry or a second
  //    caregiver's device produces.
  // -------------------------------------------------------------------------
  test('7. completing the same occurrence twice creates no second row', async ({
    page,
    account,
  }) => {
    const series = SERIES.doubleTap;
    const target = addDays(TODAY, 2);
    const before = seriesRows(series.rootId);

    await openMonthView(page);
    await goToMonthOf(page, target);
    const request = await completeOccurrence(page, target, series.title);
    const afterFirst = seriesRows(series.rootId);
    const firstObservation = observe(series.rootId, before, afterFirst);

    settle({
      scenario: '7a. first tap',
      what: 'first completion of the +2 occurrence',
      series,
      clickedDate: target,
      request,
      observation: firstObservation,
      expectedDate: MODE === 'after' ? target : series.startDate,
      expectedIsRoot: MODE === 'before',
      expectedCreatedRows: 0,
    });

    // Replay tap two.
    const login = await page.request.post('/api/auth/login', {
      data: { email: account.email, password: account.password },
    });
    expect(login.ok(), 'replay login succeeded').toBe(true);
    const session = (await login.json()) as { data: { session: { access_token: string } } };

    const replay = await page.request.post(request.path, {
      headers: { Authorization: `Bearer ${session.data.session.access_token}` },
      ...(request.body === '(no request body)'
        ? {}
        : { data: JSON.parse(request.body) as Record<string, string> }),
    });
    expect(replay.ok(), `replayed completion returned ${replay.status()}`).toBe(true);

    const afterSecond = seriesRows(series.rootId);
    const second = observe(series.rootId, afterFirst, afterSecond);

    recordProof({
      mode: MODE,
      scenario: '7b. second tap (replayed)',
      what: 'the identical completion request, sent a second time',
      seriesTitle: series.title,
      seriesStartDate: series.startDate,
      clickedDate: target,
      postedEventId: request.postedEventId,
      postedEventIsSeriesRoot: request.postedEventId === series.rootId,
      requestBody: request.body,
      stampedRowId: second.stamped?.id ?? '(nothing newly stamped)',
      stampedRowDate: second.stamped?.scheduled_date ?? '(nothing newly stamped)',
      stampedRowIsSeriesRoot: second.stamped?.id === series.rootId,
      stampedRowCreatedByRequest: false,
      rootStamped: second.rootStamped,
      rowsCreatedByRequest: second.created.length,
      stampedRowsInSeries: second.stampedCount,
      correct: second.created.length === 0 && second.stampedCount === afterFirst.filter((r) => r.completed_at !== null).length,
    });

    expect(second.created.length, 'the second tap created no row').toBe(0);
    expect(afterSecond.length, 'the series has the same number of rows as after tap one').toBe(
      afterFirst.length
    );
    expect(second.stampedCount, 'the series holds exactly one completed row').toBe(1);
  });
});
