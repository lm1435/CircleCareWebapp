import { test, expect } from '../fixtures';
import { dbQuery, sqlStr } from '../unhappy';
import { checkA11y } from '../helpers';
import {
  apiSession,
  circleTimezone,
  createDailyMedication,
  dateInTz,
  deleteSeries,
  deleteViaMoreMenu,
  escapeRegExp,
  gotoActivitySettled,
  gotoWeekContaining,
  materializeRecurringInstances,
  openChip,
  assertChipAbsent,
  assertChipPresent,
  setProfileLanguage,
  stepWeeks,
  uniqueSuffix,
  weekOffset,
} from '../notesFirstClassShared';

// docs/plans/medication-remove-occurrence.md, Stages 1-3 + 4.2: "This event
// only" on a single dose truly REMOVES it (tombstone), instead of the old
// behaviour (a "Skipped" confirmation that stayed on the calendar and counted
// against adherence). Covers (a) tomorrow's MATERIALIZED dose (the hourly
// materializer's own 3-day forward window: today/+1/+2 — forced here via
// `materialize_recurring_instances()` since it is clock-bound) and (b) a dose
// ~10 days out, which stays VIRTUAL (well beyond that window) until the
// delete mints a tombstoned child for it. Also covers the Activity feed
// entry (EN then ES) per Stage 2.6 / 4.2.

const MED_PREFIX = 'ZZ_E2E_DOSEREMOVE_';

