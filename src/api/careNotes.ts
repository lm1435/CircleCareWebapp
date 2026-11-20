import { apiClient } from '@/lib/api';

// Daily Care Notes (docs/plans/daily-care-notes.md, Web Task 15).
//
// Contract per the plan's API spec (backend/src/routes/careNotes.ts, built in
// parallel — mirrors eventNotes.ts idioms):
// - GET    /circles/:circleId/care-notes?from=YYYY-MM-DD&to=YYYY-MM-DD
//          window capped at 92 days, defaults to last 14; notes ordered
//          note_date DESC, created_at DESC
//          → { success, data: { notes, today, timezone } }  (tasks envelope idiom)
// - POST   /circles/:circleId/care-notes
//          body: { body? (<=2000), mood?, categories?, note_date? } — body-or-mood
//          required; note_date (today or earlier, recipient TZ) is sent ONLY for
//          a past day — absent, the server stamps today in the recipient TZ
//          → { success, data: { note } }
// - PATCH  /circles/:circleId/care-notes/:noteId (author-only; result must
//          still satisfy body-or-mood) → { success, data: { note } }
// - DELETE /circles/:circleId/care-notes/:noteId (author or circle owner) → 200
//
// `note_date` is a naive DATE in the care recipient's timezone; `created_at` /
// `updated_at` are UTC ISO timestamps. All calls go through the apiClient
// response interceptor, so the resolved value IS the { success, data } envelope.

/** Canonical mood keys — an enum so trends are computable later (never labels). */
export type CareNoteMood = 'great' | 'good' | 'okay' | 'tough';

/** Canonical category keys (multi-select). */
export type CareNoteCategory = 'meal' | 'medication' | 'visit' | 'incident';

export const CARE_NOTE_MOODS: CareNoteMood[] = ['great', 'good', 'okay', 'tough'];
export const CARE_NOTE_CATEGORIES: CareNoteCategory[] = [
  'meal',
  'medication',
  'visit',
  'incident',
];

/** Body length cap — mirrors the backend Zod `body <= 2000` rule. */
export const MAX_CARE_NOTE_LENGTH = 2000;

export interface CareNote {
  id: string;
  circle_id: string;
  author_id: string;
  /** YYYY-MM-DD in the care recipient's timezone (server stamps today unless a past day was sent). */
  note_date: string;
  body: string | null;
  mood: CareNoteMood | null;
  categories: CareNoteCategory[];
  created_at: string;
  updated_at: string;
  /** Joined author (eventNotes idiom). Null when the account was anonymized. */
  author: {
    id: string;
    first_name: string | null;
    last_name: string | null;
  } | null;
  /**
   * ADDITIVE ("Seen by"): readers of this note's CURRENT version who are current circle members
   * and not the author; the viewer is included once they have seen it. ABSENT from an older
   * backend or when that read failed, so absence must never be read as "unread".
   */
  seen_by?: CareNoteReader[];
}

export interface CareNoteReader {
  user_id: string;
  first_name: string | null;
}

export interface GetCareNotesParams {
  /** YYYY-MM-DD (recipient TZ) — window start. Defaults server-side to -14d. */
  from?: string;
  /** YYYY-MM-DD (recipient TZ) — window end. */
  to?: string;
}

export interface GetCareNotesResponse {
  notes: CareNote[];
  /** Today's YYYY-MM-DD in the care recipient's timezone (server-resolved). */
  today: string;
  /** Resolved care-recipient IANA timezone (fallback chain applied). */
  timezone: string;
  /**
   * ADDITIVE (backend 2026-11-09): the circle's earliest note_date the viewer can read; `null` = no
   * notes. ABSENT from an older backend (or when that read failed): "Show older notes" then keeps its
   * old paging exactly.
   */
  oldest_note_date?: string | null;
}

export interface CareNoteInput {
  /** Omit on create when empty; PATCH sends explicit null to clear (the Zod
   *  refine still requires the RESULT to satisfy body-or-mood). */
  body?: string | null;
  mood?: CareNoteMood | null;
  categories?: CareNoteCategory[];
  /** YYYY-MM-DD, today or earlier (recipient TZ). Omit for today / unchanged. */
  note_date?: string;
  /**
   * CREATE only (1.4.3). The server recognises a re-send of a create whose
   * response was lost and answers 200 `{ replayed: true }` with the SAME note,
   * which is success. An old backend ignores it.
   */
  client_request_id?: string;
}

interface NotesEnvelope {
  success: boolean;
  data: GetCareNotesResponse;
}

interface NoteEnvelope {
  success: boolean;
  data: { note: CareNote };
}

export async function getCareNotes(
  circleId: string,
  params?: GetCareNotesParams
): Promise<GetCareNotesResponse> {
  const searchParams = new URLSearchParams();
  if (params?.from) searchParams.set('from', params.from);
  if (params?.to) searchParams.set('to', params.to);
  const qs = searchParams.toString();

  const response = (await apiClient.get(
    `/circles/${circleId}/care-notes${qs ? `?${qs}` : ''}`
  )) as unknown as NotesEnvelope;
  return response.data;
}

export async function createCareNote(
  circleId: string,
  data: CareNoteInput
): Promise<CareNote> {
  const response = (await apiClient.post(
    `/circles/${circleId}/care-notes`,
    data
  )) as unknown as NoteEnvelope;
  return response.data.note;
}

export async function updateCareNote(
  circleId: string,
  noteId: string,
  data: CareNoteInput
): Promise<CareNote> {
  const response = (await apiClient.patch(
    `/circles/${circleId}/care-notes/${noteId}`,
    data
  )) as unknown as NoteEnvelope;
  return response.data.note;
}

export async function deleteCareNote(circleId: string, noteId: string): Promise<void> {
  await apiClient.delete(`/circles/${circleId}/care-notes/${noteId}`);
}

export interface CareNoteSeenPair {
  note_id: string;
  /** Echoed exactly as received on the note. */
  updated_at: string;
}

/** Max pairs the backend accepts per request. */
export const MAX_SEEN_PER_REQUEST = 100;

/**
 * Records that the viewer has read these notes ("Seen by"). `marked` is how many reads were newly
 * recorded. An older backend answers 404 (the caller latches off).
 */
export async function markCareNotesSeen(
  circleId: string,
  notes: CareNoteSeenPair[]
): Promise<{ marked: number }> {
  const response = (await apiClient.post(`/circles/${circleId}/care-notes/seen`, {
    notes,
  })) as unknown as { success: boolean; data: { marked: number } };
  return { marked: response?.data?.marked ?? 0 };
}
