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
  viewer_role?: string | null;
  viewer_permissions?: ReadonlyArray<string> | null;
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

// ===========================================================================
// MEMBER MANAGEMENT (manager role, docs/plans/manager-role.md)
// ---------------------------------------------------------------------------
// The backend serves `viewer_role` + `viewer_permissions` on GET /circles and
// GET /circles/:id, and the client READS them -- it never works permissions
// out itself. Web port of mobile's `viewerCanManageMembers`.
//
// Owning a circle is NOT the same as managing its members any more: a Manager
// (Premium, owner-picked) can invite, resend/cancel invites, see the pending
// list and remove plain members, while circle settings, medication reminders,
// billing and the role itself stay with the owner. Every premium CTA still
// keys on `viewerOwnsCircle` -- a manager is never sold a paywall.
// ===========================================================================

/**
 * May the viewer invite / cancel / resend invites / remove members here?
 *
 * `viewer_permissions` present -> it is the answer (an empty array means no).
 * Absent (a backend older than the manager role) -> the owner test, which is
 * exactly what that backend enforces.
 */
export function viewerCanManageMembers(
  circle: CircleOwnershipFields | null | undefined,
  userId: string | null | undefined
): boolean {
  if (circle == null) return false;
  if (Array.isArray(circle.viewer_permissions)) {
    return circle.viewer_permissions.includes('manage_members');
  }
  return viewerOwnsCircle(circle, userId);
}

/**
 * May the viewer make / remove managers? Only from `viewer_permissions` --
 * there is NO ownership fallback: an older backend (or the switch off) has no
 * role endpoint, so the item must not appear at all. Served to a free owner
 * too; the endpoint's 402 then routes to the owner's upgrade path.
 */
export function viewerCanAssignManager(
  circle: CircleOwnershipFields | null | undefined,
  userId: string | null | undefined
): boolean {
  if (!viewerOwnsCircle(circle, userId)) return false;
  return circle?.viewer_permissions?.includes('assign_manager') === true;
}

/**
 * May the invite form tell the viewer "after they join, you can make them a
 * manager"? The OWNER, while the server offers `assign_manager`, on a PREMIUM
 * circle only: `assign_manager` is served to a free owner too, and the invite
 * flow must never become a paywall upsell. `is_premium_circle` is the owner's
 * tier as the server computes it (never false for the owner's own row, which
 * is never a view-only seat). Mobile parity: InviteMemberScreen
 * `showManagerHint`. The caller still hides it for a care-recipient invite.
 */
export function viewerCanSuggestManager(
  circle: (CircleOwnershipFields & { is_premium_circle?: boolean | null }) | null | undefined,
  userId: string | null | undefined
): boolean {
  return viewerCanAssignManager(circle, userId) && circle?.is_premium_circle === true;
}

/** The viewer's role, for analytics (`actor_role`) and copy. */
export function viewerCircleRole(
  circle: CircleOwnershipFields | null | undefined,
  userId: string | null | undefined
): 'owner' | 'manager' | 'member' {
  if (viewerOwnsCircle(circle, userId)) return 'owner';
  if (circle?.viewer_role === 'manager' && viewerCanManageMembers(circle, userId)) {
    return 'manager';
  }
  return 'member';
}

/** The row being acted on. `CircleMember` satisfies it. */
export interface MemberTargetFields {
  id: string;
  role: string;
  is_care_recipient: boolean;
  view_only?: boolean;
  is_medication_responsible?: boolean;
}

export interface MemberRowActions {
  /** Remove from the circle. */
  remove: boolean;
  /** Set / clear the medication-responsible member (owner only). */
  medResponsible: boolean;
  /** Make manager / Remove as manager (owner only, `assign_manager`). */
  managerRole: boolean;
}

const NO_ACTIONS: MemberRowActions = { remove: false, medResponsible: false, managerRole: false };

/**
 * Which per-member actions to offer on one row. ONE rule for MembersPage and
 * the Home care team, so the two can never disagree.
 *
 *   - Nobody acts on their own row, the owner's row, or the care recipient's
 *     (the owner never could; a manager may not do more than the owner).
 *   - Owner: medication reminders on every other row EXCEPT a view-only seat
 *     (it receives no notifications; the backend refuses it with
 *     RESPONSIBLE_MEMBER_VIEW_ONLY) -- unless that seat is ALREADY responsible,
 *     so the owner can still clear it; Remove on every other row (other
 *     managers included); Make/Remove manager when the server says
 *     `assign_manager`, never on a view-only seat (the backend refuses it).
 *   - Manager: Remove on PLAIN members only -- never another manager.
 *   - Member: nothing.
 */
export function memberRowActions(
  circle: CircleOwnershipFields | null | undefined,
  userId: string | null | undefined,
  member: MemberTargetFields
): MemberRowActions {
  if (userId == null || circle == null) return NO_ACTIONS;
  if (member.id === userId || member.role === 'owner' || member.is_care_recipient) {
    return NO_ACTIONS;
  }
  if (viewerOwnsCircle(circle, userId)) {
    return {
      remove: true,
      medResponsible: member.view_only !== true || member.is_medication_responsible === true,
      managerRole:
        viewerCanAssignManager(circle, userId) &&
        (member.role === 'manager' || member.view_only !== true),
    };
  }
  if (viewerCanManageMembers(circle, userId)) {
    return { remove: member.role === 'member', medResponsible: false, managerRole: false };
  }
  return NO_ACTIONS;
}
