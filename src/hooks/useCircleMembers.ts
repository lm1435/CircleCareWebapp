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
  setMemberRole,
  type AssignableRole,
  type CircleDetail,
  type CircleMember,
  type SetMemberRoleResult,
} from '@/api/circleMembers';
import type { Circle } from '@/api/circles';
import { queryKeys } from '@/lib/queryKeys';
import { invalidateCircleAccessFlags } from '@/lib/circleAccessFlags';
import {
  failureContext,
  isPermissionDeniedError,
  isSubscriptionRequiredError,
  type FailureAction,
} from '@/lib/apiErrors';
import { useToast } from '@/components/ui';
import { usePremiumGate } from '@/hooks/usePremiumGate';
import { Analytics } from '@/lib/analytics';
import { cachedActorRole } from '@/lib/circleViewerRole';

const EMPTY_MEMBERS: CircleMember[] = [];

/**
 * Owner first, then managers, then the care recipient, then caregivers — each
 * group by join date. Managers sit right under the owner because they are the
 * people to ask about the circle (mirrors the backend's owner → manager →
 * member order).
 */
function rolePriority(member: CircleMember): number {
  if (member.role === 'owner') return 0;
  if (member.role === 'manager') return 1;
  if (member.is_care_recipient) return 2;
  return 3;
}

