import {
  useInfiniteQuery,
  useMutation,
  useQuery,
  useQueryClient,
  type UseInfiniteQueryResult,
  type UseMutationResult,
  type UseQueryResult,
} from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import {
  confirmMedication,
  getTodaysMedications,
  getMedicationTodaySummary,
  getWeeklyAdherence,
  getMedicationConfirmations,
  getAdherenceReport,
  isPermissionDeniedError,
  type ConfirmMedicationRequest,
  type WeeklyAdherence,
  type MedicationConfirmationsPage,
  type MedicationConfirmationsParams,
  type AdherenceReport,
  type AdherencePeriod,
  type MedicationConfirmation,
  type MedicationTodaySummary,
  type TodaysMedication,
} from '@/api/medicationConfirmations';
import { queryKeys } from '@/lib/queryKeys';
import { invalidateCircleAccessFlags } from '@/lib/circleAccessFlags';
import { classifyFailureCode } from '@/lib/apiErrors';
import { withRefetchCap } from '@/lib/refetchCap';
import { useToast } from '@/components/ui';
import { getDateInTimezone } from '@/utils/timezone';
import { Analytics, type MedicationConfirmSource } from '@/lib/analytics';
import {
  isAmbiguousConfirmFailure,
  markConfirmFailure,
  verifyConfirmLanded,
} from '@/lib/confirmVerify';
import { doseAlreadyRecorded } from '@/lib/doseAlreadyRecorded';

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
  return useMedsForDate(circleId, dateStr);
}

/**
 * One day's medications, by explicit date.
 *
 * Split out of `useTodaysMeds` so the Overview card can also ask for
 * YESTERDAY — mobile has surfaced yesterday's unanswered doses as "Needs
 * Attention" since it shipped, and web had no equivalent, so a dose nobody
 * answered simply stopped existing on web at midnight.
 *
 * The date is part of the key, so each day caches separately; the confirm
 * mutation invalidates the `todaysMedsKey(circleId)` PREFIX, which clears every
 * day at once and keeps both groups honest after an answer.
 */
