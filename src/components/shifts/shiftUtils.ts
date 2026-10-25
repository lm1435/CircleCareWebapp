import type { CalendarEvent } from '@/api/calendarEvents';
import type { HourCycle } from '@/utils/hourCycle';
import {
  getEventTimeParts,
  getTimezoneSuffix,
  formatTimeOfDay,
  getDeviceTimezone,
  timezonesAreDifferent,
  zoneReferenceInstant,
} from '@/utils/timezone';
import { instantFromNaiveTimeInZone } from '@/utils/recipientEventDate';
import { addDays } from '@/components/calendar/dateMath';

// Pure helpers for the care-shifts feature (docs/plans/care-shifts.md). A shift
// is a `calendar_events` row with `event_type = 'shift'`; `scheduled_date` +
// `scheduled_time` are NAIVE LOCAL values in the CARE RECIPIENT's timezone and
// the end is `naive start + duration_minutes` (it may cross midnight). Nothing
// here builds a `Date` from those strings.

export type { ShiftScope } from '@/api/shifts';

/** The reminder choices (`reminder_lead_minutes`): 60 | 120 | 240 | 1440, null = off. */
export const SHIFT_REMINDER_LEADS = [null, 60, 120, 240, 1440] as const;
export type ShiftReminderLead = (typeof SHIFT_REMINDER_LEADS)[number];
/** The form's default reminder: 1 hour before. */
export const DEFAULT_SHIFT_REMINDER_LEAD: ShiftReminderLead = 60;

export const MIN_SHIFT_MINUTES = 15;
export const MAX_SHIFT_MINUTES = 1440;
export const SHIFT_NAME_MAX = 60;

export function isShiftEvent(event: Pick<CalendarEvent, 'event_type'>): boolean {
  return event.event_type === 'shift';
}

/** OPEN = nobody on it. */
export function isShiftOpen(shift: Pick<CalendarEvent, 'assigned_to'>): boolean {
  return !shift.assigned_to;
}

export function isShiftRepeating(
  shift: Pick<CalendarEvent, 'recurrence_rule' | 'parent_event_id'>
): boolean {
  return !!shift.recurrence_rule || !!shift.parent_event_id;
}

/**
 * Does the assignee hold ONLY this day of a repeating shift ("Just this one")? True for a
 * physical occurrence whose series default person (the root's) is somebody else or nobody.
 * `false` whenever we cannot tell (root not loaded yet, a virtual row, the root itself), so
 * the UI falls back to the series wording rather than claiming "this day only".
 */
export function holdsOnlyThisDay(
  shift: Pick<CalendarEvent, 'id' | 'assigned_to' | 'parent_event_id' | 'is_virtual'>,
  root: Pick<CalendarEvent, 'id' | 'assigned_to'> | null | undefined
): boolean {
  if (!shift.assigned_to || !shift.parent_event_id || shift.is_virtual === true) return false;
  if (!root || root.id === shift.id || root.id !== shift.parent_event_id) return false;
  return root.assigned_to !== shift.assigned_to;
}

/** The series root of a shift row (itself for a one-off or a root). */
export function shiftRootId(shift: Pick<CalendarEvent, 'id' | 'parent_event_id'>): string {
  return shift.parent_event_id || shift.id;
}

/**
 * Is the series DEFAULT person open, as far as the rows we hold can tell?
 * `true` / `false` when known, `undefined` when nothing we hold says. Read from, in
 * order: the root row when it is loaded (or fetched), the event itself when it is
 * virtual (a virtual occurrence inherits its root's person), any loaded VIRTUAL
 * sibling (same root, same inheritance), then `fetchedRoot`. Mirrors mobile's
 * `seriesDefaultOpen`.
 */
