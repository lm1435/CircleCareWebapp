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
  resendInvite,
  type CreateInviteRequest,
  type CreateInviteResponse,
  type PendingInvite,
  type ResendInviteResult,
} from '@/api/invites';
import { queryKeys } from '@/lib/queryKeys';
import { invalidateCircleAccessFlags } from '@/lib/circleAccessFlags';
import {
  getPendingInviteSeat,
  isPermissionDeniedError,
  isSubscriptionRequiredError,
} from '@/lib/apiErrors';
import { useToast } from '@/components/ui';
import { usePremiumGate } from '@/hooks/usePremiumGate';
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
 * hit — but the cap splits in two (`error.details.reason`):
 *
 *   - `pending_invite_seat` — the last free seat is held by a still-pending
 *     invite to somebody else. We name that person, because cancelling their
 *     invite frees the seat at no cost — but we still offer Upgrade, since
 *     having spent the only free invitation is itself a legitimate reason to
 *     buy more. This is the "let an invite lapse, spend the freed seat on
 *     someone else, then hit Resend on the old one" case.
 *   - `members_full` (or NO `details` at all — an older backend) — every seat
 *     is taken by a real member, so the generic upgrade prompt is all we can say.
 *
 * Both create and resend route through here so the SAME situation never reads
 * as a paywall on one surface and an explanation on the other.
 *
 * On a 403 (owner-only / inviter-only) we surface a permission toast and
 * refetch circles so stale access flags refresh.
 *
 * `fallbackMessageKey` overrides ONLY the generic catch-all message, so a
 * mutation with more specific copy (resend) still shares every classified
 * branch — and callers never double-toast by adding their own onError.
 */
function useInviteMutationOnError(
  /** Undefined only for `useAcceptInvite` — the invitee has no circle yet. */
  circleId: string | undefined,
  fallbackMessageKey = 'errors.saveFailed'
): (error: unknown) => void {
  const queryClient = useQueryClient();
  const { showToast } = useToast();
  // A seat cap — a hard limit that money lifts. Mobile calls this CAPACITY.
  // The cap is the circle OWNER's tier, so it is owner-aware; `useAcceptInvite`
  // passes no circle (it never answers 402) and keeps the plain gate.
  const { promptUpgrade } = usePremiumGate('capacity', { circleId });
  const { t } = useTranslation('members');

  return (error: unknown) => {
    const code = (error as { error?: { code?: string } } | null)?.error?.code;
    const pendingSeat = getPendingInviteSeat(error);
    if (pendingSeat !== null) {
      // Say WHY the seat is gone -- it is held by a still-pending invite, and
      // cancelling that one frees it for nothing -- but keep the Upgrade action,
      // because having used up the only free seat IS a real reason to buy more.
      // Routing through promptUpgrade keeps this to a single toast carrying both
      // the explanation and the action, rather than two competing ones.
      promptUpgrade(
        pendingSeat.email
          ? t('errors.pendingInviteSeat', { email: pendingSeat.email })
          : t('errors.pendingInviteSeatUnknown')
      );
      invalidateCircleAccessFlags(queryClient, circleId);
    } else if (isSubscriptionRequiredError(error)) {
      promptUpgrade();
      invalidateCircleAccessFlags(queryClient, circleId);
    } else if (isPermissionDeniedError(error)) {
      showToast(t('errors.permissionDenied'), 'error');
      invalidateCircleAccessFlags(queryClient, circleId);
    } else if (code === 'ALREADY_MEMBER') {
      showToast(t('errors.alreadyMember'), 'error');
    } else if (code === 'PENDING_INVITE') {
      showToast(t('errors.pendingInvite'), 'error');
    } else if (code === 'CIRCLE_ARCHIVED') {
      // The circle was deleted — by another member, on another device, or in
      // another tab — and this list is stale. Every invite path now refuses
      // (create, resend, both accepts); "something went wrong, try again" is a
      // retry prompt for something that can never succeed.
      showToast(t('errors.circleArchived'), 'error');
    } else if (code === 'CARE_RECIPIENT_EXISTS') {
      // A second care-recipient invite into a circle that already has one,
      // backstopped by a partial unique index.
      showToast(t('errors.careRecipientExists'), 'error');
    } else {
      showToast(t(fallbackMessageKey), 'error');
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
  const onError = useInviteMutationOnError(circleId);

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
  const onError = useInviteMutationOnError(circleId);

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

export interface ResendInviteVariables {
  inviteId: string;
}

/**
 * POST /invites/:inviteId/resend — inviter/owner revives a lapsed invite.
 *
 * Invalidates the same query families as cancel: the new `expires_at` /
 * `is_expired` live on the circle detail's `pending_invites`, and the circle
 * summary counts live-vs-expired invites.
 *
 * A 402 here means reviving an expired caregiver invite would exceed the
 * free-tier cap. The shared onError classifies it exactly like the create path:
 * `pending_invite_seat` explains which pending invite is holding the seat,
 * anything else prompts the upgrade.
 */
export function useResendInvite(
  circleId: string
): UseMutationResult<ResendInviteResult, unknown, ResendInviteVariables> {
  const queryClient = useQueryClient();
  const onError = useInviteMutationOnError(circleId, 'manage.resendInviteFailed');

  return useMutation({
    mutationFn: ({ inviteId }: ResendInviteVariables) => resendInvite(inviteId),
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
  // No circleId: the invitee is not a member of the target circle yet, so there
  // is no cached circle detail to refresh (see invalidateCircleAccessFlags).
  const onError = useInviteMutationOnError(undefined);

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
