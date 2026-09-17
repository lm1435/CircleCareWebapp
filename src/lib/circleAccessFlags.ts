import type { QueryClient } from '@tanstack/react-query';
import { queryKeys } from '@/lib/queryKeys';

/**
 * The circle's write-access flags live in TWO caches, and a rejection makes
 * BOTH stale — so every "the server said no, refresh the gating flags" branch
 * must refresh both. This is the one function that does it.
 *
 *   `queryKeys.circles` (`['circles']`)
 *     GET /circles. Carries `can_edit`, `view_only`, `is_premium_circle`, AND
 *     the one flag the detail response does not have at all — `read_only` (the
 *     owner's non-selected free-tier circle).
 *     Read by `components/meds/TodaysMeds.tsx` and `useCircle().readOnly`.
 *
 *     `is_premium_circle` IS ALSO ON THE DETAIL RESPONSE — this comment used to
 *     group it with `read_only` as list-only, and it is not
 *     (`backend/src/routes/circles.ts` puts it on GET /circles/:circleId, and
 *     `api/circleMembers.ts` has always typed it on `CircleDetail`). That false
 *     belief is why the AI entry gate was built on `can_edit` instead of the
 *     flag the backend actually gates on; see `src/lib/aiAccess.ts`.
 *
 *   `queryKeys.circleDetail` (`['circle', circleId]`)
 *     GET /circles/:circleId. This is where `useCircle().canEdit` comes from
 *     (`useCircleMembers` → `circle.can_edit ?? false`), which is the gate
 *     behind every write affordance in the app: the Add menu, every masthead
 *     Add action, Edit/Delete menus, the Done button, Take/Skip, note
 *     composers, upload, and the `!canEdit → return null` guards inside
 *     `AddEventModal` and `VitalFormModal`.
 *
 * WHY THIS EXISTS. `['circles']` does not prefix-match `['circle', id]` —
 * different root key (plural vs singular; see the comment on
 * `queryKeys.circleDetail`). Every rejection handler used to invalidate only
 * the list, so a 403 refreshed the cache that almost nothing gates on. A
 * view-only member (or anyone on a frozen non-selected circle) kept being
 * offered Edit / Delete / Done / Take for the rest of the session: each click
 * 403'd again and an optimistic row flipped back — a working-looking app that
 * silently refuses every write.
 *
 * Pinned by `src/hooks/__tests__/viewOnlyGateRefresh.test.tsx` (behaviour) and
 * `src/__tests__/bans/circleAccessFlagRefresh.test.ts` (drift).
 *
 * `circleId` is optional for the one caller that genuinely has no circle yet:
 * an invitee accepting an invite (`useAcceptInvite`) is not a member of the
 * target circle, so there is no `['circle', id]` entry to refresh. Every
 * circle-scoped write MUST pass it.
 */
export function invalidateCircleAccessFlags(queryClient: QueryClient, circleId?: string): void {
  void queryClient.invalidateQueries({ queryKey: queryKeys.circles });
  if (circleId) {
    void queryClient.invalidateQueries({ queryKey: queryKeys.circleDetail(circleId) });
  }
}
