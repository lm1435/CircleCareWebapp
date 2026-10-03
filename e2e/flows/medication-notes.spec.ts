import type { Locator, Page } from '@playwright/test';
import { test, expect } from '../fixtures';
import { apiSession, dbQuery, sqlStr, type ApiSession } from '../unhappy';
import { expandAllDayOverflow } from '../helpers';

// Regression coverage for the event-note SERIES-LEAK bug (proven live
// 2026-09-27; evidence: scratchpad case1*.json/.mjs).
//
// webapp/src/components/calendar/EventDetailModal.tsx passed `scheduledDate`
// to <EventNotesPanel> only when `event.is_virtual || event.parent_event_id`.
// A persisted series ROOT rendered on ITS OWN start date (not virtual, no
// parent_event_id — exactly a freshly-created recurring medication/task's
// first dose) fell through that gate and got `scheduledDate: undefined`.
// api/eventNotes.ts then sent the POST with no `scheduled_date`, so
// backend/src/routes/eventNotes.ts attached the note directly to the ROOT
// row instead of materializing a per-occurrence child — and its GET handler
// ALWAYS unions the root id into every date's query (~eventNotes.ts:320-338),
// so a note added on the series' first day rendered on EVERY occurrence.
// Proven live: one first-day note surfaced on 20 doses opened across 3 weeks.
//
// Fix: also gate on `event.recurrence_rule`, so the series ROOT on its own
// day passes its own scheduled_date like any other recurring row. The
// backend then materializes a child at (root, S) via
// `resolveOrMaterializeOccurrence({ opts: { ownDate: 'materialize' } })` and
// re-points a start-date confirmation onto it (eventNotes.ts ~153-187).
//
// This spec creates its series via a direct authenticated API call
// (`apiSession`, per e2e/unhappy.ts) — same established pattern as
// flows/medications.spec.ts's `createDailyMed`, which also starts series in
// the past with no UI minimum-date restriction — then drives every
// note/visibility/Taken-status assertion through the REAL browser UI against
// the live backend, per e2e/README.md's isolation model (`test`/`circleId`/
// `account` fixtures; the isolated account's own circle; cleanup via a
// targeted API delete in each test's `finally`).

const MED_PREFIX = 'ZZ_E2E_NOTES_MED_';
const TASK_PREFIX = 'ZZ_E2E_NOTES_TASK_';

