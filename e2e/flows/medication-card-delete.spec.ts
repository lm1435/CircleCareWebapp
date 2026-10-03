import type { Page, Request } from '@playwright/test';
import { test, expect } from '../fixtures';
import { dbQuery, sqlStr } from '../unhappy';
import {
  apiSession,
  circleTimezone,
  createDailyMedication,
  dateInTz,
  deleteSeries,
  uniqueSuffix,
  type ApiSession,
} from '../notesFirstClassShared';

// Test-gap audit 2026-09-29, item #1 — the WEB Meds page medication CARD delete.
//
// THE MECHANISM BEFORE THE FIX (same as the mobile Meds-tab prod data loss, 2026-09-27):
// the Meds page card's Delete passes the GROUP'S REPRESENTATIVE row to the
// shared DeleteEventDialog (`MedicationsPage.tsx` `onDelete={(g) =>
// setDeletingEvent(g.event)}`, and the detail sheet's onDelete). For a
// medication whose series root is inside the roster window, the representative
// IS the root (`representativeScore`: root 2 > non-root 0), so the dialog —
// which sees a recurring event — raises the "This dose only / This and all
// future doses" picker and sends the ROOT's own `scheduled_date` (the series
// START date, never shown to the caregiver) as `scheduledDate`
// (`DeleteEventDialog.tsx` onConfirm).
//
// The backend then does exactly what that request says:
//   - "This and all future doses" from the start date: `hasPastInstances` is
//     false (`backend/src/routes/calendarEvents.ts`, `scheduledDate >
//     parentScheduledDate`), so it falls through to the FULL delete — the root,
//     every child and, by CASCADE, every `medication_confirmations` row. The
//     Stage 10 safety net that keeps recorded doses lives only in the
//     `hasPastInstances` branch, so it never runs.
//   - "This dose only": tombstones the START-DATE dose and deletes its
//     confirmation — a recorded dose the caregiver never picked.
//
// Mobile fixed this on 2026-09-27 (`useMedicationActions` `doseScoped`): a
// CARD skips the picker and goes to the whole-medication confirm with the
// line "To stop future doses and keep the history, use Discontinue instead."
// (`medicationHistory.discontinue.deleteInsteadHint`). Web matched it on
// 2026-09-29: MedicationsPage passes `doseScoped={false}` (card + detail
// sheet) and DeleteEventDialog's whole-medication branch sends the series id
// with no scope/date. The calendar's per-dose delete is unchanged.
//
// Layout of this file:
//   - FIXED 2026-09-29 (web now mirrors mobile: MedicationsPage passes
//     `doseScoped={false}` to DeleteEventDialog). BEFORE the fix, two passing
//     proofs here showed, with DB evidence, that card → "This and all future
//     doses" sent `deleteScope=future&scheduledDate=<start date>` (root +
//     children + all 3 recorded doses deleted) and card → "This dose only" sent
//     `scheduledDate=<start date>` (the recorded START-date dose tombstoned and
//     its Taken confirmation deleted). Those steps no longer exist (no picker
//     on a card), so the proofs were retired with the fix;
//   - two contract tests (formerly `test.fail` pins): no picker + whole-med
//     copy + Discontinue hint; one scope-less whole-medication DELETE of the
//     series root, and the DB shows exactly what the copy promised;
//   - PK3 (approved-recs-2026-09-30, B1 backend + B5 clients): the whole-medication delete
//     KEEPS the recorded doses (soft delete: `deleted_at` + `discontinued_at`, hidden from
//     every list, answers `history_kept: true`); a medication with NO recorded dose is still
//     hard-deleted. The FACT test that pinned the old cascade is flipped.
//
// Fixture prefix CARDDEL0929_ is unique to this spec; no cleanup sweep matches
// it. Every created series is deleted in `finally`, and the per-run isolated
// account (and its circle) is purged at teardown anyway.

const MED_PREFIX = 'CARDDEL0929_';

interface Seeded {
  session: ApiSession;
  rootId: string;
  name: string;
  start: string;
  today: string;
  /** The dates marked Taken, and the confirmation ids they produced. */
  takenDates: string[];
  confirmationIds: string[];
  /** Calendar rows (root + children) holding those confirmations. */
  confirmedEventIds: string[];
}

/**
 * A daily medication started 5 days ago (root INSIDE the roster window, so the
 * card's representative is the root) with THREE recorded Taken doses: the
 * start date itself (confirmed against the root id), today-3 and today-1
 * (virtual ids, which the confirm materializes into children).
 */