export function seriesDefaultOpen(
  event: Pick<CalendarEvent, 'id' | 'parent_event_id' | 'is_virtual' | 'assigned_to'>,
  loaded: readonly CalendarEvent[],
  fetchedRoot?: Pick<CalendarEvent, 'id' | 'assigned_to'> | null
): boolean | undefined {
  const rootId = shiftRootId(event);
  const root = loaded.find((e) => e.id === rootId) ?? (fetchedRoot?.id === rootId ? fetchedRoot : undefined);
  if (root) return !root.assigned_to;
  if (event.is_virtual === true) return !event.assigned_to;
  const sibling = loaded.find((e) => e.is_virtual === true && e.parent_event_id === rootId);
  if (sibling) return !sibling.assigned_to;
  return undefined;
}

/**
 * May the viewer take "this and every future one"? The server answers 409
 * SHIFT_ALREADY_TAKEN for a `future` take on a series whose DEFAULT person is
 * someone else (only managers / the owner take that over), so the option is
 * offered only when the series default is open, or for owner / manager. When the
 * default can't be read from what is loaded it is not offered until
 * `fetchedRoot` arrives.
 */
export function canTakeFuture(
  event: CalendarEvent,
  loaded: readonly CalendarEvent[],
  canAssignOthers: boolean,
  fetchedRoot?: Pick<CalendarEvent, 'id' | 'assigned_to'> | null
): boolean {
  if (!isShiftRepeating(event)) return false;
  if (canAssignOthers) return true;
  return seriesDefaultOpen(event, loaded, fetchedRoot) === true;
}

function parseHm(time: string | null | undefined): number | null {
  if (!time) return null;
  const [h, m] = time.split(':');
  const hours = parseInt(h, 10);
  const minutes = parseInt(m, 10);
  if (!Number.isFinite(hours) || !Number.isFinite(minutes)) return null;
  return hours * 60 + minutes;
}

function hm(totalMinutes: number): string {
  const wrapped = ((totalMinutes % 1440) + 1440) % 1440;
  return `${String(Math.floor(wrapped / 60)).padStart(2, '0')}:${String(wrapped % 60).padStart(2, '0')}`;
}

export interface ShiftEnd {
  /** `YYYY-MM-DD`, naive recipient-local. */
  date: string;
  /** `HH:MM`. */
  time: string;
  /** The end lands on a later calendar day than the start. */
  nextDay: boolean;
}

/**
 * The naive-local end of a shift: start + duration, rolling past midnight. DST
 * is deliberately NOT applied (the entered wall times are what is shown).
 */
export function shiftEnd(startDate: string, startTime: string, durationMinutes: number): ShiftEnd {
  const start = parseHm(startTime) ?? 0;
  const total = start + durationMinutes;
  const dayOffset = Math.floor(total / 1440);
  return { date: addDays(startDate, dayOffset), time: hm(total), nextDay: dayOffset >= 1 };
}

/** Chronological order: date, then time, then name (stable for equal starts). */
export function sortShifts(shifts: readonly CalendarEvent[]): CalendarEvent[] {
  return [...shifts].sort((a, b) => {
    if (a.scheduled_date !== b.scheduled_date) return a.scheduled_date < b.scheduled_date ? -1 : 1;
    const at = a.scheduled_time ?? '';
    const bt = b.scheduled_time ?? '';
    if (at !== bt) return at < bt ? -1 : 1;
    return (a.title || '').localeCompare(b.title || '');
  });
}

export function shiftsOnDay(shifts: readonly CalendarEvent[], date: string): CalendarEvent[] {
  return sortShifts(shifts.filter((s) => s.scheduled_date === date));
}

export function countOpen(shifts: readonly CalendarEvent[]): number {
  return shifts.reduce((n, s) => (isShiftOpen(s) ? n + 1 : n), 0);
}

/** Group by `scheduled_date`, each day sorted by start. */
export function groupShiftsByDay(shifts: readonly CalendarEvent[]): Map<string, CalendarEvent[]> {
  const byDay = new Map<string, CalendarEvent[]>();
  for (const shift of sortShifts(shifts)) {
    const list = byDay.get(shift.scheduled_date);
    if (list) list.push(shift);
    else byDay.set(shift.scheduled_date, [shift]);
  }
  return byDay;
}

