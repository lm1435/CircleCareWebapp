/**
 * Analytics consent for the web companion.
 *
 * ── THREE STATES, NOT TWO ────────────────────────────────────────────────
 *
 * This module used to expose one boolean that defaulted false, which made a
 * visitor nobody had ever asked indistinguishable from a visitor who had been
 * asked and said no. That is the right COLLECTION posture (both must fail
 * closed) and a useless RECORD: it cannot answer "did they decline, or did we
 * never ask?", and it cannot tell the signup flow whether it still owes
 * somebody the question. `AnalyticsConsentState` splits the two.
 *
 * The WIRE FORMAT is unchanged — the same `cc_analytics_enabled` key holding
 * 'true' | 'false' — so no migration is needed and a build from either side of
 * this change reads the other's writes. The third state is the ABSENCE of the
 * key, which was always there; it was only being collapsed on the way out.
 *
 * ── THE ASK, AND WHY THE MODULE NOTE USED TO SAY THERE WASN'T ONE ────────
 *
 * Until 2026-09-08 the only caller of `setAnalyticsConsent` outside tests was
 * a toggle buried in Profile > Privacy, so in practice nothing ever asked and
 * ~100% of web users sat at the default. `pages/SignUpPage.tsx` now carries an
 * optional, unticked, non-blocking checkbox — the same shape mobile's signup
 * screen uses — and `lib/analyticsConsentDecision.ts` turns the answer (either
 * answer) into a recorded decision. The OAuth buttons park their answer in
 * `lib/pendingAnalyticsConsent.ts` so it survives the provider redirect, and
 * `pages/AuthCallbackPage.tsx` records it once the sign-in actually completes.
 *
 * ── GRANDFATHERING: WEB DOES NOT, AND THAT IS NOT AN OVERSIGHT ───────────
 *
 * Mobile grandfathers pre-gate installs ON, detected by a persisted auth
 * session in SecureStore. Web cannot detect that (authStore deliberately
 * persists NOTHING — the session lives in an httpOnly cookie) and, more
 * importantly, should not want to. Both platforms are applying the SAME
 * principle — a consent gate must not change what is already happening to
 * people who were never asked — and land on opposite booleans because their
 * status quos were opposite: mobile was already collecting fully, so ON
 * preserved it; web has never identified anybody, so ON would START something
 * new for people who never said yes. See `GRANDFATHER_UNASKED_WEB_USERS` in
 * lib/analyticsMode.ts, where that decision is a named constant with a test.
 *
 * The web surface is also privacy-hardened in ways mobile is not: memory-only
 * persistence (nothing in cookies or localStorage from PostHog), `$ip: null`
 * so no IP or derived geo is stored, and autocapture off.
 */

const CONSENT_KEY = 'cc_analytics_enabled';

/**
 * What this browser knows about the visitor's answer.
 *
 *   'granted'  — they were asked and said yes.
 *   'declined' — they were asked and said no.
 *   'unasked'  — no answer has been recorded here (and the storage-failure
 *                fallback: an answer we cannot read is one we do not have).
 */
export type AnalyticsConsentState = 'granted' | 'declined' | 'unasked';

let cached: AnalyticsConsentState | null = null;
const listeners = new Set<(enabled: boolean) => void>();

/**
 * Read the recorded state.
 *
 * Never throws: localStorage is unavailable in private mode on some browsers
 * and behind certain enterprise policies, and an analytics preference must not
 * be able to break the app. An unreadable store — and any value that is not
 * exactly 'true' or 'false' — fails CLOSED to 'unasked', which resolves to the
 * same non-identifying mode a decline does while still recording, truthfully,
 * that we do not have an answer.
 */
export function getAnalyticsConsentState(): AnalyticsConsentState {
  if (cached !== null) return cached;
  try {
    const stored = localStorage.getItem(CONSENT_KEY);
    cached = stored === 'true' ? 'granted' : stored === 'false' ? 'declined' : 'unasked';
  } catch {
    cached = 'unasked';
  }
  return cached;
}

/**
 * Has this visitor answered at all? The "do we still owe them the question?"
 * predicate — and the thing that keeps a returning user from being re-asked.
 */
export function hasAnsweredAnalyticsConsent(): boolean {
  return getAnalyticsConsentState() !== 'unasked';
}