export interface UseCircleMembersResult {
  /** Sorted: owner, managers, care recipient, then caregivers (oldest join first). */
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
function useMemberMutationOnError(
  circleId: string,
  action: FailureAction
): (error: unknown) => void {
  const queryClient = useQueryClient();
  const { showToast } = useToast();
  // Seat cap on the member write path — CAPACITY, same as invites. The cap is
  // the OWNER's tier, so the gate is owner-aware.
  const { promptUpgrade } = usePremiumGate('capacity', { circleId });
  const { t } = useTranslation('members');

  return (error: unknown) => {
    // `error_occurred` for the admin digest: enums only, no circle_id.
    Analytics.errorOccurred('members', `members_${action}_failed`, failureContext('members', action, error));
    const code = (error as { error?: { code?: string } } | null)?.error?.code;
    if (isSubscriptionRequiredError(error)) {
      promptUpgrade();
      invalidateCircleAccessFlags(queryClient, circleId);
    } else if (isPermissionDeniedError(error)) {
      // Also a manager whose role was taken back since the page loaded, or one
      // trying to remove another manager: refresh so the menu matches the server.
      showToast(t('errors.permissionDenied'), 'error');
      invalidateCircleAccessFlags(queryClient, circleId);
      invalidateCircleQueries(queryClient, circleId);
    } else if (code === 'CIRCLE_ARCHIVED') {
      showToast(t('errors.circleInactive'), 'error');
      invalidateCircleQueries(queryClient, circleId);
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
  const onError = useMemberMutationOnError(circleId, 'delete');

  return useMutation({
    mutationFn: ({ userId }: RemoveMemberVariables) => removeMember(circleId, userId),
    onSuccess: () => {
      // Deliberately no removed-user id — see Analytics.memberRemoved's doc comment.
      Analytics.memberRemoved(circleId, cachedActorRole(circleId));
      invalidateCircleQueries(queryClient, circleId);
    },
    onError,
  });
}

/** POST /circles/:circleId/leave — current member voluntarily leaves. */
export function useLeaveCircle(circleId: string): UseMutationResult<void, unknown, void> {
  const queryClient = useQueryClient();
  const onError = useMemberMutationOnError(circleId, 'delete');

  return useMutation({
    mutationFn: () => leaveCircle(circleId),
    onSuccess: () => {
      Analytics.circleLeft(circleId);
      // The user is no longer in this circle — drop its detail and refresh the list.
      //
      // PK16: take the circle out of the CACHED list synchronously, before the
      // caller navigates to /circles. Invalidating alone keeps the stale list as
      // `data` until the refetch lands, and the picker's single-circle auto-skip
      // reads it on mount: leaving your only circle forwarded you straight back
      // into /circles/<left>.
      queryClient.setQueryData<Circle[] | undefined>(queryKeys.circles, (old) =>
        Array.isArray(old) ? old.filter((c) => c.id !== circleId) : old
      );
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
  const onError = useMemberMutationOnError(circleId, 'update');

  return useMutation({
    mutationFn: (userId: string | null) => setMedicationResponsible(circleId, userId),
    onSuccess: () => invalidateCircleQueries(queryClient, circleId),
    onError,
  });
}

export interface SetMemberRoleVariables {
  userId: string;
  role: AssignableRole;
  /** Display name for the success toast ("Ana is now a manager."). */
  name: string;
}

/**
 * PATCH /circles/:circleId/members/:userId/role — the owner makes a member a
 * manager, or takes the role back. Owner-only on the server; the UI offers it
 * only when `viewer_permissions` carries `assign_manager`.
 *
 * Errors (`err.error.code`), each with copy that says what to do:
 *   402 SUBSCRIPTION_REQUIRED   promoting on a free owner's circle — the owner
 *                               is the viewer, so the owner-aware gate offers
 *                               Upgrade ('feature': managers are Premium).
 *   403 FEATURE_DISABLED        the switch was turned off since the page loaded.
 *   400 CARE_RECIPIENT_CANNOT_MANAGE / VIEW_ONLY_CANNOT_MANAGE
 *   400 CIRCLE_ARCHIVED, 403 FORBIDDEN, 404 NOT_FOUND, 503, network → generic.
 * Every refusal refreshes the circle so the menu matches the server again.
 */
export function useSetMemberRole(
  circleId: string
): UseMutationResult<SetMemberRoleResult, unknown, SetMemberRoleVariables> {
  const queryClient = useQueryClient();
  const { showToast } = useToast();
  const { promptUpgrade } = usePremiumGate('feature', { circleId });
  const { t } = useTranslation('members');

  return useMutation({
    mutationFn: ({ userId, role }: SetMemberRoleVariables) =>
      setMemberRole(circleId, userId, role),
    onSuccess: (result, variables) => {
      // Enum only: no circle id, no member id (founder rule on new events).
      if (result?.changed !== false) Analytics.memberRoleChanged(variables.role);
      // The toast lives here, not in the two surfaces that offer the action
      // (Members page, Home care team), so they can never word it differently.
      showToast(
        variables.role === 'manager'
          ? t('manage.madeManager', { name: variables.name })
          : t('manage.removedManager', { name: variables.name }),
        'success'
      );
      invalidateCircleQueries(queryClient, circleId);
    },
    onError: (error: unknown) => {
      Analytics.errorOccurred('members', 'members_update_failed', failureContext('members', 'update', error));
      const code = (error as { error?: { code?: string } } | null)?.error?.code;
      if (isSubscriptionRequiredError(error)) {
        promptUpgrade();
        invalidateCircleAccessFlags(queryClient, circleId);
      } else if (code === 'FEATURE_DISABLED') {
        showToast(t('errors.managerUnavailable'), 'error');
      } else if (code === 'CARE_RECIPIENT_CANNOT_MANAGE') {
        showToast(t('errors.careRecipientCannotManage'), 'error');
      } else if (code === 'VIEW_ONLY_CANNOT_MANAGE') {
        showToast(t('errors.viewOnlyCannotManage'), 'error');
      } else if (code === 'CIRCLE_ARCHIVED') {
        showToast(t('errors.circleInactive'), 'error');
      } else if (isPermissionDeniedError(error)) {
        showToast(t('errors.permissionDenied'), 'error');
        invalidateCircleAccessFlags(queryClient, circleId);
      } else {
        showToast(t('errors.saveFailed'), 'error');
      }
      invalidateCircleQueries(queryClient, circleId);
    },
  });
}
