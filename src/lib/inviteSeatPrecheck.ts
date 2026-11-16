import { isPendingInviteExpired, type CircleDetail } from '@/api/circleMembers';

/**
 * Free-tier caregiver seat PRE-CHECK for the invite modal — the client half of
 * the backend's create-invite gate (backend/src/routes/invites.ts, POST
 * /:circleId/invites), so a free owner sees the cap BEFORE filling the form
 * instead of being refused with a 402 on submit.
 *
 * THE SAME RULE AS THE BACKEND:
 *   active  = members with is_care_recipient false AND view_only false
 *             (getActiveCaregiversCount; includes the owner)
 *   pending = pending_invites with member_type 'caregiver' that have NOT
 *             expired (getLivePendingCaregiverInvites: status 'pending',
 *             expires_at > now — GET /circles/:id serves status 'pending' only
 *             and the server's `is_expired` flag)
 *   blocked when active + pending >= limit (2: owner + 1)
 *
 * `reason` mirrors the backend's `describeSeatBlock`: the oldest live pending
 * invite is named ONLY when cancelling it would actually free a seat
 * (active < limit); otherwise the circle is full of members.
 *
 * `member_type` absent (an older backend) reads as 'caregiver', the create
 * route's default. The tier half (free vs premium) stays with the caller.
 * Mobile twin: mobile/src/utils/inviteSeatPrecheck.ts.
 */
export const FREE_TIER_CAREGIVER_LIMIT = 2;

export type InviteSeatPrecheckReason = 'pending_invite_seat' | 'members_full';

export interface InviteSeatPrecheck {
  atLimit: boolean;
  reason: InviteSeatPrecheckReason | null;
  activeCaregivers: number;
  livePendingCaregiverInvites: number;
  /** Email of the invite holding the seat (reason 'pending_invite_seat' only). */
  blockingEmail: string | null;
}

export function getInviteSeatPrecheck(
  circle: Pick<CircleDetail, 'members' | 'pending_invites'> | undefined | null
): InviteSeatPrecheck {
  const activeCaregivers = (circle?.members ?? []).filter(
    (m) => !m.is_care_recipient && !m.view_only
  ).length;
  const livePending = (circle?.pending_invites ?? [])
    .filter((i) => (i.member_type ?? 'caregiver') === 'caregiver' && !isPendingInviteExpired(i))
    .slice()
    .sort((a, b) => String(a.created_at ?? '').localeCompare(String(b.created_at ?? '')));

  const atLimit = activeCaregivers + livePending.length >= FREE_TIER_CAREGIVER_LIMIT;
  const blocking =
    atLimit && activeCaregivers < FREE_TIER_CAREGIVER_LIMIT ? livePending[0] : undefined;
  return {
    atLimit,
    reason: !atLimit ? null : blocking ? 'pending_invite_seat' : 'members_full',
    activeCaregivers,
    livePendingCaregiverInvites: livePending.length,
    blockingEmail: blocking?.invited_email || null,
  };
}
