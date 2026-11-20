import type { CalendarEvent } from '@/api/calendarEvents';
import { addDays, daysBetween } from '@/components/calendar/dateMath';
import { wallTimeToInstant } from '@/utils/wallTimeToInstant';
import { shiftEnd, shiftRootId } from './shiftUtils';

// Shift tasks (docs/plans/shift-tasks.md). PURE helpers: the list a shift detail shows, the card
// count, the "Task · Lucia · Afternoons" label and the edit warning. Everything is read off rows
// the client already holds (naive recipient-local dates and times), never a `Date`.
//
// WHAT IS IN "<Name>'s list" (spec sections 1 and "Decided additions"):
//   - every task LINKED to this occurrence (`event.shift`, status covered / open),
//   - every medication dose due in the window (not as-needed, not discontinued),
//   - every REGULAR task (no link) assigned to the person on this shift whose time is in the window.
// Everything else in the window (other people's and Anyone's regular tasks, other shifts' linked
// tasks, appointments) goes under "Also happening during this shift". Regular tasks are never
// removed or reassigned by a shift action; they only ever appear on one side of this split.

const hm = (time: string | null | undefined): string => (time ? time.slice(0, 5) : '');

export interface ShiftWindow {
  /** `YYYY-MM-DDTHH:MM`, naive recipient-local. */
  start: string;
  end: string;
}

/** start .. start + duration (inclusive of both ends, as the server decides "inside"). */
export function shiftWindow(
  shift: Pick<CalendarEvent, 'scheduled_date' | 'scheduled_time' | 'duration_minutes'>
): ShiftWindow {
  const time = hm(shift.scheduled_time) || '00:00';
  const end = shiftEnd(shift.scheduled_date, time, shift.duration_minutes ?? 0);
  return { start: `${shift.scheduled_date}T${time}`, end: `${end.date}T${end.time}` };
}

function eventAt(event: Pick<CalendarEvent, 'scheduled_date' | 'scheduled_time'>): string | null {
  const time = hm(event.scheduled_time);
  return time ? `${event.scheduled_date}T${time}` : null;
}

function inWindow(event: CalendarEvent, window: ShiftWindow): boolean {
  const at = eventAt(event);
  return at !== null && at >= window.start && at <= window.end;
}

export type ShiftListKind = 'task' | 'med';

export interface ShiftListRow {
  /** The event id (stable per occurrence). */
  key: string;
  kind: ShiftListKind;
  event: CalendarEvent;
  /** A completed task, or a dose that is taken, taken late or SKIPPED (handled). */
  done: boolean;
  skipped: boolean;
  /** A dose nobody answered ("Not marked"): not handled, and no longer actionable. */
  missed: boolean;
  /** Added to the shift (linked), as opposed to a regular task that merely overlaps it. */
  linked: boolean;
}

export interface ShiftListModel {
  rows: ShiftListRow[];
  /** Other people's / Anyone's tasks, other shifts' tasks and appointments in the window, in time order. */
  also: CalendarEvent[];
  /** Rows (tasks + meds) and how many are handled: the "n of N done" header. */
  total: number;
  done: number;
  /** Tasks only (linked + the person's regular ones): the card's "N tasks · n done". */
  taskTotal: number;
  taskDone: number;
  /** The shift has nobody on it. */
  open: boolean;
  /** Key of the first OPEN row (not done, not missed): the only filled (primary) action. Same rule as mobile's nextKey and the server's Live Activity "next". */
  primaryKey: string | null;
}

/** Is this task row one of THIS occurrence's own list (and not another shift's)? */
function isLinkedHere(event: CalendarEvent, shift: CalendarEvent, window: ShiftWindow): boolean {
  const link = event.shift;
  if (event.event_type !== 'task' || !link || link.status === 'outside') return false;
  if (link.date !== shift.scheduled_date) return false;
  if (link.root_id === shiftRootId(shift)) return true;
  // A split moved the occurrence to a newer segment root: same date and same window is the same shift.
  const sameWindow =
    !!link.window_start &&
    !!link.window_end &&
    link.window_start.slice(0, 16) === window.start &&
    link.window_end.slice(0, 16) === window.end;
  return sameWindow && link.title === shift.title;
}

