import i18n from '@/i18n';
import { formatTimeOfDay, getTimezoneSuffix } from '@/utils/timezone';
import type { HourCycle } from '@/utils/hourCycle';

// Date-only arithmetic on YYYY-MM-DD strings using UTC methods exclusively.
// Mirrors backend/src/utils/recurrence.ts helpers. NEVER use device-local
// getDay()/getDate()/setDate() for date iteration — local methods shift dates
// across timezones (20 timezone bugs were fixed on mobile/backend this way).
// Display formatting parses date-only strings with T12:00:00Z + timeZone:'UTC'
// so the rendered date can never roll over to an adjacent day.

/** Parse a YYYY-MM-DD string as UTC midnight (for arithmetic only). */
function parseUTC(dateStr: string): Date {
  return new Date(`${dateStr}T00:00:00Z`);
}

/** Format a Date's UTC components back to YYYY-MM-DD. */
function toDateStr(date: Date): string {
  const y = date.getUTCFullYear();
  const m = String(date.getUTCMonth() + 1).padStart(2, '0');
  const d = String(date.getUTCDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

/** Add (or subtract) whole days to a YYYY-MM-DD string. */
export function addDays(dateStr: string, days: number): string {
  const d = parseUTC(dateStr);
  d.setUTCDate(d.getUTCDate() + days);
  return toDateStr(d);
}

/** Whole days from `a` to `b` (positive when b is later). */
export function daysBetween(a: string, b: string): number {
  return Math.round((parseUTC(b).getTime() - parseUTC(a).getTime()) / 86400000);
}

/** Day of week for a date string: 0=Sun..6=Sat (matches recurrence_days). */
export function getDayOfWeek(dateStr: string): number {
  return parseUTC(dateStr).getUTCDay();
}

/** Sunday that starts the week containing `dateStr`. */
export function startOfWeek(dateStr: string): string {
  return addDays(dateStr, -getDayOfWeek(dateStr));
}

/** The 7 date strings of the week starting at `weekStart`. */
export function getWeekDays(weekStart: string): string[] {
  return Array.from({ length: 7 }, (_, i) => addDays(weekStart, i));
}

/** First day (YYYY-MM-01) of the month containing `dateStr`. */
export function startOfMonth(dateStr: string): string {
  return `${dateStr.slice(0, 8)}01`;
}

/** First day of the month `months` away from the month containing `dateStr`. */
export function addMonths(dateStr: string, months: number): string {
  const d = parseUTC(startOfMonth(dateStr));
  d.setUTCMonth(d.getUTCMonth() + months);
  return toDateStr(d);
}

/**
 * Classic 6-week (42-cell) month grid starting on the Sunday on/before the
 * 1st of the month. Fixed height keeps the layout stable across months.
 */
export function getMonthGridDays(dateStr: string): string[] {
  const gridStart = startOfWeek(startOfMonth(dateStr));
  return Array.from({ length: 42 }, (_, i) => addDays(gridStart, i));
}

/** True when both date strings fall in the same calendar month. */
export function isSameMonth(a: string, b: string): boolean {
  return a.slice(0, 7) === b.slice(0, 7);
}

/**
 * Locale-aware display formatting for a NAIVE date-only string.
 * Parses with T12:00:00Z and formats with timeZone:'UTC' (noon UTC can never
 * cross a day boundary in any rendering timezone).
 */
export function formatDateForDisplay(
  dateStr: string,
  options: Intl.DateTimeFormatOptions,
  locale: string = i18n.language
): string {
  return new Intl.DateTimeFormat(locale, { timeZone: 'UTC', ...options }).format(
    new Date(`${dateStr}T12:00:00Z`)
  );
}

/**
 * Localized weekday name for a 0=Sun..6=Sat index (recurrence_days convention
 * — NEVER convert Sunday 0→7). Uses Intl, not hand-written arrays.
 * 2024-01-07 is a known Sunday.
 */
export function getWeekdayName(
  dayIndex: number,
  width: 'narrow' | 'short' | 'long' = 'short',
  locale: string = i18n.language
): string {
  const ref = new Date(Date.UTC(2024, 0, 7 + dayIndex, 12));
  return new Intl.DateTimeFormat(locale, { timeZone: 'UTC', weekday: width }).format(ref);
}

/**
 * Format an ISO UTC timestamp (e.g. confirmation.confirmed_at) as a time in a
 * specific timezone, LABELLED with that timezone.
 *
 * The label is not decoration. "Taken at 8:05 PM" is rendered to caregivers who
 * are frequently NOT in the care recipient's zone, and this string is the
 * evidence a dose was actually taken — read in the wrong frame it is evidence
 * of something that did not happen.
 *
 * SHOWN ONLY WHEN THE VIEWER IS ELSEWHERE, though. The label used to be
 * unconditional, so a caregiver in the recipient's own zone read "8:05 PM CT"
 * on every confirmation — a label answers "whose clock is this?", and in a
 * single-zone circle nobody is asking. {@link getTimezoneSuffix} owns that rule
 * for every time surface in the app.
 */
export function formatTimestampInTimezone(
  isoString: string,
  timezone: string,
  locale: string,
  cycle?: HourCycle
): string {
  try {
    const at = new Date(isoString);
    // Extract the wall clock NUMERICALLY, then render it through the app's one
    // time renderer.
    //
    // Formatting straight off the locale ignored the viewer's resolved 12h/24h
    // preference and made the output locale-dependent in a way nothing else in
    // the app is: `es-MX` produced "8:05 p.m." while a bare `es` produced
    // "20:05" for the same instant and the same user. `formatTimeOfDay` is what
    // every other time surface uses, including the RAE meridiem rules.
    const parts = new Intl.DateTimeFormat('en-US', {
      timeZone: timezone,
      hour: '2-digit',
      minute: '2-digit',
      hour12: false,
    }).formatToParts(at);
    const hours = parseInt(parts.find((p) => p.type === 'hour')?.value || '0', 10) % 24;
    const minutes = parseInt(parts.find((p) => p.type === 'minute')?.value || '0', 10);

    const time = cycle
      ? formatTimeOfDay(hours, minutes, cycle)
      : new Intl.DateTimeFormat(locale, {
          timeZone: timezone,
          hour: 'numeric',
          minute: 'numeric',
        }).format(at);

    // Judged AT the instant. The city itself does not move with the season, but
    // whether it is worth naming does: Phoenix and Denver are the same clock in
    // January and an hour apart in July.
    return `${time}${getTimezoneSuffix(timezone, at)}`;
  } catch {
    return '';
  }
}

