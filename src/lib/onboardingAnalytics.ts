import { useAuthStore } from '@/store/authStore';
import { Analytics, type OnboardingPath } from './analytics';

// R4-5 (docs/plans/condition-tags.md): onboarding funnel instrumentation for
// the web companion. Web has no onboarding questionnaire, so it mirrors only
// the two funnel endpoints — `onboarding_started` and
// `onboarding_flow_completed` — with the SAME event names mobile sends.
//
// Guard model (per plan):
// - `onboarding_started` fires at most once per BROWSER SESSION
//   (sessionStorage), and only while this browser has never seen the user
//   complete onboarding. It marks "authenticated with zero circles" — the
//   web equivalent of mobile's first onboarding screen after signup.
// - `onboarding_flow_completed` fires at most once per BROWSER (localStorage)
//   with `path: 'created' | 'joined' | 'existing'`. Cross-device duplicates
//   are acceptable: funnels count unique persons, `path: 'existing'` is
//   filterable, and the `$set_once: { onboarded_at }` person property keeps
//   the first completion timestamp regardless.
//
// Storage access is wrapped in try/catch (some privacy modes throw). On
// storage failure we still capture — a possible duplicate event beats a
// silently dead funnel — matching the "dupes are acceptable" spec stance.
//
// PHI-safe: events carry only the path enum + a timestamp. No content.

/** localStorage — survives sessions; "this browser saw the user onboarded". */
export const ONBOARDING_COMPLETED_KEY = 'cc:onboardingCompleted';
/** sessionStorage — per-tab-session "started already fired". */
export const ONBOARDING_STARTED_KEY = 'cc:onboardingStarted';

/**
 * WB7: both guards above used to be a single un-namespaced key per browser.
 * On a shared device, the SECOND account to sign in inherited the FIRST
 * account's "already onboarded" flag and its funnel silently never fired —
 * indistinguishable from a real completion. Namespace by the signed-in user
 * id (falling back to a shared 'anon' bucket pre-auth, which matches prior
 * behavior for that edge case).
 */
function scopedKey(base: string): string {
  const userId = useAuthStore.getState().user?.id ?? 'anon';
  return `${base}:${userId}`;
}

function safeRead(storage: 'local' | 'session', key: string): string | null {
  try {
    const store = storage === 'local' ? window.localStorage : window.sessionStorage;
    return store.getItem(key);
  } catch {
    return null;
  }
}

function safeWrite(storage: 'local' | 'session', key: string): void {
  try {
    const store = storage === 'local' ? window.localStorage : window.sessionStorage;
    store.setItem(key, '1');
  } catch {
    // Storage unavailable — degrade to possibly firing again later.
  }
}

/** Whether this browser has already reported onboarding_flow_completed
 *  FOR THE CURRENTLY SIGNED-IN USER. */
export function hasCompletedOnboarding(): boolean {
  return safeRead('local', scopedKey(ONBOARDING_COMPLETED_KEY)) !== null;
}

/**
 * Fire `onboarding_started` — call when an authenticated user is known to have
 * ZERO circles (the web "start of onboarding"). No-ops when it already fired
 * this session, or when this browser has already seen the user complete
 * onboarding (e.g. they left/deleted their only circle — that is not a new
 * signup funnel entry).
 */
export function trackOnboardingStarted(): void {
  if (hasCompletedOnboarding()) return;
  if (safeRead('session', scopedKey(ONBOARDING_STARTED_KEY)) !== null) return;
  safeWrite('session', scopedKey(ONBOARDING_STARTED_KEY));
  Analytics.onboardingStarted();
}

/**
 * Fire `onboarding_flow_completed` with the given path — at most once per
 * browser (localStorage guard). Call sites:
 * - 'created'  — circle creation succeeded (CreateCircleModal).
 * - 'joined'   — invite accept succeeded (JoinCircleModal, PendingInvitesPage,
 *   InviteLandingPage). If the user already had circles, this browser has
 *   already fired 'existing' when those circles loaded, so this no-ops —
 *   which is exactly the "first circle only" semantics.
 * - 'existing' — the circles list loaded with >= 1 circle before any local
 *   create/join (device swap / onboarded on another platform). Fired via
 *   trackCirclesLoaded, not directly.
 */
export function trackOnboardingCompleted(path: OnboardingPath): void {
  if (hasCompletedOnboarding()) return;
  safeWrite('local', scopedKey(ONBOARDING_COMPLETED_KEY));
  Analytics.onboardingFlowCompleted(path);
}

/**
 * Single observation point for "the authenticated user's circle list resolved"
 * (CirclePickerPage + AppLayout). Zero circles → the user is un-onboarded →
 * `onboarding_started`. One or more → they onboarded somewhere → complete with
 * 'existing' (no-op if this browser already fired completed for create/join).
 */
export function trackCirclesLoaded(circleCount: number): void {
  if (circleCount > 0) {
    trackOnboardingCompleted('existing');
  } else {
    trackOnboardingStarted();
  }
}
