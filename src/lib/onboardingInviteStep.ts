import { isPendingInviteExpired, type CircleDetail } from '@/api/circleMembers';
import { viewerOwnsCircle } from '@/lib/premiumOwnership';

/**
 * The setup invite step (pricing report 2026-11-02, owner-approved): after the first med's
 * payoff and BEFORE the onboarding paywall, the owner is asked once to invite one person. The
 * free plan is owner + 1 caregiver, so this spends a seat the plan already includes. It is never
 * a paywall and never sells anything.
 *
 * PORT of mobile `src/utils/onboardingInviteStep.ts`; same rule, same answer. Shown only when
 * every fact is KNOWN and true (unknown = no step):
 *  - the circle has loaded and the viewer OWNS it;
 *  - not a view-only seat;
 *  - no caregiver is in the circle or invited yet (a live, caregiver-type pending invite counts);
 *  - on the free plan, the caregiver cap is not reached (owner + 1 = 2 non-recipient members).
 *
 * `freePlanLine` decides "Your free plan includes one person.": a free owner only.
 */
export const FREE_PLAN_CAREGIVER_SEATS = 2;

export interface OnboardingInviteStepDecision {
  show: boolean;
  freePlanLine: boolean;
}

export function onboardingInviteStepDecision(input: {
  circle:
    | Pick<CircleDetail, 'owner_id' | 'view_only' | 'members' | 'pending_invites'>
    | null
    | undefined;
  userId: string | null | undefined;
  /** The viewer's (= owner's) tier; undefined while it loads. */
  tier: string | undefined;
}): OnboardingInviteStepDecision {
  const { circle, userId, tier } = input;
  const no = { show: false, freePlanLine: false };
  if (!circle || !Array.isArray(circle.members)) return no;
  if (!viewerOwnsCircle(circle, userId)) return no;
  if (circle.view_only === true) return no;
  if (tier !== 'free' && tier !== 'premium') return no;

  const caregiverJoined = circle.members.some(
    (m) => (m.role === 'member' || m.role === 'manager') && !m.is_care_recipient
  );
  const caregiverPending = (circle.pending_invites ?? []).some(
    (i) => i.member_type !== 'care_recipient' && !isPendingInviteExpired(i)
  );
  if (caregiverJoined || caregiverPending) return no;

  const isFree = tier === 'free';
  if (isFree) {
    const caregivers = circle.members.filter((m) => !m.is_care_recipient).length;
    if (caregivers >= FREE_PLAN_CAREGIVER_SEATS) return no;
  }
  return { show: true, freePlanLine: isFree };
}
