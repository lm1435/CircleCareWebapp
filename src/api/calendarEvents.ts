import { z } from 'zod';
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

// ===========================================================================
// Event WRITE functions (Task 1.1)
// ---------------------------------------------------------------------------
// PORT of mobile/src/api/calendarEvents.ts (createEvent/updateEvent/deleteEvent/
// completeEvent). Verified against backend/src/routes/calendarEvents.ts:
//   POST   /api/circles/:circleId/events                       → validateBody(eventSchema)
//   PATCH  /api/circles/:circleId/events/:eventId              → validateBody(updateEventSchema)
//   DELETE /api/circles/:circleId/events/:eventId?deleteScope=&scheduledDate=
//   POST   /api/circles/:circleId/events/:eventId/complete
// All guarded by requireAuth + requireCircleEditAccess (402/403 on rejection).
//
// scheduled_date / scheduled_time are NAIVE LOCAL values in the CARE RECIPIENT's
// timezone — callers MUST format them with the Stage 0 TZ-aware write helpers,
// never device-local Date math.
// ===========================================================================

export interface CreateEventRequest {
  event_type: EventType;
  title: string;
  description?: string;

  // Medication-specific
  medication_name?: string;
  medication_dosage?: string;

  // Medication enhancements (optional - backwards compatible)
  medication_photo_url?: string; // Storage path for medication photo
  rxcui?: string; // RxNorm Concept Unique Identifier
  track_refills?: boolean; // Whether to track refill status
  quantity_in_bottle?: number; // Initial quantity
  quantity_remaining?: number; // Current remaining
  pills_per_day?: number; // Pills taken per day
  alert_days_before?: number; // Days before to alert

  // OCR scanning fields (extracted from prescription label)
  prescriber_name?: string;
  pharmacy_name?: string;
  pharmacy_phone?: string;
  rx_number?: string;
  scan_data?: { raw_text: string; scanned_at: string; source: 'medication_bottle' };

  // Scheduling — naive local values in the care recipient's timezone
  scheduled_date: string; // YYYY-MM-DD
  scheduled_time?: string; // HH:MM or HH:MM:SS
  duration_minutes?: number;
  location?: string;

  // Recurrence
  recurrence_rule?: string;
  recurrence_days?: number[];
  recurrence_end_date?: string;

  // Related event (e.g., follow-up linked to original)
  related_event_id?: string | null;

  // Task-specific
  assigned_to?: string | null;

  // Customization
  color_hex?: string;

  // Notifications
  notifications_enabled?: boolean;
  reminder_24h?: boolean;
  reminder_1h?: boolean;
  reminder_30m?: boolean;
  reminder_15m?: boolean;
}

export interface UpdateEventRequest extends Partial<CreateEventRequest> {}

/** Scope of a recurring-event delete (mobile/web parity). */
export type DeleteEventScope = 'single' | 'future';

export interface DeleteEventOptions {
  deleteScope?: DeleteEventScope;
  scheduledDate?: string; // YYYY-MM-DD (required for scoped deletes)
}

interface SingleEventEnvelope {
  success: boolean;
  data: { event: CalendarEvent };
}

/** POST /circles/:circleId/events — create a med/appointment/task event. */
export async function createEvent(
  circleId: string,
  data: CreateEventRequest
): Promise<CalendarEvent> {
  const response = (await apiClient.post(
    `/circles/${circleId}/events`,
    data
  )) as unknown as SingleEventEnvelope;
  return response.data.event;
}

/**
 * PATCH /circles/:circleId/events/:eventId — edit an event. Edits ALWAYS target
 * the PARENT series; callers pass `eventId = event.parent_event_id || event.id`
 * and a plain partial body (no scope param — mobile has no "this event only"
 * edit).
 */
export async function updateEvent(
  circleId: string,
  eventId: string,
  data: UpdateEventRequest
): Promise<CalendarEvent> {
  const response = (await apiClient.patch(
    `/circles/${circleId}/events/${eventId}`,
    data
  )) as unknown as SingleEventEnvelope;
  return response.data.event;
}

/**
 * DELETE /circles/:circleId/events/:eventId — delete an event. Deletes ARE
 * scoped: recurring events pass `deleteScope` (`single` | `future`) +
 * `scheduledDate` as query params; non-recurring events pass neither.
 */