function isDose(event: CalendarEvent): boolean {
  return event.event_type === 'medication' && event.as_needed !== true && !event.discontinued_at;
}

function orderKey(event: CalendarEvent): string {
  return `${eventAt(event) ?? `${event.scheduled_date}T99:99`}|${event.id}`;
}

export function buildShiftList(shift: CalendarEvent, events: readonly CalendarEvent[]): ShiftListModel {
  const window = shiftWindow(shift);
  const holder = shift.assigned_to ?? null;
  const rows: ShiftListRow[] = [];
  const also: CalendarEvent[] = [];
  const seen = new Set<string>();

  for (const event of events) {
    if (event.event_type === 'shift' || seen.has(event.id)) continue;
    seen.add(event.id);

    if (isLinkedHere(event, shift, window)) {
      rows.push({ key: event.id, kind: 'task', event, done: !!event.completed_at, skipped: false, missed: false, linked: true });
      continue;
    }
    if (!inWindow(event, window)) continue;

    if (isDose(event)) {
      const status = event.confirmation?.status;
      const skipped = status === 'skipped';
      rows.push({
        key: event.id,
        kind: 'med',
        event,
        done: status === 'taken' || status === 'taken_late' || skipped,
        skipped,
        missed: status === 'missed',
        linked: false,
      });
    } else if (event.event_type === 'task' && holder && event.assigned_to === holder) {
      rows.push({ key: event.id, kind: 'task', event, done: !!event.completed_at, skipped: false, missed: false, linked: false });
    } else if (event.event_type === 'task' || event.event_type === 'appointment') {
      also.push(event);
    }
  }

  rows.sort((x, y) => (orderKey(x.event) < orderKey(y.event) ? -1 : 1));
  also.sort((x, y) => (orderKey(x) < orderKey(y) ? -1 : 1));

  const tasks = rows.filter((r) => r.kind === 'task');
  return {
    rows,
    also,
    total: rows.length,
    done: rows.filter((r) => r.done).length,
    taskTotal: tasks.length,
    taskDone: tasks.filter((r) => r.done).length,
    open: !holder,
    primaryKey: rows.find((r) => !r.done && !r.missed)?.key ?? null,
  };
}

// ---------------------------------------------------------------------------
// "Task · Lucia · Afternoons"
// ---------------------------------------------------------------------------

type T = (key: string, opts?: Record<string, unknown>) => string;

/**
 * Whose shift a task rides with. Where a "Task" chip already names the type (calendar rows, the event detail,
 * the Tasks list) the shift title leads and the person's name comes last, so a long name is what truncates:
 * "Afternoons · Lucia" (nobody on it: "Night · Open shift"). `withType` (Today's Next up, which shows no chip)
 * keeps the type word: "Task · Lucia · Afternoons". Null for a plain task, including a linked one whose time is
 * outside the shift ("outside"), which is shown as a normal task. The name is `shift.assignee`, never
 * `assigned_to` (which stays null for these rows). Mobile twin: utils/shiftTasks.ts.
 */
export function shiftTaskMeta(
  task: Pick<CalendarEvent, 'shift'>,
  t: T,
  opts?: { withType?: boolean }
): string | null {
  const link = task.shift;
  if (!link || link.status === 'outside') return null;
  const who =
    link.status === 'open' || !link.assignee
      ? t('shifts:tasks.meta.open')
      : link.assignee.first_name?.trim() || t('shifts:someone');
  return opts?.withType
    ? t('shifts:tasks.meta.line', { who, title: link.title })
    : t('shifts:tasks.meta.compact', { who, title: link.title });
}

// ---------------------------------------------------------------------------
// Analytics buckets
// ---------------------------------------------------------------------------

