import type {
  DailyUpdateAppointmentDetail,
  DailyUpdateData,
  DailyUpdateDoseDetail,
  DailyUpdateNoteDetail,
  DailyUpdateTaskDetail,
} from '@/api/dailyUpdate';
import { addDaysToDateString, isDateInDailyUpdateRange } from '@/lib/dailyUpdateWindow';

/**
 * Where each daily-update row goes (docs/plans/daily-update.md "Design v2 B2",
 * "Tap targets"). Every target is an EXISTING web route:
 *
 *   appointment         → /circles/:id/calendar?date=&eventId=   (that day's occurrence)
 *   completed task      → /circles/:id/calendar?eventId=         (the row, by id; the
 *                                                                   calendar reads its date)
 *   event note          → its event by id, &panel=notes
 *   care note           → /circles/:id/notes?date=                (that day's notes)
 *   dose                → /circles/:id/meds?medication=           (the medication's detail)
 *   2+ tasks            → the full update page, at its Tasks section
 *
 * A row whose target id is missing returns null: it renders as plain text, no
 * chevron (the spec's "target no longer exists" rule).
 */

const enc = encodeURIComponent;

export function dailyUpdatePagePath(
  circleId: string,
  date: string | null,
  hash?: string
): string {
  const base = `/circles/${circleId}/daily-update${date ? `/${date}` : ''}`;
  return hash ? `${base}#${hash}` : base;
}

export function calendarEventPath(
  circleId: string,
  date: string,
  eventId: string,
  panel?: 'notes'
): string {
  return `/circles/${circleId}/calendar?date=${date}&eventId=${enc(eventId)}${panel ? `&panel=${panel}` : ''}`;
}

/**
 * An event opened BY ID, with no date from the update page: a virtual
 * occurrence id (`${rootId}_${YYYY-MM-DD}`) carries its own date; any other id
 * is a real row whose date the calendar reads from GET /events/:id.
 */
export function eventPathById(circleId: string, eventId: string, panel?: 'notes'): string {
  const virtual = /_(\d{4}-\d{2}-\d{2})$/.exec(eventId);
  if (virtual) return calendarEventPath(circleId, virtual[1], eventId, panel);
  return `/circles/${circleId}/calendar?eventId=${enc(eventId)}${panel ? `&panel=${panel}` : ''}`;
}

/** A completed task: the completed row itself, opened by id (never the update's date). */
export function taskTarget(circleId: string, task: DailyUpdateTaskDetail): string | null {
  return task.event_id ? eventPathById(circleId, task.event_id) : null;
}

export function appointmentTarget(
  circleId: string,
  date: string,
  appt: DailyUpdateAppointmentDetail
): string | null {
  return appt.event_id ? calendarEventPath(circleId, date, appt.event_id) : null;
}

export function noteTarget(
  circleId: string,
  date: string,
  note: DailyUpdateNoteDetail
): string | null {
  if (note.kind === 'care') return `/circles/${circleId}/notes?date=${date}`;
  if (!note.event_id) return null;
  return eventPathById(circleId, note.event_id, 'notes');
}

export function doseTarget(circleId: string, dose: DailyUpdateDoseDetail): string | null {
  return dose.medication_id ? `/circles/${circleId}/meds?medication=${enc(dose.medication_id)}` : null;
}

/**
 * The card's tasks row: exactly one task done → that task; two or more → the
 * full update at its Tasks section. Without item detail (older backend) the
 * row still opens the full update.
 */
export function tasksRowTarget(circleId: string, data: DailyUpdateData): string {
  const detail = data.tasks_done_detail ?? [];
  if (data.tasks.done === 1 && detail.length === 1) {
    const one = taskTarget(circleId, detail[0]);
    if (one) return one;
  }
  return dailyUpdatePagePath(circleId, null, detail.length > 0 ? 'tasks' : undefined);
}

/**
 * Day arrows: the server's `nav` when it sends one, else computed from the
 * recipient-local `today` (prev within the 7-day range, next ≤ today).
 */
export function dayNav(
  date: string,
  today: string,
  serverNav?: DailyUpdateData['nav']
): { prev: string | null; next: string | null } {
  if (serverNav) return { prev: serverNav.prev_date, next: serverNav.next_date };
  const prev = addDaysToDateString(date, -1);
  const next = addDaysToDateString(date, 1);
  return {
    prev: isDateInDailyUpdateRange(prev, today) ? prev : null,
    next: next <= today && isDateInDailyUpdateRange(next, today) ? next : null,
  };
}

/**
 * The way back ("Daily updates" in Quick access and atop the Activity feed):
 * today's page once it is 19:00+ in the recipient's zone AND today has
 * activity; otherwise yesterday's page.
 */
export function latestDailyUpdatePath(
  circleId: string,
  today: string,
  inWindow: boolean,
  todayHasActivity: boolean
): string {
  if (inWindow && todayHasActivity) return dailyUpdatePagePath(circleId, null);
  return dailyUpdatePagePath(circleId, addDaysToDateString(today, -1));
}
