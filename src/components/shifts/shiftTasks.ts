import type { CalendarEvent } from '@/api/calendarEvents';
import { daysBetween } from '@/components/calendar/dateMath';
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
  /** Key of the first row that is not done: the only filled (primary) action. */
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
    primaryKey: rows.find((r) => !r.done)?.key ?? null,
  };
}

// ---------------------------------------------------------------------------
// "Task · Lucia · Afternoons"
// ---------------------------------------------------------------------------

type T = (key: string, opts?: Record<string, unknown>) => string;

/**
 * The meta line of a task that belongs to a shift: "Task · <first name> · <shift title>", or
 * "Task · Open shift · <shift title>" while nobody covers it. Null for a plain task, including a
 * linked one whose time is outside the shift ("outside"), which is shown as a normal task. The name
 * is `shift.assignee`, never `assigned_to` (which stays null for these rows).
 */
export function shiftTaskMeta(
  task: Pick<CalendarEvent, 'shift'>,
  t: T
): string | null {
  const link = task.shift;
  if (!link || link.status === 'outside') return null;
  const who =
    link.status === 'open' || !link.assignee
      ? t('shifts:tasks.meta.open')
      : link.assignee.first_name?.trim() || t('shifts:someone');
  return t('shifts:tasks.meta.line', { who, title: link.title });
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
