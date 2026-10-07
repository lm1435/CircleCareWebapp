/**
 * Quiet-hours window arithmetic, shared by the editor's UI-time warning.
 *
 * Mirrors the backend rule (`isTimeInRange` in backend/src/utils/timezone.ts):
 *   - start < end  -> same-day window, end - start minutes
 *   - start > end  -> overnight window, wraps midnight
 *   - start == end -> `currentMinutes >= s && currentMinutes < s` is never true,
 *                     so the window is EMPTY (0 minutes: quiet hours never fire)
 *
 * Values are naive wall-clock "HH:MM" (optionally "HH:MM:SS"). The window math
 * itself has no timezone arithmetic; only `minuteOfDayInZone` (dose-time warning)
 * converts an instant to a zone's wall clock, via the shared offset helper.
 */

import { getTimezoneOffsetMinutes } from './timezone';

const MINUTES_PER_DAY = 24 * 60;

/** Quiet hours leaving less than this much of the day outside the window get a warning. */
export const QUIET_HOURS_MIN_OUTSIDE_MINUTES = 60;

function toMinutes(value: string): number | null {
  const match = /^(\d{1,2}):(\d{2})(?::\d{2})?$/.exec(value.trim());
  if (!match) return null;
  const h = Number(match[1]);
  const m = Number(match[2]);
  if (h > 23 || m > 59) return null;
  return h * 60 + m;
}

/** Minutes covered by the quiet window, or null when either value is unparseable. */
export function quietWindowMinutes(start: string, end: string): number | null {
  const s = toMinutes(start);
  const e = toMinutes(end);
  if (s === null || e === null) return null;
  if (e > s) return e - s;
  if (e < s) return MINUTES_PER_DAY - s + e;
  return 0;
}

/**
 * True when the window covers all but under an hour of the day (e.g. 22:00 ->
 * 21:59 = 23 h 59 m). start == end is an EMPTY window on the server, not a full
 * day, so it does not warn.
 */
export function quietHoursCoverAlmostAllDay(start: string, end: string): boolean {
  const minutes = quietWindowMinutes(start, end);
  if (minutes === null || minutes === 0) return false;
  return MINUTES_PER_DAY - minutes < QUIET_HOURS_MIN_OUTSIDE_MINUTES;
}

// ─── Dose-time warning (medication form) ────────────────────────────────────
//
// Quiet hours are OFF by default for new accounts (migration
// 20261005130000), and the at-due dose reminder is DROPPED, not queued, inside
// quiet hours. So the medication form warns when a dose time falls inside the
// quiet hours of the person who would receive that reminder.
//
// Who receives it: the backend's `trigger_medication_reminders` picks
// COALESCE(medication-responsible member, care-recipient member, circle owner)
// and sends to that ONE user. Their quiet hours are read from THEIR OWN
// `users.timezone` (NULL -> America/New_York), via `sendToUser`.
//
// What the client can know: quiet hours are SELF-READ ONLY (the member list
// carries no quiet hours — it is a "when somebody sleeps" field). So the check
// runs only when the VIEWER is the recipient; for anyone else it stays silent
// rather than guess.

const FALLBACK_TIMEZONE = 'America/New_York';

/**
 * Mirror of backend `isTimeInRange` on a minute-of-day: start > end wraps
 * midnight; start == end is EMPTY. Unparseable bounds -> false.
 */
export function isMinuteInQuietWindow(minuteOfDay: number, start: string, end: string): boolean {
  const s = toMinutes(start);
  const e = toMinutes(end);
  if (s === null || e === null) return false;
  if (s > e) return minuteOfDay >= s || minuteOfDay < e;
  return minuteOfDay >= s && minuteOfDay < e;
}

/**
 * Wall-clock minute of the day (0-1439) at `instant` in `timezone`.
 *
 * Derived from the shared `getTimezoneOffsetMinutes` (the one place that reads a
 * zone's wall clock and carries the hour-24 guard) instead of a second
 * hour-extraction of its own. An unknown zone falls back to America/New_York,
 * like the backend's `safeTimezone`.
 */
export function minuteOfDayInZone(instant: Date, timezone: string | null | undefined): number {
  let zone = timezone || FALLBACK_TIMEZONE;
  try {
    new Intl.DateTimeFormat('en-US', { timeZone: zone });
  } catch {
    zone = FALLBACK_TIMEZONE;
  }
  const utcMinute = Math.floor(instant.getTime() / 60000);
  const wallMinute = utcMinute + getTimezoneOffsetMinutes(zone, instant);
  return ((wallMinute % MINUTES_PER_DAY) + MINUTES_PER_DAY) % MINUTES_PER_DAY;
}

/**
 * Is `instant` inside the quiet window, judged on the wall clock of `timezone`
 * (the recipient's own zone — exactly how the server judges it)?
 * NULL / empty on EITHER bound = quiet hours off = never inside.
 */
export function isInstantInQuietHours(
  instant: Date,
  timezone: string | null | undefined,
  start: string | null | undefined,
  end: string | null | undefined
): boolean {
  if (!start || !end) return false;
  return isMinuteInQuietWindow(minuteOfDayInZone(instant, timezone), start, end);
}

export interface ReminderRecipientMember {
  id: string;
  role?: string | null;
  is_care_recipient?: boolean | null;
  is_medication_responsible?: boolean | null;
}

/**
 * The user the at-due dose reminder goes to — the backend's rule:
 * medication-responsible member, else the care-recipient member, else the
 * circle owner. null when the member list is not loaded yet (never guess).
 */
export function doseReminderRecipientId(
  members: readonly ReminderRecipientMember[] | null | undefined,
  ownerId: string | null | undefined
): string | null {
  if (!members || members.length === 0) return null;
  const responsible = members.find((m) => m.is_medication_responsible);
  if (responsible) return responsible.id;
  const recipient = members.find((m) => m.is_care_recipient);
  if (recipient) return recipient.id;
  if (ownerId) return ownerId;
  return members.find((m) => m.role === 'owner')?.id ?? null;
}

export interface DoseQuietHoursCheck {
  /** The dose as a real instant (the form's own date + time, viewer frame). */
  instant: Date;
  members: readonly ReminderRecipientMember[] | null | undefined;
  ownerId: string | null | undefined;
  /** The signed-in user. */
  viewerId: string | null | undefined;
  /** The viewer's `users.timezone` (server judges quiet hours in this zone). */
  viewerTimezone: string | null | undefined;
  quietHoursStart: string | null | undefined;
  quietHoursEnd: string | null | undefined;
}

/**
 * True when the viewer is the dose-reminder recipient AND the dose time falls
 * inside the viewer's own quiet hours. False in every other case, including
 * "recipient is someone else" (their quiet hours are not exposed to clients).
 */
export function doseFallsInOwnQuietHours(check: DoseQuietHoursCheck): boolean {
  const { viewerId } = check;
  if (!viewerId) return false;
  if (doseReminderRecipientId(check.members, check.ownerId) !== viewerId) return false;
  return isInstantInQuietHours(
    check.instant,
    check.viewerTimezone,
    check.quietHoursStart,
    check.quietHoursEnd
  );
}
