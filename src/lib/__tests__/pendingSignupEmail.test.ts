import {
  setPendingSignupEmail,
  peekPendingSignupEmail,
  clearPendingSignupEmail,
} from '@/lib/pendingSignupEmail';

// The pending-signup-email handoff: a sessionStorage bridge that lets
// SignUpPage redirect a browser-back to /verify-email (instead of a blank,
// re-submittable form) and lets VerifyEmailPage recover the address when
// router state is gone.

const STORAGE_KEY = 'cc_pending_signup_email';

describe('pendingSignupEmail', () => {
  beforeEach(() => {
    sessionStorage.clear();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('parks, peeks (without clearing) and clears an address', () => {
    setPendingSignupEmail('pat@example.com');

    expect(peekPendingSignupEmail()).toBe('pat@example.com');
    // Peek never consumes: VerifyEmailPage clears only after a verified code.
    expect(peekPendingSignupEmail()).toBe('pat@example.com');

    clearPendingSignupEmail();
    expect(peekPendingSignupEmail()).toBeNull();
    expect(sessionStorage.getItem(STORAGE_KEY)).toBeNull();
  });

  it('trims on set', () => {
    setPendingSignupEmail('  pat@example.com ');
    expect(sessionStorage.getItem(STORAGE_KEY)).toBe('pat@example.com');
  });

  it('ignores invalid values on set', () => {
    setPendingSignupEmail('');
    setPendingSignupEmail('   ');
    setPendingSignupEmail('not-an-email');
    setPendingSignupEmail('a b@example.com');
    setPendingSignupEmail(`${'a'.repeat(320)}@example.com`);
    expect(sessionStorage.getItem(STORAGE_KEY)).toBeNull();
  });

  it('returns null for a tampered stored value', () => {
    sessionStorage.setItem(STORAGE_KEY, '<script>alert(1)</script>');
    expect(peekPendingSignupEmail()).toBeNull();
  });

  it('returns null when nothing is parked', () => {
    expect(peekPendingSignupEmail()).toBeNull();
  });

  it('is safe when sessionStorage throws (Safari private mode)', () => {
    const boom = () => {
      throw new Error('SecurityError');
    };
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(boom);
    vi.spyOn(Storage.prototype, 'getItem').mockImplementation(boom);
    vi.spyOn(Storage.prototype, 'removeItem').mockImplementation(boom);

    expect(() => setPendingSignupEmail('pat@example.com')).not.toThrow();
    expect(peekPendingSignupEmail()).toBeNull();
    expect(() => clearPendingSignupEmail()).not.toThrow();
  });
});
