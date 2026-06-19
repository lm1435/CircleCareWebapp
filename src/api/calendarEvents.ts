import { apiClient } from '@/lib/api';

// PORT of mobile/src/api/calendarEvents.ts (read-only subset needed by the web
// calendar). Verified against backend/src/routes/calendarEvents.ts:
//   GET /api/circles/:circleId/events?start_date=YYYY-MM-DD&end_date=YYYY-MM-DD
//   → { success, data: { events: CalendarEvent[] } }
// scheduled_date (DATE) + scheduled_time (TIME) are NAIVE LOCAL values in the
// CARE RECIPIENT's timezone — never parse them as `new Date(`${date}T${time}`)`.
// The backend expands recurrences (virtual + persisted instances) — the client
// must render exactly what it receives and NEVER expand recurrences itself.

export type EventType = 'medication' | 'appointment' | 'task';

export type ConfirmationStatus = 'taken' | 'taken_late' | 'missed' | 'skipped';

export interface EventConfirmation {
  status: ConfirmationStatus;
  confirmed_at: string; // ISO timestamp (UTC)
  confirmed_by: string;
}

export interface EventUser {
  id: string;
  email: string;
  first_name: string | null;
  last_name: string | null;
}

export interface CalendarEvent {
  id: string;
  circle_id: string;
  event_type: EventType;
  title: string;
  description?: string | null;

  // Medication-specific
  medication_name?: string | null;
  medication_dosage?: string | null;
  quantity_remaining?: number | null;
  pills_per_day?: number | null;

  // Scheduling — naive local values in the care recipient's timezone
  scheduled_date: string; // YYYY-MM-DD
  scheduled_time?: string | null; // HH:MM:SS (null/undefined = all-day)
  duration_minutes?: number | null;
  location?: string | null;

  // Recurrence (display only on web). recurrence_days: 0=Sun..6=Sat.
  recurrence_rule?: string | null; // 'daily' | 'every_other_day' | 'weekly' | 'custom:N'
  recurrence_days?: number[] | null;
  recurrence_end_date?: string | null;
  parent_event_id?: string | null;
  is_virtual?: boolean;

  related_event_id?: string | null;

  // Task-specific
  assigned_to?: string | null;
  completed_at?: string | null;

  // UI customization
  color_hex?: string | null;

  // Embedded confirmation (medications only; null when pending)
  confirmation?: EventConfirmation | null;

  note_count?: number;

  // Metadata
  created_by?: string;
  created_at: string;
  updated_at: string;
  created_by_user?: EventUser | null;
  assigned_to_user?: EventUser | null;
}

export interface GetEventsParams {
  start_date?: string; // YYYY-MM-DD in care recipient's timezone
  end_date?: string; // YYYY-MM-DD in care recipient's timezone
  event_type?: EventType;
}

interface EventsEnvelope {
  success: boolean;
  data: { events: CalendarEvent[] };
}

export async function getEvents(
  circleId: string,
  params?: GetEventsParams
): Promise<CalendarEvent[]> {
  // apiClient's response interceptor unwraps axios' response.data, so the
  // resolved value IS the `{ success, data }` envelope.
  const response = (await apiClient.get(`/circles/${circleId}/events`, {
    params,
  })) as unknown as EventsEnvelope;
  return response.data.events;
}

// ---------------------------------------------------------------------------
// Circle detail — care recipient timezone source.
// Verified in backend/src/routes/circles.ts GET /api/circles/:circleId:
//   data.circle.care_recipient_timezone =
//     care recipient's user timezone → circle owner's timezone → 'America/New_York'
// (The GET /circles LIST response does NOT include a timezone field.)
// Lives here instead of src/api/circles.ts to keep file ownership clean while
// other agents work concurrently.
// ---------------------------------------------------------------------------

export interface CircleDetail {
  id: string;
  name: string;
  recipient_name: string;
  care_recipient_timezone: string; // IANA timezone
  can_edit: boolean;
  view_only: boolean;
}

interface CircleDetailEnvelope {
  success: boolean;
  data: { circle: CircleDetail };
}

export async function getCircleDetail(circleId: string): Promise<CircleDetail> {
  const response = (await apiClient.get(`/circles/${circleId}`)) as unknown as CircleDetailEnvelope;
  return response.data.circle;
}
