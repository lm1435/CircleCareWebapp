import { beforeEach, describe, expect, it, vi } from 'vitest';
import { Analytics } from '@/lib/analytics';
import { useAuthStore } from '@/store/authStore';
import {
  ONBOARDING_COMPLETED_KEY,
  ONBOARDING_STARTED_KEY,
  hasCompletedOnboarding,
  trackCirclesLoaded,
  trackOnboardingCompleted,
  trackOnboardingStarted,
} from '@/lib/onboardingAnalytics';

// Unit tests for the R4-5 onboarding funnel guard module. The Analytics
// wrapper is mocked so these tests assert ONLY the guard/dedupe/path logic;
// the event payloads themselves ($set_once etc.) are covered in
// analytics.test.ts. Storage is real jsdom local/sessionStorage — the module
// is stateless, so clearing storage fully resets it between tests.

vi.mock('@/lib/analytics', () => ({
  Analytics: {
    onboardingStarted: vi.fn(),
    onboardingFlowCompleted: vi.fn(),
  },
}));

const started = vi.mocked(Analytics.onboardingStarted);
const completed = vi.mocked(Analytics.onboardingFlowCompleted);

/** Set the signed-in user the guard keys get namespaced by (WB7). */
function signInAs(userId: string): void {
  useAuthStore.setState({
    user: { id: userId, email: `${userId}@example.com`, first_name: null, last_name: null },
    isAuthenticated: true,
    isBootstrapping: false,
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  localStorage.clear();
  sessionStorage.clear();
  signInAs('user-1');
});

describe('trackOnboardingStarted', () => {
  it('fires onboarding_started once, then no-ops for the rest of the session', () => {
    trackOnboardingStarted();
    trackOnboardingStarted();
    trackOnboardingStarted();
    expect(started).toHaveBeenCalledTimes(1);
    expect(sessionStorage.getItem(`${ONBOARDING_STARTED_KEY}:user-1`)).not.toBeNull();
  });

  it('fires again in a NEW session (sessionStorage guard, not persisted)', () => {
    trackOnboardingStarted();
    sessionStorage.clear(); // simulate a fresh browser session
    trackOnboardingStarted();
    expect(started).toHaveBeenCalledTimes(2);
  });

  it('never fires once this browser has seen onboarding completed', () => {
    trackOnboardingCompleted('created');
    trackOnboardingStarted();
    expect(started).not.toHaveBeenCalled();
  });
});

describe('trackOnboardingCompleted', () => {
  it('fires onboarding_flow_completed with the given path and sets the browser guard', () => {
    trackOnboardingCompleted('created');
    expect(completed).toHaveBeenCalledTimes(1);
    expect(completed).toHaveBeenCalledWith('created');
    expect(localStorage.getItem(`${ONBOARDING_COMPLETED_KEY}:user-1`)).not.toBeNull();
    expect(hasCompletedOnboarding()).toBe(true);
  });

  it('fires at most once per browser — later calls no-op regardless of path', () => {
    trackOnboardingCompleted('joined');
    trackOnboardingCompleted('created');
    trackOnboardingCompleted('existing');
    expect(completed).toHaveBeenCalledTimes(1);
    expect(completed).toHaveBeenCalledWith('joined');
  });

  it('respects a guard set in a previous session (localStorage persists)', () => {
    localStorage.setItem(`${ONBOARDING_COMPLETED_KEY}:user-1`, '1');
    trackOnboardingCompleted('existing');
    expect(completed).not.toHaveBeenCalled();
  });
});

describe('namespacing by user id (WB7)', () => {
  // REGRESSION — before namespacing, both guards were a single shared key per
  // BROWSER. On a shared/kiosk device, the second account to sign in silently
  // inherited the first account's "already onboarded" flag: their own funnel
  // (started/completed) never fired, indistinguishable from a real
  // completion. Old code: `hasCompletedOnboarding()` for user-2 would return
  // true immediately after user-1 completed, and this test's second
  // `completed` call would never fire.
  it("a second account on the same browser is NOT suppressed by the first account's guard", () => {
    signInAs('user-1');
    trackOnboardingCompleted('created');
    expect(completed).toHaveBeenCalledTimes(1);

    signInAs('user-2');
    expect(hasCompletedOnboarding()).toBe(false);
    trackOnboardingCompleted('created');
    expect(completed).toHaveBeenCalledTimes(2);
  });

  it('switching back to the first account still respects ITS OWN previously-set guard', () => {
    signInAs('user-1');
    trackOnboardingCompleted('created');
    signInAs('user-2');
    trackOnboardingCompleted('created');
    completed.mockClear();

    signInAs('user-1');
    expect(hasCompletedOnboarding()).toBe(true);
    trackOnboardingCompleted('existing');
    expect(completed).not.toHaveBeenCalled();
  });

  it('falls back to a shared "anon" bucket when no user is signed in', () => {
    useAuthStore.setState({ user: null, isAuthenticated: false, isBootstrapping: false });
    trackOnboardingCompleted('created');
    expect(localStorage.getItem(`${ONBOARDING_COMPLETED_KEY}:anon`)).not.toBeNull();
  });
});

describe('trackCirclesLoaded', () => {
  it('zero circles → onboarding_started (un-onboarded landing)', () => {
    trackCirclesLoaded(0);
    expect(started).toHaveBeenCalledTimes(1);
    expect(completed).not.toHaveBeenCalled();
  });

  it('>= 1 circle → onboarding_flow_completed with path "existing"', () => {
    trackCirclesLoaded(3);
    expect(completed).toHaveBeenCalledTimes(1);
    expect(completed).toHaveBeenCalledWith('existing');
    expect(started).not.toHaveBeenCalled();
  });

  it('does NOT fire "existing" when the circles were created/joined on this browser', () => {
    // Signup funnel: landed with zero circles, created one, list refetches.
    trackCirclesLoaded(0);
    trackOnboardingCompleted('created');
    trackCirclesLoaded(1);
    expect(started).toHaveBeenCalledTimes(1);
    expect(completed).toHaveBeenCalledTimes(1);
    expect(completed).toHaveBeenCalledWith('created');
  });

  it('does NOT re-fire started after completion even if the user drops to zero circles', () => {
    trackCirclesLoaded(1); // 'existing'
    trackCirclesLoaded(0); // left/deleted their only circle — not a new signup
    expect(started).not.toHaveBeenCalled();
    expect(completed).toHaveBeenCalledTimes(1);
  });
});

describe('hasCompletedOnboarding', () => {
  it('is false on a fresh browser and true after any completion', () => {
    expect(hasCompletedOnboarding()).toBe(false);
    trackOnboardingCompleted('existing');
    expect(hasCompletedOnboarding()).toBe(true);
  });
});
