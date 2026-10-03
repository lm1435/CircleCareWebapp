import { test, expect } from '../fixtures';
import { dbQuery, sqlStr } from '../unhappy';
import { sqlExec } from '../db';
import { checkA11y } from '../helpers';
import {
  apiSession,
  circleTimezone,
  createDailyMedication,
  dateInTz,
  deleteEventById,
  deleteViaMoreMenu,
  escapeRegExp,
  gotoWeekContaining,
  openChip,
  stepWeeks,
  weekOffset,
  assertChipAbsent,
  assertChipPresent,
  uniqueSuffix,
} from '../notesFirstClassShared';

// docs/plans/medication-remove-occurrence.md, Stage 9: a medication whose
// repeat was cleared ("Repeat: Never") still keeps its PAST children (the
// clear only prunes future ones). The shipped web/mobile delete flow ALWAYS
// targets `event.parent_event_id || event.id` — the ROOT — with the child's
// own scheduledDate, so deleting one past dose used to fall through to the
// FULL delete: the root + every child + (via refill_group_id) the sibling
// dose time and ITS children. Fixed by treating a rule-less root that still
// owns children as a series member and tombstoning just that one date.
//
// M1 (08:00) owns the bottle; M2 (20:00) shares it via refill_group_id. Both
// get two PAST children seeded directly (the materializer only fills
// TODAY/+1/+2, never the past), mirroring what a real medication a few days
// old would already have on disk. Clearing the repeat via the real PATCH the
// app itself sends, then deleting ONE past dose through the real UI, must
// leave the medication, the other past day, and the second dose time intact.

const MED_PREFIX = 'ZZ_E2E_CLEARDEL_';

interface ChildRow {
  id: string;
}

function insertChild(
  circleId: string,
  parentId: string,
  title: string,
  medicationName: string,
  scheduledDate: string,
  scheduledTime: string,
  createdBy: string
): string {
  sqlExec(
    `insert into calendar_events (circle_id, parent_event_id, event_type, title, medication_name, medication_dosage, scheduled_date, scheduled_time, created_by)
     values (${sqlStr(circleId)}, ${sqlStr(parentId)}, 'medication', ${sqlStr(title)}, ${sqlStr(medicationName)}, '10mg', ${sqlStr(scheduledDate)}, ${sqlStr(scheduledTime)}, ${sqlStr(createdBy)})`
  );
  const rows = dbQuery<ChildRow>(
    `select id from calendar_events where parent_event_id = ${sqlStr(parentId)} and scheduled_date = ${sqlStr(scheduledDate)}`
  );
  return rows[0].id;
}

test.describe('medication delete on a cleared-repeat series never deletes the medication', () => {
  test('"This dose only" on a past dose hides only that day; medication, other days and the second dose time remain', async ({
    page,
    request,
    circleId,
    account,
  }, testInfo) => {
    test.slow();
    const session = await apiSession(request, account);
    const tz = await circleTimezone(session, circleId);
    const today = dateInTz(tz, 0);
    const start = dateInTz(tz, -4);
    const pastDate1 = dateInTz(tz, -3);
    const pastDate2 = dateInTz(tz, -2);

    // M1 and M2 get DISTINCT titles (not just distinct times): both are
    // real, independently-recurring series on the same dates, so a shared
    // title would make M2's own (unrelated) virtual chip on M1's dates
    // indistinguishable from M1's by name alone — exactly the ambiguity a
    // by-title chip lookup must not have.
    const suffix = uniqueSuffix();
    const nameM1 = `${MED_PREFIX}M1_${suffix}`;
    const nameM2 = `${MED_PREFIX}M2_${suffix}`;
    const titleRe = new RegExp(escapeRegExp(nameM1));

    const m1Id = await createDailyMedication(session, circleId, nameM1, start, { time: '08:00' });
    const m2Id = await createDailyMedication(session, circleId, nameM2, start, {
      time: '20:00',
      refillGroupId: m1Id,
    });

    try {
      // Seed the past children the materializer never would (it only fills
      // today/+1/+2, and these dates are already in the past).
      const child1 = insertChild(circleId, m1Id, nameM1, nameM1, pastDate1, '08:00', account.userId);
      const child2 = insertChild(circleId, m1Id, nameM1, nameM1, pastDate2, '08:00', account.userId);

      // Clear the repeat exactly as the app's editor does.
      const patchRes = await session.patch(`/api/circles/${circleId}/events/${m1Id}`, {
        recurrence_rule: null,
        recurrence_end_date: null,
      });
      expect(patchRes.ok(), `PATCH clear-repeat failed: ${patchRes.status()} ${await patchRes.text()}`).toBe(true);

      // --- Delete ONE past dose (child1) via the real UI ---
      await gotoWeekContaining(page, circleId, today, pastDate1);
      const dialog = await openChip(page, pastDate1, titleRe);
      await deleteViaMoreMenu(page, dialog, 'single');

      await assertChipAbsent(page, pastDate1, titleRe);
      // The other past day (same medication) is untouched. It can sit in the
      // NEXT week (today-2 is the following Sunday whenever today is a
      // Tuesday), so step to its week before looking.
      await stepWeeks(page, weekOffset(pastDate1, pastDate2));
      await assertChipPresent(page, pastDate2, titleRe);

      // New UI state: calendar with one day of a cleared-repeat series
      // removed while its siblings and second dose time remain.
      await checkA11y(page, `/circles/${circleId}/calendar`, testInfo);

      // --- DB: only child1 tombstoned; nothing else deleted ---
      const child1After = dbQuery<{ removed_at: string | null }>(
        `select removed_at from calendar_events where id = ${sqlStr(child1)}`
      );
      expect(child1After).toHaveLength(1);
      expect(child1After[0].removed_at).not.toBeNull();

      const child2After = dbQuery<{ removed_at: string | null }>(
        `select removed_at from calendar_events where id = ${sqlStr(child2)}`
      );
      expect(child2After).toHaveLength(1);
      expect(child2After[0].removed_at).toBeNull();

      const m1After = dbQuery<{ id: string }>(`select id from calendar_events where id = ${sqlStr(m1Id)}`);
      expect(m1After, 'M1 root must still exist').toHaveLength(1);

      const m2After = dbQuery<{ id: string; refill_group_id: string | null }>(
        `select id, refill_group_id from calendar_events where id = ${sqlStr(m2Id)}`
      );
      expect(m2After, 'M2 (second dose time) must still exist, untouched').toHaveLength(1);
      expect(m2After[0].refill_group_id).toBe(m1Id);
    } finally {
      // Full cleanup: delete every row this test created (M1 + M2 + their
      // children, including the seeded ones deleteEventById's series scope
      // will not reach since M1 no longer has a recurrence_rule).
      await deleteEventById(session, circleId, m1Id);
      await deleteEventById(session, circleId, m2Id);
      sqlExec(
        `delete from calendar_events where id in (${sqlStr(m1Id)}, ${sqlStr(m2Id)}) or parent_event_id in (${sqlStr(m1Id)}, ${sqlStr(m2Id)})`
      );
    }
  });
});
