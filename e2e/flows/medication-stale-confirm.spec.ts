import { test, expect } from '../fixtures';
import { dbQuery, sqlStr } from '../unhappy';
import { checkA11y } from '../helpers';
import {
  apiSession,
  circleTimezone,
  createDailyMedication,
  dateInTz,
  deleteSeries,
  escapeRegExp,
  gotoWeekContaining,
  openChip,
  uniqueSuffix,
} from '../notesFirstClassShared';

// docs/plans/medication-remove-occurrence.md, Stages 2.3 + 8: a confirm
// (Mark taken / Save) that races a concurrent "This dose only" delete of the
// SAME dose must be refused with 409 OCCURRENCE_REMOVED and write nothing —
// never a silent success that resurrects a confirmation on a dose the
// caregiver just removed. Covers both address forms the confirm route can
// receive for the SAME logical dose:
//   (1) a later, non-start-date occurrence — addressed as the VIRTUAL
//       composite id (`${root}_${date}`) while it is still unmaterialized;
//   (2) the series' FIRST-DAY dose — addressed as the PLAIN series ROOT id
//       (GET /events represents a root's own start date with the root row
//       itself, not a composite id), exercising Stage 8's "plain root id
//       whose own date carries a removed child" 409 path.
// In both cases the dialog is opened FIRST (capturing the stale id), the dose
// is removed out from under it via a direct API call, and only THEN is Save
// pressed on the still-open, stale dialog.

const MED_PREFIX = 'ZZ_E2E_STALECONF_';

test.describe('a stale Confirm dialog on a removed dose', () => {
  test('a later occurrence: Save shows "dose was removed" and writes no confirmation', async ({
    page,
    request,
    circleId,
    account,
  }, testInfo) => {
    test.slow();
    const session = await apiSession(request, account);
    const tz = await circleTimezone(session, circleId);
    const today = dateInTz(tz, 0);
    // A PAST, non-start-date occurrence: due (so "Mark taken" is offered —
    // a FUTURE date, tried first, correctly has no confirm affordance at
    // all, since the dose isn't due yet) and still virtual (materialize_
    // recurring_instances() only ever fills forward, today/+1/+2, never the
    // past, so nothing backfills it).
    const start = dateInTz(tz, -5);
    const target = dateInTz(tz, -2);

    const name = `${MED_PREFIX}later_${uniqueSuffix()}`;
    const titleRe = new RegExp(escapeRegExp(name));

    const rootId = await createDailyMedication(session, circleId, name, start);
    try {
      await gotoWeekContaining(page, circleId, today, target);
      const detailDialog = await openChip(page, target, titleRe);
      await detailDialog.getByRole('button', { name: 'Mark taken' }).click();
      const confirmDialog = page.getByRole('dialog', { name: 'Confirm medication' });
      await expect(confirmDialog).toBeVisible({ timeout: 10_000 });

      // Remove the SAME dose from under the open dialog.
      const delRes = await session.delete(
        `/api/circles/${circleId}/events/${rootId}?deleteScope=single&scheduledDate=${target}`
      );
      expect(delRes.ok(), `DELETE single failed: ${delRes.status()} ${await delRes.text()}`).toBe(true);

      // Now submit the STALE dialog.
      await confirmDialog.getByRole('button', { name: 'Save' }).click();
      await expect(confirmDialog.getByRole('alert')).toHaveText(
        'This dose was removed from the schedule.',
        { timeout: 15_000 }
      );
      // The dialog is still open (not a success close).
      await expect(confirmDialog).toBeVisible();
      // New UI state: the confirm dialog's OCCURRENCE_REMOVED error copy.
      await checkA11y(page, `/circles/${circleId}/calendar`, testInfo);
      await confirmDialog.getByRole('button', { name: 'Cancel' }).click();
      await expect(confirmDialog).toHaveCount(0, { timeout: 10_000 });

      const childRows = dbQuery<{ id: string; removed_at: string | null }>(
        `select id, removed_at from calendar_events where parent_event_id = ${sqlStr(rootId)} and scheduled_date = ${sqlStr(target)}`
      );
      expect(childRows).toHaveLength(1);
      expect(childRows[0].removed_at).not.toBeNull();
      const confirmations = dbQuery<{ id: string }>(
        `select id from medication_confirmations where event_id = ${sqlStr(childRows[0].id)}`
      );
      expect(confirmations, 'no confirmation must have been written').toHaveLength(0);
    } finally {
      await deleteSeries(session, circleId, rootId);
    }
  });

  test('the series FIRST-DAY dose (plain root id): Save shows "dose was removed" and writes no confirmation', async ({
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

    const name = `${MED_PREFIX}firstday_${uniqueSuffix()}`;
    const titleRe = new RegExp(escapeRegExp(name));

    const rootId = await createDailyMedication(session, circleId, name, S);
    try {
      await gotoWeekContaining(page, circleId, today, S);
      const detailDialog = await openChip(page, S, titleRe);
      await detailDialog.getByRole('button', { name: 'Mark taken' }).click();
      const confirmDialog = page.getByRole('dialog', { name: 'Confirm medication' });
      await expect(confirmDialog).toBeVisible({ timeout: 10_000 });

      // Remove the first-day dose (root's own date) out from under it.
      const delRes = await session.delete(
        `/api/circles/${circleId}/events/${rootId}?deleteScope=single&scheduledDate=${S}`
      );
      expect(delRes.ok(), `DELETE single failed: ${delRes.status()} ${await delRes.text()}`).toBe(true);

      await confirmDialog.getByRole('button', { name: 'Save' }).click();
      await expect(confirmDialog.getByRole('alert')).toHaveText(
        'This dose was removed from the schedule.',
        { timeout: 15_000 }
      );
      await expect(confirmDialog).toBeVisible();
      await confirmDialog.getByRole('button', { name: 'Cancel' }).click();
      await expect(confirmDialog).toHaveCount(0, { timeout: 10_000 });

      // DB: the root itself is untouched; the minted child at (root, S) is
      // the one tombstoned; no confirmation anywhere.
      const rootRow = dbQuery<{ id: string; removed_at: string | null }>(
        `select id, removed_at from calendar_events where id = ${sqlStr(rootId)}`
      );
      expect(rootRow).toHaveLength(1);
      expect(rootRow[0].removed_at).toBeNull();

      const childRows = dbQuery<{ id: string; removed_at: string | null }>(
        `select id, removed_at from calendar_events where parent_event_id = ${sqlStr(rootId)} and scheduled_date = ${sqlStr(S)}`
      );
      expect(childRows).toHaveLength(1);
      expect(childRows[0].removed_at).not.toBeNull();

      const confirmationsOnRoot = dbQuery<{ id: string }>(
        `select id from medication_confirmations where event_id = ${sqlStr(rootId)}`
      );
      expect(confirmationsOnRoot).toHaveLength(0);
      const confirmationsOnChild = dbQuery<{ id: string }>(
        `select id from medication_confirmations where event_id = ${sqlStr(childRows[0].id)}`
      );
      expect(confirmationsOnChild).toHaveLength(0);
    } finally {
      await deleteSeries(session, circleId, rootId);
    }
  });
});
