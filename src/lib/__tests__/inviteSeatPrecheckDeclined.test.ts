import { getInviteSeatPrecheck } from '@/lib/inviteSeatPrecheck';

// 1.4.3: a declined invite holds no seat (backend counts pending rows only), so
// `declined_invites` must never move the free-tier pre-check.
const owner = { id: 'u1', is_care_recipient: false, view_only: false } as any;
const declined = {
  id: 'd1',
  invited_email: 'ana@example.com',
  member_type: 'caregiver',
  created_at: '2026-11-17T21:04:00.000Z',
  status: 'declined',
  declined_at: null,
};

describe('getInviteSeatPrecheck with declined invites', () => {
  it('N: declined rows do not count toward the seat cap', () => {
    const circle = { members: [owner], pending_invites: [], declined_invites: [declined, { ...declined, id: 'd2' }] };
    expect(getInviteSeatPrecheck(circle as any)).toMatchObject({
      atLimit: false,
      livePendingCaregiverInvites: 0,
    });
  });

  it('P: a live pending caregiver invite still fills the free seat', () => {
    const circle = {
      members: [owner],
      pending_invites: [
        { id: 'p1', invited_email: 'b@example.com', created_at: '2026-11-17T00:00:00Z', expires_at: new Date(Date.now() + 86400000).toISOString(), member_type: 'caregiver' },
      ],
      declined_invites: [declined],
    };
    expect(getInviteSeatPrecheck(circle as any)).toMatchObject({ atLimit: true, reason: 'pending_invite_seat', blockingEmail: 'b@example.com' });
  });
});
