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
