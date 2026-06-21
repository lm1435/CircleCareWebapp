import { getDateInTimezone, getTimezoneOffsetMinutes } from '@/utils/timezone';

// recorded_at TZ conversion for the vitals form (Plan Task 6.4 / cross-cutting
// "timezone for writes").
//
// Unlike calendar events (which store naive date + time), a vital's recorded_at
// is a SINGLE UTC ISO timestamp. The form edits it as the care recipient's NAIVE
// LOCAL wall time (a DateField YYYY-MM-DD + a TimeField HH:MM). These helpers
// bridge that wall time ↔ the UTC instant, DST-correctly, using the Stage 0
// timezone utilities (Intl-based — never device-local getHours()/new Date(str)).

/**
 * Convert a care-recipient-local wall time (YYYY-MM-DD + HH:MM, naive) to a UTC
 * ISO instant.
 *
 * The wall time has no offset of its own, so we treat the components as UTC to
 * get a provisional instant, read the recipient's UTC offset AT that instant,
 * and subtract it. A second pass re-reads the offset at the corrected instant so
 * a DST transition between the two is handled (the offset can differ by the hour
 * the wall time lands in).
 */
export function recipientWallTimeToUtcISO(
  dateStr: string,
  timeStr: string,
  timezone: string
): string {
  const [y, m, d] = dateStr.split('-').map(Number);
  const [hh, mm] = timeStr.split(':').map(Number);
  const wallAsUtcMs = Date.UTC(y, m - 1, d, hh, mm, 0, 0);

  // Pass 1: offset at the provisional instant.
  let offsetMin = getTimezoneOffsetMinutes(timezone, new Date(wallAsUtcMs));
  let utcMs = wallAsUtcMs - offsetMin * 60_000;
  // Pass 2: re-read at the corrected instant (handles DST boundary).
  offsetMin = getTimezoneOffsetMinutes(timezone, new Date(utcMs));
  utcMs = wallAsUtcMs - offsetMin * 60_000;

  return new Date(utcMs).toISOString();
}

/**
 * Convert a UTC ISO instant to the care recipient's naive local wall time
 * (YYYY-MM-DD date + HH:MM time) for prefilling the form's date/time fields.
 */
export function utcISOToRecipientWallTime(
  iso: string,
  timezone: string
): { date: string; time: string } {
  const date = new Date(iso);
  const dateStr = getDateInTimezone(timezone, date);

  const parts = new Intl.DateTimeFormat('en-US', {
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
    timeZone: timezone,
  }).formatToParts(date);
  let hour = parts.find((p) => p.type === 'hour')?.value ?? '00';
  const minute = parts.find((p) => p.type === 'minute')?.value ?? '00';
  if (hour === '24') hour = '00';

  return { date: dateStr, time: `${hour}:${minute}` };
}
