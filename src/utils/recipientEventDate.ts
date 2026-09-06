import { getTimezoneOffsetMinutes } from './timezone';

/**
 * Date/time conversion for the calendar-event save payload.
 *
 * PORT of mobile/src/utils/recipientEventDate.ts — mobile is canonical. Read
 * that file's notes before changing anything here; six real bugs are documented
 * in place there and this module exists to not re-earn them.
 *
 * ── THE MODEL ─────────────────────────────────────────────────────────────
 *
 * A caregiver types a time in THEIR OWN timezone. The client converts it into
 * the care recipient's zone and stores it there. Storage is not in dispute and
 * never was: `scheduled_date` (DATE) / `scheduled_time` (TIME) are NAIVE LOCAL
 * values in the RECIPIENT's frame. The only question is how to read what the
 * user TYPED, and the answer is: it is the VIEWER's wall clock.
 *
 *   Caregiver in America/Denver (MT), recipient in America/Chicago (CT).
 *   Caregiver types 8:00 PM  ->  stored as 21:00 CT.
 *
 * A caregiver reads their own clock. Asking them to convert in their head is
 * where the errors come from, so the form shows the conversion live instead.
 *
 * ── WHY THIS IS ONE MODULE ────────────────────────────────────────────────
 *
 * Because `eventDatesForApi` and `eventDatesFromApi` MUST be exact inverses,
 * and the only way to keep two functions inverse is to make them impossible to
 * change independently. Mobile's bug: the save serialised INTO the recipient
 * frame while hydration parsed the stored strings back as device-local, so on a
 * Denver device with a UTC recipient an 8:00 PM dose stored as `02:00` the next
 * day and the edit form showed "2:00 AM" — and saving it untouched MOVED THE
 * REAL DOSE. Same-zone circles are an exact identity, which is why it hid for
 * so long.
 *
 * ── WEB ADAPTATION ────────────────────────────────────────────────────────
 *
 * Mobile's pickers produce `Date` objects; the web form holds STRINGS from
 * `<input type="date">` (`YYYY-MM-DD`) and `<input type="time">` (`HH:MM`),
 * both in the viewer's frame. So this module is string-in/string-out, and the
 * span arithmetic runs on the date strings directly rather than on device-noon
 * `Date`s — same result, and with no DST slack to round away at all.
 *
 * ── NO LOCALE PARAMETER, DELIBERATELY ─────────────────────────────────────
 *
 * Mobile threads a display locale into its wire formatters and is fixing that:
 * under `en-SA-u-ca-islamic-umalqura` a `scheduled_date` serialises as
 * `1448-03-20`. Every formatter here is pinned to `en-CA` / `en-US` with an
 * explicit Gregorian calendar and Latin digits, and takes no locale argument,
 * so a display locale CANNOT reach wire formatting through this module. Do not
 * add one.
 */

/** Formatter options that make a wire format a wire format. */
const WIRE = { calendar: 'gregory', numberingSystem: 'latn' } as const;

