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

  /**
   * Discontinue / inactivate marker (medications only). `null`/undefined =
   * active; a non-null ISO timestamp (UTC) = discontinued at that instant. NOT
   * a naive care-recipient date — it's a true action instant.
   *
   * PRESENT ON CALENDAR ROWS. The Calendar GET keeps every occurrence that was
   * DUE BEFORE the discontinue instant (history is not erased) and hides only
   * the occurrences after it, so a plain windowed fetch — no
   * `includeDiscontinued` flag — CAN return rows with this set. It also arrives
   * on the medication roster (`?includeDiscontinued=true`) and on the
   * medication-status write. Never filter these rows out client-side: they keep
   * their confirmation state and render with an "Inactive" text marker.
   */
  discontinued_at?: string | null;

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
  /**
   * Who marked the task done. A user id; the embedded row is `completed_by_user`.
   *
   * ONLY the tasks endpoint embeds the user (see backend/src/routes/tasks.ts —
   * `completed_by_user:users!calendar_events_completed_by_fkey(...)`). The
   * calendar GET does not, so a task opened from the calendar has
   * `completed_at` without a name. Every reader must fall back (circle members,
   * then an unattributed label) rather than assume the embed is present.
   */
  completed_by?: string | null;
  completed_by_user?: EventUser | null;

  /**
   * The five reminder flags plus their master mute — ON THE LIST RESPONSE, not
   * detail-only. Verified in backend/src/routes/calendarEvents.ts: `listSelect`
   * names `notifications_enabled, reminder_24h, reminder_1h, reminder_30m,
   * reminder_15m, reminder_at_due`, GET /tasks selects `*`, and the virtual
   * recurring instances are built by copying these off the parent.
   *
   * DECLARED HERE BECAUSE AN EDIT REWRITES THEM ALL. AddEventModal hydrates the
   * six switches from the event it is handed and `reminderFlagsForSave` now
   * persists the selection VERBATIM, so every save writes all five back — and
   * the backend forwards each one it receives to the series parent. If the list
   * ever stopped returning them, hydration would fall through to its defaults
   * and a user who edited only the TITLE of a recurring task would silently
   * rewrite the whole series' reminder settings.
   *
   * Untyped, that regression is invisible: it produced no compile error and no
   * test failure, because the modal read them through a local `as` cast and the
   * test helper spread them onto a cast literal. Typed, dropping a column from
   * `listSelect` is a `tsc` failure at the read site instead.
   *
   * Optional, because they are absent from a payload built before the column
   * existed; each read site states its own fallback (`?? true` for the anchor
   * and the mute, both `NOT NULL DEFAULT TRUE`).
   */
  notifications_enabled?: boolean;
  reminder_at_due?: boolean;
  reminder_24h?: boolean;
  reminder_1h?: boolean;
  reminder_30m?: boolean;
  reminder_15m?: boolean;

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

  /**
   * DETAIL-ONLY, and a SIGNED url when present.
   *
   * The events list deliberately omits this field, so it is undefined on any
   * event that came from `getEvents`. It only arrives from the single-event
   * endpoint, already signed — see `getMedicationPhotoUrl`, which is the only
   * thing that should read it, precisely so the signed value never reaches the
   * React Query cache.
   */
  medication_photo_url?: string;
}

export interface GetEventsParams {
  start_date?: string; // YYYY-MM-DD in care recipient's timezone
  end_date?: string; // YYYY-MM-DD in care recipient's timezone
  event_type?: EventType;
  /**
   * Medication roster only: include the FULL set of discontinued (inactive)
   * meds in the response so the Medications page can split Active vs Inactive.
   * The calendar page must NOT pass this — without the flag the calendar still
   * receives the historical occurrences that predate each discontinue instant
   * (which is exactly what it should show), while the occurrences after it, and
   * roster rows outside the window, stay out.
   * (Mirrors mobile/src/api/calendarEvents.ts GetEventsParams.)
   */
  includeDiscontinued?: boolean;
}

