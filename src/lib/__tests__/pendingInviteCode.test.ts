import {
  setPendingInviteCode,
  consumePendingInviteCode,
  peekPendingInviteCode,
  clearPendingInviteCode,
} from '@/lib/pendingInviteCode';

// The pending-invite handoff module — a sessionStorage bridge across the auth
// boundary (OAuth full-page redirects and the signup → verify-email flow both
// lose router state). Backend codes are 6-8 uppercase alphanumeric chars
// (backend/src/routes/invites.ts generateInviteCode).

const STORAGE_KEY = 'cc_pending_invite_code';

describe('pendingInviteCode', () => {
  beforeEach(() => {
    sessionStorage.clear();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('stores a code and consumes it exactly once (get + clear atomically)', () => {
    setPendingInviteCode('ABC234');

    expect(consumePendingInviteCode()).toBe('ABC234');
    // Consumed — a second read must not redirect again.
    expect(consumePendingInviteCode()).toBeNull();
    expect(sessionStorage.getItem(STORAGE_KEY)).toBeNull();
  });

  it('normalizes (trim + uppercase) on set', () => {
    setPendingInviteCode('  abc234 ');

    expect(sessionStorage.getItem(STORAGE_KEY)).toBe('ABC234');
    expect(consumePendingInviteCode()).toBe('ABC234');
  });

  it('accepts the 8-character collision-fallback code format', () => {
    setPendingInviteCode('ABC234XY');
    expect(consumePendingInviteCode()).toBe('ABC234XY');
  });

  it('ignores invalid codes on set', () => {
    setPendingInviteCode('');
    setPendingInviteCode('   ');
    setPendingInviteCode('not a code!');
    setPendingInviteCode('ABC/../234');
    setPendingInviteCode('A'.repeat(33)); // absurd length

    expect(sessionStorage.getItem(STORAGE_KEY)).toBeNull();
    expect(consumePendingInviteCode()).toBeNull();
  });

  it('returns null (and clears) when the stored value is garbage', () => {
    // Tampered / stale storage written outside the module.
    sessionStorage.setItem(STORAGE_KEY, 'not a code / at all');

    expect(consumePendingInviteCode()).toBeNull();
    expect(sessionStorage.getItem(STORAGE_KEY)).toBeNull();
  });

  it('returns null when nothing is stored', () => {
    expect(consumePendingInviteCode()).toBeNull();
  });

  it('clearPendingInviteCode drops the code without reading it', () => {
    setPendingInviteCode('ABC234');
    clearPendingInviteCode();

    expect(consumePendingInviteCode()).toBeNull();
  });

  // WB1 — AuthCallbackPage/VerifyEmailPage must PEEK (not consume) so
  // InviteLandingPage's own consume-and-auto-accept effect still finds the
  // code when it lands.
  it('peekPendingInviteCode reads the code without clearing it', () => {
    setPendingInviteCode('ABC234');

    expect(peekPendingInviteCode()).toBe('ABC234');
    // Still there — a peek must never consume.
    expect(peekPendingInviteCode()).toBe('ABC234');
    expect(sessionStorage.getItem(STORAGE_KEY)).toBe('ABC234');
    // A subsequent real consume still works normally.
    expect(consumePendingInviteCode()).toBe('ABC234');
    expect(peekPendingInviteCode()).toBeNull();
  });

  it('peekPendingInviteCode returns null for garbage or missing values without touching storage', () => {
    expect(peekPendingInviteCode()).toBeNull();

    sessionStorage.setItem(STORAGE_KEY, 'not a code / at all');
    expect(peekPendingInviteCode()).toBeNull();
    // Unlike consume, peek must not clear even a garbage value.
    expect(sessionStorage.getItem(STORAGE_KEY)).toBe('not a code / at all');
  });

  it('degrades to a no-op when sessionStorage throws (Safari private mode)', () => {
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new DOMException('QuotaExceededError');
    });
    vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
      throw new SecurityError();
    });
    vi.spyOn(Storage.prototype, 'removeItem').mockImplementation(() => {
      throw new SecurityError();
    });

    expect(() => setPendingInviteCode('ABC234')).not.toThrow();
    expect(consumePendingInviteCode()).toBeNull();
    expect(() => clearPendingInviteCode()).not.toThrow();
  });
});

class SecurityError extends Error {
  constructor() {
    super('The operation is insecure.');
    this.name = 'SecurityError';
  }
}
