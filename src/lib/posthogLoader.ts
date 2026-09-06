/**
 * Shared lazy-loader + action queue for `posthog-js` (~64 KB gzip).
 *
 * `lib/posthog.ts` (init/identify/reset/disable/captureException) and
 * `lib/analytics.ts` + `lib/pageview.ts` (event capture) all route their
 * posthog-js calls through `withPosthog` below instead of importing the SDK
 * themselves. That buys three things:
 *
 * - The SDK is fetched with exactly ONE dynamic `import()`, shared by all
 *   three modules — whichever of them runs first (`initAnalytics` scheduled
 *   after first paint in `main.tsx`, or an event fired the instant the app
 *   boots) starts the fetch; everyone else reuses the same promise.
 * - Nothing statically imports 'posthog-js', so it lands in its own chunk
 *   instead of the entry bundle.
 * - `posthog.init()` is always the FIRST thing that runs against a freshly
 *   loaded instance. Only `markPosthogReady` — called exclusively by
 *   `initAnalytics`'s `configure()`, after init()/register()/opt-in have been
 *   applied — flips the queue open, so a capture that raced ahead of init can
 *   never reach posthog-js before it has been configured.
 *
 * CONSENT-CONTROL ENTRIES (`kind: 'consentControl'`, used by
 * `resetAnalytics`/`disableAnalytics`): `markPosthogReady` never runs these.
 * `configure()` has JUST finished freshly deciding this instance's opt-in/out
 * state for whatever consent is current RIGHT NOW; a reset/opt-out that
 * queued earlier necessarily reflects an OLDER decision and would silently
 * override the fresh one the moment it flushed (this is exactly the bug: a
 * declined visitor logs out — which used to queue a reset+opt-out — then
 * re-consents and the queued closure would opt them back OUT the instant the
 * SDK finally loaded). `resetAnalytics`/`disableAnalytics` are additionally
 * guarded so they never even reach the queue unless the SDK has already
 * loaded (see their call sites in lib/posthog.ts) — this queue-side drop is
 * defense in depth for the residual load-resolved-but-not-yet-ready window.
 */
type PostHogModule = typeof import('posthog-js');
export type PostHogInstance = PostHogModule['default'];

type QueueEntry = {
  kind: 'capture' | 'consentControl';
  run: (ph: PostHogInstance) => void;
};

let sdkPromise: Promise<PostHogInstance> | null = null;
// Populated as soon as the dynamic import resolves — lets `initAnalytics` run
// SYNCHRONOUSLY when the SDK is already loaded, instead of always deferring
// through a microtask via `.then()` (which would never be able to run before
// init/register/opt-in have executed, even on a warm cache).
let loadedModule: PostHogInstance | null = null;
// Populated only once `initAnalytics` has finished configuring the instance.
// This is the gate `withPosthog` checks — NOT `loadedModule` — so a capture
// can never reach a posthog-js instance that hasn't been `.init()`-ed yet.
let readyInstance: PostHogInstance | null = null;
const queue: QueueEntry[] = [];

/**
 * Start (or reuse) the dynamic import of posthog-js. Does NOT mark the SDK
 * ready for capture — only `markPosthogReady` does that.
 *
 * A REJECTED import (chunk 404 after a redeploy, offline, a flaky CDN) must
 * not be cached forever — without clearing `sdkPromise` on failure, every
 * future call site (a fresh `Analytics.*` call, a retried `initAnalytics`)
 * would replay the SAME rejection until a full page reload, permanently
 * bricking analytics (and, via the identical pattern in purchases.ts,
 * checkout) for the rest of the session.
 */
export function loadPosthogModule(): Promise<PostHogInstance> {
  if (!sdkPromise) {
    sdkPromise = import('posthog-js')
      .then((mod) => {
        loadedModule = mod.default;
        return mod.default;
      })
      .catch((err: unknown) => {
        sdkPromise = null;
        throw err;
      });
  }
  return sdkPromise;
}

/** The already-resolved module, if the dynamic import has completed — lets
 *  `initAnalytics` configure synchronously on a warm cache. */
export function getLoadedPosthogModule(): PostHogInstance | null {
  return loadedModule;
}

/**
 * Drop everything queued, without running any of it, and WITHOUT marking the
 * SDK ready. Used when `configure()` discovers consent was withdrawn while
 * the SDK was loading: the instance must never be treated as "ready" for
 * future captures (it was never `.init()`-ed), and nothing queued under the
 * old, now-stale consent decision should run against whatever configuration
 * eventually does apply.
 */
export function clearPendingQueue(): void {
  queue.length = 0;
}

/**
 * Called by `initAnalytics`'s `configure()` once init()/register()/opt-in
 * have all run against `instance`. Flushes every `capture`-kind action queued
 * while the SDK was loading or being configured, in the order they arrived.
 * `consentControl`-kind entries (reset/disable) are deliberately dropped, not
 * run — see this module's doc comment.
 */
export function markPosthogReady(instance: PostHogInstance): void {
  readyInstance = instance;
  const pending = queue.splice(0, queue.length);
  for (const entry of pending) {
    if (entry.kind === 'consentControl') continue;
    try {
      entry.run(instance);
    } catch {
      // Analytics is best-effort — a queued action failing must never surface
      // anywhere near the feature that originally triggered it.
    }
  }
}

/**
 * Run `action` against the ready posthog instance now, or queue it (and
 * ensure a load is in flight) if the SDK isn't configured yet. Never throws.
 *
 * `kind` defaults to `'capture'` (event capture, identify, exception
 * reporting — anything that should simply run once the SDK is ready).
 * `resetAnalytics`/`disableAnalytics` pass `'consentControl'` — see this
 * module's doc comment for why those are dropped rather than replayed.
 */
export function withPosthog(
  action: (ph: PostHogInstance) => void,
  kind: QueueEntry['kind'] = 'capture'
): void {
  if (readyInstance) {
    try {
      action(readyInstance);
    } catch {
      /* best-effort — see markPosthogReady */
    }
    return;
  }
  queue.push({ kind, run: action });
  // Satisfies "on first tracked event" as a load trigger, in addition to
  // main.tsx's after-first-paint schedule — whichever happens first wins;
  // `loadPosthogModule` dedupes so this never causes a second fetch. Caught
  // so a load failure here (see `loadPosthogModule`'s doc comment) never
  // becomes an unhandled rejection — the queued action just never flushes;
  // `configure()`'s own `.catch` is what actually surfaces/logs a failure.
  void loadPosthogModule().catch(() => {
    /* best-effort — see loadPosthogModule's cache-clearing doc comment */
  });
}

/**
 * Test seam: prime the loader as if the SDK were already loaded AND
 * configured, so analytics.ts/pageview.ts/posthog.ts's own unit tests can
 * exercise their gating/sanitization logic SYNCHRONOUSLY, exactly as they did
 * before this module existed. Real queue/lazy-load behavior has its own test
 * (posthogLoader.test.ts) that does NOT use this seam.
 */
export function __primePosthogForTests(instance: PostHogInstance): void {
  loadedModule = instance;
  markPosthogReady(instance);
}

/** Test seam: drop all loader state. Mostly redundant with `vi.resetModules`
 *  (each reset gets a fresh module instance), kept for tests that want to
 *  reset state without a full module reset. */
export function __resetPosthogLoaderForTests(): void {
  sdkPromise = null;
  loadedModule = null;
  readyInstance = null;
  queue.length = 0;
}
