import { addDays } from '@/components/calendar/dateMath';
import { getDateInTimezone } from '@/utils/timezone';
import type {
  MedicationConfirmation,
  MedicationConfirmationsParams,
} from '@/api/medicationConfirmations';

// Task 24: `confirmed_by_user`/`event` now live on the base type itself.
export type HistoryConfirmation = MedicationConfirmation;

/**
 * How far back the History tab reads: 29 days back plus today.
 *
 * THIS IS NOT THE HERO'S WINDOW, and the difference is deliberate rather than
 * an oversight — the two answer different questions:
 *
 *   - the hero's `30d` adherence report covers `[today-30, today-1]` and counts
 *     SCHEDULED doses. Today is excluded on purpose: a dose that has not come
 *     around yet is not a missed one (backend/src/routes/
 *     medicationConfirmations.ts — `reportEndDateStr = addDays(todayStr, -1)`,
 *     fed to `walkScheduledDoses`).
 *   - this list covers `[today-29, today]` and the backend filters it on
 *     `confirmed_at`, the instant someone answered. Today is INCLUDED because a
 *     record of what happened that hides what happened this morning is useless
 *     to the person who did it.
 *
 * So the percentage and the rows under it are not two views of one set, and a
 * dose answered today shows in the list a day before it can move the
 * percentage. Both spans are 30 local days; that is all they share.
 */
export const HISTORY_WINDOW_DAYS = 30;

/**
 * The date window for the History tab, resolved in the CARE RECIPIENT'S
 * timezone.
 *
 * Never device-local: the backend projects these local days into instants with
 * the recipient's zone, so handing it the caregiver's "today" would shift the
 * whole window by up to a day for a remote caregiver.
 *
 * No `limit`/`offset` — paging belongs to `useMedicationConfirmations`, which
 * ignores them if passed. This is only the window, and the window IS the query
 * key, so the page's copy of the query and the list's share one cache entry.
 */
export function historyParams(
  timezone: string,
  now: Date = new Date()
): MedicationConfirmationsParams {
  const end = getDateInTimezone(timezone, now);
  return {
    start_date: addDays(end, -(HISTORY_WINDOW_DAYS - 1)),
    end_date: end,
  };
}

/**
 * The distinct medications in the history LOADED SO FAR, in first-seen order —
 * the options the filter row offers.
 *
 * "Loaded so far" is the honest description now that the list pages: this is
 * built from every page fetched, so a medication last answered five weeks ago
 * joins the menu only once the reader has paged back far enough to reach it.
 *
 * Keyed by NAME, matching mobile (`MedicationHistoryScreen`'s `medications`
 * memo). See `MedicationFilter` for why the option id cannot be an event id.
 */
export function medicationOptions(
  confirmations: HistoryConfirmation[]
): { id: string; name: string }[] {
  const seen = new Map<string, { id: string; name: string }>();
  for (const confirmation of confirmations) {
    const name = confirmation.event?.medication_name || confirmation.event?.title;
    if (!name || seen.has(name)) continue;
    seen.set(name, { id: name, name });
  }
  return [...seen.values()];
}
