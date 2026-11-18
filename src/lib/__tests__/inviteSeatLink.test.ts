import { getInviteCapDetails, getPendingInviteSeat } from '@/lib/apiErrors';
import { getInviteSeatPrecheck } from '@/lib/inviteSeatPrecheck';
import { readDeclineError } from '@/lib/inviteDecline';

// 1.4.3: a SHARED-LINK invite (invited_email null) can hold the free seat.
const owner = { id: 'u1', is_care_recipient: false, view_only: false } as any;
const live = () => new Date(Date.now() + 86400000).toISOString();
const seat402 = (blocking: unknown) => ({
  success: false,
  error: { code: 'SUBSCRIPTION_REQUIRED', message: 'x', details: { reason: 'pending_invite_seat', blocking_invite: blocking } },
});

describe('seat held by a shared-link invite (1.4.3)', () => {
  it('LS-P1: a 402 whose blocking invite has a null address reads as link, not unknown', () => {
    expect(getPendingInviteSeat(seat402({ id: 'i1', invited_email: null }))).toEqual({ email: null, link: true });
    expect(getInviteCapDetails(seat402({ id: 'i1', invited_email: null }))?.blocking_invite).toEqual({
      id: 'i1',
      invited_email: null,
    });
  });

  it('LS-N1: a named email invite is NOT a link; a missing blocking invite is NOT a link', () => {
    expect(getPendingInviteSeat(seat402({ id: 'i1', invited_email: 'a@b.com' }))).toEqual({ email: 'a@b.com', link: false });
    expect(getPendingInviteSeat(seat402(null))).toEqual({ email: null, link: false });
    // A malformed address (a number) is dropped, never treated as a link.
    expect(getPendingInviteSeat(seat402({ id: 'i1', invited_email: 42 }))).toEqual({ email: null, link: false });
  });

  it('LS-P2: the pre-check names a live link invite as the blocker', () => {
    const circle = {
      members: [owner],
      pending_invites: [{ id: 'p1', invited_email: null, created_at: '2026-11-17T00:00:00Z', expires_at: live(), member_type: 'caregiver' }],
    };
    expect(getInviteSeatPrecheck(circle as any)).toMatchObject({
      atLimit: true,
      reason: 'pending_invite_seat',
      blockingEmail: null,
      blockingIsLink: true,
    });
  });

  it('LS-N2: an email blocker is not a link, and no blocker at all is not a link', () => {
    const emailCircle = {
      members: [owner],
      pending_invites: [{ id: 'p1', invited_email: 'b@x.com', created_at: '2026-11-17T00:00:00Z', expires_at: live(), member_type: 'caregiver' }],
    };
    expect(getInviteSeatPrecheck(emailCircle as any).blockingIsLink).toBe(false);
    expect(getInviteSeatPrecheck({ members: [owner], pending_invites: [] } as any).blockingIsLink).toBe(false);
  });
});

describe('decline by code refusals (1.4.3)', () => {
  it('LD-N1: NOT_INVITEE (inviter/member) reads as its own enum with the generic copy', () => {
    expect(readDeclineError({ error: { code: 'NOT_INVITEE' } })).toEqual({
      code: 'NOT_INVITEE',
      messageKey: 'declineErrorGeneric',
      refetch: true,
    });
  });
});