async function seedMedWithTakenHistory(
  request: Parameters<typeof apiSession>[0],
  account: { email: string; password: string },
  circleId: string
): Promise<Seeded> {
  const session = await apiSession(request, account);
  const tz = await circleTimezone(session, circleId);
  const today = dateInTz(tz, 0);
  const start = dateInTz(tz, -5);
  const name = `${MED_PREFIX}${uniqueSuffix()}`;
  const rootId = await createDailyMedication(session, circleId, name, start, { time: '08:00' });

  const takenDates = [start, dateInTz(tz, -3), dateInTz(tz, -1)];
  for (const date of takenDates) {
    const eventId = date === start ? rootId : `${rootId}_${date}`;
    const res = await session.post(`/api/circles/${circleId}/medications/confirm`, {
      event_id: eventId,
      status: 'taken',
      scheduled_time: '08:00:00',
    });
    if (!res.ok()) throw new Error(`seed confirm ${date} failed: ${res.status()} ${await res.text()}`);
  }

  const rows = dbQuery<{ confirmation_id: string; event_id: string; scheduled_date: string }>(
    `select mc.id as confirmation_id, ce.id as event_id, ce.scheduled_date::text as scheduled_date
       from medication_confirmations mc
       join calendar_events ce on ce.id = mc.event_id
      where ce.id = ${sqlStr(rootId)} or ce.parent_event_id = ${sqlStr(rootId)}`
  );
  expect(rows.map((r) => r.scheduled_date).sort(), 'three recorded doses seeded').toEqual(
    [...takenDates].sort()
  );
  return {
    session,
    rootId,
    name,
    start,
    today,
    takenDates,
    confirmationIds: rows.map((r) => r.confirmation_id),
    confirmedEventIds: rows.map((r) => r.event_id),
  };
}

function inList(ids: string[]): string {
  return ids.map((id) => sqlStr(id)).join(', ');
}

/** Opens the card's "More actions" menu on /meds and picks Delete. Returns the dialog. */
async function openCardDelete(page: Page, circleId: string, name: string) {
  await page.goto(`/circles/${circleId}/meds`, { waitUntil: 'domcontentloaded' });
  const activeRegion = page.getByRole('region', { name: 'Active', exact: true });
  const card = activeRegion.locator('li').filter({ hasText: name });
  await expect(card).toBeVisible({ timeout: 25_000 });
  await card.getByRole('button', { name: `More actions for ${name}` }).click();
  await page.getByRole('menu').getByRole('menuitem', { name: 'Delete', exact: true }).click();
  const dialog = page.getByRole('dialog', { name: 'Delete medication' });
  await expect(dialog).toBeVisible({ timeout: 10_000 });
  return dialog;
}