export function tasksBucket(count: number): '0' | '1' | '2-3' | '4+' {
  if (!(count > 0)) return '0';
  if (count === 1) return '1';
  return count <= 3 ? '2-3' : '4+';
}

export function editWarningBucket(count: number): '1' | '2-3' | '4+' {
  if (count <= 1) return '1';
  return count <= 3 ? '2-3' : '4+';
}

export function doneBucket(done: number, total: number): 'none' | 'some' | 'all' {
  if (total <= 0 || done <= 0) return 'none';
  return done >= total ? 'all' : 'some';
}

// ---------------------------------------------------------------------------
// Shift edit warning: "2 tasks fall outside the new hours"
// ---------------------------------------------------------------------------

export type ShiftEditChange =
  | { kind: 'time'; shift: CalendarEvent; startTime: string; durationMinutes: number; scope: 'occurrence' | 'future' }
  | { kind: 'date' | 'repeat'; shift: CalendarEvent; scope: 'occurrence' | 'future' };

function minutesOf(time: string): number {
  const [h, m] = time.split(':');
  return parseInt(h, 10) * 60 + parseInt(m, 10);
}

/**
 * How many tasks added to this shift would stop being on its list when the edit is saved. A time or
 * duration edit keeps each task's clock time, so a task falls out when (day offset, clock time) is
 * outside the new window. A date move or a repeat change leaves tasks on their own dates, so every
 * linked task of the scope falls off. A repeating task counts ONCE however many of its occurrences
 * are loaded. Unlinked tasks and other shifts' tasks never count.
 */
export function countTasksAffectedByEdit(
  change: ShiftEditChange,
  tasks: readonly CalendarEvent[]
): number {
  const { shift, scope } = change;
  const root = shiftRootId(shift);
  const affected = new Set<string>();
  for (const task of tasks) {
    const link = task.shift;
    if (task.event_type !== 'task' || !link || link.status === 'outside' || link.root_id !== root) continue;
    if (task.completed_at) continue;
    if (scope === 'occurrence' ? link.date !== shift.scheduled_date : link.date < shift.scheduled_date) continue;
    if (change.kind === 'time') {
      if (!task.scheduled_time) continue;
      const k = Math.max(0, daysBetween(link.date, task.scheduled_date));
      const at = k * 1440 + minutesOf(task.scheduled_time);
      const start = minutesOf(change.startTime);
      if (at >= start && at <= start + change.durationMinutes) continue;
    }
    affected.add(task.parent_event_id ?? task.id);
  }
  return affected.size;
}

/** An open item is "Late" on the shift detail from this long after its due time (mobile parity, same rule as the Live Activity). */
export const SHIFT_ITEM_LATE_AFTER_MS = 15 * 60_000;

/**
 * Is this OPEN list item 15 minutes or more past its due time? `scheduled_date` + `scheduled_time` are naive in the
 * recipient's zone and resolved the one way the reminder cron does (wallTimeToInstant). No time = never late.
 * The caller decides "open": done, skipped, missed and optimistically-answered rows are not late.
 */
export function isShiftItemLate(
  event: Pick<CalendarEvent, 'scheduled_date' | 'scheduled_time'>,
  timezone: string,
  nowMs: number
): boolean {
  if (!event.scheduled_time) return false;
  const due = wallTimeToInstant(event.scheduled_date, event.scheduled_time, timezone).getTime();
  return Number.isFinite(due) && nowMs - due >= SHIFT_ITEM_LATE_AFTER_MS;
}

// ---------------------------------------------------------------------------
// Shift mode of the full task editor (1.4.3): window checks, the default time, the editor context
// ---------------------------------------------------------------------------

const toMinutes = (time: string): number => {
  const [h, m] = time.split(':');
  return parseInt(h, 10) * 60 + parseInt(m, 10);
};
const fromMinutes = (total: number): string =>
  `${String(Math.floor(total / 60)).padStart(2, '0')}:${String(total % 60).padStart(2, '0')}`;

