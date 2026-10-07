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
  getAsNeededDoses,
  getCircleAsNeededDoses,
  getAsNeededSummaries,
  logAsNeededDose,
  removeAsNeededDose,
  type AsNeededDose,
  type AsNeededDoseWithEvent,
  type AsNeededDosesPage,
  type AsNeededSummary,
  type LogAsNeededDoseRequest,
  type LogAsNeededDoseResult,
} from '@/api/medicationAsNeeded';
import { isPermissionDeniedError } from '@/lib/apiErrors';
import { invalidateCircleAccessFlags } from '@/lib/circleAccessFlags';
import { queryKeys } from '@/lib/queryKeys';
import { useToast } from '@/components/ui';

// As-needed (PRN) medications — docs/plans/prn-medications.md.
//
// FREE (no premium gate). Any editing member logs or removes a dose; a
// view-only member never reaches these writes (the UI hides them) and the server
// answers 403 VIEW_ONLY regardless, which `onError` below turns into the same
// "no permission" toast + access-flag refresh every other write hook does.

const EMPTY_SUMMARIES: Record<string, AsNeededSummary> = {};
const DOSES_PAGE_SIZE = 30;

/** Everything a dose write refreshes: the card line, the log, the feed. */
export function invalidateAsNeeded(
  queryClient: ReturnType<typeof useQueryClient>,
  circleId: string
): void {
  void queryClient.invalidateQueries({ queryKey: queryKeys.asNeededSummary(circleId) });
  void queryClient.invalidateQueries({ queryKey: queryKeys.asNeededDoses(circleId) });
  void queryClient.invalidateQueries({ queryKey: queryKeys.activityFeed(circleId) });
}

/** `eventId → { last_dose }` for every active as-needed medication. */
export function useAsNeededSummaries(
  circleId: string | undefined,
  options?: { enabled?: boolean }
): UseQueryResult<Record<string, AsNeededSummary>> & {
  summaries: Record<string, AsNeededSummary>;
} {
  const query = useQuery({
    queryKey: queryKeys.asNeededSummary(circleId ?? ''),
    queryFn: () => getAsNeededSummaries(circleId!),
    enabled: !!circleId && (options?.enabled ?? true),
  });
  return { ...query, summaries: query.data ?? EMPTY_SUMMARIES };
}

/** One medication's dose log, newest first, removed doses included (struck through). */
export function useAsNeededDoses(
  circleId: string,
  eventId: string,
  options?: { enabled?: boolean }
): UseInfiniteQueryResult<{ pages: AsNeededDosesPage[]; pageParams: number[] }> {
  return useInfiniteQuery({
    queryKey: queryKeys.asNeededDoses(circleId, eventId),
    queryFn: ({ pageParam }) =>
      getAsNeededDoses(circleId, eventId, {
        limit: DOSES_PAGE_SIZE,
        offset: pageParam,
        includeRemoved: true,
      }),
    initialPageParam: 0,
    getNextPageParam: (last, pages) =>
      last.hasMore ? pages.reduce((n, p) => n + p.doses.length, 0) : undefined,
    enabled: !!circleId && !!eventId && (options?.enabled ?? true),
  });
}

/** Pages are 100 rows; ten pages is 1000 doses — far past any real month. */
const CIRCLE_DOSES_PAGE_SIZE = 100;
const CIRCLE_DOSES_MAX_PAGES = 10;
const EMPTY_DOSES: AsNeededDoseWithEvent[] = [];

/**
 * EVERY as-needed dose in the circle for a recipient-zone day window, all pages
 * (capped). Lives under the `asNeededDoses(circleId)` prefix so every dose write
 * (`invalidateAsNeeded`) refreshes it. Used by the History tab (removed doses
 * included) and the Calendar (live doses only).
 */
export function useCircleAsNeededDoses(
  circleId: string,
  window: { start_date?: string; end_date?: string } | undefined,
  options: { includeRemoved: boolean; enabled?: boolean }
): UseQueryResult<AsNeededDoseWithEvent[]> & { doses: AsNeededDoseWithEvent[] } {
  const query = useQuery({
    queryKey: [
      ...queryKeys.asNeededDoses(circleId),
      'circle',
      window?.start_date ?? '',
      window?.end_date ?? '',
      options.includeRemoved,
    ],
    queryFn: async () => {
      const all: AsNeededDoseWithEvent[] = [];
      for (let page = 0; page < CIRCLE_DOSES_MAX_PAGES; page++) {
        const res = await getCircleAsNeededDoses(circleId, {
          start_date: window!.start_date,
          end_date: window!.end_date,
          includeRemoved: options.includeRemoved,
          limit: CIRCLE_DOSES_PAGE_SIZE,
          offset: all.length,
        });
        all.push(...res.doses);
        if (!res.hasMore || res.doses.length === 0) break;
      }
      return all;
    },
    enabled:
      !!circleId && !!window?.start_date && !!window?.end_date && (options.enabled ?? true),
  });
  return { ...query, doses: query.data ?? EMPTY_DOSES };
}

export interface LogAsNeededDoseVariables {
  eventId: string;
  body: LogAsNeededDoseRequest;
  /** The circle the dose was logged in (the undo window sends 5 s later). */
  circleId?: string;
}

/**
 * POST a dose. The CALLER owns the outcome toasts (it knows whether a 409 is a
 * prompt or a failure); this hook owns the cache + access-flag consequences.
 */
export function useLogAsNeededDose(
  hookCircleId: string
): UseMutationResult<LogAsNeededDoseResult, unknown, LogAsNeededDoseVariables> {
  const queryClient = useQueryClient();
  const { showToast } = useToast();
  const { t } = useTranslation('meds');

  return useMutation({
    mutationFn: ({ eventId, body, circleId }: LogAsNeededDoseVariables) =>
      logAsNeededDose(circleId ?? hookCircleId, eventId, body),
    onSuccess: (_result, variables) => {
      invalidateAsNeeded(queryClient, variables.circleId ?? hookCircleId);
    },
    onError: (error, variables) => {
      const circleId = variables.circleId ?? hookCircleId;
      if (isPermissionDeniedError(error)) {
        showToast(t('asNeeded.toast.permissionDenied'), 'error');
        // The cached can_edit / view_only flags are stale — refresh BOTH caches.
        invalidateCircleAccessFlags(queryClient, circleId);
        return;
      }
      // A 409 prompt or a failure: either way what the card shows may be stale.
      void queryClient.invalidateQueries({ queryKey: queryKeys.asNeededSummary(circleId) });
    },
  });
}

export interface RemoveAsNeededDoseVariables {
  eventId: string;
  doseId: string;
}

export function useRemoveAsNeededDose(
  circleId: string
): UseMutationResult<{ dose: AsNeededDose }, unknown, RemoveAsNeededDoseVariables> {
  const queryClient = useQueryClient();
  const { showToast } = useToast();
  const { t } = useTranslation('meds');

  return useMutation({
    mutationFn: ({ eventId, doseId }: RemoveAsNeededDoseVariables) =>
      removeAsNeededDose(circleId, eventId, doseId),
    onSuccess: () => {
      invalidateAsNeeded(queryClient, circleId);
    },
    onError: (error) => {
      if (isPermissionDeniedError(error)) {
        showToast(t('asNeeded.toast.permissionDenied'), 'error');
        invalidateCircleAccessFlags(queryClient, circleId);
        return;
      }
      // ALREADY_REMOVED / NOT_FOUND: someone else got there first — show the truth.
      invalidateAsNeeded(queryClient, circleId);
    },
  });
}
