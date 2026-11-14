import { apiClient } from '@/lib/api';

/**
 * Quiet-circle back-off (1.4.2). Contract:
 * docs/plans/quiet-circle-backoff-1-4-2-backend-contract.md.
 *
 *   GET  /circles/:circleId/dose-alerts         any member, view-only included
 *   POST /circles/:circleId/dose-alerts/answer  { answer, source } (strict Zod)
 *
 * With the server switch off the GET always answers `paused: false`, so the
 * client behaves exactly as before the feature.
 */
export type DoseAlertsAnswer = 'still_giving' | 'routine_changed' | 'keep_paused';
export type DoseAlertsSource = 'push' | 'inbox' | 'notice' | 'link';

export const DOSE_ALERTS_ANSWERS: readonly DoseAlertsAnswer[] = [
  'still_giving',
  'routine_changed',
  'keep_paused',
];
export const DOSE_ALERTS_SOURCES: readonly DoseAlertsSource[] = ['push', 'inbox', 'notice', 'link'];

export interface DoseAlertsState {
  paused: boolean;
  /** ISO instant of the current pause, else null. */
  paused_since: string | null;
  /** The answer given during the CURRENT pause ('still_giving' always resumes, so never here). */
  answer: 'routine_changed' | 'keep_paused' | null;
  /** False for view-only seats and read-only circles: the notice shows without buttons. */
  can_answer: boolean;
}

export interface DoseAlertsAnswerResult extends DoseAlertsState {
  resumed: boolean;
}

interface Envelope<T> {
  success: boolean;
  data: T;
}

/** Normalizes the wire shape: anything unexpected reads as "not paused" (fail quiet). */
export function normalizeDoseAlerts(raw: unknown): DoseAlertsState {
  const r = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>;
  const answer = r.answer === 'routine_changed' || r.answer === 'keep_paused' ? r.answer : null;
  return {
    paused: r.paused === true,
    paused_since: typeof r.paused_since === 'string' ? r.paused_since : null,
    answer,
    can_answer: r.can_answer === true,
  };
}

export async function getDoseAlerts(circleId: string): Promise<DoseAlertsState> {
  const response = (await apiClient.get(
    `/circles/${circleId}/dose-alerts`
  )) as unknown as Envelope<unknown>;
  return normalizeDoseAlerts(response?.data);
}

export async function answerDoseAlerts(
  circleId: string,
  answer: DoseAlertsAnswer,
  source: DoseAlertsSource
): Promise<DoseAlertsAnswerResult> {
  const response = (await apiClient.post(`/circles/${circleId}/dose-alerts/answer`, {
    answer,
    source,
  })) as unknown as Envelope<unknown>;
  const data = (response?.data ?? {}) as Record<string, unknown>;
  return { ...normalizeDoseAlerts(data), resumed: data.resumed === true };
}
