import { scopedKey } from './storageScope';

/**
 * THE ONBOARDING PAYWALL'S BROWSER-LOCAL STATE.
 *
 * PORT of the two pieces of `useOnboardingProgress` that mobile's
 * `CreateCircleScreen.doCreate` reads (mobile/src/screens/circle/
 * CreateCircleScreen.tsx:254-262):
 *
 *   if (isFirstCircle && isFreeTier() && !hasSeenOnboardingPaywall) {
 *     markOnboardingPaywallSeen();   // AsyncStorage, once ever
 *     pendingFirstRunRef.current = true;   // defer the wizard
 *     navigate(OnboardingPlanSelection, { paywallContext: ONBOARDING });
 *   } else {
 *     goToFirstRunWizard(...);
 *   }
 *
 * WHY THE PLACEMENT IS WORTH PORTING AT ALL: it has been removed from mobile
 * and restored twice, and the release history is an ABA cohorted on the app
 * version at signup — 1.1.3–1.1.5 with no onboarding paywall converted 1/34
 * (2.9%); 1.1.6–1.1.10 with it converted 25/113 (22.1%). The limit-moment 402s
 * did not absorb the difference during the removal: total conversion collapsed
 * rather than redistributing, and with observation time equalised the paywall
 * cohort was AHEAD on every activation and retention measure. The webapp had
 * no onboarding paywall at all.
 *
 * TWO DIFFERENT STORAGE LIFETIMES, on purpose:
 *
 * - "Seen" is localStorage. It is a ONCE EVER decision, exactly like mobile's
 *   AsyncStorage flag: a user who declined must never be asked again by this
 *   placement, including after a browser restart.
 * - The deferred first run is sessionStorage. It is a one-shot consequence of
 *   the create that just happened, not durable state. mobile holds the
 *   equivalent in a React ref, which dies when the app is killed; a tab close
 *   is the closest web analogue, so sessionStorage is the closer match AND the
 *   safer default — a stale record cannot follow the user into a session weeks
 *   later and shove a wizard at them.
 *
 * Both are namespaced per signed-in user via `scopedKey` (see WB7 in
 * storageScope.ts): on a shared browser the second account must not
 * inherit the first account's "already seen the paywall" flag and silently
 * lose the ask.
 *
 * Every storage touch is wrapped — Safari private mode and "block all cookies"
 * throw on access, and an analytics/onboarding nicety must never be able to
 * break circle creation. On a storage failure the flags degrade to their
 * absent state, which means the paywall may be shown again on a later create;
 * that is the correct direction to fail (the user still reaches the wizard
 * either way, and the ask is what the data says is valuable).
 */

/** localStorage — "this browser has shown this user the onboarding paywall". */
export const ONBOARDING_PAYWALL_SEEN_KEY = 'cc:onboardingPaywallSeen';

/** sessionStorage — the first-run wizard deferred behind the paywall. */
export const PENDING_FIRST_RUN_KEY = 'cc:pendingFirstRun';

/**
 * The wizard hand-off, held across a full route change.
 *
 * `recipientName` is here for the same reason it rides in `location.state`
 * today: the wizard's copy asks about the person by name and the circle detail
 * query has not landed when it opens. It never leaves the browser — it is not
 * an analytics property, and the PHI rules in lib/analytics.ts still forbid it
 * there.
 */
export interface DeferredFirstRun {
  circleId: string;
  recipientName: string;
}

function read(storage: 'local' | 'session', key: string): string | null {
  try {
    const store = storage === 'local' ? window.localStorage : window.sessionStorage;
    return store.getItem(key);
  } catch {
    return null;
  }
}

function write(storage: 'local' | 'session', key: string, value: string): void {
  try {
    const store = storage === 'local' ? window.localStorage : window.sessionStorage;
    store.setItem(key, value);
  } catch {
    // Storage unavailable — see the module comment for how this degrades.
  }
}

function remove(storage: 'local' | 'session', key: string): void {
  try {
    const store = storage === 'local' ? window.localStorage : window.sessionStorage;
    store.removeItem(key);
  } catch {
    // Nothing to do — a record we cannot delete is a record we could not write.
  }
}

/** Mobile's `hasSeenOnboardingPaywall`. */
export function hasSeenOnboardingPaywall(): boolean {
  return read('local', scopedKey(ONBOARDING_PAYWALL_SEEN_KEY)) !== null;
}

/**
 * Mobile's `markOnboardingPaywallSeen`. Written BEFORE navigating, never after
 * the user answers: mobile marks it at the moment of the ask
 * (CreateCircleScreen.tsx:257), so an abandoned session still counts as asked.
 * Otherwise a user who closes the tab on the paywall gets asked again on their
 * next circle, which is the nag the once-ever flag exists to prevent.
 */
export function markOnboardingPaywallSeen(): void {
  write('local', scopedKey(ONBOARDING_PAYWALL_SEEN_KEY), '1');
}

/**
 * The whole gate, in one testable place — mobile's
 * `isFirstCircle && isFreeTier() && !hasSeenOnboardingPaywall`.
 *
 * `tier` is `useSubscriptionStatus().data?.tier`. It is `undefined` until that
 * query resolves, and undefined DOES NOT open the gate: never ask someone who
 * might already be paying. In practice the query is warm long before this runs
 * (the circle picker renders NeedsCircleSelectionBanner, which subscribes to
 * it, and the user still has to open the modal and type a name).
 */
export function shouldShowOnboardingPaywall(input: {
  isFirstCircle: boolean;
  tier: string | undefined;
}): boolean {
  if (!input.isFirstCircle) return false;
  if (input.tier !== 'free') return false;
  return !hasSeenOnboardingPaywall();
}

/** Park the first-run wizard for the duration of the paywall route. */
export function deferFirstRun(record: DeferredFirstRun): void {
  write('session', scopedKey(PENDING_FIRST_RUN_KEY), JSON.stringify(record));
}

/** Read the deferred wizard without consuming it. */
export function peekDeferredFirstRun(): DeferredFirstRun | null {
  const raw = read('session', scopedKey(PENDING_FIRST_RUN_KEY));
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw) as Partial<DeferredFirstRun> | null;
    if (!parsed || typeof parsed.circleId !== 'string' || parsed.circleId === '') return null;
    return {
      circleId: parsed.circleId,
      recipientName: typeof parsed.recipientName === 'string' ? parsed.recipientName : '',
    };
  } catch {
    // Corrupt payload (hand-edited, or a shape from an older build). Treat it
    // as absent rather than throwing inside a render path.
    return null;
  }
}

/**
 * Read AND consume. Every consumer uses this rather than peek+clear so the
 * record cannot be delivered twice — the wizard is a once-per-circle event and
 * two consumers (the paywall's own exits and the circle picker's
 * browser-back fallback) can both reach it.
 */
export function takeDeferredFirstRun(): DeferredFirstRun | null {
  const record = peekDeferredFirstRun();
  clearDeferredFirstRun();
  return record;
}

export function clearDeferredFirstRun(): void {
  remove('session', scopedKey(PENDING_FIRST_RUN_KEY));
}

/**
 * The `location.state` OverviewPage reads to open the wizard
 * (`FirstRunLocationState` there). Three call sites now navigate with it —
 * CreateCircleModal (no paywall), UpgradePage (the paywall's exits) and
 * CirclePickerPage (the browser-back fallback) — and a typo in any one of them
 * is a silently missing wizard, so the shape is built in exactly one place.
 */
export function firstRunNavigationState(recipientName: string): {
  firstRun: true;
  firstRunRecipientName: string;
} {
  return { firstRun: true, firstRunRecipientName: recipientName };
}