test.describe('Meds page card → Delete (audit #1)', () => {
  // Audit #1 — FIXED on web 2026-09-29 (mobile parity with 09-27's
  // useMedicationActions `doseScoped`): a card never raises the dose picker.
  test('card Delete is a whole-medication confirm with the Discontinue hint, no scope picker (mobile parity)', async ({
    page,
    request,
    circleId,
    account,
  }) => {
    test.slow();
    const s = await seedMedWithTakenHistory(request, account, circleId);
    try {
      const dialog = await openCardDelete(page, circleId, s.name);
      await expect(dialog.getByRole('radio')).toHaveCount(0, { timeout: 5_000 });
      await expect(dialog.getByRole('radiogroup')).toHaveCount(0);
      // PK3 copy: the med leaves the list and its reminders stop, but doses already recorded stay in
      // the adherence reports; Discontinue is the way to keep it in the Inactive list.
      await expect(dialog).toContainText(
        `Delete "${s.name}"? It will be removed from your medication list and its reminders will stop. Doses already recorded stay in adherence reports. This can't be undone.`
      );
      await expect(dialog).toContainText(
        'To keep it in your Inactive list so you can turn it back on later, use Discontinue instead.'
      );
      // The unseen start date is never the subject of the dialog.
      await expect(dialog).not.toContainText(s.start);
      // Cancel is a no-op: nothing deleted.
      await dialog.getByRole('button', { name: 'Cancel', exact: true }).click();
      await expect(dialog).toHaveCount(0);
      const confirmations = dbQuery<{ id: string }>(
        `select id from medication_confirmations where id in (${inList(s.confirmationIds)})`
      );
      expect(confirmations, 'cancel keeps every recorded dose').toHaveLength(3);
    } finally {
      await deleteSeries(s.session, circleId, s.rootId);
    }
  });

  test('card Delete sends ONE whole-medication DELETE (series id, no scope, no date) — mobile parity', async ({
    page,
    request,
    circleId,
    account,
  }) => {
    // Mobile's card sends `DELETE /events/<series id>` with NO scope and NO
    // date (useMedicationActions.ts `runDelete(med)`, "Never
    // `med.scheduled_date` here"); web's DeleteEventDialog `doseScoped={false}`
    // branch does the same.
    test.slow();
    const s = await seedMedWithTakenHistory(request, account, circleId);
    try {
      const dialog = await openCardDelete(page, circleId, s.name);
      const deleteRequests: Request[] = [];
      page.on('request', (r) => {
        if (r.method() === 'DELETE' && /\/api\/circles\/[^/]+\/events\//.test(r.url())) {
          deleteRequests.push(r);
        }
      });
      const deleteRes = page.waitForResponse(
        (r) => r.request().method() === 'DELETE' && /\/api\/circles\/[^/]+\/events\//.test(r.url())
      );
      await dialog.getByRole('button', { name: 'Delete', exact: true }).click();
      expect((await deleteRes).status(), 'the DELETE itself succeeds').toBe(200);
      await expect(dialog).toHaveCount(0, { timeout: 20_000 });
      expect(deleteRequests, 'exactly one DELETE').toHaveLength(1);
      const url = new URL(deleteRequests[0].url());
      expect(url.pathname.endsWith(`/events/${s.rootId}`)).toBe(true);
      expect(url.searchParams.get('deleteScope'), 'no dose scope from a card').toBeNull();
      expect(url.searchParams.get('scheduledDate'), 'no unseen date from a card').toBeNull();

      // DB: exactly what the confirm said (PK3) — the medication is gone from the app (soft
      // deleted: hidden + stopped) and its recorded doses stay for the reports.
      const seriesRows = dbQuery<{ id: string; deleted: boolean; stopped: boolean }>(
        `select id, deleted_at is not null as deleted, discontinued_at is not null as stopped
           from calendar_events where id = ${sqlStr(s.rootId)} or parent_event_id = ${sqlStr(s.rootId)}`
      );
      expect(seriesRows.length, 'root + children kept after the card delete').toBeGreaterThan(0);
      expect(seriesRows.every((r) => r.deleted && r.stopped), 'every kept row is soft-deleted and stopped').toBe(true);
      const confirmations = dbQuery<{ id: string }>(
        `select id from medication_confirmations where id in (${inList(s.confirmationIds)})`
      );
      expect(confirmations, 'recorded doses after the card delete').toHaveLength(3);
      const feed = dbQuery<{ action_type: string; description: string }>(
        `select action_type, description from activity_feed
          where circle_id = ${sqlStr(circleId)} and subject_id = ${sqlStr(s.rootId)}
            and action_type in ('medication_deleted', 'medication_updated')`
      );
      expect(feed).toEqual([
        { action_type: 'medication_deleted', description: `Deleted Medication: ${s.name}` },
      ]);
      // The card is gone from the roster.
      await expect(
        page.getByRole('region', { name: 'Active', exact: true }).locator('li').filter({ hasText: s.name })
      ).toHaveCount(0, { timeout: 15_000 });
    } finally {
      await deleteSeries(s.session, circleId, s.rootId);
    }
  });

  // PK3 (was "FACT: erases the recorded doses too"): a whole-medication DELETE (no scope) of a
  // med with recorded doses answers history_kept:true, keeps the doses and hides the med from
  // every read; a med with NO recorded dose is hard-deleted exactly as before.
  test('PK3: a whole-medication DELETE keeps the recorded doses (soft delete) and answers history_kept', async ({
    request,
    circleId,
    account,
  }) => {
    const s = await seedMedWithTakenHistory(request, account, circleId);
    try {
      const res = await s.session.delete(`/api/circles/${circleId}/events/${s.rootId}`);
      expect(res.status()).toBe(200);
      expect(((await res.json()) as { data: { history_kept?: boolean } }).data.history_kept).toBe(true);
      const confirmations = dbQuery<{ id: string }>(
        `select id from medication_confirmations where id in (${inList(s.confirmationIds)})`
      );
      expect(confirmations, 'recorded doses after a whole-medication delete').toHaveLength(3);
      const seriesRows = dbQuery<{ deleted: boolean }>(
        `select deleted_at is not null as deleted from calendar_events where id = ${sqlStr(s.rootId)} or parent_event_id = ${sqlStr(s.rootId)}`
      );
      expect(seriesRows.length).toBeGreaterThan(0);
      expect(seriesRows.every((r) => r.deleted)).toBe(true);
      // Hidden from the roster read (the inactive/roster mode too) and from the single-event read.
      const roster = await s.session.get(
        `/api/circles/${circleId}/events?includeDiscontinued=true&includeInactiveRoots=true`
      );
      const names = ((await roster.json()) as { data: { events: { title: string }[] } }).data.events.map((e) => e.title);
      expect(names).not.toContain(s.name);
      expect((await s.session.get(`/api/circles/${circleId}/events/${s.rootId}`)).status()).toBe(404);
    } finally {
      await deleteSeries(s.session, circleId, s.rootId);
    }
  });

  test('PK3: a medication with NO recorded dose is hard-deleted exactly as before (a mistaken entry leaves no trace)', async ({
    request,
    circleId,
    account,
  }) => {
    const session = await apiSession(request, account);
    const tz = await circleTimezone(session, circleId);
    const name = `${MED_PREFIX}${uniqueSuffix()}`;
    const rootId = await createDailyMedication(session, circleId, name, dateInTz(tz, -2), { time: '08:00' });
    try {
      const res = await session.delete(`/api/circles/${circleId}/events/${rootId}`);
      expect(res.status()).toBe(200);
      expect(((await res.json()) as { data: { history_kept?: boolean } }).data.history_kept).toBeUndefined();
      const rows = dbQuery<{ id: string }>(
        `select id from calendar_events where id = ${sqlStr(rootId)} or parent_event_id = ${sqlStr(rootId)}`
      );
      expect(rows).toHaveLength(0);
    } finally {
      await deleteSeries(session, circleId, rootId);
    }
  });
});
