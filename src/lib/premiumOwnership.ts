/**
 * WHO MAY BE SOLD A CIRCLE-LEVEL PREMIUM FEATURE. Web port of
 * `mobile/src/services/premiumGate.ts`.
 *
 * A circle's premium status is the OWNER's tier and nobody else's:
 * `backend/src/services/circleAccess.ts` answers `getUserTier(circle.owner_id)`,
 * and the client sees that as `is_premium_circle`. A non-owner member who pays
 * gets their OWN account upgraded while the feature in this circle stays
 * locked -- so every prompt gated on the circle's premium status must branch on
 * ownership before it offers an Upgrade:
 *
 *   - viewer owns the circle -> the Upgrade action (they are the one person who
 *                               can act on it);
 *   - anyone else            -> an informational notice with nothing to buy.
 *
 * Unknown ownership (circle not loaded, no `owner_id`, or no signed-in user) is
 * treated as NOT the owner. Failing closed costs one owner a tap; failing open
 * sells a subscription that unlocks nothing.
 */

/** The fields this module reads. `CircleDetail` satisfies it. */
export interface CircleOwnershipFields {
  owner_id?: string | null;
  view_only?: boolean | null;
  members?: ReadonlyArray<{ role: string; first_name: string | null }> | null;
}

/**
 * `userId != null` FIRST: an absent `owner_id` and a signed-out viewer are two
 * nullish values that must never be read as a match.
 */
export function viewerOwnsCircle(
  circle: CircleOwnershipFields | null | undefined,
  userId: string | null | undefined
): boolean {
  if (userId == null || circle == null) return false;
  if (circle.owner_id == null) return false;
  return circle.owner_id === userId;
}

/**
 * The owner's first name from the member list, for "Only Ana, the circle owner,
 * can upgrade." Undefined when there is no owner row or no usable name -- the
 * caller then shows the nameless copy rather than an empty interpolation.
 */
export function getCircleOwnerName(
  circle: CircleOwnershipFields | null | undefined
): string | undefined {
  const owner = circle?.members?.find((m) => m.role === 'owner');
  const name = owner?.first_name?.trim();
  return name ? name : undefined;
}
