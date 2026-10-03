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
  gotoWeekContaining,
  markDoseTaken,
  openChip,
  uniqueSuffix,
} from '../notesFirstClassShared';

// docs/plans/medication-remove-occurrence.md, Stage 10: "This and future"
// deleted from an EARLIER day than an already-taken dose used to erase that
// taken dose (recorded doses are real history). Fix: the future-scope delete
// excludes any candidate child that already has a medication_confirmations
// row (any status) from the batch it deletes, and sets recurrence_end_date to
// the day BEFORE the cut. This spec proves the production bug (7 occurrences)
// is fixed: mark a dose taken, then delete "this and future" from an earlier
// day, and the taken dose + its confirmation must survive.

const MED_PREFIX = 'ZZ_E2E_FUTKEEP_';

test.describe('medication "This and future" never deletes a recorded dose', () => {
  test('a taken past dose survives a "this and future" delete from an earlier day', async ({
    page,
    request,
    circleId,
    account,
  }, testInfo) => {
    test.slow();
    const session = await apiSession(request, account);
    const tz = await circleTimezone(session, circleId);
    const today = dateInTz(tz, 0);
    const start = dateInTz(tz, -10);
    const takenDay = dateInTz(tz, -5); // will be marked Taken
    const cutDay = dateInTz(tz, -7); // "This and future" fired from HERE — earlier than takenDay
    const dayBeforeCut = dateInTz(tz, -8);

    const name = `${MED_PREFIX}${uniqueSuffix()}`;
    const titleRe = new RegExp(escapeRegExp(name));

    const rootId = await createDailyMedication(session, circleId, name, start);
    try {
      // --- Mark the takenDay dose Taken (still virtual at this point) ---
      await gotoWeekContaining(page, circleId, today, takenDay);
      {
        const dialog = await openChip(page, takenDay, titleRe);
        await markDoseTaken(page, dialog);
      }

      const takenChildBefore = dbQuery<{ id: string }>(
        `select id from calendar_events where parent_event_id = ${sqlStr(rootId)} and scheduled_date = ${sqlStr(takenDay)}`
      );
      expect(takenChildBefore, 'marking Taken must have materialized a real child').toHaveLength(1);
      const takenChildId = takenChildBefore[0].id;
      const confirmationsBefore = dbQuery<{ id: string; status: string }>(
        `select id, status from medication_confirmations where event_id = ${sqlStr(takenChildId)}`
      );
      expect(confirmationsBefore).toHaveLength(1);

      // --- "This and future" from cutDay, EARLIER than takenDay ---
      await gotoWeekContaining(page, circleId, today, cutDay);
      const cutDialog = await openChip(page, cutDay, titleRe);
      await deleteViaMoreMenu(page, cutDialog, 'future');

      // --- DB: recurrence_end_date set to the day before the cut ---
      const rootRow = dbQuery<{ recurrence_end_date: string | null }>(
        `select recurrence_end_date from calendar_events where id = ${sqlStr(rootId)}`
      );
      expect(rootRow).toHaveLength(1);
      expect(rootRow[0].recurrence_end_date).toBe(dayBeforeCut);

      // --- DB: the taken dose + its confirmation are KEPT, same row id ---
      const takenChildAfter = dbQuery<{ id: string; removed_at: string | null }>(
        `select id, removed_at from calendar_events where id = ${sqlStr(takenChildId)}`
      );
      expect(takenChildAfter).toHaveLength(1);
      expect(takenChildAfter[0].removed_at).toBeNull();
      const confirmationsAfter = dbQuery<{ id: string; status: string }>(
        `select id, status from medication_confirmations where event_id = ${sqlStr(takenChildId)}`
      );
      expect(confirmationsAfter).toHaveLength(1);
      expect(confirmationsAfter[0].id).toBe(confirmationsBefore[0].id);
      expect(['taken', 'taken_late']).toContain(confirmationsAfter[0].status);

      // --- Calendar still shows the taken dose, marked Taken ---
      await gotoWeekContaining(page, circleId, today, takenDay);
      {
        const dialog = await openChip(page, takenDay, titleRe);
        await expect(dialog.getByText(/^Taken(?: late)? at/)).toBeVisible({ timeout: 10_000 });
        // New UI state: a kept, still-Taken dose surviving a "this and future" cut.
        await checkA11y(page, `/circles/${circleId}/calendar`, testInfo);
        await page.getByRole('button', { name: 'Close event details' }).click();
        await expect(page.getByRole('dialog')).toHaveCount(0, { timeout: 10_000 });
      }
    } finally {
      await deleteSeries(session, circleId, rootId);
    }
  });
});
