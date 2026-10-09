import { getCachedDateTimeFormat, getCurrentHoursInTimezone, getDateInTimezone } from '@/utils/timezone';

/**
 * Daily update window (docs/plans/daily-update.md §3.1, §5.2, §6).
 *
 * The card is visible from 19:00 to 24:00 in the CARE RECIPIENT'S zone. All of
 * this is evaluated in that frame from an injected `now`: never
 * `new Date().getHours()`, never `+24h` (DST days are 23 or 25 hours).
 */
export const DAILY_UPDATE_OPEN_HOUR = 19;

/** How far back the dated view may go (§4.1: `today-7 ≤ date ≤ today`). */
export const DAILY_UPDATE_HISTORY_DAYS = 7;

/**
 * The longest a single boundary timer may wait. The boundary delay is computed
 * from the recipient's WALL clock, which is off by an hour if a DST transition
 * sits between now and the boundary; capping the wait means the next
 * re-evaluation (from the true wall clock, after the transition) is exact.
 */
export const MAX_BOUNDARY_TIMER_MS = 30 * 60 * 1000;

const HOUR_MS = 60 * 60 * 1000;

export interface DailyUpdateWindowState {
  /** "Today" as YYYY-MM-DD in the recipient's zone. */
  localDate: string;
  /** 19:00 ≤ recipient wall time < 24:00. */
  inWindow: boolean;
  /** Milliseconds until the next boundary (19:00 opening or midnight closing), capped. */
  msToNextBoundary: number;
}

export function evaluateDailyUpdateWindow(timezone: string, now: Date): DailyUpdateWindowState {
  const localDate = getDateInTimezone(timezone, now);
  // Minute resolution in the recipient's zone. Seconds are the same in every
  // zone in use today, so they are taken from the instant itself.
  const hours = getCurrentHoursInTimezone(timezone, now);
  const subMinuteMs = now.getUTCSeconds() * 1000 + now.getUTCMilliseconds();
  const inWindow = hours >= DAILY_UPDATE_OPEN_HOUR;
  const targetHour = inWindow ? 24 : DAILY_UPDATE_OPEN_HOUR;
  const raw = Math.round((targetHour - hours) * HOUR_MS) - subMinuteMs;
  const msToNextBoundary = Math.min(Math.max(raw, 1000), MAX_BOUNDARY_TIMER_MS);
  return { localDate, inWindow, msToNextBoundary };
}

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

/** Shift a YYYY-MM-DD STRING by whole calendar days (UTC arithmetic on a date-only value). */
export function addDaysToDateString(date: string, days: number): string {
  const [y, m, d] = date.split('-').map(Number);
  const shifted = new Date(Date.UTC(y, m - 1, d + days));
  return shifted.toISOString().slice(0, 10);
}

/** A real calendar date in YYYY-MM-DD form (rejects 2026-02-30). */
export function isCalendarDate(date: string): boolean {
  if (!DATE_RE.test(date)) return false;
  return addDaysToDateString(date, 0) === date;
}

/**
 * Whether the dated view can show `date`: a real date with
 * `today - 7 ≤ date ≤ today` (recipient-local `today`). The server enforces
 * the same bound (400 DATE_OUT_OF_RANGE); checking here avoids a request that
 * can only fail.
 */
export function isDateInDailyUpdateRange(date: string, today: string): boolean {
  if (!isCalendarDate(date)) return false;
  return date <= today && date >= addDaysToDateString(today, -DAILY_UPDATE_HISTORY_DAYS);
}

/**
 * "Wednesday, Oct 8" for a date-only string, in the reader's language. Parsed at
 * T12:00:00Z and formatted in UTC so no zone can move it to a neighbouring day.
 */
export function formatDailyUpdateDate(date: string, locale: string): string {
  try {
    return getCachedDateTimeFormat(locale, {
      weekday: 'long',
      month: 'short',
      day: 'numeric',
      timeZone: 'UTC',
    }).format(new Date(`${date}T12:00:00Z`));
  } catch {
    return date;
  }
}

/** "Wed, Oct 7" for the day arrows (same UTC-noon parsing as above). */
export function formatDailyUpdateShortDate(date: string, locale: string): string {
  try {
    return getCachedDateTimeFormat(locale, {
      weekday: 'short',
      month: 'short',
      day: 'numeric',
      timeZone: 'UTC',
    }).format(new Date(`${date}T12:00:00Z`));
  } catch {
    return date;
  }
}
