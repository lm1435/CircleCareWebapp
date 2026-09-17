import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  setPendingAnalyticsConsent,
  consumePendingAnalyticsConsent,
  clearPendingAnalyticsConsent,
} from '../pendingAnalyticsConsent';

/**
 * Parks the signup page's analytics answer across the OAuth full-page redirect
 * (mirrors lib/pendingTermsConsent.ts and lib/pendingAuthMethod.ts).
 *
 * WHY IT CANNOT BE A BOOLEAN FLAG the way pendingTermsConsent is: terms are
 * REQUIRED, so "parked" and "accepted" are the same thing there and absence
 * means "this OAuth run did not come from the signup page". Analytics consent
 * is OPTIONAL, so all THREE outcomes have to survive the redirect — accepted,
 * declined, and "no answer was parked at all" (an OAuth LOGIN, which must
 * record nothing and must not overwrite an existing decision).
 */

const KEY = 'cc_pending_analytics_consent';

beforeEach(() => {
  sessionStorage.clear();
});

describe('parking an answer across the redirect', () => {
  it('round-trips an acceptance', () => {
    setPendingAnalyticsConsent(true);
    expect(consumePendingAnalyticsConsent()).toBe(true);
  });

  it('round-trips a DECLINE — the value that used to be unrecordable', () => {
    setPendingAnalyticsConsent(false);
    expect(consumePendingAnalyticsConsent()).toBe(false);
  });

  it('returns null when nothing was parked (an OAuth login, not a signup)', () => {
    expect(consumePendingAnalyticsConsent()).toBeNull();
  });

  it('distinguishes a parked FALSE from nothing parked', () => {
    setPendingAnalyticsConsent(false);
    const parkedFalse = consumePendingAnalyticsConsent();
    const nothing = consumePendingAnalyticsConsent();
    expect(parkedFalse).toBe(false);
    expect(nothing).toBeNull();
    expect(parkedFalse).not.toBe(nothing);
  });
});

describe('read-and-clear', () => {
  /**
   * Same contract as `consumePendingAuthMethod`: a stale answer must never be
   * attributed to a LATER, unrelated sign-in. The browser can be signed out and
   * back in as a different account in the same tab.
   */
  it('clears on read, so a second consume sees nothing', () => {
    setPendingAnalyticsConsent(true);
    expect(consumePendingAnalyticsConsent()).toBe(true);
    expect(consumePendingAnalyticsConsent()).toBeNull();
    expect(sessionStorage.getItem(KEY)).toBeNull();
  });

  it('uses sessionStorage, not localStorage — the lifetime of one tab', () => {
    setPendingAnalyticsConsent(true);
    expect(sessionStorage.getItem(KEY)).not.toBeNull();
    expect(localStorage.getItem(KEY)).toBeNull();
  });
});

/**
 * For the paths where the handshake never started (`signInWithOAuth` failing
 * BEFORE the redirect): no callback runs, so read-and-clear never happens, and
 * without this the parked answer — '0' by default — would be consumed by a
 * later OAuth sign-in for a different account in the same tab.
 */
describe('clearing without reading', () => {
  it('drops a parked DECLINE so a later sign-in consumes nothing', () => {
    setPendingAnalyticsConsent(false);
    clearPendingAnalyticsConsent();
    expect(sessionStorage.getItem(KEY)).toBeNull();
    expect(consumePendingAnalyticsConsent()).toBeNull();
  });

  it('drops a parked acceptance too', () => {
    setPendingAnalyticsConsent(true);
    clearPendingAnalyticsConsent();
    expect(consumePendingAnalyticsConsent()).toBeNull();
  });

  it('is a no-op when nothing was parked, and leaves other keys alone', () => {
    sessionStorage.setItem('unrelated', 'kept');
    expect(() => clearPendingAnalyticsConsent()).not.toThrow();
    expect(consumePendingAnalyticsConsent()).toBeNull();
    expect(sessionStorage.getItem('unrelated')).toBe('kept');
  });

  it('degrades to a no-op when storage throws', () => {
    const spy = vi.spyOn(Storage.prototype, 'removeItem').mockImplementation(() => {
      throw new Error('SecurityError');
    });
    expect(() => clearPendingAnalyticsConsent()).not.toThrow();
    spy.mockRestore();
  });
});

describe('storage that throws', () => {
  it('parking degrades to a no-op instead of breaking the redirect', () => {
    const spy = vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new Error('SecurityError');
    });
    expect(() => setPendingAnalyticsConsent(true)).not.toThrow();
    spy.mockRestore();
  });

  it('an unreadable store consumes as null — never as a fabricated consent', () => {
    const spy = vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
      throw new Error('SecurityError');
    });
    expect(consumePendingAnalyticsConsent()).toBeNull();
    spy.mockRestore();
  });

  it('an unrecognised parked value consumes as null', () => {
    sessionStorage.setItem(KEY, 'maybe');
    expect(consumePendingAnalyticsConsent()).toBeNull();
  });
});