interface EventsEnvelope {
  success: boolean;
  data: { events: CalendarEvent[] };
}

export async function getEvents(
  circleId: string,
  params?: GetEventsParams
): Promise<CalendarEvent[]> {
  // Serialize explicitly: the backend checks `includeDiscontinued === 'true'`
  // (string), so send the literal 'true' ONLY when the flag is set — never
  // 'false'/undefined placeholders in the query string.
  let requestParams: Record<string, string> | undefined;
  if (params) {
    requestParams = {};
    if (params.start_date) requestParams.start_date = params.start_date;
    if (params.end_date) requestParams.end_date = params.end_date;
    if (params.event_type) requestParams.event_type = params.event_type;
    if (params.includeDiscontinued) requestParams.includeDiscontinued = 'true';
  }
  // apiClient's response interceptor unwraps axios' response.data, so the
  // resolved value IS the `{ success, data }` envelope.
  const response = (await apiClient.get(`/circles/${circleId}/events`, {
    params: requestParams,
  })) as unknown as EventsEnvelope;
  return response.data.events;
}

/**
 * Per-type presence for a window. Each flag is exactly "GET /events for this
 * window would return >= 1 event of that type" (backend contract).
 */
export interface EventsPresence {
  medication: boolean;
  appointment: boolean;
  task: boolean;
}

interface EventsPresenceEnvelope {
  success: boolean;
  data: EventsPresence;
}

/**
 * GET /circles/:circleId/events/presence?start_date&end_date — the cheap
 * "does anything exist here?" read, instead of downloading the window's events.
 * Dates are YYYY-MM-DD in the care recipient's timezone. An OLDER backend has
 * no such route and answers 404 NOT_FOUND; this function rethrows that like any
 * other failure — `useEventsPresence` owns the fallback.
 */
