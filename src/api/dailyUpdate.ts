import { apiClient } from '@/lib/api';

/**
 * GET /api/circles/:circleId/daily-update?date=YYYY-MM-DD
 * Contract: docs/plans/daily-update.md §4.1. The server returns COUNTS and
 * ITEMS, never prose (P7); every sentence is built client-side with i18next.
 */
export interface DailyUpdateStillToDoItem {
  kind: 'dose' | 'task' | 'appointment';
  id: string;
  title: string;
  /** Recipient-local "HH:MM[:SS]" (naive, like scheduled_time), or null for all-day / untimed. */
  time: string | null;
  status: 'upcoming' | 'not_marked' | 'open';
}

export interface DailyUpdateData {
  enabled: boolean;
  date: string;
  is_today: boolean;
  timezone: string;
  window: { opens_at: string; closes_at: string };
  eligible: boolean;
  has_activity: boolean;
  recipient_name: string | null;
  is_solo: boolean;
  doses: { taken: number; taken_late: number; skipped: number; not_marked: number; upcoming: number };
  as_needed: { given: number } | null;
  tasks: { done: number };
  appointments: { past_count: number };
  notes: { count: number; authors: string[]; more_authors: number };
  still_to_do: DailyUpdateStillToDoItem[];
  still_to_do_more: number;
  // ---- Contract v2 (ADDITIVE, docs/plans/daily-update.md "Design v2 B2").
  // Optional on purpose: an older backend omits them and the UI falls back to
  // the counts above (no item rows, no item sections).
  doses_detail?: DailyUpdateDoseDetail[];
  tasks_done_detail?: DailyUpdateTaskDetail[];
  appointments_detail?: DailyUpdateAppointmentDetail[];
  notes_detail?: DailyUpdateNoteDetail[];
  nav?: { prev_date: string | null; next_date: string | null };
}

/** Recipient-local naive times ('HH:MM'); names are first names, null = departed/unknown. */
export interface DailyUpdateDoseDetail {
  /** NOT unique: an as-needed dose carries its medication's id, so repeats share it. */
  event_id: string;
  /** The medication series (root) id — the Medications page's detail target. */
  medication_id: string | null;
  medication_name: string;
  dosage: string | null;
  time: string | null;
  status: 'taken' | 'taken_late' | 'skipped' | 'not_marked' | 'upcoming';
  marked_by_name: string | null;
  marked_at: string | null;
}

export interface DailyUpdateTaskDetail {
  event_id: string | null;
  title: string;
  completed_by_name: string | null;
  completed_at: string | null;
}

export interface DailyUpdateAppointmentDetail {
  event_id: string | null;
  title: string;
  time: string | null;
  location: string | null;
}

export interface DailyUpdateNoteDetail {
  note_id: string;
  kind: 'care' | 'event';
  event_id: string | null;
  author_name: string | null;
  created_at: string;
  /** '' for a mood-only care note: no excerpt line is shown. */
  excerpt: string;
}

/**
 * The kill-switch shape: when the rollout mode is off for this viewer the
 * server answers `{ enabled: false }` and nothing else (§4.1).
 */
export type DailyUpdateResponse = DailyUpdateData | { enabled: false };

interface DailyUpdateEnvelope {
  success: boolean;
  data: DailyUpdateResponse;
}

export function isDailyUpdateEnabled(r: DailyUpdateResponse | undefined): r is DailyUpdateData {
  return r != null && r.enabled === true && 'date' in r;
}

/** `date` omitted → the server answers for the recipient's today (used for the rollout check). */
export async function getDailyUpdate(
  circleId: string,
  date?: string
): Promise<DailyUpdateResponse> {
  const response = (await apiClient.get(
    `/circles/${circleId}/daily-update`,
    date ? { params: { date } } : undefined
  )) as unknown as DailyUpdateEnvelope;
  return response.data;
}
