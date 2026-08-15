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
//          body: { body? (<=2000), mood?, categories? } — body-or-mood required;
//          note_date is stamped SERVER-SIDE in the recipient TZ (client never
//          computes it — midnight-boundary rule) → { success, data: { note } }
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
  /** YYYY-MM-DD in the care recipient's timezone (server-stamped). */
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
}

export interface CareNoteInput {
  /** Omit on create when empty; PATCH sends explicit null to clear (the Zod
   *  refine still requires the RESULT to satisfy body-or-mood). */
  body?: string | null;
  mood?: CareNoteMood | null;
  categories?: CareNoteCategory[];
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
