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
  getLatestVitals,
  getVitals,
  updateVital,
  type CreateVitalRequest,
  type GetVitalsParams,
  type HealthVital,
  type LatestVitals,
  type UpdateVitalRequest,
} from '@/api/vitals';
import { queryKeys } from '@/lib/queryKeys';
import { invalidateCircleAccessFlags } from '@/lib/circleAccessFlags';
import { isPermissionDeniedError, isSubscriptionRequiredError } from '@/lib/apiErrors';
import { useToast } from '@/components/ui';
import { usePremiumGate } from '@/hooks/usePremiumGate';
import { Analytics } from '@/lib/analytics';

// Vitals data layer (Plan Task 6.3). Read hook + create/update/delete mutations,
// mirroring the shipped mutation pattern in useMedConfirmation.ts / useDocuments.ts:
//   mutationFn → onSuccess invalidates queryKeys.vitals(cid) + vitalsLatest(cid)
//   → onError classifies the rejection (403 SUBSCRIPTION_REQUIRED on a lapsed
//     circle / 403 permission) so the UI shows the right message; the backend
//     enforces access regardless of UI.
//
// VITALS ARE NOT A PREMIUM FEATURE. Every tier can log, edit and delete
// readings; backend/src/routes/vitals.ts gates writes ONLY on
// `requireCircleEditAccess` (backend/src/middleware/circleAccess.ts), never on
// the viewer's or owner's plan, and never answers 402.
//
// Every reading is manual and freely editable/deletable — write affordances are
// gated only on circle edit access (useCircle().canEdit), not on the reading.

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
 * Read the single latest reading PER TYPE, independent of any date-range
 * filter — this is what lets the empty states tell "never logged" (this type
 * has no reading at all) apart from "not in the selected range" (a reading
 * exists, just older than the window). Mirrors mobile's useLatestVitals.
 */
export function useLatestVitals(circleId: string | undefined): UseQueryResult<LatestVitals> {
  return useQuery({
    queryKey: queryKeys.vitalsLatest(circleId ?? ''),
    queryFn: () => getLatestVitals(circleId!),
    enabled: !!circleId,
    staleTime: 1000 * 60 * 5,
  });
}

/**
 * Shared onError for vitals mutations. Surfaces the access rejections distinctly:
 *   - 403 SUBSCRIPTION_REQUIRED → lapsed-circle prompt (owner: Upgrade) + refetch circle flags.
 *     This is `requireCircleEditAccess`'s CIRCLE-WIDE refusal ("This circle
 *     requires an active subscription. Only the owner and care recipient can
 *     make changes.") for a circle whose owner lapsed — the same 403 every
 *     circle write route answers, not a vitals-specific gate.
 *   - 403 VIEW_ONLY / FORBIDDEN → "no permission" + refetch circle flags.
 *   - everything else           → generic save-failed.
 * Handles SUBSCRIPTION_REQUIRED exactly like the calendar write surface
 * (useCalendarEvents' useEventMutationOnError — events, tasks and medications).
 */
function useVitalsMutationOnError(circleId: string): (error: unknown) => void {
  const queryClient = useQueryClient();
  const { showToast } = useToast();
  // NOT a premium-only surface. The only SUBSCRIPTION_REQUIRED vitals can get
  // is the circle-wide lapsed-owner 403 above, so it gets the LAPSED copy
  // (promptLapsed), never the "not included in the free plan" gate copy; circle-
  // level so only the owner is offered Upgrade.
  const { promptLapsed } = usePremiumGate('capacity', { circleId });
  const { t } = useTranslation('vitals');

  return (error: unknown) => {
    if (isSubscriptionRequiredError(error)) {
      // PK18: lapsed-plan wording (owner: Upgrade action; members: never sold).
      promptLapsed();
      invalidateCircleAccessFlags(queryClient, circleId);
    } else if (isPermissionDeniedError(error)) {
      showToast(t('errors.permissionDenied'), 'error');
      invalidateCircleAccessFlags(queryClient, circleId);
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

/** PUT /circles/:circleId/vitals/:id — edit a reading. */
export function useUpdateVital(
  circleId: string
): UseMutationResult<HealthVital, unknown, UpdateVitalVariables> {
  const queryClient = useQueryClient();
  const onError = useVitalsMutationOnError(circleId);

  return useMutation({
    mutationFn: ({ id, data }: UpdateVitalVariables) => updateVital(circleId, id, data),
    onSuccess: () => {
      Analytics.vitalUpdated(circleId);
      invalidateVitals(queryClient, circleId);
    },
    onError,
  });
}

/** DELETE /circles/:circleId/vitals/:id. */
export function useDeleteVital(circleId: string): UseMutationResult<void, unknown, string> {
  const queryClient = useQueryClient();
  const onError = useVitalsMutationOnError(circleId);

  return useMutation({
    mutationFn: (id: string) => deleteVital(circleId, id),
    onSuccess: () => {
      Analytics.vitalDeleted(circleId);
      invalidateVitals(queryClient, circleId);
    },
    onError,
  });
}