/**
 * Read consent as a boolean. Unchanged semantics: ONLY an explicit 'granted'
 * is a yes, so "never asked" can never be treated as one.
 *
 * Kept as the emit-path's cheap read and for every existing caller. Anything
 * that needs to tell "declined" from "never asked" — the signup flow, the
 * grandfathering rule — must use `getAnalyticsConsentState` instead.
 */
export function getAnalyticsConsent(): boolean {
  return getAnalyticsConsentState() === 'granted';
}

/**
 * Record an answer. Writes the same two strings the boolean version always
 * wrote, so nothing has to migrate in either direction.
 *
 * Note this is what makes 'declined' reachable at all: before the signup flow
 * existed, nothing ever called it with `false` for someone who had not first
 * turned it on, so the declined cohort was never written down.
 */
export function setAnalyticsConsent(enabled: boolean): void {
  cached = enabled ? 'granted' : 'declined';
  try {
    localStorage.setItem(CONSENT_KEY, enabled ? 'true' : 'false');
  } catch {
    // Keep the in-memory value so the current session still honours the
    // choice. The answer was given; only its durability was lost — it must
    // not read back as "still owed an answer" for the rest of this session.
  }
  // A NEW ANSWER STARTS OWNERLESS. Without this, an answer given at a signup
  // form (where nobody is signed in) would inherit the PREVIOUS account's id
  // and be reconciled as theirs — the same false attribution the owner exists
  // to prevent, pointing the other way. Callers that know whose answer it is
  // stamp it immediately afterwards via `setAnalyticsConsentOwner`.
  clearOwner();
  listeners.forEach((fn) => fn(enabled));
}

/**
 * ── WHOSE ANSWER IS THIS? ────────────────────────────────────────────────
 *
 * The answer above is one key in one browser. The SERVER's half of the same
 * decision (`analytics_consent_withdrawn_at`) is a column on a USER. On a
 * shared browser those two scopes come apart, and the consequence is not
 * subtle: A declines, signs out, B accepts, signs out, A signs back in —
 * login never re-asks — and `identifyUser(A.id)` resolves 'full' from B's
 * answer, so A is JOINED TO A NAMED PERSON in PostHog on the strength of B's
 * consent while A's own server record still says withdrawn. (Until 2026-09-10
 * that call also carried A's EMAIL; the id is no longer accompanied by any
 * person trait, but creating the person at all is the thing A withdrew from.)
 *
 * `lib/analyticsConsentSync.ts` already carries a userId on the server half's
 * retry marker for exactly this reason. This is the client-half equivalent.
 *
 * SEPARATE KEY, not a new value format. `cc_analytics_enabled` keeps holding
 * 'true' | 'false' so a build from either side of this change reads the
 * other's writes, and the absence of the owner key is a meaningful state
 * (see `reconcileAnalyticsConsentOwner`) rather than a parse failure.
 *
 * It is a user id, not a credential — the same id `analytics_consent_pending_
 * sync` has always written to this store — and it is only ever written
 * alongside an answer that already exists here.
 */
const CONSENT_OWNER_KEY = 'cc_analytics_consent_user';

function readOwner(): string | null {
  try {
    const stored = localStorage.getItem(CONSENT_OWNER_KEY);
    return stored !== null && stored.length > 0 ? stored : null;
  } catch {
    return null;
  }
}

function clearOwner(): void {
  try {
    localStorage.removeItem(CONSENT_OWNER_KEY);
  } catch {
    // Storage unavailable — there is nothing stored to clear either.
  }
}

/** The account the recorded answer belongs to, or null when nobody claimed it. */
export function getAnalyticsConsentOwner(): string | null {
  return readOwner();
}

/**
 * Claim the recorded answer for an account.
 *
 * Called by the surfaces that know who answered at the moment they answered —
 * the Profile toggle (via `recordAnalyticsConsentDecision`), the OAuth
 * callback, and email signup once the account id comes back. Anything not
 * stamped here is adopted by the first account to sign in afterwards.
 */
export function setAnalyticsConsentOwner(userId: string): void {
  if (!userId) return;
  try {
    localStorage.setItem(CONSENT_OWNER_KEY, userId);
  } catch {
    // Best-effort. An unstampable answer reads back as ownerless, which is
    // adopted rather than discarded — the conservative direction for a
    // browser that cannot persist anything anyway.
  }
}

