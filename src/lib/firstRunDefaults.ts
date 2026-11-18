import { addDays } from '@/components/calendar/dateMath';
import { formatTimeForAPI, getDateInTimezone } from '@/utils/timezone';

/**
 * First run v2, locked by the owner (plan.md "Locked", 1, 5 and 7):
 *  - the medication tab opens with 8:00 AM Morning picked;
 *  - a first appointment or task opens with 9:00 AM picked ("Pick a time", not "Any time");
 *  - once 9:00 AM has passed TODAY on the care recipient's clock, it is 9:00 AM TOMORROW, so the
 *    first item is never late the moment it is saved.
 * Both times are the RECIPIENT's wall clock (the circle's timezone), never the browser's.
 */
export const FIRST_RUN_MED_TIME = '08:00';
export const FIRST_RUN_ITEM_TIME = '09:00';

/** The recipient-frame day and time a first appointment / task opens on. */
export function firstRunItemDefault(
  timezone: string,
  now: Date = new Date()
): { date: string; time: string } {
  const today = getDateInTimezone(timezone, now);
  const clock = formatTimeForAPI(now, timezone);
  // "HH:MM" strings compare correctly as text. At exactly 9:00 the slot is already due: tomorrow.
  const date = clock >= FIRST_RUN_ITEM_TIME ? addDays(today, 1) : today;
  return { date, time: FIRST_RUN_ITEM_TIME };
}