/**
 * The open-shift badge window: from now through the next 7 days, in the
 * recipient's timezone — `today` .. `today + 6`... plus today's already-started
 * shifts are still "today", so the window is the 7 calendar days starting today.
 */
export function openShiftWindow(today: string): { start: string; end: string } {
  return { start: today, end: addDays(today, 6) };
}

/** Has the shift already ENDED (naive end resolved in the recipient's zone) at `now`? */
export function hasShiftEnded(
  shift: Pick<CalendarEvent, 'scheduled_date' | 'scheduled_time' | 'duration_minutes'>,
  timezone: string,
  now: Date = new Date()
): boolean {
  const end = shiftEnd(
    shift.scheduled_date,
    shift.scheduled_time ?? '00:00',
    shift.duration_minutes ?? 0
  );
  const mins = parseHm(end.time) ?? 0;
  const endInstant = instantFromNaiveTimeInZone(end.date, Math.floor(mins / 60), mins % 60, timezone);
  return endInstant.getTime() <= now.getTime();
}

/** Open shifts that have not ended yet: what the Shifts badge counts. */
export function countOpenUpcoming(
  shifts: readonly CalendarEvent[],
  timezone: string,
  now: Date = new Date()
): number {
  return shifts.reduce(
    (n, s) => (isShiftOpen(s) && !hasShiftEnded(s, timezone, now) ? n + 1 : n),
    0
  );
}

/**
 * Start within 24 h from now (or already under way): the `shift_dropped.within_24h`
 * flag. Exact instant, same as mobile's `isWithin24hOfStart`.
 */
export function isWithin24hOfStart(
  shift: Pick<CalendarEvent, 'scheduled_date' | 'scheduled_time'>,
  timezone: string,
  now: Date = new Date()
): boolean {
  const mins = parseHm(shift.scheduled_time) ?? 0;
  const start = instantFromNaiveTimeInZone(
    shift.scheduled_date,
    Math.floor(mins / 60),
    mins % 60,
    timezone
  );
  return start.getTime() - now.getTime() <= 24 * 60 * 60 * 1000;
}

// ---------------------------------------------------------------------------
// Optimistic patches (hooks/useShifts) -- same contract as mobile's
// `patchOccurrences`: a `future` action patches only the rows the server moves.
// ---------------------------------------------------------------------------

export interface OccurrenceTarget {
  /** The series root the occurrence belonged to when the action started. */
  rootId: string;
  date: string;
  scope: 'occurrence' | 'future';
  /**
   * For `future`: which rows ride along. A take only moves OPEN rows (a row that
   * someone else holds is an explicit override and keeps its person); a drop or
   * assign moves the rows held by the same person as the tapped one.
   */
  appliesTo: (event: CalendarEvent) => boolean;
}

/** The target of a take (`take`: open rows follow) or a drop / assign (`other`: same holder). */
export function targetFor(
  shift: Pick<CalendarEvent, 'id' | 'parent_event_id' | 'scheduled_date' | 'assigned_to'>,
  scope: 'occurrence' | 'future',
  mode: 'take' | 'other'
): OccurrenceTarget {
  const holder = shift.assigned_to ?? null;
  return {
    rootId: shiftRootId(shift),
    date: shift.scheduled_date,
    scope,
    appliesTo:
      mode === 'take' ? (e) => !e.assigned_to : (e) => (e.assigned_to ?? null) === holder,
  };
}

/** `events` with `patch` applied to every row the target covers; same array when none match. */
export function patchOccurrences(
  events: readonly CalendarEvent[],
  target: OccurrenceTarget,
  patch: Partial<CalendarEvent>
): CalendarEvent[] {
  let changed = false;
  const next = events.map((e) => {
    if (shiftRootId(e) !== target.rootId) return e;
    const hit =
      target.scope === 'future'
        ? e.scheduled_date === target.date ||
          (e.scheduled_date > target.date && target.appliesTo(e))
        : e.scheduled_date === target.date;
    if (!hit) return e;
    changed = true;
    return { ...e, ...patch };
  });
  return changed ? next : (events as CalendarEvent[]);
}

