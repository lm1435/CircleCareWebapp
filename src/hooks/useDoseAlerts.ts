import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  answerDoseAlerts,
  getDoseAlerts,
  type DoseAlertsAnswer,
  type DoseAlertsAnswerResult,
  type DoseAlertsSource,
  type DoseAlertsState,
} from '@/api/doseAlerts';
import { queryKeys } from '@/lib/queryKeys';
import { useDoseAlertsResumedStore } from '@/store/doseAlertsResumedStore';

export interface DoseAlertsView {
  /** Null while the first read is in flight. A failed read is "not paused" (never silences anything). */
  state: DoseAlertsState | null;
  /** The read has answered (success OR failure): Today's coaching waits for this. */
  settled: boolean;
  isError: boolean;
  refetch: () => void;
}

const NOT_PAUSED: DoseAlertsState = {
  paused: false,
  paused_since: null,
  answer: null,
  can_answer: false,
};

/**
 * `GET /circles/:circleId/dose-alerts` (quiet-circle back-off, 1.4.2), key
 * `['doseAlerts', circleId]`. Any member may read it. ERROR = NOT PAUSED: the
 * notice is a convenience, and a failed read must never show a pause that is
 * not there (nor keep coaching waiting).
 */
export function useDoseAlerts(circleId: string | undefined): DoseAlertsView {
  const query = useQuery({
    queryKey: queryKeys.doseAlerts(circleId ?? ''),
    queryFn: () => getDoseAlerts(circleId!),
    enabled: Boolean(circleId),
    staleTime: 60_000,
    // No retry: a failed read already means "not paused", and Today's coaching waits for this
    // read, so a retry would only hold the page back.
    retry: false,
  });
  return {
    // Cached data wins over a failed REFETCH (React Query keeps `data` on a refetch error): a real
    // pause must not vanish because one background read failed. No data + error = not paused.
    state: query.data ?? (query.isError ? NOT_PAUSED : null),
    // An OFFLINE first read is paused (fetchStatus 'paused', never success/error): settle as
    // "not paused" so Today's coaching is not withheld forever (mobile twin).
    settled:
      !circleId ||
      query.isSuccess ||
      query.isError ||
      (query.fetchStatus === 'paused' && query.data === undefined),
    // "Could not load" = a failed read with nothing to show; a failed refetch over cached data is not.
    isError: query.isError && query.data === undefined,
    refetch: () => void query.refetch(),
  };
}

export interface AnswerVariables {
  answer: DoseAlertsAnswer;
  source: DoseAlertsSource;
}

/**
 * `POST /circles/:circleId/dose-alerts/answer`. On success the response IS
 * the new state (written into the cache, then refetched for freshness); a
 * resume is remembered so Today can say "Alerts are on".
 */
export function useAnswerDoseAlerts(circleId: string) {
  const queryClient = useQueryClient();
  const markResumed = useDoseAlertsResumedStore((s) => s.markResumed);
  return useMutation<DoseAlertsAnswerResult, unknown, AnswerVariables>({
    mutationFn: ({ answer, source }) => answerDoseAlerts(circleId, answer, source),
    onSuccess: (result, variables) => {
      const state: DoseAlertsState = {
        paused: result.paused,
        paused_since: result.paused_since,
        answer: result.answer,
        can_answer: result.can_answer,
      };
      queryClient.setQueryData(queryKeys.doseAlerts(circleId), state);
      if (variables.answer === 'still_giving') markResumed(circleId);
      void queryClient.invalidateQueries({ queryKey: queryKeys.doseAlerts(circleId) });
    },
  });
}
