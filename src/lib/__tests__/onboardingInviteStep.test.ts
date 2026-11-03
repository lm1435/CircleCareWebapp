import { onboardingInviteStepDecision } from '@/lib/onboardingInviteStep';

/** The setup invite step's rule (pricing report 2026-11-02). Mobile: src/utils/onboardingInviteStep. */
const owner = { user_id: 'u1', role: 'owner', is_care_recipient: false, first_name: 'Ana' };
const circle = (over: Record<string, unknown> = {}) =>
  ({
    owner_id: 'u1',
    view_only: false,
    members: [owner],
    pending_invites: [],
    ...over,
  }) as never;

describe('onboardingInviteStepDecision', () => {
  it('a new free circle: show, with the free-plan line', () => {
    expect(onboardingInviteStepDecision({ circle: circle(), userId: 'u1', tier: 'free' })).toEqual({
      show: true,
      freePlanLine: true,
    });
  });

  it('a new premium circle: show, without the free-plan line', () => {
    expect(onboardingInviteStepDecision({ circle: circle(), userId: 'u1', tier: 'premium' })).toEqual({
      show: true,
      freePlanLine: false,
    });
  });

  it('a joined care recipient does not use the free seat: still show', () => {
    const c = circle({ members: [owner, { user_id: 'r', role: 'member', is_care_recipient: true }] });
    expect(onboardingInviteStepDecision({ circle: c, userId: 'u1', tier: 'free' }).show).toBe(true);
  });

  it('an expired caregiver invite does not hold the seat: show', () => {
    const c = circle({
      pending_invites: [
        { id: 'i', invited_email: 'x@example.invalid', created_at: '2020-01-01T00:00:00Z', expires_at: '2020-01-08T00:00:00Z', is_expired: true, member_type: 'caregiver' },
      ],
    });
    expect(onboardingInviteStepDecision({ circle: c, userId: 'u1', tier: 'free' }).show).toBe(true);
  });

  it.each([
    ['unknown circle', { circle: undefined, userId: 'u1', tier: 'free' }],
    ['not the owner', { circle: circle(), userId: 'u2', tier: 'free' }],
    ['signed out', { circle: circle(), userId: null, tier: 'free' }],
    ['view-only seat', { circle: circle({ view_only: true }), userId: 'u1', tier: 'free' }],
    ['tier unknown', { circle: circle(), userId: 'u1', tier: undefined }],
    [
      'a caregiver joined',
      { circle: circle({ members: [owner, { user_id: 'u2', role: 'member', is_care_recipient: false }] }), userId: 'u1', tier: 'free' },
    ],
    [
      'a manager joined',
      { circle: circle({ members: [owner, { user_id: 'u2', role: 'manager', is_care_recipient: false }] }), userId: 'u1', tier: 'premium' },
    ],
    [
      'a live caregiver invite',
      {
        circle: circle({
          pending_invites: [
            { id: 'i', invited_email: 'x@example.invalid', created_at: '2026-11-01T00:00:00Z', expires_at: '2099-01-01T00:00:00Z', member_type: 'caregiver' },
          ],
        }),
        userId: 'u1',
        tier: 'free',
      },
    ],
  ])('no step: %s', (_label, input) => {
    expect(onboardingInviteStepDecision(input as never)).toEqual({ show: false, freePlanLine: false });
  });
});
