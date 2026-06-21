import { apiClient } from '@/lib/api';

// PORT of mobile/src/api/eventNotes.ts + the composite-id split that lives in
// mobile/src/screens/calendar/EventNotesScreen.tsx.
//
// Verified backend contracts (backend/src/routes/eventNotes.ts):
// - GET    /circles/:circleId/events/:eventId/notes?scheduled_date=YYYY-MM-DD
//          → { success, data: { notes } }
// - POST   /circles/:circleId/events/:eventId/notes
//          body: { body (1-2000), scheduled_date? } → { success, data: { note } }
//   When the event is recurring and scheduled_date is supplied, the backend
//   materializes the virtual instance and attaches the note to that physical row.
// - PATCH  /circles/:circleId/events/:eventId/notes/:noteId
//          body: { body } (author-only) → { success, data: { note } }
// - DELETE /circles/:circleId/events/:eventId/notes/:noteId (author/owner) → 200
//
// Notes/confirmations are INSTANCE-scoped: a recurring instance's id can be the
// composite `parentUUID_YYYY-MM-DD`. It MUST be split into the real parent
// eventId (UUID) + scheduled_date before hitting any of the endpoints above.
//
// All four functions go through the apiClient response interceptor, which
// unwraps the `{ success, data }` envelope and rejects with the error envelope
// on failure (see src/lib/api.ts). So `response` here is already `{ success, data }`.

export interface EventNote {
  id: string;
  event_id: string;
  circle_id: string;
  author_id: string;
  body: string;
  created_at: string;
  updated_at: string;
  author: {
    id: string;
    first_name: string;
    last_name: string;
  };
}

/**
 * Result of splitting a (possibly composite) event id into the real parent
 * UUID the backend can find plus the per-instance scheduled date.
 */
export interface SplitEventId {
  /** The real parent event UUID. */
  eventId: string;
  /** The instance date (YYYY-MM-DD) for a virtual recurring instance, if any. */
  scheduledDate?: string;
}

/**
 * Split a (possibly composite) virtual-instance id into its real parent UUID +
 * scheduled date. Mirrors mobile EventNotesScreen.tsx:
 *
 *   const isVirtualId = rawEventId.includes('_') && rawEventId.length > 36;
 *   const eventId = isVirtualId ? rawEventId.split('_')[0] : rawEventId;
 *   const scheduledDate = explicit ?? (isVirtualId ? rawEventId.split('_')[1] : undefined);
 *
 * Virtual recurring instances have composite ids like
 * `8f1c...-uuid_2026-05-28`. A bare UUID is exactly 36 chars and never contains
 * `_`, so the length-and-underscore check cleanly distinguishes the two. An
 * explicitly-passed `scheduledDate` always wins over the one parsed from the id.
 */
export function splitEventId(rawEventId: string, scheduledDate?: string): SplitEventId {
  const isVirtualId = rawEventId.includes('_') && rawEventId.length > 36;
  const eventId = isVirtualId ? rawEventId.split('_')[0] : rawEventId;
  const effectiveScheduledDate = scheduledDate ?? (isVirtualId ? rawEventId.split('_')[1] : undefined);
  return { eventId, scheduledDate: effectiveScheduledDate };
}

interface NotesEnvelope {
  success: boolean;
  data: { notes: EventNote[] };
}

interface NoteEnvelope {
  success: boolean;
  data: { note: EventNote };
}

/**
 * List notes for an event instance. `eventId` may be a real UUID or the
 * composite `parentUUID_YYYY-MM-DD`; it is split so the real parent UUID hits
 * the endpoint and the instance date drives the materialized-child lookup.
 */
export async function getEventNotes(
  circleId: string,
  eventId: string,
  scheduledDate?: string
): Promise<EventNote[]> {
  const { eventId: realEventId, scheduledDate: date } = splitEventId(eventId, scheduledDate);
  const response = (await apiClient.get(`/circles/${circleId}/events/${realEventId}/notes`, {
    params: date ? { scheduled_date: date } : undefined,
  })) as unknown as NotesEnvelope;
  return response.data.notes ?? [];
}

/**
 * Create a note on an event instance. `eventId` may be composite; the split
 * date becomes the request body's `scheduled_date` (unless one is passed
 * explicitly in `data`) so the backend materializes the right recurring row.
 */
export async function createNote(
  circleId: string,
  eventId: string,
  data: { body: string; scheduled_date?: string }
): Promise<EventNote> {
  const { eventId: realEventId, scheduledDate: date } = splitEventId(eventId, data.scheduled_date);
  const response = (await apiClient.post(`/circles/${circleId}/events/${realEventId}/notes`, {
    body: data.body,
    ...(date ? { scheduled_date: date } : {}),
  })) as unknown as NoteEnvelope;
  return response.data.note;
}

/**
 * Update a note's body (author-only on the backend). `eventId` may be composite
 * and is split to the real parent UUID; the note id itself is already concrete.
 * Signature mirrors mobile `updateNote(circleId, eventId, noteId, body)`.
 */
export async function updateNote(
  circleId: string,
  eventId: string,
  noteId: string,
  data: { body: string }
): Promise<EventNote> {
  const { eventId: realEventId } = splitEventId(eventId);
  const response = (await apiClient.patch(
    `/circles/${circleId}/events/${realEventId}/notes/${noteId}`,
    { body: data.body }
  )) as unknown as NoteEnvelope;
  return response.data.note;
}

/**
 * Delete a note (author or circle owner on the backend). `eventId` may be
 * composite and is split to the real parent UUID.
 * Signature mirrors mobile `deleteNote(circleId, eventId, noteId)`.
 */
export async function deleteNote(
  circleId: string,
  eventId: string,
  noteId: string
): Promise<void> {
  const { eventId: realEventId } = splitEventId(eventId);
  await apiClient.delete(`/circles/${circleId}/events/${realEventId}/notes/${noteId}`);
}