/** Forget the recorded answer entirely — back to 'unasked'. */
function forgetRecordedAnalyticsConsent(): void {
  const wasGranted = getAnalyticsConsentState() === 'granted';
  cached = 'unasked';
  try {
    localStorage.removeItem(CONSENT_KEY);
  } catch {
    // Storage unavailable — the in-memory value above is what this session
    // reads, and it already says 'unasked'.
  }
  clearOwner();
  // Only report an actual change to what a subscriber can observe (the
  // callback is a boolean and cannot express 'unasked'; both non-granted
  // states resolve to the same mode).
  if (wasGranted) listeners.forEach((fn) => fn(false));
}

/**
 * Settle the recorded answer against the account that just signed in. Call it
 * at every point a user id becomes known, BEFORE anything can identify.
 *
 *   owner === userId  keep it. Their own answer, returned to.
 *   owner === null    ADOPT it. Email/password signup records its answer
 *                     before any session exists (the backend returns an OTP,
 *                     not a token), and answers from the old Profile-only
 *                     toggle predate this key. The first account to arrive
 *                     after such an answer is the account that gave it.
 *   otherwise         FORGET it. Somebody else answered on this browser. The
 *                     arriving account is 'unasked' — which resolves to
 *                     anonymous and refuses identify — rather than inheriting
 *                     a stranger's yes OR no.
 *
 * Forgetting loses nothing authoritative: the durable per-account record is
 * the server column, which this never touches, and the Profile toggle can
 * always restate the answer.
 */
export function reconcileAnalyticsConsentOwner(userId: string): void {
  if (!userId) return;
  // No answer here to own. Drop any orphaned stamp and write nothing — the
  // auth path must not put anything new in JS-readable storage.
  if (getAnalyticsConsentState() === 'unasked') {
    if (readOwner() !== null) clearOwner();
    return;
  }
  const owner = readOwner();
  if (owner === userId) return;
  if (owner === null) {
    setAnalyticsConsentOwner(userId);
    return;
  }
  forgetRecordedAnalyticsConsent();
}