export function useMedsForDate(
  circleId: string | undefined,
  dateStr: string | undefined
): UseQueryResult<TodaysMedication[]> {
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
/**
 * The confirm body plus, optionally, THE CIRCLE TO SEND TO. The dose undo window
 * (components/meds/useMedicationUndo) commits up to 5s after the tap — on its
 * timer or in a flush — and by then the hook may be rendering a different
 * circle; the request, its analytics and its invalidations belong to the circle
 * the tap was made in. Omitted, the hook's `circleId` is used, as before.
 * `circleId` is stripped before the POST — it is never part of the body.
 */
export type ConfirmMedicationVariables = ConfirmMedicationRequest & {
  circleId?: string;
  /**
   * The dose's DAY (and series), for VERIFY-BEFORE-ALERT: an ambiguous
   * rejection (timeout, network, 5xx) re-reads this day before anything is
   * reported — see lib/confirmVerify.ts. Omitted, a rejection is reported as
   * it is (the old behaviour). Stripped before the POST, like `circleId`.
   */
  dose?: { scheduled_date: string; parent_event_id?: string | null };
};

/**
 * Confirmations that came back from a VERIFIED re-read after an ambiguous
 * rejection, mapped to the bounded failure code that was recovered from — so
 * `onSuccess` can log `medication_confirm_recovered` (mobile parity).
 */
const RECOVERED = new WeakMap<object, string>();

export function useConfirmMedication(
  hookCircleId: string,
  /** Which surface answered the dose — see Analytics.medicationConfirmed. */
  source: MedicationConfirmSource
): UseMutationResult<MedicationConfirmation, unknown, ConfirmMedicationVariables> {
  const queryClient = useQueryClient();
  const { showToast } = useToast();
  const { t } = useTranslation('meds');

  return useMutation({
    mutationFn: async ({
      circleId: sentCircleId,
      dose,
      ...data
    }: ConfirmMedicationVariables): Promise<MedicationConfirmation> => {
      const circleId = sentCircleId ?? hookCircleId;
      try {
        return await confirmMedication(circleId, data);
      } catch (error) {
        // VERIFY BEFORE ALERT (test-gap audit 2026-09-29 #3, mobile parity).
        // A definitive refusal — DOSE_ALREADY_RECORDED included — is reported
        // as it is. An AMBIGUOUS one may have been written: re-read the day.
        if (!dose || !isAmbiguousConfirmFailure(error)) throw error;
        const { verdict, row } = await verifyConfirmLanded(
          circleId,
          {
            id: data.event_id,
            scheduled_date: dose.scheduled_date,
            scheduled_time: data.scheduled_time,
            parent_event_id: dose.parent_event_id ?? null,
          },
          data.status
        );
        if (verdict !== 'recorded') throw markConfirmFailure(error, verdict);
        // It landed. Resolve — the success toast, the success invalidations.
        const recovered = {
          id: '',
          event_id: row?.id ?? data.event_id,
          circle_id: circleId,
          confirmed_by: row?.confirmation?.confirmed_by ?? '',
          confirmed_at: row?.confirmation?.confirmed_at ?? '',
          status: row?.confirmation?.status ?? data.status,
          scheduled_time: data.scheduled_time,
        } as MedicationConfirmation;
        RECOVERED.set(recovered, classifyFailureCode(error));
        return recovered;
      }
    },
    onSuccess: (confirmation, variables) => {
      const circleId = variables.circleId ?? hookCircleId;
      // PHI-safe: only circle_id + the status enum (never the medication name).
      Analytics.medicationConfirmed(circleId, variables.status, source);
      const recoveredFrom =
        confirmation && typeof confirmation === 'object' ? RECOVERED.get(confirmation) : undefined;
      if (recoveredFrom !== undefined) {
        Analytics.medicationConfirmRecovered(circleId, variables.status, source, recoveredFrom);
      }

      // THE TODAY'S-MEDS INVALIDATION IS RETURNED, NOT FIRED AND FORGOTTEN.
      //
      // TanStack awaits a promise returned from `onSuccess` before the mutation
      // settles, so `mutateAsync` here resolves only once the dose list has
      // actually refetched. The undo flow (components/meds/useMedicationUndo)
      // clears a dose's pending entry when the mutation settles; with a bare
      // `void invalidateQueries(...)` that happened while the refetch was still
      // in flight, so the row fell back to the STALE cached dose for a frame or
      // two — Take/Skip reappeared under the cursor on a dose that had just
      // been answered, and a second click wrote a duplicate confirmation, a
      // duplicate activity-feed row and a duplicate push to the whole circle.
      //
      // Only this one is awaited. The rest below are background freshness for
      // screens the caregiver is not looking at (adherence, activity, weekly),
      // and awaiting them would hold the Take/Skip pair hostage to a report
      // fetch nobody is waiting on.
      //
      // CAPPED at `REFETCH_CAP_MS` (src/lib/refetchCap.ts) — this QueryClient
      // runs `networkMode: 'online'` (src/lib/queryClient.ts), so a refetch
      // begun while the caregiver is offline PAUSES rather than fails, and its
      // promise would otherwise never settle. Past the cap the badge clears
      // exactly as it did before this wait existed — the same behavior a
      // rejected refetch already got here.
      const todaysMedsRefetched = withRefetchCap(
        queryClient.invalidateQueries({
          queryKey: todaysMedsKey(circleId),
        })
      );

      void queryClient.invalidateQueries({ queryKey: queryKeys.calendarEvents(circleId) });
      void queryClient.invalidateQueries({ queryKey: queryKeys.medicationConfirmations(circleId) });
      void queryClient.invalidateQueries({ queryKey: queryKeys.medicationTodaySummary(circleId) });
      void queryClient.invalidateQueries({ queryKey: queryKeys.weeklyAdherence(circleId) });
      void queryClient.invalidateQueries({ queryKey: queryKeys.adherenceReport(circleId) });
      void queryClient.invalidateQueries({
        queryKey: ['medicationAdherence', circleId, variables.event_id],
      });
      void queryClient.invalidateQueries({ queryKey: queryKeys.activityFeed(circleId) });
      void queryClient.invalidateQueries({ queryKey: queryKeys.weeklyAdherence(circleId) });
      void queryClient.invalidateQueries({ queryKey: queryKeys.adherenceReport(circleId) });

      return todaysMedsRefetched;
    },
    onError: (error, variables) => {
      const circleId = variables.circleId ?? hookCircleId;

      // PK1 (2026-09-29): ANOTHER CAREGIVER ALREADY ANSWERED this dose (409
      // DOSE_ALREADY_RECORDED). Nothing failed and nothing was overwritten, so
      // this is not an `error_occurred`. Refetch the day on every surface that
      // shows it, and RETURN the capped today's-meds refetch so the mutation
      // settles only once the row can show the real answer — the undo badge
      // clears on settle, and it must not fall back to a stale Take/Skip pair.
      if (doseAlreadyRecorded(error)) {
        Analytics.medicationConfirmAlreadyRecorded(variables.status, source);
        void queryClient.invalidateQueries({ queryKey: queryKeys.calendarEvents(circleId) });
        void queryClient.invalidateQueries({ queryKey: queryKeys.medicationConfirmations(circleId) });
        void queryClient.invalidateQueries({ queryKey: queryKeys.medicationTodaySummary(circleId) });
        return withRefetchCap(queryClient.invalidateQueries({ queryKey: todaysMedsKey(circleId) }));
      }

      // Mobile parity (`medicationConfirmFailed`): the SAME `error_occurred` /
      // `medication_confirm_error` row, so the digest and a cross-platform
      // breakdown join on `error` + `code`. Every property is an id or an enum:
      // `code` comes from `classifyFailureCode`, a closed set by construction
      // — never the toast string, never `error.message`. Fired on BOTH
      // branches: a permission rejection is still a failed confirm.
      Analytics.errorOccurred('medication_confirm', 'medication_confirm_error', {
        circle_id: circleId,
        status: variables.status,
        source,
        code: classifyFailureCode(error),
      });
      if (isPermissionDeniedError(error)) {
        showToast(t('permissionDenied'), 'error');
        // Refresh access flags + visible med state — the rejection means the
        // cached can_edit/view_only/read_only flags are stale.
        invalidateCircleAccessFlags(queryClient, circleId);
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

// ---------------------------------------------------------------------------
// Adherence + history queries (Wave 3). Mirror mobile's useMedicationConfirmations.
// ---------------------------------------------------------------------------

export function useWeeklyAdherence(
  circleId: string,
  options?: { enabled?: boolean }
): UseQueryResult<WeeklyAdherence> {
  return useQuery({
    queryKey: queryKeys.weeklyAdherence(circleId),
    queryFn: () => getWeeklyAdherence(circleId),
    enabled: !!circleId && (options?.enabled ?? true),
    staleTime: 60_000,
  });
}

/**
 * Rows per request. Mobile's `useMedicationConfirmations` pages at 30
 * (mobile/src/hooks/useMedicationConfirmations.ts) and so does this; the
 * backend clamps `limit` to 1..100 regardless
 * (backend/src/routes/medicationConfirmations.ts).
 */
export const MEDICATION_CONFIRMATIONS_PAGE_SIZE = 30;

/**
 * A page of medication history — PAGED, like mobile's.
 *
 * This was a single `useQuery` asking for one 100-row page and discarding
 * `hasMore`, under a comment claiming mobile did the same. Mobile does not: it
 * is a `useInfiniteQuery` that fetches the next page when the list hits its
 * end. The single-page version silently truncated: a circle on five daily
 * medications answers ~150 doses a month, so the last two weeks of the "last
 * 30 days" simply did not exist on web, with nothing on screen saying so.
 *
 * `select` flattens the pages back into the `{ confirmations, hasMore }` shape
 * every caller already reads, so a consumer that does not page — the filter's
 * option list — needs no changes and sees every row loaded so far.
 * `hasNextPage` / `fetchNextPage` / `isFetchingNextPage` come through the
 * normal infinite-query result for the one that does.
 *
 * `params.limit`/`params.offset` are IGNORED if passed: paging is this hook's
 * job now, and letting a caller set them would fork the page size out of the
 * query key's control.
 */
export function useMedicationConfirmations(
  circleId: string,
  params?: MedicationConfirmationsParams,
  options?: { enabled?: boolean }
): UseInfiniteQueryResult<MedicationConfirmationsPage, Error> {
  const window: MedicationConfirmationsParams | undefined = params
    ? {
        ...(params.event_id ? { event_id: params.event_id } : null),
        ...(params.start_date ? { start_date: params.start_date } : null),
        ...(params.end_date ? { end_date: params.end_date } : null),
      }
    : undefined;

  return useInfiniteQuery({
    queryKey: queryKeys.medicationConfirmations(
      circleId,
      window as Record<string, unknown> | undefined
    ),
    queryFn: ({ pageParam }) =>
      getMedicationConfirmations(circleId, {
        ...window,
        limit: MEDICATION_CONFIRMATIONS_PAGE_SIZE,
        offset: pageParam,
      }),
    initialPageParam: 0,
    // The next OFFSET is how many rows are already loaded — counted from the
    // pages themselves rather than `pages.length * PAGE_SIZE`, so a short page
    // (the backend clamping, or a row deleted between requests) cannot make the
    // next request skip rows.
    getNextPageParam: (lastPage, allPages) =>
      lastPage.hasMore
        ? allPages.reduce((total, page) => total + page.confirmations.length, 0)
        : undefined,
    select: (data) => ({
      confirmations: data.pages.flatMap((page) => page.confirmations),
      hasMore: data.pages[data.pages.length - 1]?.hasMore ?? false,
    }),
    enabled: !!circleId && (options?.enabled ?? true),
    staleTime: 60_000,
  });
}

export function useAdherenceReport(
  circleId: string,
  period: AdherencePeriod = '30d',
  options?: { enabled?: boolean }
): UseQueryResult<AdherenceReport> {
  return useQuery({
    queryKey: queryKeys.adherenceReport(circleId, period),
    queryFn: () => getAdherenceReport(circleId, period),
    enabled: !!circleId && (options?.enabled ?? true),
    staleTime: 60_000,
  });
}
