import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import {
  ONBOARDING_PAYWALL_PENDING_KEY,
  ONBOARDING_PAYWALL_SEEN_KEY,
  PENDING_FIRST_RUN_KEY,
  clearDeferredFirstRun,
  clearOnboardingPaywallPending,
  consumeOnboardingPaywall,
  deferFirstRun,
  firstRunNavigationState,
  hasSeenOnboardingPaywall,
  markOnboardingPaywallPending,
  markOnboardingPaywallSeen,
  peekDeferredFirstRun,
  peekOnboardingPaywallPending,
  shouldShowOnboardingPaywall,
  takeDeferredFirstRun,
} from '@/lib/onboardingPaywall';
import { useAuthStore } from '@/store/authStore';

/**
 * The onboarding paywall's gate and its two storage lifetimes.
 *
 * PORT PARITY: `shouldShowOnboardingPaywall` is mobile's
 * `isFirstCircle && isFreeTier() && !hasSeenOnboardingPaywall`
 * (mobile/src/screens/circle/CreateCircleScreen.tsx:254). Each of the three
 * inputs gets its own falsifying case here, because the whole placement is
 * worth 22.1% vs 2.9% conversion on the mobile release cohorts and a gate that
 * silently never opens looks exactly like a paywall nobody converts on.
 */

const USER_ID = 'user-1';

function signIn(userId: string): void {
  useAuthStore.setState({
    user: { id: userId, email: `${userId}@example.com` } as never,
    isAuthenticated: true,
  });
}

beforeEach(() => {
  window.localStorage.clear();
  window.sessionStorage.clear();
  signIn(USER_ID);
});

afterEach(() => {
  vi.restoreAllMocks();
  useAuthStore.setState({ user: null, isAuthenticated: false });
});

describe('shouldShowOnboardingPaywall', () => {
  it('opens for a free-tier user creating their FIRST circle who has never been asked', () => {
    expect(shouldShowOnboardingPaywall({ isFirstCircle: true, tier: 'free' })).toBe(true);
  });

  it('stays shut for a SECOND circle', () => {
    expect(shouldShowOnboardingPaywall({ isFirstCircle: false, tier: 'free' })).toBe(false);
  });

  it('stays shut for a premium user — never gate what they already paid for', () => {
    expect(shouldShowOnboardingPaywall({ isFirstCircle: true, tier: 'premium' })).toBe(false);
  });

  it('stays shut while the plan tier is still unknown', () => {
    // Failing CLOSED matters: an open gate here asks a paying customer to pay
    // again, which is worse than missing one ask.
    expect(shouldShowOnboardingPaywall({ isFirstCircle: true, tier: undefined })).toBe(false);
  });

  it('stays shut once the user has already seen it', () => {
    markOnboardingPaywallSeen();
    expect(shouldShowOnboardingPaywall({ isFirstCircle: true, tier: 'free' })).toBe(false);
  });
});

describe('the once-ever seen flag', () => {
  it('writes ONE localStorage entry, namespaced to the signed-in user', () => {
    markOnboardingPaywallSeen();

    const keys = Object.keys(window.localStorage).filter((k) =>
      k.startsWith(ONBOARDING_PAYWALL_SEEN_KEY)
    );
    expect(keys).toEqual([`${ONBOARDING_PAYWALL_SEEN_KEY}:${USER_ID}`]);
  });

  it('is idempotent — marking twice leaves exactly one entry', () => {
    markOnboardingPaywallSeen();
    markOnboardingPaywallSeen();

    expect(
      Object.keys(window.localStorage).filter((k) => k.startsWith(ONBOARDING_PAYWALL_SEEN_KEY))
    ).toHaveLength(1);
  });

  it('SURVIVES a session boundary (localStorage, not sessionStorage)', () => {
    markOnboardingPaywallSeen();

    // A new browser session clears sessionStorage and nothing else. The flag
    // must outlive it, or a user who declined gets asked again next visit.
    window.sessionStorage.clear();

    expect(hasSeenOnboardingPaywall()).toBe(true);
    expect(window.sessionStorage.getItem(`${ONBOARDING_PAYWALL_SEEN_KEY}:${USER_ID}`)).toBeNull();
  });

  it('does not leak between accounts on a shared browser', () => {
    markOnboardingPaywallSeen();
    expect(hasSeenOnboardingPaywall()).toBe(true);

    signIn('user-2');

    // WB7: the second account must still get its ask.
    expect(hasSeenOnboardingPaywall()).toBe(false);
    expect(shouldShowOnboardingPaywall({ isFirstCircle: true, tier: 'free' })).toBe(true);
  });

  it('degrades to "not seen" instead of throwing when storage is blocked', () => {
    // Safari private mode / "block all cookies" throw on access. Circle
    // creation must not be able to fail because of an onboarding nicety.
    vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
      throw new Error('SecurityError');
    });
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new Error('SecurityError');
    });

    expect(() => markOnboardingPaywallSeen()).not.toThrow();
    expect(hasSeenOnboardingPaywall()).toBe(false);
    expect(shouldShowOnboardingPaywall({ isFirstCircle: true, tier: 'free' })).toBe(true);
  });
});