export async function getEventsPresence(
  circleId: string,
  params: { start_date: string; end_date: string }
): Promise<EventsPresence> {
  const response = (await apiClient.get(`/circles/${circleId}/events/presence`, {
    params: { start_date: params.start_date, end_date: params.end_date },
  })) as unknown as EventsPresenceEnvelope;
  const data = response.data;
  return {
    medication: data?.medication === true,
    appointment: data?.appointment === true,
    task: data?.task === true,
  };
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
  /**
   * The dose-time row that owns this medication's BOTTLE; null/absent means
   * this row owns it. Several dose times of one medication ("twice daily") are
   * separate series roots, so without this link the bottle — one physical
   * container — had no owning row and each dose drained its own counter at half
   * the real rate. The backend resolves `COALESCE(refill_group_id, id)` before
   * it decrements. Nullable AND optional, and they differ: absent leaves the
   * stored value alone, an explicit null detaches the row onto its own bottle.
   */
  refill_group_id?: string | null;
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
  /**
   * The alert AT the scheduled time — the anchor, on by default (the column is
   * `BOOLEAN NOT NULL DEFAULT TRUE`). The four `reminder_*` flags below are the
   * opt-IN "earlier reminders"; this one is the opt-OUT primary alert.
   */
  reminder_at_due?: boolean;
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

/**
 * Shared by all four single-event writes below (create / update / complete /
 * medication-photo detail).
 *
 * Declared ONCE. It was declared twice, identically — legal, because TypeScript
 * MERGES interfaces of the same name and identical members, so the duplicate
 * cost nothing and reported nothing. The danger is the day the two copies stop
 * being identical: merging keeps both member sets, so an edit to one of them
 * would silently widen the type at every cast site rather than fail.
 */
interface SingleEventEnvelope {
  success: boolean;
  data: { event: CalendarEvent };
}

/**
 * Fetch the SIGNED medication photo URL for one event, on demand.
 *
 * Two things force this shape:
 *
 *  1. The events LIST endpoint deliberately omits `medication_photo_url` —
 *     detail-only fields are fetched per event — so a photo can only come from
 *     `GET /circles/:id/events/:eventId`, which signs it (backend
 *     calendarEvents.ts, "Sign medication photo URL for detail view").
 *  2. Signed Storage URLs must NEVER sit in the React Query cache or any
 *     persistent store, the same rule `api/documents.ts` follows for
 *     `file_url`. So this returns the URL directly rather than exposing the
 *     whole cached event, and callers hold it in transient component state.
 *
 * Returns null when the medication has no photo, or when the fetch fails — a
 * missing photo must never block the detail view from rendering.
 */
export async function getMedicationPhotoUrl(
  circleId: string,
  eventId: string,
): Promise<string | null> {
  try {
    const response = (await apiClient.get(
      `/circles/${circleId}/events/${eventId}`,
    )) as unknown as SingleEventEnvelope;
    return response.data.event.medication_photo_url ?? null;
  } catch {
    // Never log — the URL and its labels are PHI-adjacent.
    return null;
  }
}

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

/**
 * POST /circles/:circleId/events/:eventId/complete — complete a task/appt.
 *
 * `scheduledDate` says WHICH DAY of a recurring series is being completed.
 * `completed_at` lives on a ROW, and a series is addressed by its ROOT
 * (`parent_event_id || id`), so without it the server can only stamp the root —
 * the series' FIRST day, not the day the caregiver clicked. The calendar's
 * recurring occurrences are also VIRTUAL rows the backend synthesises with a
 * composite id (`${parentId}_${date}`, `is_virtual: true`), which no `id`
 * column can match at all: root + date is the only addressable form they have.
 *
 * OMITTED FOR EVERYTHING ELSE. A one-off, or any row addressed by its own id,
 * already IS its occurrence — and with no date this sends the exact body-less
 * POST every shipped client sends, which the OLD server must keep answering
 * through the deploy window. Same wire contract as mobile, so one backend
 * serves both.
 */
export async function completeEvent(
  circleId: string,
  eventId: string,
  scheduledDate?: string
): Promise<CalendarEvent> {
  const path = `/circles/${circleId}/events/${eventId}/complete`;
  // One argument, no body — literally the shipped call — unless there is a date.
  const response = (await (scheduledDate
    ? apiClient.post(path, { scheduled_date: scheduledDate })
    : apiClient.post(path))) as unknown as SingleEventEnvelope;
  return response.data.event;
}

// ---------------------------------------------------------------------------
// Medication discontinue / reactivate (Stage 4 — Web).
// Verified against backend/src/routes/calendarEvents.ts:
//   PATCH /api/circles/:circleId/events/:eventId/medication-status
//     body { discontinued: boolean, scope?: 'series' | 'medication' }
//     (requireAuth + requireCircleEditAccess)
//     → { success, data: { event: { id, parent_event_id, discontinued_at },
//                          discontinued, affected_count, series_count } }
// The backend resolves the series root (parent_event_id ?? id) and propagates
// to every physical child, so passing ANY instance id (including a child) is
// safe. `discontinued: true` inactivates (keeps the record, stops reminders +
// materialization); `false` reactivates. After query invalidation a discontinue
// removes only the occurrences DUE AFTER the discontinue instant from the
// calendar; the earlier ones stay, now carrying `discontinued_at` so the UI can
// mark them inactive.
// ---------------------------------------------------------------------------

/**
 * How wide a medication-status change reaches.
 *
 *  - `series`     — the resolved series root + its physical children only.
 *                   The backend default, and the historical (only) behavior.
 *  - `medication` — EVERY series root in the circle sharing this medication's
 *                   normalized name + dosage (backend `utils/medicationKey.ts`,
 *                   a verbatim port of this repo's `getMedKey`). One drug dosed
 *                   at 08:00 and 20:00 is two roots; whole-medication semantics
 *                   require both to toggle together.
 *
 * Web always asks for `medication` on the user-facing discontinue/reactivate
 * paths: resolving the sibling roots CLIENT-side could only ever see the loaded
 * calendar window, so a medication whose other series fell outside that window
 * came back half-reactivated under a success toast. The server has no window.
 */
export type MedicationStatusScope = 'series' | 'medication';

export interface MedicationStatusResult {
  /** The updated series-root row (subset projection from the backend). */
  event: Pick<CalendarEvent, 'id' | 'parent_event_id' | 'discontinued_at'>;
  /** Echoes the requested state: true = discontinued, false = reactivated. */
  discontinued: boolean;
  /** How many rows (root + physical children) were updated. */
  affected_count: number;
  /**
   * How many SERIES ROOTS were actually mutated — 1 for `scope: 'series'`, and
   * the full name+dosage match count for `scope: 'medication'`. This is the
   * only trustworthy `series_count` for analytics: the client cannot count what
   * its loaded window never held.
   */
  /**
  * OPTIONAL: a backend predating this field omits it. Typed as required,
  * TypeScript vouches for a value that is `undefined` at runtime and every
  * analytics call ships `undefined`. Read as `?? 0`.
  */
  series_count?: number;
}

interface MedicationStatusEnvelope {
  success: boolean;
  data: MedicationStatusResult;
}

/**
 * PATCH /circles/:circleId/events/:eventId/medication-status — discontinue
 * (`discontinued: true`) or reactivate (`discontinued: false`) a medication.
 * Targets the series root + all physical children server-side. Pass any
 * instance id (parent or child).
 *
 * `scope` widens that to the whole medication (every root sharing name +
 * dosage). Omitted = the backend's `'series'` default, so the request body is
 * byte-identical to what it was before the field existed.
 */
export async function setMedicationStatus(
  circleId: string,
  eventId: string,
  discontinued: boolean,
  scope?: MedicationStatusScope
): Promise<MedicationStatusResult> {
  const response = (await apiClient.patch(
    `/circles/${circleId}/events/${eventId}/medication-status`,
    scope ? { discontinued, scope } : { discontinued }
  )) as unknown as MedicationStatusEnvelope;
  return response.data;
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

// VALIDATION MESSAGES on the fields the AddEvent form actually renders are i18n
// KEY NAMES, never prose — same contract as `src/lib/vitals.ts`. AddEventModal
// maps them through `messageFor()` into `calendar:addEvent.validation.*`.
// Fields the form cannot populate by hand keep Zod's defaults; the consumer's
// `defaultValue` fallback catches those as a generic localized line.
export const eventFormSchema = z.object({
  event_type: z.enum(['medication', 'appointment', 'task']),
  title: z.string().min(1, { message: 'titleRequired' }).max(150, { message: 'titleTooLong' }),
  description: z.string().max(850, { message: 'descriptionTooLong' }).optional(),

  // Medication-specific
  medication_name: z.string().max(150, { message: 'medicationNameTooLong' }).optional(),
  medication_dosage: z.string().max(100, { message: 'dosageTooLong' }).optional(),

  // Medication enhancements
  medication_photo_url: z.string().max(2048).optional(),
  rxcui: z.string().max(100).optional(),
  track_refills: z.boolean().optional(),
  quantity_in_bottle: z.number().int().min(1).optional(),
  quantity_remaining: z.number().int().min(0).optional(),
  pills_per_day: z.number().int().min(1).optional(),
  // Mirrors the backend's `refill_group_id: z.string().uuid().nullable().optional()`.
  // Sibling dose rows created by the first-run wizard carry the primary row's
  // id here so every dose time decrements ONE bottle.
  refill_group_id: z.string().uuid().nullable().optional(),
  alert_days_before: z.number().int().min(1).max(90).optional(),

  // Scheduling — naive local values in the care recipient's timezone
  scheduled_date: z.string().max(10),
  scheduled_time: z.string().max(8).optional(),
  duration_minutes: z.number().optional(),
  location: z.string().max(250, { message: 'locationTooLong' }).optional(),

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
  reminder_at_due: z.boolean().optional(),
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