test.describe('medication dose removal: "This dose only" truly removes the dose', () => {
  test('a materialized (tomorrow) dose disappears, stays gone after reload, DB tombstoned, no skip', async ({
    page,
    request,
    circleId,
    account,
  }, testInfo) => {
    test.slow();
    const session = await apiSession(request, account);
    const tz = await circleTimezone(session, circleId);
    const today = dateInTz(tz, 0);
    const tomorrow = dateInTz(tz, 1);
    const dayAfter = dateInTz(tz, 2); // neighbour, must stay intact
    // Start YESTERDAY, never "today": a medication whose own start date is
    // today and whose time-of-day has already passed gets ROLLED to tomorrow
    // by the backend's medication-start-roll (memory project_medication_start_roll)
    // — which would silently shift every date this test hardcodes.
    const start = dateInTz(tz, -1);

    const name = `${MED_PREFIX}materialized_${uniqueSuffix()}`;
    const titleRe = new RegExp(escapeRegExp(name));

    const rootId = await createDailyMedication(session, circleId, name, start);
    try {
      // Force the materializer so tomorrow's dose is a real physical child
      // before we touch it (the hourly cron cannot be relied on in a test).
      materializeRecurringInstances();
      const before = dbQuery<{ id: string }>(
        `select id from calendar_events where parent_event_id = ${sqlStr(rootId)} and scheduled_date = ${sqlStr(tomorrow)}`
      );
      expect(before, 'tomorrow must be a real materialized child before the delete').toHaveLength(1);
      const childId = before[0].id;

      await gotoWeekContaining(page, circleId, today, tomorrow);
      const dialog = await openChip(page, tomorrow, titleRe);
      await deleteViaMoreMenu(page, dialog, 'single');

      await assertChipAbsent(page, tomorrow, titleRe);
      // Neighbours intact. The week view is Sunday-start, so today/tomorrow/
      // dayAfter can straddle a week boundary (Sat: today|tomorrow; Fri:
      // tomorrow|dayAfter) — step to each date's week before asserting on it.
      // Screen is on tomorrow's week here.
      await stepWeeks(page, weekOffset(tomorrow, today));
      await assertChipPresent(page, today, titleRe);
      // Screen is on today's week here.
      await stepWeeks(page, weekOffset(today, dayAfter));
      await assertChipPresent(page, dayAfter, titleRe);

      // New UI state: the calendar with a dose truly gone (no "Skipped"
      // placeholder chip left behind to carry a stray a11y issue).
      await checkA11y(page, `/circles/${circleId}/calendar`, testInfo);

      await page.reload({ waitUntil: 'domcontentloaded' });
      await expect(page.getByRole('grid')).toBeVisible({ timeout: 25_000 });
      // Reload resets the week view to TODAY's week (week lives in useState);
      // on a Saturday tomorrow is in the next week, so step there first.
      await stepWeeks(page, weekOffset(today, tomorrow));
      await assertChipAbsent(page, tomorrow, titleRe);

      // DB: the SAME child row now carries removed_at/removed_by — no new row.
      const after = dbQuery<{ id: string; removed_at: string | null; removed_by: string | null }>(
        `select id, removed_at, removed_by from calendar_events where parent_event_id = ${sqlStr(rootId)} and scheduled_date = ${sqlStr(tomorrow)}`
      );
      expect(after).toHaveLength(1);
      expect(after[0].id).toBe(childId);
      expect(after[0].removed_at).not.toBeNull();
      expect(after[0].removed_by).not.toBeNull();

      // No "Skipped via delete action" confirmation was written.
      const confirmations = dbQuery<{ status: string; notes: string | null }>(
        `select status, notes from medication_confirmations where event_id = ${sqlStr(childId)}`
      );
      expect(confirmations).toHaveLength(0);
    } finally {
      await deleteSeries(session, circleId, rootId);
    }
  });

  test('a virtual dose ~10 days out disappears, stays gone after reload, DB tombstoned, no skip', async ({
    page,
    request,
    circleId,
    account,
  }) => {
    test.slow();
    const session = await apiSession(request, account);
    const tz = await circleTimezone(session, circleId);
    const today = dateInTz(tz, 0);
    const target = dateInTz(tz, 10);
    const neighbourBefore = dateInTz(tz, 9);
    const neighbourAfter = dateInTz(tz, 11);
    const start = dateInTz(tz, -1); // never "today" — see the start-roll note above

    const name = `${MED_PREFIX}virtual_${uniqueSuffix()}`;
    const titleRe = new RegExp(escapeRegExp(name));

    const rootId = await createDailyMedication(session, circleId, name, start);
    try {
      const beforeChild = dbQuery<{ id: string }>(
        `select id from calendar_events where parent_event_id = ${sqlStr(rootId)} and scheduled_date = ${sqlStr(target)}`
      );
      expect(beforeChild, 'the target day must be virtual (no physical child) before the delete').toHaveLength(0);

      await gotoWeekContaining(page, circleId, today, target);
      const dialog = await openChip(page, target, titleRe);
      await deleteViaMoreMenu(page, dialog, 'single');

      await assertChipAbsent(page, target, titleRe);
      // Sunday-start weeks: neighbourBefore/target/neighbourAfter can straddle
      // a week boundary (Thu: +9|+10; Wed: +10|+11) — step to each neighbour's
      // week first. Screen is on target's week here.
      await stepWeeks(page, weekOffset(target, neighbourBefore));
      await assertChipPresent(page, neighbourBefore, titleRe);
      // Screen is on neighbourBefore's week here.
      await stepWeeks(page, weekOffset(neighbourBefore, neighbourAfter));
      await assertChipPresent(page, neighbourAfter, titleRe);

      await page.reload({ waitUntil: 'domcontentloaded' });
      await expect(page.getByRole('grid')).toBeVisible({ timeout: 25_000 });
      await gotoWeekContaining(page, circleId, today, target);
      await assertChipAbsent(page, target, titleRe);

      // DB: a NEW child row was minted for that date, tombstoned.
      const afterChild = dbQuery<{ id: string; parent_event_id: string; removed_at: string | null }>(
        `select id, parent_event_id, removed_at from calendar_events where parent_event_id = ${sqlStr(rootId)} and scheduled_date = ${sqlStr(target)}`
      );
      expect(afterChild).toHaveLength(1);
      expect(afterChild[0].removed_at).not.toBeNull();

      const confirmations = dbQuery<{ status: string }>(
        `select status from medication_confirmations where event_id = ${sqlStr(afterChild[0].id)}`
      );
      expect(confirmations).toHaveLength(0);
    } finally {
      await deleteSeries(session, circleId, rootId);
    }
  });

  test('the Activity feed shows "Removed dose" in English, then in Spanish after switching, then switches back', async ({
    page,
    request,
    circleId,
    account,
  }, testInfo) => {
    test.slow();
    const session = await apiSession(request, account);
    const tz = await circleTimezone(session, circleId);
    const today = dateInTz(tz, 0);
    const target = dateInTz(tz, 5);
    const start = dateInTz(tz, -1); // never "today" — see the start-roll note above

    const name = `${MED_PREFIX}activity_${uniqueSuffix()}`;
    const titleRe = new RegExp(escapeRegExp(name));

    const rootId = await createDailyMedication(session, circleId, name, start);
    try {
      await gotoWeekContaining(page, circleId, today, target);
      const dialog = await openChip(page, target, titleRe);
      await deleteViaMoreMenu(page, dialog, 'single');
      await assertChipAbsent(page, target, titleRe);

      // --- English activity entry, with a FORMATTED date (not raw ISO) ---
      // `.first()`: the same row also mirrors into a "Latest" highlight
      // region elsewhere on the page — both copies carry identical text.
      //
      // The row renders the server's raw-ISO `description` fallback until the
      // care recipient's timezone resolves (activityTranslation.ts's
      // documented "Case 4"), then re-renders through the formatted
      // description_key renderer — a real, intentional, short-lived state,
      // not a bug. `not.toContainText` is a RETRYING assertion, so it waits
      // out that window instead of sampling it once.
      await gotoActivitySettled(page, circleId);
      const enRow = page.getByText(new RegExp(`Removed dose: ${escapeRegExp(name)} on `)).first();
      await expect(enRow).toBeVisible({ timeout: 25_000 });
      await expect(enRow).not.toContainText(target, { timeout: 15_000 }); // never the raw YYYY-MM-DD

      // New UI state: an Activity row for the new medicationOccurrenceRemoved action_type.
      await checkA11y(page, `/circles/${circleId}/activity`, testInfo);

      // --- Switch the profile language to Spanish ---
      await setProfileLanguage(page, 'es');

      await gotoActivitySettled(page, circleId);
      const esRow = page.getByText(new RegExp(`Dosis eliminada: ${escapeRegExp(name)} el `)).first();
      await expect(esRow).toBeVisible({ timeout: 25_000 });
      await expect(esRow).not.toContainText(target, { timeout: 15_000 });
    } finally {
      // --- Switch back to English regardless of outcome (shared worker slot) ---
      await setProfileLanguage(page, 'en').catch(() => {});
      await deleteSeries(session, circleId, rootId);
    }
  });
});
