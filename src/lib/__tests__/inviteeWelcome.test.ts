import {
  clearPendingInviteeWelcome,
  inviteeWelcomePath,
  peekPendingInviteeWelcome,
  recordPendingInviteeWelcome,
  toInviteeWelcome,
} from '@/lib/inviteeWelcome';

beforeEach(() => sessionStorage.clear());

describe('toInviteeWelcome', () => {
  it('maps the invite into a caregiver welcome with a trimmed first name', () => {
    expect(
      toInviteeWelcome({ inviterName: ' Sam ', recipientName: 'Rose', memberType: 'caregiver' })
    ).toEqual({ inviter: 'Sam', recipient: 'Rose', role: 'caregiver', self: false });
  });

  it('view_only comes from the accept response; no inviter name -> null', () => {
    expect(toInviteeWelcome({ inviterName: null, recipientName: 'Rose', viewOnly: true })).toEqual({
      inviter: null,
      recipient: 'Rose',
      role: 'view_only',
      self: false,
    });
    expect(toInviteeWelcome({ inviterName: '  ', recipientName: 'Rose' }).inviter).toBeNull();
  });

  it('a care_recipient invite is the self-care variant', () => {
    expect(toInviteeWelcome({ recipientName: 'Rose', memberType: 'care_recipient' }).self).toBe(true);
  });
});

describe('pending invitee welcome store', () => {
  it('records per user + circle and peeks without clearing', () => {
    expect(recordPendingInviteeWelcome('u1', 'c1', { inviterName: 'Sam', recipientName: 'Rose' })).toBe(true);
    expect(peekPendingInviteeWelcome('u1', 'c1')?.inviter).toBe('Sam');
    expect(peekPendingInviteeWelcome('u1', 'c1')?.inviter).toBe('Sam');
    // Other user / other circle never see it.
    expect(peekPendingInviteeWelcome('u2', 'c1')).toBeNull();
    expect(peekPendingInviteeWelcome('u1', 'c2')).toBeNull();
  });

  it('clear consumes it (once only)', () => {
    recordPendingInviteeWelcome('u1', 'c1', { recipientName: 'Rose' });
    clearPendingInviteeWelcome('u1', 'c1');
    expect(peekPendingInviteeWelcome('u1', 'c1')).toBeNull();
  });

  it('refuses to record without a user or circle (nothing to key on)', () => {
    expect(recordPendingInviteeWelcome(undefined, 'c1', { recipientName: 'R' })).toBe(false);
    expect(recordPendingInviteeWelcome('u1', null, { recipientName: 'R' })).toBe(false);
    expect(sessionStorage.length).toBe(0);
  });

  it('survives corrupt storage and an unavailable storage', () => {
    sessionStorage.setItem('cc:inviteeWelcome:u1:c1', '{not json');
    expect(peekPendingInviteeWelcome('u1', 'c1')).toBeNull();
    const spy = vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new Error('denied');
    });
    expect(recordPendingInviteeWelcome('u1', 'c1', { recipientName: 'R' })).toBe(false);
    spy.mockRestore();
  });

  it('builds the route', () => {
    expect(inviteeWelcomePath('abc')).toBe('/circles/abc/welcome');
  });
});
