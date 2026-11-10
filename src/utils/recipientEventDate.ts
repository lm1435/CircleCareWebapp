import { getDateInTimezone } from './timezone';
import { wallClockMsToInstant } from './wallTimeToInstant';

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

/**
 * The default date of a NEW event: the CARE RECIPIENT's "today" (`YYYY-MM-DD`).
 *
 * It used to be the VIEWER's today (`getDateInTimezone(getDeviceTimezone())`).
 * A caregiver 25 hours behind their recipient (Midway -> Kiritimati) therefore
 * got a default - and, for a date-only task, a saved date - one day before the
 * recipient's today.
 *
 * `null` zone means the circle is still loading: returns `''` (no date at all)
 * rather than a guessed day, so nothing wrong is shown and then replaced. This
 * is the same gate the edit hydration uses, and callers must NOT pass a
 * placeholder zone here (see useCircle's `timezone: null`).
 *
 * Only the DATE is recipient-frame. The form has no "now"-derived default time
 * (it starts empty, or carries the wizard's fixed wall-clock time); once a time
 * is typed the pair is converted viewer -> recipient on save, with the
 * dual-timezone hint shown beside it.
 */
export function defaultNewEventDate(timezone: string | null, now: Date = new Date()): string {
  return timezone ? getDateInTimezone(timezone, now) : '';
}

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

/**
 * The device-local instant meant by a viewer-frame `YYYY-MM-DD` + `HH:MM`.
 *
 * `held` is the exact instant the fields were last filled with: an edit's hydrated time, or a time chip's
 * (both `eventDatesFromApi().instant`). A fall-back repeats an hour of the viewer's clock and the Date
 * constructor names the FIRST reading, so a time on the SECOND one (Pago Pago 21:00 on 2026-10-31 = the
 * second 01:00 in Denver) read back as the first, and the dose saved an hour early. When the fields still
 * read exactly `held`'s own day and clock, `held` is returned (to the minute). Outside a repeated hour that
 * is the very instant the constructor builds, so nothing else changes; a changed field never matches, so it
 * is converted as before. Mirrors mobile `deviceInstantOn`.
 */
export function viewerInstant(dateStr: string, timeStr: string, held?: Date | null): Date {
  const [y, m, d] = dateStr.split('-').map(Number);
  const [hh, mm] = timeStr.split(':').map(Number);
  const built = new Date(y, (m || 1) - 1, d || 1, hh || 0, mm || 0, 0, 0);
  if (
    held &&
    Number.isFinite(held.getTime()) &&
    deviceDay(held) === dateStr &&
    deviceClock(held) === deviceClock(built)
  ) {
    return new Date(Math.floor(held.getTime() / 60000) * 60000);
  }
  return built;
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
 * Delegates to `wallClockMsToInstant` (utils/wallTimeToInstant.ts), the ONE
 * resolver shared with the dual-clock formatter, mobile and the backend, which
 * matches the pg_cron SQL's Postgres `AT TIME ZONE` rule exactly:
 *
 *   - a wall clock that happens TWICE (fall-back repeat) resolves to the SECOND
 *     occurrence — the instant the reminder actually fires at;
 *   - a wall clock that DOES NOT EXIST (spring-forward gap) resolves with the
 *     offset in force BEFORE the jump, i.e. forward past the gap.
 *
 * This used to be a two-pass offset lookup whose answer on those two days was
 * accidental and zone-dependent (and differed from mobile, which normalised
 * both cases). An unknown zone degrades to UTC (offset 0), as
 * `getTimezoneOffsetMinutes` does.
 */
export function instantFromNaiveTimeInZone(
  isoDay: string,
  hours: number,
  minutes: number,
  timezone: string
): Date {
  const [y, m, d] = isoDay.split('-').map(Number);
  const naiveAsUtc = Date.UTC(y, (m || 1) - 1, d || 1, hours, minutes);
  const instant = wallClockMsToInstant(naiveAsUtc, timezone);
  return Number.isNaN(instant.getTime()) ? new Date(naiveAsUtc) : instant;
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
  /** The instant the fields were filled with (an edit or a time chip); see `viewerInstant`. */
  heldInstant?: Date | null;
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
  const { dateStr, timeStr, recurrenceEndDateStr, timezone, heldInstant } = input;

  // No time means no instant to re-express: the calendar day the user picked is
  // exactly what they mean. Mirrors the null-time branch of the inverse below.
  const hasTime = !!timeStr;
  const scheduledDate = hasTime
    ? dayInZone(viewerInstant(dateStr, timeStr as string, heldInstant), timezone)
    : dateStr;
  const scheduledTime = hasTime
    ? clockInZone(viewerInstant(dateStr, timeStr as string, heldInstant), timezone)
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
  /**
   * The exact instant the stored pair names (absent without a time). `timeStr` is its viewer wall clock,
   * which cannot tell the two readings of a repeated (fall-back) hour apart; pass this back as
   * `heldInstant` so the save can.
   */
  instant?: Date;
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
    instant: startInstant,
    // Inverted by the SAME span arithmetic the save used, not by re-resolving a
    // second instant: the stored pair carries the span directly, so this is
    // exact by construction and cannot need a correction pass.
    recurrenceEndDateStr: storedEnd
      ? addDaysToIsoDay(dateStr, isoDaysBetween(scheduledDate, storedEnd))
      : '',
  };
}
