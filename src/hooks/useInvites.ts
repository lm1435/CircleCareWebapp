import {
  useMutation,
  useQuery,
  useQueryClient,
  type UseMutationResult,
  type UseQueryResult,
} from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import {
  acceptInvite,
  cancelInvite,
  createInvite,
  getPendingInvites,
  type CreateInviteRequest,
  type CreateInviteResponse,
  type PendingInvite,
} from '@/api/invites';
import { queryKeys } from '@/lib/queryKeys';
import { isPermissionDeniedError, isSubscriptionRequiredError } from '@/lib/apiErrors';
import { useToast } from '@/components/ui';
import { Analytics } from '@/lib/analytics';

// Plan Stage 5, Task 5.2 — invite mutations + pending-invites query.
//
// Mirrors the SHIPPED mutation pattern in useMedConfirmation.ts /
// useCalendarEvents.ts: mutationFn → onSuccess invalidates the same query
// families mobile's hooks invalidate (reuse queryKeys, do NOT invent shapes) →
// onError distinguishes 402 SUBSCRIPTION_REQUIRED (web cannot transact → point
// the user at the app) from a 403 permission rejection, from a generic failure.

/**
 * Shared onError for invite mutations. On a 402 the free-tier caregiver cap was
 * hit (≥2 caregivers) — web cannot purchase, so we surface the "open the app to
 * upgrade" toast. On a 403 (owner-only / inviter-only) we surface a permission
 * toast and refetch circles so stale access flags refresh.
 */
function useInviteMutationOnError(): (error: unknown) => void {
  const queryClient = useQueryClient();
  const { showToast } = useToast();
  const { t } = useTranslation('members');

  return (error: unknown) => {
    if (isSubscriptionRequiredError(error)) {
      showToast(t('errors.subscriptionRequired'), 'error');
      void queryClient.invalidateQueries({ queryKey: queryKeys.circles });
    } else if (isPermissionDeniedError(error)) {
      showToast(t('errors.permissionDenied'), 'error');
      void queryClient.invalidateQueries({ queryKey: queryKeys.circles });
    } else {
      showToast(t('errors.saveFailed'), 'error');
    }
  };
}

/**
 * POST /circles/:circleId/invites — send an invite (owner only).
 * 402 SUBSCRIPTION_REQUIRED (free-tier caregiver cap) is handled in onError.
 */
export function useCreateInvite(
  circleId: string
): UseMutationResult<CreateInviteResponse, unknown, CreateInviteRequest> {
  const queryClient = useQueryClient();
  const onError = useInviteMutationOnError();

  return useMutation({
    mutationFn: (data: CreateInviteRequest) => createInvite(circleId, data),
    onSuccess: (_response, variables) => {
      // PHI-safe: only circle_id + the member_type role enum (never the email).
      Analytics.inviteSent(circleId, variables.member_type);
      // A new pending invite changes the circle detail (pending_invites list) and
      // the circle summary (member/invite counts).
      void queryClient.invalidateQueries({ queryKey: queryKeys.circle(circleId) });
      void queryClient.invalidateQueries({ queryKey: queryKeys.circleDetail(circleId) });
      void queryClient.invalidateQueries({ queryKey: queryKeys.circles });
    },
    onError: (error: unknown) => {
      // PHI-safe: only circle_id + the backend error CODE (or a generic fallback).
      const code = (error as { error?: { code?: string } } | null)?.error?.code;
      Analytics.inviteFailed(circleId, code ?? 'INVITE_FAILED');
      onError(error);
    },
  });
}

export interface CancelInviteVariables {
  inviteId: string;
}

/** DELETE /invites/:inviteId — inviter/owner cancels a pending invite. */
export function useCancelInvite(
  circleId: string
): UseMutationResult<void, unknown, CancelInviteVariables> {
  const queryClient = useQueryClient();
  const onError = useInviteMutationOnError();

  return useMutation({
    mutationFn: ({ inviteId }: CancelInviteVariables) => cancelInvite(inviteId),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: queryKeys.circle(circleId) });
      void queryClient.invalidateQueries({ queryKey: queryKeys.circleDetail(circleId) });
      void queryClient.invalidateQueries({ queryKey: queryKeys.circles });
    },
    onError,
  });
}

export interface AcceptInviteVariables {
  inviteId: string;
}

/**
 * POST /invites/:inviteId/accept — the invitee accepts. Accepting adds the user
 * to a new circle and clears the invite from their pending list.
 */
export function useAcceptInvite(): UseMutationResult<void, unknown, AcceptInviteVariables> {
  const queryClient = useQueryClient();
  const onError = useInviteMutationOnError();

  return useMutation({
    mutationFn: ({ inviteId }: AcceptInviteVariables) => acceptInvite(inviteId),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: queryKeys.invitesPending });
      void queryClient.invalidateQueries({ queryKey: queryKeys.circles });
    },
    onError,
  });
}

/** GET /invites/pending — invites addressed to the current user. */
export function usePendingInvites(): UseQueryResult<PendingInvite[]> {
  return useQuery({
    queryKey: queryKeys.invitesPending,
    queryFn: getPendingInvites,
  });
}
