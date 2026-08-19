import { apiClient } from '@/lib/api';

// GET /circles/:circleId — circle detail including the members array.
// Members are NOT included in the GET /circles list response, so this module
// exists per plan Task 36. Shape verified against backend/src/routes/circles.ts
// (GET /:circleId handler). The apiClient response interceptor unwraps axios'
// `response.data`, so the value resolves to the `{ success, data }` envelope.

export interface CircleMember {
  id: string;
  email: string;
  first_name: string | null;
  last_name: string | null;
  role: 'owner' | 'member';
  is_care_recipient: boolean;
  is_medication_responsible: boolean;
  /** ISO timestamp (timestamptz) or date-only string — format defensively. */
  joined_at: string;
  timezone: string | null;
  /**
   * Membership-level view-only flag (freemium caregiver cap).
   * NOTE: the backend currently does NOT return this per member on
   * GET /circles/:circleId (only the requester's own `view_only` at the
   * circle level). Optional so the UI indicator lights up if/when the
   * backend adds it to the members select.
   */
  view_only?: boolean;
}

/**
 * A pending invite returned on the circle detail (`pending_invites`). Only the
 * inviter/owner perspective — shape from backend/src/routes/circles.ts GET
 * /:circleId (`select('id, invited_email, created_at, expires_at')`).
 */
export interface PendingCircleInvite {
  id: string;
  invited_email: string;
  created_at: string;
  expires_at: string;
  /**
   * Server-computed expiry flag (backend/src/routes/circles.ts GET /:circleId).
   * Expired invites are INCLUDED in `pending_invites`, so this is the only way
   * to tell them apart. OPTIONAL for staged-rollout safety: a web build can
   * reach a backend that predates the field, so consumers must fall back to
   * `isPendingInviteExpired()` rather than treating `undefined` as "live".
   */
  is_expired?: boolean;
}

const DAY_MS = 24 * 60 * 60 * 1000;

/** How close to `expires_at` an invite has to be before we warn the owner. */
export const INVITE_EXPIRING_SOON_MS = 3 * DAY_MS;

/**
 * Lifecycle of a pending invite from the owner's point of view.
 *  - `expired` — lapsed; nobody can join through it any more.
 *  - `soon`    — still usable, but lapses in under 3 days.
 *  - `live`    — comfortably in date (or the deadline is unknown).
 */
export type InviteExpiryState = 'expired' | 'soon' | 'live';

export interface InviteExpiry {
  state: InviteExpiryState;
  /**
   * Whole days remaining, floor 1 (an invite with 4 hours left reads as
   * "1 day", never "0 days"). `null` when there is nothing honest to show:
   * the invite has already expired, `expires_at` is missing/unparseable, or
   * the server says the invite is live while the local clock says otherwise.
   */
  daysLeft: number | null;
}

/**
 * The ONE place the pending-invite expiry rule lives. Prefers the
 * server-computed `is_expired` (the two clocks can disagree); falls back to
 * comparing `expires_at` against the browser clock when the backend has not
 * shipped the field yet. An absent or unparseable `expires_at` is treated as
 * live — a formatting problem must never make a usable invite look dead.
 *
 * `daysLeft` is a DURATION (plain ms arithmetic), not a calendar date, so it
 * deliberately does not go through any date/timezone helper.
 */
export function getInviteExpiryState(invite: PendingCircleInvite): InviteExpiry {
  const expiresAtMs = new Date(invite.expires_at).getTime();
  // NaN for a missing/garbage `expires_at`; every comparison below is false,
  // which lands on `live` with an unknown countdown.
  const msUntilExpiry = expiresAtMs - Date.now();

  const expired =
    typeof invite.is_expired === 'boolean' ? invite.is_expired : msUntilExpiry <= 0;
  if (expired) return { state: 'expired', daysLeft: null };

  const daysLeft = msUntilExpiry > 0 ? Math.max(1, Math.ceil(msUntilExpiry / DAY_MS)) : null;
  if (msUntilExpiry > 0 && msUntilExpiry < INVITE_EXPIRING_SOON_MS) {
    return { state: 'soon', daysLeft };
  }
  return { state: 'live', daysLeft };
}

/**
 * True when a pending invite has lapsed. Thin wrapper over
 * `getInviteExpiryState` so the rule is never duplicated.
 */
export function isPendingInviteExpired(invite: PendingCircleInvite): boolean {
  return getInviteExpiryState(invite).state === 'expired';
}

export interface CircleDetail {
  id: string;
  name: string;
  recipient_name: string;
  recipient_photo_url: string | null;
  recipient_dob: string | null;
  // Backend stores this as an array of condition strings (circles route:
  // recipient_conditions = z.array(z.string())), NOT a free-text string.
  recipient_conditions: string[] | null;
  owner_id: string;
  created_at: string;
  is_self_care: boolean;
  care_recipient_timezone: string;
  members: CircleMember[];
  /** Pending invites for this circle (owner/inviter perspective). Optional —
   *  only returned to owners; consumers default to []. */
  pending_invites?: PendingCircleInvite[];
  // Subscription-aware access info (requester's perspective)
  access_level: 'full' | 'edit' | 'view';
  is_premium_circle: boolean;
  can_edit: boolean;
  view_only: boolean;
}

interface CircleDetailEnvelope {
  success: boolean;
  data: { circle: CircleDetail };
}

export async function getCircleDetail(circleId: string): Promise<CircleDetail> {
  const response = (await apiClient.get(
    `/circles/${circleId}`
  )) as unknown as CircleDetailEnvelope;
  return response.data.circle;
}

// ===========================================================================
// Member-management WRITE functions (plan Stage 5, Task 5.1)
// ---------------------------------------------------------------------------
// Mirrors mobile/src/api/circles.ts (removeMember, leaveCircle) + mobile's
// useSetMedicationResponsible hook. Backend contracts verified against
// backend/src/routes/circles.ts:
//   - DELETE /circles/:circleId/members/:userId  (requireAuth, owner kicks).
//   - POST   /circles/:circleId/leave            (requireAuth, owner blocked).
//   - PUT    /circles/:circleId/medication-responsible (requireAuth, owner)
//       body { userId: uuid | null } — null clears the assignment.
// All return the `{ success, data }` envelope (unwrapped by the interceptor);
// these write helpers don't need the payload, so they resolve to void.
// ===========================================================================

/** DELETE /circles/:circleId/members/:userId — owner removes a member. */
export async function removeMember(circleId: string, userId: string): Promise<void> {
  await apiClient.delete(`/circles/${circleId}/members/${userId}`);
}

/** POST /circles/:circleId/leave — current member voluntarily leaves (owner blocked). */
export async function leaveCircle(circleId: string): Promise<void> {
  await apiClient.post(`/circles/${circleId}/leave`);
}

/**
 * PUT /circles/:circleId/medication-responsible — owner sets or clears the
 * medication-responsible member. Pass `null` to clear the assignment.
 */
export async function setMedicationResponsible(
  circleId: string,
  userId: string | null
): Promise<void> {
  await apiClient.put(`/circles/${circleId}/medication-responsible`, { userId });
}
