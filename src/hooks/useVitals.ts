import {
  useMutation,
  useQuery,
  useQueryClient,
  type UseMutationResult,
  type UseQueryResult,
} from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import {
  createVital,
  deleteVital,
  getVitals,
  updateVital,
  type CreateVitalRequest,
  type GetVitalsParams,
  type HealthVital,
  type UpdateVitalRequest,
} from '@/api/vitals';
import { queryKeys } from '@/lib/queryKeys';
import { isPermissionDeniedError, isSubscriptionRequiredError } from '@/lib/apiErrors';
import { useToast } from '@/components/ui';
import { usePremiumGate } from '@/hooks/usePremiumGate';
import { Analytics } from '@/lib/analytics';

// Vitals data layer (Plan Task 6.3). Read hook + create/update/delete mutations,
// mirroring the shipped mutation pattern in useMedConfirmation.ts / useDocuments.ts:
//   mutationFn → onSuccess invalidates queryKeys.vitals(cid) + vitalsLatest(cid)
//   → onError classifies the rejection (402 subscription / 403 permission) so the
//     UI shows the right message; the backend enforces access regardless of UI.
//
// EDIT/DELETE GUARD: only `source: 'manual'` readings may be edited or deleted
// (synced device readings are read-only — backend PUT returns 403 on non-manual).
// `canEditVital` lets the UI hide edit/delete affordances; re-exported from the
// api module so callers import one place.

export { isManualVital as canEditVital } from '@/api/vitals';

// Note: vitalsLatest(cid) = ['vitals', cid, 'latest'] is a prefix-subset of
// vitals(cid) = ['vitals', cid], so invalidating vitals(cid) already matches it.
// We invalidate BOTH explicitly per the plan so the intent is unambiguous and a
// future query-key change to the latest shape doesn't silently miss it.
function invalidateVitals(queryClient: ReturnType<typeof useQueryClient>, circleId: string): void {
  void queryClient.invalidateQueries({ queryKey: queryKeys.vitals(circleId) });
  void queryClient.invalidateQueries({ queryKey: queryKeys.vitalsLatest(circleId) });
}

/**
 * Read vitals for a circle within a date window. `from`/`to` are UTC ISO
 * timestamps; the query stays disabled until both (and circleId) are present.
 * Cache key mirrors mobile useVitals (type-scoped when a type is given).
 */
export function useVitals(
  circleId: string | undefined,
  params?: Partial<GetVitalsParams>
): UseQueryResult<HealthVital[]> {
  const type = params?.type;
  const from = params?.from;
  const to = params?.to;

  return useQuery({
    queryKey: type
      ? [...queryKeys.vitals(circleId ?? ''), type, from, to]
      : [...queryKeys.vitals(circleId ?? ''), from, to],
    queryFn: () => getVitals(circleId!, { type, from: from!, to: to! }),
    enabled: !!circleId && !!from && !!to,
    staleTime: 1000 * 60 * 5,
  });
}

/**
 * Shared onError for vitals mutations. Surfaces the access rejections distinctly:
 *   - 402 SUBSCRIPTION_REQUIRED → "open the app to upgrade" + refetch circle flags.
 *   - 403 (view/read-only)      → "no permission" + refetch circle flags.
 *   - everything else           → generic save-failed.
 * Mirrors useDocuments' classifier (no 413 path — vitals have no storage cap).
 */
function useVitalsMutationOnError(circleId: string): (error: unknown) => void {
  const queryClient = useQueryClient();
  const { showToast } = useToast();
  const { promptUpgrade } = usePremiumGate();
  const { t } = useTranslation('vitals');

  return (error: unknown) => {
    if (isSubscriptionRequiredError(error)) {
      promptUpgrade();
      void queryClient.invalidateQueries({ queryKey: queryKeys.circles });
    } else if (isPermissionDeniedError(error)) {
      showToast(t('errors.permissionDenied'), 'error');
      void queryClient.invalidateQueries({ queryKey: queryKeys.circles });
    } else {
      showToast(t('errors.saveFailed'), 'error');
      invalidateVitals(queryClient, circleId);
    }
  };
}

/** POST /circles/:circleId/vitals — log a new (manual) reading. */
export function useCreateVital(
  circleId: string
): UseMutationResult<HealthVital, unknown, CreateVitalRequest> {
  const queryClient = useQueryClient();
  const onError = useVitalsMutationOnError(circleId);

  return useMutation({
    mutationFn: (data: CreateVitalRequest) => createVital(circleId, data),
    onSuccess: (_vital, variables) => {
      // PHI-safe: only circle_id + the vital_type enum (never the reading value).
      Analytics.vitalLogged(circleId, variables.vital_type);
      invalidateVitals(queryClient, circleId);
    },
    onError,
  });
}

export interface UpdateVitalVariables {
  id: string;
  data: UpdateVitalRequest;
}

/**
 * PUT /circles/:circleId/vitals/:id — edit a MANUAL reading. Synced readings
 * (source !== 'manual') 403 server-side; gate the UI on `canEditVital` so the
 * edit affordance never appears for them.
 */
export function useUpdateVital(
  circleId: string
): UseMutationResult<HealthVital, unknown, UpdateVitalVariables> {
  const queryClient = useQueryClient();
  const onError = useVitalsMutationOnError(circleId);

  return useMutation({
    mutationFn: ({ id, data }: UpdateVitalVariables) => updateVital(circleId, id, data),
    onSuccess: () => invalidateVitals(queryClient, circleId),
    onError,
  });
}

/** DELETE /circles/:circleId/vitals/:id. */
export function useDeleteVital(circleId: string): UseMutationResult<void, unknown, string> {
  const queryClient = useQueryClient();
  const onError = useVitalsMutationOnError(circleId);

  return useMutation({
    mutationFn: (id: string) => deleteVital(circleId, id),
    onSuccess: () => invalidateVitals(queryClient, circleId),
    onError,
  });
}