/**
 * Is `time` inside the shift's window? Earlier than the shift start means the NEXT day (day offset 1,
 * the server's rule); the window ends inclusive. Mirrors the server so the editor answers before a
 * round trip; the server's 400 SHIFT_TASK_OUTSIDE_SHIFT still has the last word on create. On an edit
 * this client check is the ONLY guard (PATCH does not enforce the window).
 */
export function timeInsideShiftWindow(time: string, start: string, durationMinutes: number): boolean {
  if (!time || !start) return false;
  const t = toMinutes(time);
  const s = toMinutes(start);
  const at = (t < s ? 1440 : 0) + t;
  return at >= s && at <= s + durationMinutes;
}

/**
 * Overnight edit rule: the window crosses midnight and `next` lands on the other side of it than
 * `stored` (before the shift start = after midnight). Changing sides would need a date move the PATCH
 * does not do. False for a window inside one day.
 */
export function crossesMidnightSide(
  stored: string,
  next: string,
  start: string,
  durationMinutes: number
): boolean {
  if (!stored || !next || !start || toMinutes(start) + durationMinutes < 1440) return false;
  const s = toMinutes(start);
  return toMinutes(stored) < s !== toMinutes(next) < s;
}

/** `now` as `{date, time}` on the recipient's naive clock. */
export function nowInZone(timezone: string, now: Date = new Date()): { date: string; time: string } {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: timezone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  }).formatToParts(now);
  const get = (type: string): string => parts.find((p) => p.type === type)?.value ?? '00';
  const hour = get('hour') === '24' ? '00' : get('hour');
  return { date: `${get('year')}-${get('month')}-${get('day')}`, time: `${hour}:${get('minute')}` };
}

export type ShiftTimeDefault = 'next_half_hour' | 'shift_start';

/**
 * The time a new shift task opens on. The shift is today in the recipient zone and now is inside the
 * window: the next half hour, clamped to the window end. Otherwise the shift start. Naive recipient-local
 * minutes (the frame of `timeInsideShiftWindow`), never the viewer's clock.
 */
export function defaultShiftTaskTime(
  shift: { scheduledDate: string; startTime: string; durationMinutes: number },
  timezone: string,
  now: Date = new Date()
): { time: string; source: ShiftTimeDefault } {
  const start = shift.startTime.slice(0, 5) || '00:00';
  const startMin = toMinutes(start);
  const endMin = startMin + shift.durationMinutes;
  const local = nowInZone(timezone, now);
  // Minutes since the shift's own midnight: an overnight shift's after-midnight half is `local.date` = the day after.
  const nowMin = toMinutes(local.time) + (local.date === shift.scheduledDate ? 0 : 1440);
  const sameWindowDay =
    local.date === shift.scheduledDate || (endMin >= 1440 && local.date === addDays(shift.scheduledDate, 1));
  if (!sameWindowDay || nowMin < startMin || nowMin > endMin) return { time: start, source: 'shift_start' };
  const next = Math.ceil((nowMin + 1) / 30) * 30;
  const clamped = Math.min(next, endMin);
  return { time: fromMinutes(clamped % 1440), source: 'next_half_hour' };
}

export type ShiftTaskSource = 'shift_detail' | 'saved_sheet' | 'tasks' | 'calendar';

/**
 * What the editor needs to run in shift mode: plain strings and numbers (no row, no component). Built from
 * the shift row it was opened from (`shiftContextFromShift`) or, for a linked task edited from the Tasks /
 * Calendar page, from the fetched task's own `shift` link (`shiftContextFromLink`).
 */
export interface ShiftTaskContext {
  /** The shift event id to POST to (the occurrence id as the shift list holds it). */
  shiftEventId: string;
  /** The occurrence date, `YYYY-MM-DD`, recipient frame. */
  scheduledDate: string;
  title: string;
  /** `HH:MM`, the window start. */
  startTime: string;
  durationMinutes: number;
  repeating: boolean;
  coverer: 'me' | 'other' | 'open';
  /** First name of whoever is on the shift now (null when open or unknown). */
  covererName: string | null;
  source: ShiftTaskSource;
}

