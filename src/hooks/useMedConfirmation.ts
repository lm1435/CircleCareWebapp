import {
  useMutation,
  useQuery,
  useQueryClient,
  type UseMutationResult,
  type UseQueryResult,
} from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import {
  confirmMedication,
  getTodaysMedications,
  getMedicationTodaySummary,
  isPermissionDeniedError,
  type ConfirmMedicationRequest,
  type MedicationConfirmation,
  type MedicationTodaySummary,
  type TodaysMedication,
} from '@/api/medicationConfirmations';
import { queryKeys } from '@/lib/queryKeys';
import { useToast } from '@/components/ui';
import { getDateInTimezone } from '@/utils/timezone';

// Plan Tasks 23 + 39 — confirm mutation + today's meds query.
//
// `todaysMedsKey` is local (not in queryKeys.ts) because that factory mirrors
// mobile's keys VERBATIM and mobile has no "today's meds list" query. The key
// is intentionally distinct from calendarEventsRange so this widget's
// medication-only fetch never collides with the calendar page's full-range
// cache entries for the same date window.

export function todaysMedsKey(circleId: string): readonly [string, string] {
  return ['todaysMeds', circleId] as const;
}

/**
 * Today's medications for a circle. "Today" is computed in the CARE
 * RECIPIENT'S timezone (circle.timezone) — never device-local date math.
 */
export function useTodaysMeds(
  circleId: string | undefined,
  careRecipientTimezone: string | undefined
): UseQueryResult<TodaysMedication[]> {
  const dateStr = careRecipientTimezone ? getDateInTimezone(careRecipientTimezone) : undefined;

  return useQuery({
    queryKey: [...todaysMedsKey(circleId ?? ''), dateStr ?? ''],
    queryFn: () => getTodaysMedications(circleId!, dateStr!),
    enabled: !!circleId && !!dateStr,
  });
}

/**
 * Aggregate "today" medication summary for a circle — drives the circle-picker
 * card status line. Mirrors mobile's useMedicationTodaySummary (same query key
 * family as the confirm mutation invalidates). "Today" is resolved server-side
 * in the care recipient's timezone, so no client date is needed here.
 */
export function useMedicationTodaySummary(
  circleId: string | undefined
): UseQueryResult<MedicationTodaySummary> {
  return useQuery({
    queryKey: queryKeys.medicationTodaySummary(circleId ?? ''),
    queryFn: () => getMedicationTodaySummary(circleId!),
    enabled: !!circleId,
  });
}

/**
 * React Query mutation for POST /circles/:circleId/medications/confirm.
 *
 * On success: invalidates the same query families mobile's
 * useConfirmMedication does (calendar events, confirmations, today summary,
 * activity, adherence) plus the web-only today's meds list.
 *
 * On 402/403 (requireCircleEditAccess rejection): shows the plan's edge-case
 * toast and invalidates circle queries so stale access flags refresh —
 * backend enforces access regardless of UI state.
 */
export function useConfirmMedication(
  circleId: string
): UseMutationResult<MedicationConfirmation, unknown, ConfirmMedicationRequest> {
  const queryClient = useQueryClient();
  const { showToast } = useToast();
  const { t } = useTranslation('meds');

  return useMutation({
    mutationFn: (data: ConfirmMedicationRequest) => confirmMedication(circleId, data),
    onSuccess: (_confirmation, variables) => {
      void queryClient.invalidateQueries({ queryKey: todaysMedsKey(circleId) });
      void queryClient.invalidateQueries({ queryKey: queryKeys.calendarEvents(circleId) });
      void queryClient.invalidateQueries({ queryKey: queryKeys.medicationConfirmations(circleId) });
      void queryClient.invalidateQueries({ queryKey: queryKeys.medicationTodaySummary(circleId) });
      void queryClient.invalidateQueries({
        queryKey: ['medicationAdherence', circleId, variables.event_id],
      });
      void queryClient.invalidateQueries({ queryKey: queryKeys.activityFeed(circleId) });
      void queryClient.invalidateQueries({ queryKey: queryKeys.weeklyAdherence(circleId) });
      void queryClient.invalidateQueries({ queryKey: queryKeys.adherenceReport(circleId) });
    },
    onError: (error) => {
      if (isPermissionDeniedError(error)) {
        showToast(t('permissionDenied'), 'error');
        // Refresh access flags + visible med state — the rejection means the
        // cached can_edit/view_only/read_only flags are stale.
        void queryClient.invalidateQueries({ queryKey: queryKeys.circles });
        void queryClient.invalidateQueries({ queryKey: todaysMedsKey(circleId) });
      } else {
        // Conflict/parallel-confirm path mirrors mobile: refetch current state.
        void queryClient.invalidateQueries({ queryKey: todaysMedsKey(circleId) });
        void queryClient.invalidateQueries({
          queryKey: queryKeys.medicationConfirmations(circleId),
        });
      }
    },
  });
}