/** Do the viewer's and the recipient's clocks differ on the SHIFT'S date (not today)? */
export function shiftZonesDiffer(
  date: string | null | undefined,
  timezone: string | null
): boolean {
  return (
    !!timezone && timezonesAreDifferent(getDeviceTimezone(), timezone, zoneReferenceInstant(date))
  );
}

// ---------------------------------------------------------------------------
// Display
// ---------------------------------------------------------------------------

export interface ShiftRangeParts {
  start: string;
  /** With the recipient-zone suffix, judged at the END's own date. */
  end: string;
  nextDay: boolean;
}

/** The start / end labels of a shift ("8:00 AM", "2:00 PM CT") and whether it ends the next day. */
export function formatShiftRangeParts(
  shift: Pick<CalendarEvent, 'scheduled_date' | 'scheduled_time' | 'duration_minutes'>,
  tz: string,
  cycle: HourCycle
): ShiftRangeParts {
  const start = shift.scheduled_time ?? '00:00';
  const end = shiftEnd(shift.scheduled_date, start, shift.duration_minutes ?? MIN_SHIFT_MINUTES);
  const startMin = parseHm(start) ?? 0;
  const startLabel = formatTimeOfDay(Math.floor(startMin / 60), startMin % 60, cycle);
  const endMin = parseHm(end.time) ?? 0;
  const endRef = zoneReferenceInstant(end.date);
  const endLabel = `${formatTimeOfDay(Math.floor(endMin / 60), endMin % 60, cycle)}${getTimezoneSuffix(tz, endRef)}`;
  return { start: startLabel, end: endLabel, nextDay: end.nextDay };
}

/** "8:00 AM – 2:00 PM" (the zone is named once, on the end, when it differs from the viewer's). */
export function formatShiftRange(
  shift: Pick<CalendarEvent, 'scheduled_date' | 'scheduled_time' | 'duration_minutes'>,
  tz: string,
  cycle: HourCycle
): string {
  const { start, end } = formatShiftRangeParts(shift, tz, cycle);
  return `${start} – ${end}`;
}

/**
 * The VIEWER's own clock for the same range, or null when the viewer shares the
 * recipient's zone (nothing to disclose).
 */
export function formatShiftRangeViewer(
  shift: Pick<CalendarEvent, 'scheduled_date' | 'scheduled_time' | 'duration_minutes'>,
  tz: string,
  cycle: HourCycle
): string | null {
  const start = shift.scheduled_time ?? '00:00';
  const end = shiftEnd(shift.scheduled_date, start, shift.duration_minutes ?? MIN_SHIFT_MINUTES);
  const startParts = getEventTimeParts(start, tz, zoneReferenceInstant(shift.scheduled_date), cycle);
  // The end is converted at ITS OWN date (an overnight shift can cross a DST change).
  const endParts = getEventTimeParts(end.time, tz, zoneReferenceInstant(end.date), cycle);
  if (!startParts.secondaryTime && !endParts.secondaryTime) return null;
  // One end may share the viewer's clock on its date while the other does not.
  return `${startParts.secondaryTime ?? startParts.primaryTime} – ${endParts.secondaryTime ?? endParts.primaryTime}`;
}

export function shiftDurationHm(minutes: number): { hours: number; minutes: number } {
  return { hours: Math.floor(minutes / 60), minutes: minutes % 60 };
}

// ---------------------------------------------------------------------------
// Analytics enums (identical on mobile). The bucket helpers live in lib/analytics.
// ---------------------------------------------------------------------------

