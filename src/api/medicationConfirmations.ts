import { apiClient } from '@/lib/api';
// Re-exported from the shared lib (generalized out of this module). Anything
// importing `isPermissionDeniedError`/`PERMISSION_ERROR_CODES` from here keeps
// working unchanged; new code may import the finer-grained helpers directly.
export {
  isPermissionDeniedError,
  isSubscriptionRequiredError,
  isAccessDeniedError,
  PERMISSION_ERROR_CODES,
} from '@/lib/apiErrors';

// PORT of mobile/src/api/medicationConfirmations.ts (confirm subset) plus the
// web-only "today's meds" fetch. Today's meds come from the calendar events
// endpoint (GET /circles/:circleId/events) filtered to event_type=medication —
// the same source mobile's CalendarScreen uses. The events route embeds the
// per-instance `confirmation` and generates virtual instances for recurring
// medications, which today-summary (aggregate stats only) does not provide.
//
// Verified backend contracts (backend/src/routes/medicationConfirmations.ts):
// - POST /circles/:circleId/medications/confirm
//   body: { event_id, status: taken|taken_late|skipped, notes?, scheduled_time }
//   `event_id` may be a real UUID or a virtual id (`${parentId}_${YYYY-MM-DD}`).
//   Guarded by requireCircleEditAccess → 403 { error: { code: 'VIEW_ONLY' } }
//   or 403 { error: { code: 'SUBSCRIPTION_REQUIRED' } }.
// - GET /circles/:circleId/events?start_date&end_date&event_type=medication
//   → { success, data: { events } } with `confirmation` embedded on meds.

export type ConfirmableStatus = 'taken' | 'taken_late' | 'skipped';
export type ConfirmationStatus = ConfirmableStatus | 'missed';

export interface MedicationConfirmation {
  id: string;
  event_id: string;
  circle_id: string;
  confirmed_by: string;
  confirmed_at: string;
  status: ConfirmationStatus;
  notes?: string;
  scheduled_time: string;
}

export interface ConfirmMedicationRequest {
  /** Real event UUID or virtual instance id (`${parentId}_${YYYY-MM-DD}`). */
  event_id: string;
  status: ConfirmableStatus;
  notes?: string;
  scheduled_time: string; // HH:MM:SS — in the care recipient's timezone
}

/**
 * Minimal medication event shape needed by the TodaysMeds widget. A subset of
 * the calendar event response — defined locally so this module does not depend
 * on src/api/calendarEvents.ts (owned by the calendar feature).
 */
export interface TodaysMedication {
  id: string;
  event_type: string;
  title: string;
  medication_name?: string | null;
  medication_dosage?: string | null;
  scheduled_date: string; // YYYY-MM-DD in care recipient's timezone
  scheduled_time?: string | null; // HH:MM:SS in care recipient's timezone
  is_virtual?: boolean;
  confirmation?: {
    status: ConfirmationStatus;
    confirmed_at: string;
    confirmed_by: string;
  } | null;
}

interface ConfirmEnvelope {
  success: boolean;
  data: { confirmation: MedicationConfirmation };
}

export async function confirmMedication(
  circleId: string,
  data: ConfirmMedicationRequest
): Promise<MedicationConfirmation> {
  const response = (await apiClient.post(
    `/circles/${circleId}/medications/confirm`,
    data
  )) as unknown as ConfirmEnvelope;
  return response.data.confirmation;
}

/**
 * Aggregate "today" medication stats for a circle — the same shape mobile's
 * CircleListScreen snapshot row uses (mobile/src/api/medicationConfirmations.ts
 * → MedicationTodaySummary). Powers the per-card status line on the circle
 * picker. Aggregate counts only; for the full per-med list use getTodaysMedications.
 */
export interface MedicationTodaySummary {
  total_today: number;
  taken: number;
  overdue: number; // past due but within the 2-hour grace window
  not_marked_today: number;
  not_marked_yesterday: number;
  not_marked_total: number; // today + yesterday — the "urgent" count
  next_due: string | null; // HH:MM:SS in the care recipient's timezone
  next_due_medication: string | null;
  timezone: string;
}

interface TodaySummaryEnvelope {
  success: boolean;
  data: { summary: MedicationTodaySummary };
}

/** GET /circles/:circleId/medications/today-summary — aggregate stats only. */
export async function getMedicationTodaySummary(
  circleId: string
): Promise<MedicationTodaySummary> {
  const response = (await apiClient.get(
    `/circles/${circleId}/medications/today-summary`
  )) as unknown as TodaySummaryEnvelope;
  return response.data.summary;
}

interface EventsEnvelope {
  success: boolean;
  data: { events: TodaysMedication[] };
}

/**
 * Fetch today's medications for a circle.
 *
 * @param dateStr - "today" as YYYY-MM-DD in the CARE RECIPIENT'S timezone —
 *   always compute via getDateInTimezone(circle.timezone), never device-local.
 */
export async function getTodaysMedications(
  circleId: string,
  dateStr: string
): Promise<TodaysMedication[]> {
  const response = (await apiClient.get(`/circles/${circleId}/events`, {
    params: { start_date: dateStr, end_date: dateStr, event_type: 'medication' },
  })) as unknown as EventsEnvelope;

  return (response.data.events ?? [])
    .filter((event) => event.event_type === 'medication' && !!event.scheduled_time)
    .sort((a, b) => (a.scheduled_time ?? '').localeCompare(b.scheduled_time ?? ''));
}
