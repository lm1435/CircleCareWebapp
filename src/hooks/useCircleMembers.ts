import { useMemo } from 'react';
import {
  useMutation,
  useQuery,
  useQueryClient,
  type UseMutationResult,
  type UseQueryResult,
} from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import {
  getCircleDetail,
  leaveCircle,
  removeMember,
  setMedicationResponsible,
  type CircleDetail,
  type CircleMember,
} from '@/api/circleMembers';
import { queryKeys } from '@/lib/queryKeys';
import { isPermissionDeniedError, isSubscriptionRequiredError } from '@/lib/apiErrors';
import { useToast } from '@/components/ui';
import { usePremiumGate } from '@/hooks/usePremiumGate';

const EMPTY_MEMBERS: CircleMember[] = [];

/** Owner first, then care recipient, then caregivers by join date. */
function rolePriority(member: CircleMember): number {
  if (member.role === 'owner') return 0;
  if (member.is_care_recipient) return 1;
  return 2;
}

export interface UseCircleMembersResult {
  /** Sorted: owner, care recipient, then caregivers (oldest join first). */
  members: CircleMember[];
}

/**
 * React Query hook for `GET /circles/:circleId` (plan Tasks 35-36).
 * Members are derived from the circle detail response — there is no separate
 * members endpoint. Uses mobile's `['circle', circleId]` detail key verbatim.
 */
export function useCircleMembers(
  circleId: string
): UseQueryResult<CircleDetail> & UseCircleMembersResult {
  const query = useQuery({
    queryKey: queryKeys.circleDetail(circleId),
    queryFn: () => getCircleDetail(circleId),
    enabled: !!circleId,
  });

  const rawMembers = query.data?.members ?? EMPTY_MEMBERS;

  const members = useMemo(
    () =>
      [...rawMembers].sort(
        (a, b) => rolePriority(a) - rolePriority(b) || a.joined_at.localeCompare(b.joined_at)
      ),
    [rawMembers]
  );

  return { ...query, members };
}

// ===========================================================================
// Member-management WRITE hooks (plan Stage 5, Task 5.2)
// ---------------------------------------------------------------------------
// Mirror the SHIPPED mutation pattern in useMedConfirmation.ts: mutationFn →
// onSuccess invalidates the circle detail (`['circle', cid]`) + summary
// (`['circles', cid]`) + list (`['circles']`) families mobile's hooks
// invalidate (reuse queryKeys, do NOT invent shapes) → onError distinguishes
// 402/403 rejection from a generic failure.
// ===========================================================================

/** Refresh the circle detail (members), the circle summary, and the list. */
function invalidateCircleQueries(
  queryClient: ReturnType<typeof useQueryClient>,
  circleId: string
): void {
  void queryClient.invalidateQueries({ queryKey: queryKeys.circle(circleId) });
  void queryClient.invalidateQueries({ queryKey: queryKeys.circleDetail(circleId) });
  void queryClient.invalidateQueries({ queryKey: queryKeys.circles });
}

/** Shared onError for member mutations (these are owner-gated → mostly 403). */
function useMemberMutationOnError(): (error: unknown) => void {
  const queryClient = useQueryClient();
  const { showToast } = useToast();
  const { promptUpgrade } = usePremiumGate();
  const { t } = useTranslation('members');

  return (error: unknown) => {
    if (isSubscriptionRequiredError(error)) {
      promptUpgrade();
      void queryClient.invalidateQueries({ queryKey: queryKeys.circles });
    } else if (isPermissionDeniedError(error)) {
      showToast(t('errors.permissionDenied'), 'error');
      void queryClient.invalidateQueries({ queryKey: queryKeys.circles });
    } else {
      showToast(t('errors.saveFailed'), 'error');
    }
  };
}

export interface RemoveMemberVariables {
  userId: string;
}

/** DELETE /circles/:circleId/members/:userId — owner removes a member. */
export function useRemoveMember(
  circleId: string
): UseMutationResult<void, unknown, RemoveMemberVariables> {
  const queryClient = useQueryClient();
  const onError = useMemberMutationOnError();

  return useMutation({
    mutationFn: ({ userId }: RemoveMemberVariables) => removeMember(circleId, userId),
    onSuccess: () => invalidateCircleQueries(queryClient, circleId),
    onError,
  });
}

/** POST /circles/:circleId/leave — current member voluntarily leaves. */
export function useLeaveCircle(circleId: string): UseMutationResult<void, unknown, void> {
  const queryClient = useQueryClient();
  const onError = useMemberMutationOnError();

  return useMutation({
    mutationFn: () => leaveCircle(circleId),
    onSuccess: () => {
      // The user is no longer in this circle — drop its detail and refresh the list.
      void queryClient.invalidateQueries({ queryKey: queryKeys.circleDetail(circleId) });
      void queryClient.invalidateQueries({ queryKey: queryKeys.circles });
    },
    onError,
  });
}

/**
 * PUT /circles/:circleId/medication-responsible — owner sets/clears the
 * medication-responsible member. Pass `null` to clear.
 */
export function useSetMedicationResponsible(
  circleId: string
): UseMutationResult<void, unknown, string | null> {
  const queryClient = useQueryClient();
  const onError = useMemberMutationOnError();

  return useMutation({
    mutationFn: (userId: string | null) => setMedicationResponsible(circleId, userId),
    onSuccess: () => invalidateCircleQueries(queryClient, circleId),
    onError,
  });
}