export function subscribeToAnalyticsConsent(fn: (enabled: boolean) => void): () => void {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

/**
 * ── THE CACHE IS PER-DOCUMENT; THE ANSWER IS PER-BROWSER ─────────────────
 *
 * `cached` above is a module variable, so it belongs to ONE tab. Until this
 * listener existed the only thing that ever cleared it was the test seam, and
 * the app registered no `storage` handler at all: two tabs open, consent
 * unticked in one, and the other went on resolving 'granted' — stamping
 * `circle_id` and every other stable id on every event — until it was reloaded
 * or navigated. `before_send` re-reads `currentAnalyticsMode()` per event
 * precisely so a mid-session withdrawal binds immediately; that guarantee held
 * within a tab and failed silently across them.
 *
 * WHAT EXACTLY LEAKED, stated precisely: the receiving tab kept capturing WITH
 * `circle_id` and UUID-bearing URLs un-stripped — not "kept capturing at all".
 * Capture itself would have stopped on its own, because posthog-js re-reads its
 * own `__ph_opt_in_out_<token>` flag from localStorage on EVERY capture
 * (`capture()` → `is_capturing()` → `has_opted_out_capturing()` →
 * `consent.isOptedOut()` → a fresh `getItem`; the consent manager memoizes the
 * store OBJECT and never the value, and `opt_out_capturing_persistence_type`
 * defaults to 'localStorage' independently of our `persistence: 'memory'` —
 * verified in the installed posthog-js@1.386.6 `dist/module.js`). But we never
 * write that flag: with `ANONYMOUS_ANALYTICS_WHEN_DECLINED` on,
 * `disableAnalytics` does `reset()` only and deliberately never opts out, so
 * the declined cohort stays visible anonymously. Our `before_send` gate was
 * therefore the only line there was, and it was the stale one.
 *
 * WHY IT CLEARS RATHER THAN TRUSTING `event.newValue`:
 *
 *  - One parser. Re-hydration goes back through `getAnalyticsConsentState`,
 *    which is the single fail-closed path ('true'/'false' or 'unasked'). A
 *    second place that interprets the wire format is a second place to drift.
 *  - `newValue` is a SNAPSHOT of one write. Another tab can write again before
 *    this tab next reads; a re-read gets the current answer, the snapshot gets
 *    a stale one.
 *  - It fails toward stripping, which is the direction that matters: a late
 *    withdrawal is a privacy leak, a late grant is only under-collection. If
 *    the re-read throws (private mode, enterprise policy) the shared fallback
 *    lands on 'unasked' → anonymous. Trusting `newValue` has no such floor.
 *
 * ── DO NOT ADD `disableAnalytics()` HERE. IT IS A FOOTGUN, NOT AN OMISSION ──
 *
 * Running the withdrawing tab's teardown in the RECEIVING tab looks like an
 * obvious improvement and is a latent bug armed by a config change nobody would
 * connect to this file:
 *
 *  - `disableAnalytics()` calls `posthog.reset()`, which drops this tab's
 *    pending batch — a queue this tab built and this user's withdrawal does not
 *    reach backwards to (the same reason the signup-decline path skips
 *    teardown).
 *  - Decisively: posthog-js's `reset()` runs `consent.reset()`, which DELETES
 *    `__ph_opt_in_out_<token>` — a key in SHARED localStorage. Today that key is
 *    never written, so nothing is lost. Flip `ANONYMOUS_ANALYTICS_WHEN_DECLINED`
 *    to false (lib/analyticsMode.ts) and the declined mode becomes 'off', where
 *    the withdrawing tab DOES write a real opt-out — and a receiving tab that
 *    "helpfully" tore down would erase it and opt BOTH tabs back IN. A privacy
 *    regression caused by a one-word change in a different module.
 *
 * Stripping future events is what this listener owes. The tab that made the
 * change does its own teardown, and it is the only one that can do it safely.
 */
const CROSS_TAB_LISTENER_KEY = '__ccAnalyticsConsentStorageListener';

function handleConsentStorage(event: StorageEvent): void {
  // OUR KEY ONLY — plus `null`, which is not "some other key" but a whole-store
  // `clear()` from another tab, and that took ours with it. A `clear()` of
  // sessionStorage reports null too; invalidating on it costs one re-read that
  // returns the same answer, and notifies nobody (see the change check below).
  if (event.key !== CONSENT_KEY && event.key !== null) return;

  const before = cached;
  cached = null;
  const after = getAnalyticsConsentState();

  // Only tell subscribers about an actual change to what they can observe.
  // `before === null` means this tab had never memoized an answer, so nothing
  // it read could have been stale and there is no transition to report.
  //
  // The callback signature is a BOOLEAN, which cannot express 'unasked' — that
  // is fine for every subscriber that could exist today, because the only
  // decision anyone takes from this value is "full mode or not", and both
  // non-granted states resolve to the same mode while
  // `GRANDFATHER_UNASKED_WEB_USERS` is false. There are no subscribers at all
  // right now; if that constant is ever flipped, they must move to the
  // tri-state `getAnalyticsConsentState` instead.
  if (before !== null && (before === 'granted') !== (after === 'granted')) {
    listeners.forEach((fn) => fn(after === 'granted'));
  }
}

/**
 * Install the cross-tab listener, at most once per window.
 *
 * Guarded for a missing `window` (SSR, and any node context that imports this
 * leaf module for its pure functions). The handler is parked ON the window so a
 * repeated module load — `vi.resetModules()` in tests, HMR in dev — RETIRES the
 * previous instance's handler instead of stacking a second one. Replacing
 * rather than skipping matters: a fresh module instance has its own `cached`,
 * so it needs its own live handler, and the dead instance's must go.
 */
function installCrossTabConsentListener(): void {
  if (typeof window === 'undefined' || typeof window.addEventListener !== 'function') return;
  const holder = window as unknown as Record<string, unknown>;
  const previous = holder[CROSS_TAB_LISTENER_KEY];
  if (typeof previous === 'function') {
    window.removeEventListener('storage', previous as EventListener);
  }
  holder[CROSS_TAB_LISTENER_KEY] = handleConsentStorage;
  window.addEventListener('storage', handleConsentStorage);
}

installCrossTabConsentListener();

/** Test seam only. */
export function __resetAnalyticsConsentCache(): void {
  cached = null;
  listeners.clear();
}