export type ReminderEnum = 'off' | '1h' | '2h' | '4h' | '1d';
export function reminderEnum(lead: number | null | undefined): ReminderEnum {
  switch (lead) {
    case 60:
      return '1h';
    case 120:
      return '2h';
    case 240:
      return '4h';
    case 1440:
      return '1d';
    default:
      return 'off';
  }
}

export type ShiftRecurrenceEnum = 'none' | 'daily' | 'weekly' | 'days';
export function recurrenceEnum(
  rule: string | null | undefined,
  days: readonly number[] | null | undefined
): ShiftRecurrenceEnum {
  if (!rule) return 'none';
  if (rule === 'daily') return 'daily';
  if (rule === 'weekly') return days && days.length > 0 ? 'days' : 'weekly';
  return 'none';
}

// ---------------------------------------------------------------------------
// Copy helpers
// ---------------------------------------------------------------------------

type TranslateFn = (key: string, opts?: Record<string, unknown>) => string;

/** First letter lower-cased in `language` ("Every day" -> "every day"). */
export function lowerFirst(text: string, language: string): string {
  return text ? text.charAt(0).toLocaleLowerCase(language) + text.slice(1) : text;
}

/**
 * Repeat summary, identical to mobile's detail row: a rule -> `formatRecurrence`
 * ("Daily" / "Weekly" / "Weekly on Mon, Wed"); a repeating row whose rule is
 * not known (child row, root still loading / failed) -> "Repeats"; else "Never".
 * `source` is the row carrying the rule (the series root for a child row).
 * Literal keys only.
 */
export function formatShiftRepeat(
  source: Pick<CalendarEvent, 'recurrence_rule' | 'recurrence_days'> | null,
  repeating: boolean,
  t: TranslateFn,
  weekdayList: (days: readonly number[]) => string
): string {
  const rule = source?.recurrence_rule;
  if (rule === 'daily') return t('shifts:repeat.daily');
  if (rule === 'weekly') {
    const days = source?.recurrence_days;
    const list = days && days.length > 0 ? weekdayList(days) : '';
    if (list) return t('shifts:repeat.weeklyOn', { days: list });
    return t('shifts:repeat.weekly');
  }
  if (rule || repeating) return t('shifts:repeat.series');
  return t('shifts:repeat.never');
}

/** The reminder label ("1 hour before" / "Off"). Literal keys only. */
export function formatShiftReminder(lead: number | null | undefined, t: TranslateFn): string {
  switch (lead) {
    case 60:
      return t('shifts:reminder.h1');
    case 120:
      return t('shifts:reminder.h2');
    case 240:
      return t('shifts:reminder.h4');
    case 1440:
      return t('shifts:reminder.d1');
    default:
      return t('shifts:reminder.off');
  }
}

/** The picker's short wording ("1 hour" / "Off"), shared by the shift form and the Take dialog. */
export function formatShiftReminderChip(lead: number | null | undefined, t: TranslateFn): string {
  switch (lead) {
    case 60:
      return t('shifts:reminder.chip1h');
    case 120:
      return t('shifts:reminder.chip2h');
    case 240:
      return t('shifts:reminder.chip4h');
    case 1440:
      return t('shifts:reminder.chip1d');
    default:
      return t('shifts:reminder.off');
  }
}

/** "12 hours" / "1 h 30 min" / "45 minutes". Literal keys only. */
export function formatShiftDuration(minutes: number, t: TranslateFn): string {
  const { hours, minutes: mins } = shiftDurationHm(minutes);
  if (hours > 0 && mins > 0) return t('shifts:duration.mixed', { hours, minutes: mins });
  if (hours > 0) return t('shifts:duration.hours', { count: hours });
  return t('shifts:duration.minutes', { count: mins });
}

/** Display name of a member (first name, else the email local part). */
export function memberShortName(m: {
  first_name: string | null;
  email?: string | null;
}): string {
  return m.first_name?.trim() || (m.email ? m.email.split('@')[0] : '');
}
