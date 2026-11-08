import { apiClient } from '@/lib/api';
import type { CalendarEvent } from '@/api/calendarEvents';

// Shift tasks API (docs/plans/shift-tasks.md section 4).
//
//   POST /circles/:id/events/:eventId/shift/tasks
//        { scheduledDate, title, scheduled_time 'HH:MM', only_this_day? }  -> 201 { event }
//        400 SHIFT_TASK_OUTSIDE_SHIFT | SHIFT_TASK_TIME_UNSUPPORTED | SHIFT_INVALID_DATE
//        409 SHIFT_ENDED, 402/403 lapsed or view-only, 404 SHIFT_NOT_FOUND
//   GET  /circles/:id/events/:eventId/shift/tasks/delete-impact?scheduledDate=D
//        -> data.counts { occurrence, future, all }
//
// `:eventId` may be the series root, a physical child or the virtual `<root>_<date>` id, so callers
// pass `shift.id` as-is (like take / drop / assign). Errors are read off `err.error.code`.

export interface CreateShiftTaskBody {
  /** The shift occurrence's `YYYY-MM-DD` (recipient frame). */
  scheduledDate: string;
  /** 1-150 characters. */
  title: string;
  /** `HH:MM`, inside the occurrence window; earlier than the shift start means the next day. */
  scheduled_time: string;
  /** A one-off on this occurrence instead of repeating with the shift. */
  only_this_day?: boolean;
}

export async function createShiftTask(
  circleId: string,
  eventId: string,
  body: CreateShiftTaskBody
): Promise<CalendarEvent> {
  const response = (await apiClient.post(
    `/circles/${circleId}/events/${encodeURIComponent(eventId)}/shift/tasks`,
    body
  )) as unknown as { success: boolean; data: { event: CalendarEvent } };
  return response.data.event;
}

/** What each delete scope would remove or cut short, from the same planner the delete runs. */
export interface ShiftTaskDeleteImpact {
  occurrence: number;
  future: number;
  all: number;
}

export async function getShiftTaskDeleteImpact(
  circleId: string,
  eventId: string,
  scheduledDate: string
): Promise<ShiftTaskDeleteImpact> {
  const response = (await apiClient.get(
    `/circles/${circleId}/events/${encodeURIComponent(eventId)}/shift/tasks/delete-impact`,
    { params: { scheduledDate } }
  )) as unknown as { success: boolean; data: { counts: Partial<ShiftTaskDeleteImpact> } };
  const counts = response.data?.counts ?? {};
  const n = (v: unknown): number => (typeof v === 'number' && v > 0 ? v : 0);
  return { occurrence: n(counts.occurrence), future: n(counts.future), all: n(counts.all) };
}

interface ErrorEnvelope {
  error?: { code?: string };
}
const codeOf = (err: unknown): string | undefined => (err as ErrorEnvelope | null)?.error?.code;

/** 400 SHIFT_TASK_OUTSIDE_SHIFT: the time is not inside the shift's window. */
export const isShiftTaskOutsideError = (err: unknown): boolean =>
  codeOf(err) === 'SHIFT_TASK_OUTSIDE_SHIFT';
/** 400 SHIFT_TASK_TIME_UNSUPPORTED: a monthly / yearly shift cannot carry an after-midnight task. */
export const isShiftTaskTimeUnsupportedError = (err: unknown): boolean =>
  codeOf(err) === 'SHIFT_TASK_TIME_UNSUPPORTED';
