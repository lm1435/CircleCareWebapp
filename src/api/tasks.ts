import { apiClient } from '@/lib/api';
import type { CalendarEvent } from './calendarEvents';

// PORT of mobile/src/api/tasks.ts (read-only). Verified against
// backend/src/routes/tasks.ts:
//   GET /api/circles/:circleId/tasks?status=&sort=&limit=
//     status: 'open' | 'completed' | 'all'   (default 'open')
//     sort:   'due_date' | 'assignee' | 'created_at'  (default 'due_date')
//     limit:  positive int, max 100 (optional)
//   → { success, data: { tasks: CalendarEvent[], today, timezone } }
// `today` is YYYY-MM-DD and `timezone` the resolved care-recipient IANA TZ
// (care_recipient.timezone → circle_owner.timezone → 'America/New_York').
// scheduled_date / scheduled_time on each task are NAIVE LOCAL values in that
// timezone — never parse them as `new Date(`${date}T${time}`)`.

// ============================================================================
// TYPES — mirrored from mobile/src/api/tasks.ts
// ============================================================================

export type TaskStatus = 'open' | 'completed' | 'all';
export type TaskSort = 'due_date' | 'assignee' | 'created_at';

export interface GetTasksParams {
  status?: TaskStatus;
  sort?: TaskSort;
  limit?: number;
}

/** A task is a calendar event with `event_type: 'task'`. */
export type Task = CalendarEvent;

export interface GetTasksResponse {
  tasks: Task[];
  today: string; // YYYY-MM-DD in the care recipient's timezone
  timezone: string; // resolved IANA timezone
}

interface GetTasksEnvelope {
  success: boolean;
  data: GetTasksResponse;
}

// ============================================================================
// API FUNCTIONS
// ============================================================================

export async function getTasks(
  circleId: string,
  params?: GetTasksParams
): Promise<GetTasksResponse> {
  const searchParams = new URLSearchParams();
  if (params?.status) searchParams.set('status', params.status);
  if (params?.sort) searchParams.set('sort', params.sort);
  if (params?.limit) searchParams.set('limit', String(params.limit));
  const qs = searchParams.toString();

  // apiClient's response interceptor unwraps axios' response.data, so the
  // resolved value IS the `{ success, data }` envelope.
  const response = (await apiClient.get(
    `/circles/${circleId}/tasks${qs ? `?${qs}` : ''}`
  )) as unknown as GetTasksEnvelope;
  return response.data;
}
