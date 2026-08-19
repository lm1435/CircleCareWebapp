import type { ConfirmationStatus } from '@/api/medicationConfirmations';

/**
 * Does this dose still need a HUMAN answer?
 *
 * Port of mobile's `confirmationNeedsAnswer` (mobile/src/components/medication/
 * MedicationRow.tsx). Change the two together.
 *
 * The subtlety is `missed`: that row is the reminder cron recording that nobody
 * answered in time — it is NOT a caregiver's answer. The dose may well have been
 * given and simply not logged, so it must keep asking. Every other status is a
 * real human answer and the row shows it instead of a control.
 *
 * WHY THIS IS SHARED: web previously decided this twice and disagreed with
 * itself. `EventDetailActions` asked (matching mobile) while `TodaysMeds` used a
 * bare `!confirmation`, so an auto-`missed` dose showed a status there and could
 * not be corrected from the Overview widget — the surface a caregiver is most
 * likely to be looking at. Correcting it meant hunting the dose down on the
 * calendar. One predicate, so the surfaces cannot drift again.
 *
 * NOTE this answers "does it still need an answer", NOT "may it be answered
 * now". Timing is `isDoseConfirmable` (utils/timezone.ts) and inactive-medication
 * visibility is the backend's read filter. The three compose; none subsumes
 * another.
 */
export function doseNeedsAnswer(
  confirmation?: { status: ConfirmationStatus } | null
): boolean {
  return !confirmation || confirmation.status === 'missed';
}