/**
 * WINDOW MODE of the appointment and medication forms ("Add to this shift"): the same context a task gets, plus who
 * holds the shift (the appointment's "Who's going" opens on them). The item is NOT linked to the shift server-side.
 */
export interface ShiftWindowContext extends ShiftTaskContext {
  /** Member id of whoever is on the shift now; null when it is open. */
  covererId: string | null;
}

/** The day a start `time` falls on inside the shift's window: the shift day, or the NEXT day before the shift's start clock. */
export function windowDayForTime(
  window: Pick<ShiftTaskContext, 'scheduledDate' | 'startTime'>,
  time: string
): string {
  return time && time.slice(0, 5) < window.startTime.slice(0, 5)
    ? addDays(window.scheduledDate, 1)
    : window.scheduledDate;
}

export function shiftContextFromShift(
  shift: CalendarEvent,
  members: readonly { id: string; first_name?: string | null; email?: string | null }[],
  viewerId: string | null | undefined,
  source: ShiftTaskSource,
  repeating: boolean
): ShiftTaskContext {
  const holder = shift.assigned_to ?? null;
  const member = holder ? members.find((m) => m.id === holder) : undefined;
  const name =
    member?.first_name?.trim() || shift.assigned_to_user?.first_name?.trim() || null;
  return {
    shiftEventId: shift.id,
    scheduledDate: shift.scheduled_date,
    title: shift.title,
    startTime: hm(shift.scheduled_time) || '00:00',
    durationMinutes: shift.duration_minutes ?? 0,
    repeating,
    coverer: !holder ? 'open' : holder === viewerId ? 'me' : 'other',
    covererName: name,
    source,
  };
}

/**
 * The context of a LINKED task opened from outside the shift (Tasks, Calendar), read off its fetched `shift`
 * link. Null for a plain task, an `outside` link, an old backend that sends no link, or a link without a
 * window (nothing to validate against): the normal editor, nothing locked.
 */
export function shiftContextFromLink(
  task: Pick<CalendarEvent, 'event_type' | 'shift' | 'recurrence_rule' | 'parent_event_id'>,
  viewerId: string | null | undefined,
  source: ShiftTaskSource
): ShiftTaskContext | null {
  const link = task.shift;
  if (task.event_type !== 'task' || !link || link.status === 'outside' || !link.window_start || !link.window_end) return null;
  const startDate = link.window_start.slice(0, 10);
  const startTime = link.window_start.slice(11, 16);
  const endDate = link.window_end.slice(0, 10);
  const endTime = link.window_end.slice(11, 16);
  if (!startTime || !endTime) return null;
  const durationMinutes = daysBetween(startDate, endDate) * 1440 + toMinutes(endTime) - toMinutes(startTime);
  if (!(durationMinutes >= 0)) return null;
  const holder = link.assignee?.id ?? null;
  return {
    shiftEventId: link.root_id,
    scheduledDate: link.date,
    title: link.title,
    startTime,
    durationMinutes,
    repeating: !!task.recurrence_rule || !!task.parent_event_id,
    coverer: link.status === 'open' || !holder ? 'open' : holder === viewerId ? 'me' : 'other',
    covererName: link.assignee?.first_name?.trim() || null,
    source,
  };
}

/**
 * Does `row` belong to the task `id` the editor just saved? A repeating task's row for the day is usually a
 * virtual `<root>_<date>` occurrence (or a physical child pointing at the root), so the root id matches too.
 */
export function rowMatchesHighlight(
  row: Pick<ShiftListRow, 'key' | 'event'>,
  id: string
): boolean {
  return row.key === id || row.key.startsWith(`${id}_`) || row.event.parent_event_id === id;
}
