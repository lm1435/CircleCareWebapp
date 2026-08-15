import {
  useMutation,
  useQueryClient,
  type UseMutationResult,
} from '@tanstack/react-query';
import {
  lookupInviteByCode,
  acceptInviteByCode,
  type InviteByCode,
} from '@/api/invites';
import { queryKeys } from '@/lib/queryKeys';

// Join-by-code mutations — web parity with mobile's useLookupInviteByCode /
// useAcceptInviteByCode (mobile/src/hooks/useInvites.ts), consumed by
// JoinCircleModal + InviteLandingPage.
//
// Error handling lives in the calling component (it maps backend error CODES to
// localized copy, mirroring mobile's JoinCircleModal). These hooks stay thin:
// lookup is a read-shaped mutation (so the modal can trigger it on demand and
// read isPending), and accept invalidates the circle list so the newly joined
// circle appears immediately.

/** GET /invites/code/:code — look up an invite by the code the user typed. */
export function useLookupInviteByCode(): UseMutationResult<InviteByCode, unknown, string> {
  return useMutation({
    mutationFn: (code: string) => lookupInviteByCode(code),
  });
}

/**
 * POST /invites/code/:code/accept — join the circle. On success, invalidate the
 * circle list so the picker reflects the new membership right away, AND the
 * pending-invites list (WB5: matches useAcceptInvite's by-id invalidation) —
 * accepting by code can resolve the SAME invite that shows up in
 * `/invites/pending` (e.g. the visitor typed the code instead of tapping the
 * emailed link), which would otherwise keep showing a now-stale "Accept" row.
 */
export function useAcceptInviteByCode(): UseMutationResult<void, unknown, string> {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (code: string) => acceptInviteByCode(code),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: queryKeys.invitesPending });
      void queryClient.invalidateQueries({ queryKey: queryKeys.circles });
    },
  });
}