export async function deleteEvent(
  circleId: string,
  eventId: string,
  options?: DeleteEventOptions
): Promise<void> {
  const params = new URLSearchParams();
  if (options?.deleteScope) params.set('deleteScope', options.deleteScope);
  if (options?.scheduledDate) params.set('scheduledDate', options.scheduledDate);
  const qs = params.toString();
  await apiClient.delete(`/circles/${circleId}/events/${eventId}${qs ? `?${qs}` : ''}`);
}

/** POST /circles/:circleId/events/:eventId/complete — complete a task/appt. */
export async function completeEvent(
  circleId: string,
  eventId: string
): Promise<CalendarEvent> {
  const response = (await apiClient.post(
    `/circles/${circleId}/events/${eventId}/complete`
  )) as unknown as SingleEventEnvelope;
  return response.data.event;
}

// ===========================================================================
// Web Zod schema (Task 1.2)
// ---------------------------------------------------------------------------
// DUPLICATES backend/src/routes/calendarEvents.ts `eventSchema` field
// constraints (backend Zod is inline-per-route, not importable — duplication is
// intended). `.max()` / enum caps mirror the backend EXACTLY so client and
// server agree. Validated on submit by the AddEvent form; the backend re-checks
// regardless.
//
// One deliberate tightening: backend stores `recurrence_rule` as a loose
// `z.string().max(20)`. The web form only ever produces the values the mobile
// AddEventScreen produces — daily | every_other_day | weekly | monthly | yearly
// | cycle:N:M — so the web schema constrains to that set (still ≤20 chars,
// always a subset the backend accepts).
// ===========================================================================

/** Recurrence rule values the AddEvent form can emit (mirrors mobile). */
export const RECURRENCE_PRESETS = [
  'daily',
  'every_other_day',
  'weekly',
  'monthly',
  'yearly',
] as const;

/** `cycle:N:M` — N days on, M days off (e.g. chemo cycles). */
const CYCLE_RULE_RE = /^cycle:\d{1,3}:\d{1,3}$/;

const recurrenceRuleSchema = z
  .string()
  .max(20)
  .refine(
    (rule) => (RECURRENCE_PRESETS as readonly string[]).includes(rule) || CYCLE_RULE_RE.test(rule),
    { message: 'invalidRecurrenceRule' }
  );

export const eventFormSchema = z.object({
  event_type: z.enum(['medication', 'appointment', 'task']),
  title: z.string().min(1).max(150),
  description: z.string().max(850).optional(),

  // Medication-specific
  medication_name: z.string().max(150).optional(),
  medication_dosage: z.string().max(100).optional(),

  // Medication enhancements
  medication_photo_url: z.string().max(2048).optional(),
  rxcui: z.string().max(100).optional(),
  track_refills: z.boolean().optional(),
  quantity_in_bottle: z.number().int().min(1).optional(),
  quantity_remaining: z.number().int().min(0).optional(),
  pills_per_day: z.number().int().min(1).optional(),
  alert_days_before: z.number().int().min(1).max(90).optional(),

  // Scheduling — naive local values in the care recipient's timezone
  scheduled_date: z.string().max(10),
  scheduled_time: z.string().max(8).optional(),
  duration_minutes: z.number().optional(),
  location: z.string().max(250).optional(),

  // Recurrence
  recurrence_rule: recurrenceRuleSchema.optional(),
  recurrence_days: z.array(z.number()).max(7).optional(),
  recurrence_end_date: z.string().max(10).optional(),

  // Task-specific
  assigned_to: z.string().uuid().nullable().optional(),

  // Related event
  related_event_id: z.string().uuid().nullable().optional(),

  // Customization
  color_hex: z.string().max(9).optional(),

  // Notifications
  notifications_enabled: z.boolean().optional(),
  reminder_24h: z.boolean().optional(),
  reminder_1h: z.boolean().optional(),
  reminder_30m: z.boolean().optional(),
  reminder_15m: z.boolean().optional(),

  // OCR scanning fields
  prescriber_name: z.string().max(100).optional(),
  pharmacy_name: z.string().max(100).optional(),
  pharmacy_phone: z.string().max(20).optional(),
  rx_number: z.string().max(30).optional(),
  scan_data: z
    .object({
      raw_text: z.string().max(5000),
      scanned_at: z.string().max(30),
      source: z.enum(['medication_bottle']),
    })
    .optional(),
});

export type EventFormValues = z.infer<typeof eventFormSchema>;

/** Partial schema for EDIT mode (mirrors backend `eventSchema.partial()`). */
export const eventFormUpdateSchema = eventFormSchema.partial();
