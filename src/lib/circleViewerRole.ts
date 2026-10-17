import { queryClient } from '@/lib/queryClient';
import { queryKeys } from '@/lib/queryKeys';
import { viewerCircleRole, viewerOwnsCircle } from '@/lib/premiumOwnership';
import { useAuthStore } from '@/store/authStore';
import type { CircleDetail } from '@/api/circleMembers';

/**
 * The signed-in user's role in `circleId`, read from the circle-detail cache
 * AT CALL TIME (the singleton client, same as `usePremiumGate`). For mutation
 * callbacks — `actor_role` on analytics, owner-vs-manager copy on a 402 — so
 * those hooks add no query observer. Unknown (not cached, signed out) reads as
 * 'member', which every caller treats as "not the owner".
 */
export function cachedViewerRole(circleId: string | null | undefined): 'owner' | 'manager' | 'member' {
  if (!circleId) return 'member';
  const circle = queryClient.getQueryData<CircleDetail>(queryKeys.circleDetail(circleId));
  return viewerCircleRole(circle, useAuthStore.getState().user?.id);
}

/** `cachedViewerRole(circleId) === 'owner'`, spelled out for 402 copy choices. */
export function cachedViewerOwnsCircle(circleId: string | null | undefined): boolean {
  if (!circleId) return false;
  const circle = queryClient.getQueryData<CircleDetail>(queryKeys.circleDetail(circleId));
  return viewerOwnsCircle(circle, useAuthStore.getState().user?.id);
}

/** `actor_role` for invite_sent / member_removed: only the two roles that can act. */
export function cachedActorRole(circleId: string): 'owner' | 'manager' {
  return cachedViewerRole(circleId) === 'manager' ? 'manager' : 'owner';
}