describe('the deferred first-run wizard', () => {
  it('round-trips the circle and recipient name', () => {
    deferFirstRun({ circleId: 'circle-9', recipientName: 'Rose' });

    expect(peekDeferredFirstRun()).toEqual({ circleId: 'circle-9', recipientName: 'Rose' });
  });

  it('is CONSUMED by take, so two exits cannot both deliver the wizard', () => {
    deferFirstRun({ circleId: 'circle-9', recipientName: 'Rose' });

    expect(takeDeferredFirstRun()).toEqual({ circleId: 'circle-9', recipientName: 'Rose' });
    expect(takeDeferredFirstRun()).toBeNull();
  });

  it('lives in sessionStorage — a closed tab drops it, like mobile losing the ref', () => {
    deferFirstRun({ circleId: 'circle-9', recipientName: 'Rose' });

    expect(window.sessionStorage.getItem(`${PENDING_FIRST_RUN_KEY}:${USER_ID}`)).not.toBeNull();
    expect(window.localStorage.getItem(`${PENDING_FIRST_RUN_KEY}:${USER_ID}`)).toBeNull();
  });

  it('treats a corrupt payload as absent rather than throwing in a render path', () => {
    window.sessionStorage.setItem(`${PENDING_FIRST_RUN_KEY}:${USER_ID}`, '{not json');

    expect(peekDeferredFirstRun()).toBeNull();
  });

  it('rejects a record with no circle id', () => {
    window.sessionStorage.setItem(
      `${PENDING_FIRST_RUN_KEY}:${USER_ID}`,
      JSON.stringify({ recipientName: 'Rose' })
    );

    expect(peekDeferredFirstRun()).toBeNull();
  });

  it('clears cleanly', () => {
    deferFirstRun({ circleId: 'circle-9', recipientName: 'Rose' });
    clearDeferredFirstRun();

    expect(peekDeferredFirstRun()).toBeNull();
  });
});

describe('firstRunNavigationState', () => {
  it('builds the exact shape OverviewPage reads', () => {
    // OverviewPage's FirstRunLocationState. A rename on either side is a
    // silently missing wizard, which is why the shape is built in one place.
    expect(firstRunNavigationState('Rose')).toEqual({
      firstRun: true,
      firstRunRecipientName: 'Rose',
    });
  });
});

/**
 * Onboarding 1.3.1 (spec section 7): circle creation only records that the paywall is OWED;
 * `consumeOnboardingPaywall` is the single place it is actually put on screen, from two entry
 * points (the first med's payoff, and the next Today) that must never both win.
 */
describe('owed (pending) onboarding paywall', () => {
  it('records the owed circle in localStorage, per user', () => {
    markOnboardingPaywallPending('circle-7');

    expect(peekOnboardingPaywallPending()).toBe('circle-7');
    expect(window.localStorage.getItem(`${ONBOARDING_PAYWALL_PENDING_KEY}:${USER_ID}`)).not.toBeNull();
    // Another user on the same browser owes nothing.
    signIn('user-2');
    expect(peekOnboardingPaywallPending()).toBeNull();
  });

  it('survives a tab close (localStorage, not session)', () => {
    markOnboardingPaywallPending('circle-7');
    expect(window.sessionStorage.getItem(`${ONBOARDING_PAYWALL_PENDING_KEY}:${USER_ID}`)).toBeNull();
  });

  it('treats a corrupt or id-less record as absent', () => {
    window.localStorage.setItem(`${ONBOARDING_PAYWALL_PENDING_KEY}:${USER_ID}`, '{nope');
    expect(peekOnboardingPaywallPending()).toBeNull();
    window.localStorage.setItem(`${ONBOARDING_PAYWALL_PENDING_KEY}:${USER_ID}`, '{"circleId":""}');
    expect(peekOnboardingPaywallPending()).toBeNull();
  });

  it('clears cleanly', () => {
    markOnboardingPaywallPending('circle-7');
    clearOnboardingPaywallPending();
    expect(peekOnboardingPaywallPending()).toBeNull();
  });
});

describe('consumeOnboardingPaywall (exactly once)', () => {
  it('writes the seen flag, clears the owed record and parks the return target', () => {
    markOnboardingPaywallPending('circle-7');

    expect(consumeOnboardingPaywall({ circleId: 'circle-7', recipientName: 'Rose' })).toBe(true);

    expect(hasSeenOnboardingPaywall()).toBe(true);
    expect(peekOnboardingPaywallPending()).toBeNull();
    expect(peekDeferredFirstRun()).toEqual({ circleId: 'circle-7', recipientName: 'Rose' });
  });

  it('a second call (the other entry point) is refused and shows nothing', () => {
    markOnboardingPaywallPending('circle-7');
    expect(consumeOnboardingPaywall({ circleId: 'circle-7', recipientName: 'Rose' })).toBe(true);
    clearDeferredFirstRun();

    markOnboardingPaywallPending('circle-7');
    expect(consumeOnboardingPaywall({ circleId: 'circle-7', recipientName: 'Rose' })).toBe(false);
    expect(peekDeferredFirstRun()).toBeNull();
    // ...and the stale owed record is released.
    expect(peekOnboardingPaywallPending()).toBeNull();
  });

  it('keeps the seen key unchanged (cc:onboardingPaywallSeen)', () => {
    expect(ONBOARDING_PAYWALL_SEEN_KEY).toBe('cc:onboardingPaywallSeen');
  });
});
