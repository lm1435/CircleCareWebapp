import { apiClient } from '@/lib/api';
import {
  createEvent,
  getEvents,
  updateEvent,
  type CalendarEvent,
  type CreateEventRequest,
  type UpdateEventRequest,
} from '@/api/calendarEvents';

// Care shifts API (docs/plans/care-shifts.md; as-built contract:
// SHIFTS_API_CONTRACT.md wins over the spec).
//
//   GET   /circles/:id/events?includeShifts=true     -> SHIFTS ONLY
//   POST  /circles/:id/events   (event_type 'shift')
//   PATCH /circles/:id/events/:eventId
//   POST  /circles/:id/events/:eventId/shift/{take,drop,assign}
//
// `:eventId` of an action may be the series root, a physical child, or the
// virtual `<root>_<YYYY-MM-DD>` id the list returns, so callers pass `shift.id`
// as-is. A `future` action SPLITS the series: the response's `rootId` is the NEW
// root owning that date — re-key on it / invalidate, never keep the old id.

export type ShiftScope = 'occurrence' | 'future';

export interface ShiftActionBody {
  scope: ShiftScope;
  /** The occurrence's `YYYY-MM-DD` (recipient frame). */
  scheduledDate: string;
  /** assign only. */
  userId?: string;
}

export interface ShiftActionResult {
  /** The physical occurrence at `scheduledDate`. */
  event: CalendarEvent;
  /** The root now owning that date (a NEW one after a `future` split). */
  rootId: string;
}

interface ShiftActionEnvelope {
  success: boolean;
  data: ShiftActionResult;
}

/** Shifts in a window (shifts only; non-shift rows are dropped defensively). */
export async function getShifts(
  circleId: string,
  startDate: string,
  endDate: string
): Promise<CalendarEvent[]> {
  const events = await getEvents(circleId, {
    start_date: startDate,
    end_date: endDate,
    includeShifts: true,
  });
  return events.filter((event) => event.event_type === 'shift');
}

export type CreateShiftRequest = Omit<CreateEventRequest, 'event_type'>;

export function createShift(circleId: string, data: CreateShiftRequest): Promise<CalendarEvent> {
  return createEvent(circleId, { ...data, event_type: 'shift' });
}

export function updateShift(
  circleId: string,
  eventId: string,
  data: UpdateEventRequest
): Promise<CalendarEvent> {
  return updateEvent(circleId, eventId, data);
}

async function postShiftAction(
  circleId: string,
  eventId: string,
  action: 'take' | 'drop' | 'assign',
  body: ShiftActionBody | TakeShiftBody
): Promise<ShiftActionResult> {
  const response = (await apiClient.post(
    `/circles/${circleId}/events/${encodeURIComponent(eventId)}/shift/${action}`,
    body
  )) as unknown as ShiftActionEnvelope;
  return response.data;
}

/** Take only: `reminder_lead_minutes` is sent when the taker changed it (null = Off); absent keeps the shift's own. */
export type TakeShiftBody = ShiftActionBody & { reminder_lead_minutes?: 60 | 120 | 240 | 1440 | null };

export const takeShift = (circleId: string, eventId: string, body: TakeShiftBody) =>
  postShiftAction(circleId, eventId, 'take', body);

export const dropShift = (circleId: string, eventId: string, body: ShiftActionBody) =>
  postShiftAction(circleId, eventId, 'drop', body);

export const assignShift = (circleId: string, eventId: string, body: ShiftActionBody) =>
  postShiftAction(circleId, eventId, 'assign', body);

// ---------------------------------------------------------------------------
// Error codes (`backend/src/constants/shiftErrorCodes.ts`). Read `err.error.code`.
// ---------------------------------------------------------------------------

interface ShiftErrorEnvelope {
  error?: { code?: string; message?: string; takenBy?: string };
}

function shiftErrorCode(err: unknown): string | undefined {
  const code = (err as ShiftErrorEnvelope | null)?.error?.code;
  return typeof code === 'string' ? code : undefined;
}

/** 409 SHIFT_ALREADY_TAKEN — someone took it first. */
export function isShiftTakenError(err: unknown): boolean {
  return shiftErrorCode(err) === 'SHIFT_ALREADY_TAKEN';
}

/** `error.takenBy` (the winner's display name) of a 409 SHIFT_ALREADY_TAKEN. */
export function shiftTakenBy(err: unknown): string | null {
  const name = (err as ShiftErrorEnvelope | null)?.error?.takenBy;
  return typeof name === 'string' && name.trim() ? name.trim() : null;
}

export const isShiftNotAssignedError = (err: unknown): boolean =>
  shiftErrorCode(err) === 'SHIFT_NOT_ASSIGNED';
export const isShiftDropForbiddenError = (err: unknown): boolean =>
  shiftErrorCode(err) === 'SHIFT_DROP_FORBIDDEN';
export const isShiftAssignForbiddenError = (err: unknown): boolean =>
  shiftErrorCode(err) === 'SHIFT_ASSIGN_FORBIDDEN';
export const isInvalidAssigneeError = (err: unknown): boolean =>
  shiftErrorCode(err) === 'INVALID_ASSIGNEE';
export const isShiftNotFoundError = (err: unknown): boolean =>
  shiftErrorCode(err) === 'SHIFT_NOT_FOUND';
export const isShiftInvalidDateError = (err: unknown): boolean =>
  shiftErrorCode(err) === 'SHIFT_INVALID_DATE';
