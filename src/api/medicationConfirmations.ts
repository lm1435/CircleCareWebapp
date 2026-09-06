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

  // Populated joins (backend/src/routes/medicationConfirmations.ts:1502-1519,
  // GET /circles/:circleId/medications/confirmations only — mirrors mobile's
  // src/api/medicationConfirmations.ts:16-29).
  confirmed_by_user?: {
    email?: string;
    first_name?: string | null;
    last_name?: string | null;
  } | null;
  event?: {
    id?: string;
    title?: string;
    medication_name?: string | null;
    medication_dosage?: string | null;
    medication_photo_url?: string | null;
    scheduled_date?: string; // YYYY-MM-DD in the care recipient's timezone
    parent_event_id?: string | null;
  } | null;
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
  /**
   * Discontinue marker (ISO instant) when this dose belongs to a medication
   * that has since been stopped. This fetch passes NO `includeDiscontinued`, so
   * anything that arrives with it set is a dose the backend found DUE before
   * the stop instant — history, and still confirmable. It changes how the row
   * is LABELLED ("Inactive", in text), never whether it can be answered.
   */
  discontinued_at?: string | null;
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
  /** Dosage of the next-due medication (optional — newer backends only). */
  next_due_dosage?: string | null;
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

  // The backend returns this already ordered (backend/src/utils/eventOrder.ts:
  // date -> time -> name -> series -> id). Re-sorted here as the client's own
  // guarantee against whatever backend is deployed, and tie-broken on id so the
  // order is TOTAL: the Today's Meds card SLICES this list, so doses sharing a
  // time — the five-dose 8:00 AM morning — would otherwise have their visibility
  // decided by response order.
  return (response.data.events ?? [])
    .filter((event) => event.event_type === 'medication' && !!event.scheduled_time)
    .sort((a, b) => {
      const at = a.scheduled_time ?? '';
      const bt = b.scheduled_time ?? '';
      if (at !== bt) return at < bt ? -1 : 1;
      return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
    });
}

// ---------------------------------------------------------------------------
// Adherence + history (Wave 3 parity with mobile's Medication History screen).
// PORT of mobile/src/api/medicationConfirmations.ts:61-202. Param names are the
// BACKEND's (backend/src/routes/medicationConfirmations.ts:115-121, 146-148);
// both schemas are `.passthrough()`, so a misspelled param is silently ignored
// and the endpoint returns unfiltered/default data — hence the tests assert the
// exact URL and params.
// ---------------------------------------------------------------------------

export interface MedicationConfirmationsPage {
  confirmations: MedicationConfirmation[];
  hasMore: boolean;
}

export interface MedicationConfirmationsParams {
  event_id?: string;
  /** YYYY-MM-DD in the circle's timezone. */
  start_date?: string;
  /** YYYY-MM-DD in the circle's timezone. */
  end_date?: string;
  limit?: number;
  offset?: number;
}

export async function getMedicationConfirmations(
  circleId: string,
  params?: MedicationConfirmationsParams
): Promise<MedicationConfirmationsPage> {
  const response = await apiClient.get<{
    confirmations: MedicationConfirmation[];
    hasMore?: boolean;
  }>(`/circles/${circleId}/medications/confirmations`, { params });
  return {
    confirmations: response.data.confirmations,
    hasMore: response.data.hasMore ?? false,
  };
}

export interface WeeklyAdherenceDaily {
  date: string;
  taken: number;
  scheduled: number;
  adherence_rate: number;
}

export interface WeeklyAdherence {
  taken: number;
  scheduled: number;
  adherence_rate: number;
  start_date: string;
  end_date: string;
  daily_breakdown: WeeklyAdherenceDaily[];
}

export async function getWeeklyAdherence(circleId: string): Promise<WeeklyAdherence> {
  const response = await apiClient.get<WeeklyAdherence>(
    `/circles/${circleId}/medications/weekly-adherence`
  );
  return response.data;
}

export type AdherencePeriod = '7d' | '14d' | '30d' | '60d' | '90d' | 'all';

export interface AdherenceReportSummary {
  total_scheduled: number;
  taken: number;
  taken_late: number;
  not_marked: number;
  skipped: number;
  adherence_rate: number;
  trend: 'improving' | 'declining' | 'stable';
  trend_change: number;
}

export interface AdherenceReportDaily {
  date: string;
  taken: number;
  not_marked: number;
  skipped: number;
  total: number;
  adherence_rate: number;
}

export interface AdherenceReportByMedication {
  id: string;
  name: string;
  dosage: string | null;
  taken: number;
  not_marked: number;
  skipped: number;
  total: number;
  adherence_rate: number;
}

export interface AdherenceReportTimeBreakdown {
  time: string;
  taken: number;
  not_marked: number;
  total: number;
  adherence_rate: number;
}

export interface AdherenceReport {
  period_days: number;
  start_date: string;
  end_date: string;
  summary: AdherenceReportSummary;
  daily_breakdown: AdherenceReportDaily[];
  by_medication: AdherenceReportByMedication[];
  time_breakdown: AdherenceReportTimeBreakdown[];
}

export async function getAdherenceReport(
  circleId: string,
  period: AdherencePeriod = '30d'
): Promise<AdherenceReport> {
  const response = await apiClient.get<{ report: AdherenceReport }>(
    `/circles/${circleId}/medications/adherence-report`,
    { params: { period } }
  );
  return response.data.report;
}