function uniqueSuffix(): string {
  return `${Date.now()}-${Math.floor(Math.random() * 1e4)}`;
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

// --- Date math, all in the CARE RECIPIENT's timezone -----------------------
//
// CalendarPage computes `todayStr`/the week anchor via `getDateInTimezone`
// (the RECIPIENT's tz), never device-local — so every date this spec creates
// or navigates to must be computed the same way, or "6 days ago" here and
// "6 days ago" on screen can disagree by a day near a boundary.

function toUTCms(dateStr: string): number {
  const [y, m, d] = dateStr.split('-').map(Number);
  return Date.UTC(y, m - 1, d);
}

function addDaysISO(dateStr: string, days: number): string {
  return new Date(toUTCms(dateStr) + days * 86_400_000).toISOString().slice(0, 10);
}

function dayOfWeek(dateStr: string): number {
  // 0 = Sunday .. 6 = Saturday, matching the app's Sunday-start week.
  return new Date(toUTCms(dateStr)).getUTCDay();
}

/** Whole weeks from the week containing `fromDate` to the week containing `toDate`. */
function weekOffset(fromDate: string, toDate: string): number {
  const fromWeekStart = addDaysISO(fromDate, -dayOfWeek(fromDate));
  const toWeekStart = addDaysISO(toDate, -dayOfWeek(toDate));
  return Math.round((toUTCms(toWeekStart) - toUTCms(fromWeekStart)) / (7 * 86_400_000));
}

function dateInTz(tz: string, offsetDays: number): string {
  const now = new Date(Date.now() + offsetDays * 86_400_000);
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: tz,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(now);
}

async function circleTimezone(session: ApiSession, circleId: string): Promise<string> {
  const res = await session.get(`/api/circles/${circleId}`);
  if (!res.ok()) {
    throw new Error(`GET /api/circles/${circleId} failed: ${res.status()} ${await res.text()}`);
  }
  const body = (await res.json()) as { data?: { circle?: { care_recipient_timezone?: string } } };
  return body?.data?.circle?.care_recipient_timezone || 'America/New_York';
}

// --- Event creation (API) ---------------------------------------------------

interface CreatedEvent {
  id: string;
}

async function createDailyMedication(
  session: ApiSession,
  circleId: string,
  name: string,
  startDate: string
): Promise<string> {
  const res = await session.post(`/api/circles/${circleId}/events`, {
    event_type: 'medication',
    title: name,
    medication_name: name,
    medication_dosage: '10mg',
    scheduled_date: startDate,
    scheduled_time: '08:00',
    recurrence_rule: 'daily',
  });
  if (!res.ok()) {
    throw new Error(`create daily medication failed: ${res.status()} ${await res.text()}`);
  }
  const body = (await res.json()) as { data: { event: CreatedEvent } };
  return body.data.event.id;
}

async function createDailyTask(
  session: ApiSession,
  circleId: string,
  title: string,
  startDate: string
): Promise<string> {
  const res = await session.post(`/api/circles/${circleId}/events`, {
    event_type: 'task',
    title,
    scheduled_date: startDate,
    recurrence_rule: 'daily',
  });
  if (!res.ok()) {
    throw new Error(`create daily task failed: ${res.status()} ${await res.text()}`);
  }
  const body = (await res.json()) as { data: { event: CreatedEvent } };
  return body.data.event.id;
}

async function deleteSeries(session: ApiSession, circleId: string, rootId: string): Promise<void> {
  await session.delete(`/api/circles/${circleId}/events/${rootId}?deleteScope=series`).catch(() => {});
}

/**
 * The note's own `event_id`, polled. The UI assertion right before this call
 * already proves the note round-tripped through a real POST + refetched GET
 * (no optimistic cache update in useCreateNote — see its onSuccess), so this
 * is belt-and-suspenders against any residual replication/visibility lag
 * between the app's Supabase client and this spec's separate `psql`
 * connection, not evidence the write itself is asynchronous.
 */
async function pollNoteEventId(circleId: string, noteBody: string): Promise<string> {
  let found: string | undefined;
  await expect
    .poll(
      () => {
        found = dbQuery<{ event_id: string }>(
          `select event_id from event_notes where circle_id = ${sqlStr(circleId)} and body = ${sqlStr(noteBody)}`
        )[0]?.event_id;
        return found;
      },
      { timeout: 10_000, message: `event_notes row for body ${JSON.stringify(noteBody)}` }
    )
    .not.toBeUndefined();
  return found!;
}

// --- Calendar navigation -----------------------------------------------------

async function gotoCalendarSettled(page: Page, circleId: string): Promise<void> {
  await page.goto(`/circles/${circleId}/calendar`, { waitUntil: 'domcontentloaded' });
  await expect(page.getByRole('grid')).toBeVisible({ timeout: 25_000 });
}

const WEEK_RANGE_HEADING = /^[A-Z][a-z]{2} \d{1,2} – [A-Z][a-z]{2} \d{1,2}, \d{4}$/;

async function stepWeeks(page: Page, weeks: number): Promise<void> {
  if (weeks === 0) return;
  const label = weeks < 0 ? 'Previous week' : 'Next week';
  const range = page.getByRole('heading', { level: 2, name: WEEK_RANGE_HEADING });
  for (let i = 0; i < Math.abs(weeks); i++) {
    await expect(range).toBeVisible({ timeout: 25_000 });
    const from = (await range.textContent())?.trim() ?? '';
    await page.getByRole('button', { name: label }).click();
    await expect(range, `week range moved off "${from}"`).not.toHaveText(from, { timeout: 25_000 });
  }
  await expect(page.getByRole('grid')).toBeVisible({ timeout: 25_000 });
}

/** The WeekView gridcell for `date` — works for both the timed grid (medications) and the all-day row (tasks); both mark `data-date`. */
function dayCell(page: Page, date: string): Locator {
  return page.locator(`[role="gridcell"][data-date="${date}"]`);
}

async function gotoWeekContaining(
  page: Page,
  circleId: string,
  todayInTz: string,
  date: string
): Promise<void> {
  await gotoCalendarSettled(page, circleId);
  await stepWeeks(page, weekOffset(todayInTz, date));
  await expandAllDayOverflow(page);
  await expect(dayCell(page, date).first()).toBeVisible({ timeout: 20_000 });
}

// --- Notes UI helpers --------------------------------------------------------

async function openChip(page: Page, date: string, titleRe: RegExp): Promise<Locator> {
  const chip = dayCell(page, date).getByRole('button', { name: titleRe });
  await expect(chip.first()).toBeVisible({ timeout: 20_000 });
  await chip.first().click();
  const dialog = page.getByRole('dialog');
  await expect(dialog).toBeVisible({ timeout: 10_000 });
  // exact: true — the med/task title itself contains "NOTES" (MED_PREFIX /
  // TASK_PREFIX), which would otherwise substring-match the modal's OWN h2
  // title heading too (Playwright role-name matching is substring by
  // default) and make this a strict-mode violation.
  await expect(dialog.getByRole('heading', { name: 'Notes', exact: true })).toBeVisible({
    timeout: 10_000,
  });
  return dialog;
}

async function closeDialog(page: Page): Promise<void> {
  await page.getByRole('button', { name: 'Close event details' }).click();
  await expect(page.getByRole('dialog')).toHaveCount(0, { timeout: 10_000 });
}

async function addNoteOnDay(
  page: Page,
  date: string,
  titleRe: RegExp,
  noteBody: string
): Promise<void> {
  const dialog = await openChip(page, date, titleRe);
  await dialog.locator('#event-note-composer').fill(noteBody);
  await dialog.getByRole('button', { name: 'Add note' }).click();
  await expect(dialog.getByText(noteBody)).toBeVisible({ timeout: 25_000 });
  await closeDialog(page);
}

async function assertNoNoteOnDay(
  page: Page,
  date: string,
  titleRe: RegExp,
  noteBody: string
): Promise<void> {
  const dialog = await openChip(page, date, titleRe);
  await expect(dialog.getByText('No notes yet.')).toBeVisible({ timeout: 25_000 });
  await expect(dialog.getByText(noteBody)).toHaveCount(0);
  await closeDialog(page);
}

test.describe('event notes: series-leak regression', () => {
  test('a note on the FIRST-DAY dose of a daily medication stays on that day only', async ({
    page,
    request,
    circleId,
    account,
  }) => {
    test.slow(); // multi-day navigation across 3 weeks
    const session = await apiSession(request, account);
    const tz = await circleTimezone(session, circleId);
    const today = dateInTz(tz, 0);
    const S = dateInTz(tz, -6); // first-day dose, started ~6 days ago
    const pastChild = dateInTz(tz, -3); // a day strictly between S and today
    const futureDay = dateInTz(tz, 4); // a future (virtual) day

    const name = `${MED_PREFIX}leak_${uniqueSuffix()}`;
    const titleRe = new RegExp(escapeRegExp(name));
    const noteBody = `CASE-A note posted on the first-day dose ${uniqueSuffix()}`;

    const rootId = await createDailyMedication(session, circleId, name, S);
    try {
      await gotoWeekContaining(page, circleId, today, S);
      await addNoteOnDay(page, S, titleRe, noteBody);

      // The note must show on S...
      await gotoWeekContaining(page, circleId, today, S);
      {
        const dialog = await openChip(page, S, titleRe);
        await expect(dialog.getByText(noteBody)).toBeVisible({ timeout: 25_000 });
        await closeDialog(page);
      }

      // ...and NOWHERE else: a past occurrence, today, and a future
      // (virtual) occurrence must all show "No notes yet."
      await gotoWeekContaining(page, circleId, today, pastChild);
      await assertNoNoteOnDay(page, pastChild, titleRe, noteBody);

      await gotoWeekContaining(page, circleId, today, today);
      await assertNoNoteOnDay(page, today, titleRe, noteBody);

      await gotoWeekContaining(page, circleId, today, futureDay);
      await assertNoNoteOnDay(page, futureDay, titleRe, noteBody);

      // DB proof: the note hangs off a CHILD at (root, S), never the root.
      const noteEventId = await pollNoteEventId(circleId, noteBody);
      expect(noteEventId).not.toBe(rootId);

      const childRows = dbQuery<{ id: string; parent_event_id: string | null; scheduled_date: string }>(
        `select id, parent_event_id, scheduled_date from calendar_events where id = ${sqlStr(noteEventId)}`
      );
      expect(childRows).toHaveLength(1);
      expect(childRows[0].parent_event_id).toBe(rootId);
      expect(childRows[0].scheduled_date).toBe(S);
    } finally {
      await deleteSeries(session, circleId, rootId);
    }
  });

  test('a first-day dose marked Taken, then noted, is still Taken after reload', async ({
    page,
    request,
    circleId,
    account,
  }) => {
    test.slow();
    const session = await apiSession(request, account);
    const tz = await circleTimezone(session, circleId);
    const today = dateInTz(tz, 0);
    const S = dateInTz(tz, -6);

    const name = `${MED_PREFIX}taken_${uniqueSuffix()}`;
    const titleRe = new RegExp(escapeRegExp(name));
    const noteBody = `CASE-B note after Taken ${uniqueSuffix()}`;

    const rootId = await createDailyMedication(session, circleId, name, S);
    try {
      await gotoWeekContaining(page, circleId, today, S);

      // --- Mark the first-day dose Taken ---
      {
        const dialog = await openChip(page, S, titleRe);
        await dialog.getByRole('button', { name: 'Mark taken' }).click();
        const confirmDialog = page.getByRole('dialog', { name: 'Confirm medication' });
        await expect(confirmDialog).toBeVisible({ timeout: 10_000 });
        await confirmDialog.getByRole('button', { name: 'Save' }).click();
        await expect(confirmDialog).toBeHidden({ timeout: 20_000 });
      }

      // --- Then add a note on the SAME first-day dose ---
      await gotoWeekContaining(page, circleId, today, S);
      await addNoteOnDay(page, S, titleRe, noteBody);

      // DB proof: the confirmation moved onto the note's minted child (the
      // note POST re-points a start-date confirmation, eventNotes.ts ~153-187).
      const childId = await pollNoteEventId(circleId, noteBody);
      expect(childId).not.toBe(rootId);

      // A dose confirmed 6 days after it was scheduled is auto-detected LATE
      // (medicationConfirmations.ts `isConfirmationLate`) — either status
      // proves the confirmation moved onto the child; only 'skipped' would be
      // wrong here.
      const confirmationsOnChild = dbQuery<{ status: string }>(
        `select status from medication_confirmations where circle_id = ${sqlStr(circleId)} and event_id = ${sqlStr(childId)}`
      );
      expect(confirmationsOnChild).toHaveLength(1);
      expect(['taken', 'taken_late']).toContain(confirmationsOnChild[0].status);

      const confirmationsOnRoot = dbQuery<{ status: string }>(
        `select status from medication_confirmations where circle_id = ${sqlStr(circleId)} and event_id = ${sqlStr(rootId)}`
      );
      expect(confirmationsOnRoot).toHaveLength(0);

      // --- Reload the whole page and reopen S: still Taken ---
      //
      // A full reload resets CalendarPage's week to TODAY's — `anchorOverride`
      // is plain `useState`, never persisted to the URL — so the previously
      // navigated week (S's) is NOT necessarily what's on screen after
      // `page.reload()`. Re-navigate explicitly rather than assuming reload
      // preserves the view (it doesn't, and asserting straight off the
      // default week is flaky whenever S falls outside it).
      await page.reload({ waitUntil: 'domcontentloaded' });
      await expect(page.getByRole('grid')).toBeVisible({ timeout: 25_000 });
      await stepWeeks(page, weekOffset(today, S));
      await expandAllDayOverflow(page);
      {
        const dialog = await openChip(page, S, titleRe);
        // "Taken at …" or "Taken late at …" (see the confirmationsOnChild
        // comment above) — either proves the Taken status survived the
        // reload on the CHILD row the note materialized.
        await expect(dialog.getByText(/^Taken(?: late)? at/)).toBeVisible({ timeout: 10_000 });
        await expect(dialog.getByText(noteBody)).toBeVisible();
        await closeDialog(page);
      }
    } finally {
      await deleteSeries(session, circleId, rootId);
    }
  });

  test('a note on a future virtual day of a daily medication stays on that day only', async ({
    page,
    request,
    circleId,
    account,
  }) => {
    test.slow();
    const session = await apiSession(request, account);
    const tz = await circleTimezone(session, circleId);
    const today = dateInTz(tz, 0);
    const start = dateInTz(tz, -2); // started recently — far-future dose stays virtual
    const futureVirtual = dateInTz(tz, 10);
    const anotherFuture = dateInTz(tz, 12);

    const name = `${MED_PREFIX}future_${uniqueSuffix()}`;
    const titleRe = new RegExp(escapeRegExp(name));
    const noteBody = `CASE-C note on a future virtual day ${uniqueSuffix()}`;

    const rootId = await createDailyMedication(session, circleId, name, start);
    try {
      await gotoWeekContaining(page, circleId, today, futureVirtual);
      await addNoteOnDay(page, futureVirtual, titleRe, noteBody);

      await gotoWeekContaining(page, circleId, today, futureVirtual);
      {
        const dialog = await openChip(page, futureVirtual, titleRe);
        await expect(dialog.getByText(noteBody)).toBeVisible({ timeout: 25_000 });
        await closeDialog(page);
      }

      await gotoWeekContaining(page, circleId, today, today);
      await assertNoNoteOnDay(page, today, titleRe, noteBody);

      await gotoWeekContaining(page, circleId, today, anotherFuture);
      await assertNoNoteOnDay(page, anotherFuture, titleRe, noteBody);
    } finally {
      await deleteSeries(session, circleId, rootId);
    }
  });

  test('a task series first-day note stays on that day only', async ({
    page,
    request,
    circleId,
    account,
  }) => {
    test.slow();
    const session = await apiSession(request, account);
    const tz = await circleTimezone(session, circleId);
    const today = dateInTz(tz, 0);
    const S = dateInTz(tz, -6);
    const futureDay = dateInTz(tz, 4);

    const title = `${TASK_PREFIX}leak_${uniqueSuffix()}`;
    const titleRe = new RegExp(escapeRegExp(title));
    const noteBody = `CASE-D task note on first day ${uniqueSuffix()}`;

    const rootId = await createDailyTask(session, circleId, title, S);
    try {
      await gotoWeekContaining(page, circleId, today, S);
      await addNoteOnDay(page, S, titleRe, noteBody);

      await gotoWeekContaining(page, circleId, today, S);
      {
        const dialog = await openChip(page, S, titleRe);
        await expect(dialog.getByText(noteBody)).toBeVisible({ timeout: 25_000 });
        await closeDialog(page);
      }

      await gotoWeekContaining(page, circleId, today, today);
      await assertNoNoteOnDay(page, today, titleRe, noteBody);

      await gotoWeekContaining(page, circleId, today, futureDay);
      await assertNoNoteOnDay(page, futureDay, titleRe, noteBody);
    } finally {
      await deleteSeries(session, circleId, rootId);
    }
  });
});