/** Whole calendar days between two `YYYY-MM-DD` strings (UTC, so DST-free). */
export function isoDaysBetween(from: string, to: string): number {
  return Math.round((Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / 86400000);
}

/** `YYYY-MM-DD` plus a whole number of calendar days, as `YYYY-MM-DD`. */
export function addDaysToIsoDay(isoDay: string, days: number): string {
  const [y, m, d] = isoDay.split('-').map(Number);
  const shifted = new Date(Date.UTC(y, (m || 1) - 1, (d || 1) + days));
  const mm = String(shifted.getUTCMonth() + 1).padStart(2, '0');
  const dd = String(shifted.getUTCDate()).padStart(2, '0');
  return `${shifted.getUTCFullYear()}-${mm}-${dd}`;
}

/** The device-local instant meant by a viewer-frame `YYYY-MM-DD` + `HH:MM`. */
export function viewerInstant(dateStr: string, timeStr: string): Date {
  const [y, m, d] = dateStr.split('-').map(Number);
  const [hh, mm] = timeStr.split(':').map(Number);
  return new Date(y, (m || 1) - 1, d || 1, hh || 0, mm || 0, 0, 0);
}

/** Device-local `YYYY-MM-DD` for an instant — the viewer's own calendar day. */
function deviceDay(instant: Date): string {
  const m = String(instant.getMonth() + 1).padStart(2, '0');
  const d = String(instant.getDate()).padStart(2, '0');
  return `${instant.getFullYear()}-${m}-${d}`;
}

/** Device-local `HH:MM` for an instant — the viewer's own wall clock. */
function deviceClock(instant: Date): string {
  return `${String(instant.getHours()).padStart(2, '0')}:${String(instant.getMinutes()).padStart(2, '0')}`;
}

/** `YYYY-MM-DD` for an instant as seen in `timezone`. */
export function dayInZone(instant: Date, timezone: string): string {
  return new Intl.DateTimeFormat('en-CA', {
    ...WIRE,
    timeZone: timezone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(instant);
}

/**
 * `HH:MM` (24-hour, FOR THE WIRE — never for display) for an instant as seen
 * in `timezone`.
 *
 * The `% 24` is load-bearing: under `hour12: false` some ICU builds render
 * midnight as `24`, and a dose stored as `"24:00"` is never past due, never
 * confirmable, and hydrates a day late.
 */
export function clockInZone(instant: Date, timezone: string): string {
  const parts = new Intl.DateTimeFormat('en-US', {
    ...WIRE,
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
    timeZone: timezone,
  }).formatToParts(instant);
  const hour = parseInt(parts.find((p) => p.type === 'hour')?.value || '0', 10) % 24;
  const minute = parseInt(parts.find((p) => p.type === 'minute')?.value || '0', 10);
  return `${String(hour).padStart(2, '0')}:${String(minute).padStart(2, '0')}`;
}

/**
 * The real instant meant by a naive wall-clock reading in `timezone`.
 *
 * Uses the SHARED `getTimezoneOffsetMinutes`, which reads the zone's full
 * wall-clock reading rather than the hour of day — the hour-of-day version it
 * replaced folded offsets past ±12h by a day, so a Kiritimati (+14) recipient's
 * events hydrated a day out. One implementation on purpose: a second local copy
 * is how the two drift apart again.
 *
 * Two passes on purpose. The offset must be looked up AT some instant, and the
 * only one available up front is the naive reading treated as UTC — which sits
 * up to a day away from the true instant and, near a DST transition, on the
 * wrong side of it. Re-reading the offset at the resolved instant and
 * recomputing when it disagrees settles that; a third pass cannot change the
 * answer, because the second lookup is already inside the correct offset period.
 *
 * On a DST-transition day a naive reading may name two instants (the repeated
 * hour) or none (the spring-forward gap). Neither resolution is "wrong" — which
 * is why the tests assert IDEMPOTENCE rather than an exact wall clock there.
 */
function instantFromNaiveTimeInZone(
  isoDay: string,
  hours: number,
  minutes: number,
  timezone: string
): Date {
  const [y, m, d] = isoDay.split('-').map(Number);
  const naiveAsUtc = Date.UTC(y, (m || 1) - 1, d || 1, hours, minutes);

  const firstOffset = getTimezoneOffsetMinutes(timezone, new Date(naiveAsUtc));
  const firstPass = new Date(naiveAsUtc - firstOffset * 60000);

  const settledOffset = getTimezoneOffsetMinutes(timezone, firstPass);
  if (settledOffset === firstOffset) return firstPass;

  return new Date(naiveAsUtc - settledOffset * 60000);
}

export interface EventDatesForApiInput {
  /** Viewer-frame calendar day, `YYYY-MM-DD`, from `<input type="date">`. */
  dateStr: string;
  /** Viewer-frame wall clock `HH:MM`, or empty/null for an all-day event. */
  timeStr: string | null;
  /** Viewer-frame calendar day the repeat ends, or empty/null for none. */
  recurrenceEndDateStr: string | null;
  /** The CARE RECIPIENT's IANA timezone. */
  timezone: string;
}

/**
 * Every DATE in one calendar-event payload, comparable to each other.
 *
 * Computed TOGETHER on purpose: the backend compares the two directly
 * (`backend/src/utils/adherenceSchedule.ts` — `if (current >
 * recurrence_end_date) break`), so a caller must not be able to derive one and
 * forget the other. An inverted pair is a 400 on the current backend and, on
 * the older one, a series that silently generates ZERO occurrences.
 *
 * THE TWO FIELDS ARE NOT THE SAME KIND OF VALUE. `scheduled_date` is the
 * recipient-frame day of a real INSTANT — it is paired with `scheduled_time`,
 * so re-expressing it in the recipient's zone is the whole job.
 * `recurrence_end_date` is a pure CALENDAR BOUNDARY ("repeat until 30 Sep")
 * with no instant attached.
 *
 * THE SPAN IS PRESERVED IN THE RECIPIENT'S CALENDAR — the end date is NOT a
 * second instant conversion. A daily series advances one RECIPIENT-LOCAL DAY at
 * a time (the backend walks `generate_series` over recipient dates), so what
 * the user picked is "N days of doses". Converting the end instant separately
 * breaks the moment the recipient's zone changes offset mid-series: from a
 * Tokyo device, 8 PM lands on NZ day D through 26 September and on D+1 from the
 * 27th when NZ enters DST — so a converted end came out 1 October against a
 * 1 September start and Postgres generated THIRTY-ONE occurrences, one of them
 * a day with no dose at all.
 *
 * Counting the span on the VIEWER's side and adding it to the RECIPIENT's start
 * day keeps "30 days" meaning 30 doses in every zone pairing, DST or not. It
 * also makes hydration invertible by the same arithmetic, with no instant to
 * re-resolve.
 *
 * `Math.max(0, …)` floors the span: "repeat until the day it starts" is a
 * one-occurrence series, and a negative span can no longer serialise as
 * end-before-start.
 */
export function eventDatesForApi(input: EventDatesForApiInput): {
  scheduledDate: string;
  scheduledTime?: string;
  recurrenceEndDate?: string;
} {
  const { dateStr, timeStr, recurrenceEndDateStr, timezone } = input;

  // No time means no instant to re-express: the calendar day the user picked is
  // exactly what they mean. Mirrors the null-time branch of the inverse below.
  const hasTime = !!timeStr;
  const scheduledDate = hasTime
    ? dayInZone(viewerInstant(dateStr, timeStr as string), timezone)
    : dateStr;
  const scheduledTime = hasTime
    ? clockInZone(viewerInstant(dateStr, timeStr as string), timezone)
    : undefined;

  if (!recurrenceEndDateStr) {
    return { scheduledDate, scheduledTime, recurrenceEndDate: undefined };
  }

  const spanDays = Math.max(0, isoDaysBetween(dateStr, recurrenceEndDateStr));
  return {
    scheduledDate,
    scheduledTime,
    recurrenceEndDate: addDaysToIsoDay(scheduledDate, spanDays),
  };
}

export interface EventDatesFromApiInput {
  /** Stored `scheduled_date`, recipient frame. */
  scheduledDate: string;
  /** Stored `scheduled_time` (`HH:MM` or `HH:MM:SS`), recipient frame. */
  scheduledTime: string | null;
  /** Stored `recurrence_end_date`, in the same recipient frame as the start. */
  recurrenceEndDate?: string | null;
  /** The CARE RECIPIENT's IANA timezone. */
  timezone: string;
}

/**
 * The EXACT INVERSE of {@link eventDatesForApi}: stored recipient-frame values
 * back into the viewer-frame strings the form's inputs hold.
 *
 * This is the half mobile was missing. The save re-expressed the picked instant
 * in the recipient's zone — correct, and what every read surface expects — but
 * hydration parsed those strings straight into the pickers with no conversion
 * back out, so the edit form was the one consumer that disagreed with the
 * stored frame, and an untouched save rewrote the event.
 *
 * `save(hydrate(stored)) === stored` is the property that keeps data still, and
 * it is what the tests assert. Exact wall-clock assertions cannot catch this
 * class of bug: a form that converts consistently in one direction satisfies
 * them while still moving the row on every save.
 */
export function eventDatesFromApi(input: EventDatesFromApiInput): {
  dateStr: string;
  timeStr: string;
  recurrenceEndDateStr: string;
} {
  const { scheduledDate, scheduledTime, recurrenceEndDate, timezone } = input;

  const storedEnd = recurrenceEndDate || '';

  // Date-only event: the stored calendar days ARE the answer, mirroring the
  // save's null-time branch.
  if (!scheduledTime) {
    return { dateStr: scheduledDate, timeStr: '', recurrenceEndDateStr: storedEnd };
  }

  const [hourPart, minutePart] = scheduledTime.split(':');
  const hours = parseInt(hourPart, 10);
  const minutes = parseInt(minutePart, 10);
  if (!Number.isFinite(hours) || !Number.isFinite(minutes)) {
    // Junk from the wire must not throw on a form the user is standing on, and
    // must not invent a time.
    return { dateStr: scheduledDate, timeStr: '', recurrenceEndDateStr: storedEnd };
  }

  // Exact by construction: `scheduled_time` is the recipient's wall clock ON
  // `scheduled_date`, so the pair names one instant.
  const startInstant = instantFromNaiveTimeInZone(scheduledDate, hours, minutes, timezone);
  const dateStr = deviceDay(startInstant);

  return {
    dateStr,
    timeStr: deviceClock(startInstant),
    // Inverted by the SAME span arithmetic the save used, not by re-resolving a
    // second instant: the stored pair carries the span directly, so this is
    // exact by construction and cannot need a correction pass.
    recurrenceEndDateStr: storedEnd
      ? addDaysToIsoDay(dateStr, isoDaysBetween(scheduledDate, storedEnd))
      : '',
  };
}
