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
 *
 * MACHINE FORMAT — NOT display. The `hour12: false` + `formatToParts` block
 * below is numeric extraction feeding an `<input type="time">` (and the round
 * trip back through recipientWallTimeToUtcISO); it must stay 24-hour regardless
 * of the viewer's hour cycle. Do NOT route it through `formatTimeOfDay` — the
 * DISPLAY of this value is formatted by the caller (see VitalsPage's
 * recordedLabel, which applies the resolved cycle).
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

/**
 * ── VIEWER-FRAME PAIR ─────────────────────────────────────────────────────
 *
 * The two functions above express a `recorded_at` instant in the CARE
 * RECIPIENT's wall clock. That is right for DISPLAY — VitalsPage renders a
 * reading in the recipient's zone, and mobile does the same
 * (`formatInstantInTimezone(recordedAt, careRecipientTimezone)`).
 *
 * It is WRONG for INPUT. A caregiver types the time they are reading off their
 * own clock; mobile builds `recorded_at` from a device-local picker and stores
 * `recordedAt.toISOString()`, and the founder's ruling on the calendar says the
 * same thing in as many words: the typed value is the viewer's wall clock.
 * Web's vitals form was converting the typed digits as if they were the
 * RECIPIENT's, so the same action on the two platforms stored instants that
 * differed by the offset between the two people.
 *
 * These are the input pair. They take NO timezone argument — that is the whole
 * point, and adding one is how this drifts back.
 */

/** A viewer-frame `YYYY-MM-DD` + `HH:MM` as the UTC instant it names. */
export function viewerWallTimeToUtcISO(dateStr: string, timeStr: string): string {
  const [y, m, d] = dateStr.split('-').map(Number);
  const [hh, mm] = timeStr.split(':').map(Number);
  // Device-local construction, exactly as mobile's picker produces.
  return new Date(y, (m || 1) - 1, d || 1, hh || 0, mm || 0, 0, 0).toISOString();
}

/**
 * The EXACT INVERSE: an instant back into the viewer's wall clock.
 *
 * Must always change together with {@link viewerWallTimeToUtcISO}. Flipping
 * only the save recreates the hydrate-is-not-the-inverse bug that this whole
 * timezone effort started from — an untouched re-save would move a real
 * reading.
 */
export function utcISOToViewerWallTime(iso: string): { date: string; time: string } {
  const at = new Date(iso);
  if (Number.isNaN(at.getTime())) return { date: '', time: '' };
  const p = (n: number): string => String(n).padStart(2, '0');
  return {
    date: `${at.getFullYear()}-${p(at.getMonth() + 1)}-${p(at.getDate())}`,
    time: `${p(at.getHours())}:${p(at.getMinutes())}`,
  };
}
