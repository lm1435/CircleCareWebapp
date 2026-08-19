import {
  getInviteExpiryState,
  isPendingInviteExpired,
  INVITE_EXPIRING_SOON_MS,
} from '@/api/circleMembers';
import type { PendingCircleInvite } from '@/api/circleMembers';

// The expiry rule lives in ONE place (getInviteExpiryState); the owner-side
// pending-invite row, the solo-owner nudge and the getting-started checklist
// all read it through this module. These tests pin the rule itself so a UI
// refactor can never quietly change what "expired" or "expiring soon" means.

const DAY = 24 * 60 * 60 * 1000;
const NOW = new Date('2026-06-10T12:00:00.000Z').getTime();

function makeInvite(overrides: Partial<PendingCircleInvite> = {}): PendingCircleInvite {
  return {
    id: 'inv-1',
    invited_email: 'pending@example.com',
    created_at: '2026-06-01T00:00:00Z',
    expires_at: new Date(NOW + 7 * DAY).toISOString(),
    ...overrides,
  };
}

/** `expires_at` exactly `ms` from the frozen now. */
function expiringIn(ms: number, overrides: Partial<PendingCircleInvite> = {}): PendingCircleInvite {
  return makeInvite({ expires_at: new Date(NOW + ms).toISOString(), ...overrides });
}

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(NOW);
});

afterEach(() => {
  vi.useRealTimers();
});

describe('getInviteExpiryState', () => {
  it('exposes the 3-day warning window as a constant', () => {
    expect(INVITE_EXPIRING_SOON_MS).toBe(3 * DAY);
  });

  it('is expired when the server flag says so, even with a future expires_at', () => {
    expect(getInviteExpiryState(expiringIn(7 * DAY, { is_expired: true }))).toEqual({
      state: 'expired',
      daysLeft: null,
    });
  });

  it('is expired by date when the backend omits is_expired', () => {
    expect(getInviteExpiryState(expiringIn(-1 * DAY))).toEqual({
      state: 'expired',
      daysLeft: null,
    });
  });

  it('is expired at the exact moment expires_at is reached', () => {
    expect(getInviteExpiryState(expiringIn(0)).state).toBe('expired');
  });

  it('trusts is_expired:false over a local clock that says the invite lapsed', () => {
    // Clock skew / a stale device clock must not fake an expiry the server
    // disagrees with. No countdown is invented for the contradiction.
    expect(getInviteExpiryState(expiringIn(-30 * DAY, { is_expired: false }))).toEqual({
      state: 'live',
      daysLeft: null,
    });
  });

  it('is live at exactly 3 days out (boundary is exclusive)', () => {
    expect(getInviteExpiryState(expiringIn(3 * DAY))).toEqual({ state: 'live', daysLeft: 3 });
  });

  it('is soon just inside the 3-day boundary', () => {
    expect(getInviteExpiryState(expiringIn(3 * DAY - 1)).state).toBe('soon');
  });

  it('is soon with 2 days left', () => {
    expect(getInviteExpiryState(expiringIn(2 * DAY))).toEqual({ state: 'soon', daysLeft: 2 });
  });

  it('is soon with exactly 1 day left', () => {
    expect(getInviteExpiryState(expiringIn(1 * DAY))).toEqual({ state: 'soon', daysLeft: 1 });
  });

  it('rounds a sub-24h remainder UP to 1 day rather than down to 0', () => {
    expect(getInviteExpiryState(expiringIn(90 * 60 * 1000))).toEqual({
      state: 'soon',
      daysLeft: 1,
    });
    // One millisecond left is still "1 day", never "0 days".
    expect(getInviteExpiryState(expiringIn(1))).toEqual({ state: 'soon', daysLeft: 1 });
  });

  it('rounds a partial day UP (3.5 days reads as 4)', () => {
    expect(getInviteExpiryState(expiringIn(3 * DAY + DAY / 2))).toEqual({
      state: 'live',
      daysLeft: 4,
    });
  });

  it('is live well outside the window', () => {
    expect(getInviteExpiryState(expiringIn(7 * DAY))).toEqual({ state: 'live', daysLeft: 7 });
  });

  it('treats an unparseable expires_at as live with no countdown', () => {
    expect(getInviteExpiryState(makeInvite({ expires_at: 'not-a-date' }))).toEqual({
      state: 'live',
      daysLeft: null,
    });
  });

  it('treats a missing expires_at as live with no countdown', () => {
    const invite = makeInvite();
    delete (invite as Partial<PendingCircleInvite>).expires_at;
    expect(getInviteExpiryState(invite)).toEqual({ state: 'live', daysLeft: null });
  });

  it('lets is_expired:true win even over a garbage expires_at', () => {
    expect(getInviteExpiryState(makeInvite({ expires_at: '', is_expired: true })).state).toBe(
      'expired'
    );
  });
});

describe('isPendingInviteExpired', () => {
  it('stays true only for the expired state', () => {
    expect(isPendingInviteExpired(expiringIn(7 * DAY, { is_expired: true }))).toBe(true);
    expect(isPendingInviteExpired(expiringIn(-1 * DAY))).toBe(true);
    // "Soon" is NOT expired — it must not suppress the solo-owner nudge's
    // opposite: a soon-to-lapse invite is still an outstanding invitation.
    expect(isPendingInviteExpired(expiringIn(2 * DAY))).toBe(false);
    expect(isPendingInviteExpired(expiringIn(7 * DAY))).toBe(false);
    expect(isPendingInviteExpired(makeInvite({ expires_at: 'not-a-date' }))).toBe(false);
    expect(isPendingInviteExpired(expiringIn(-30 * DAY, { is_expired: false }))).toBe(false);
  });
});
