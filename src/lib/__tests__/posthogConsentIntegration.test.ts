import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * End-to-end tests of the REAL lazy-load + consent-gate interaction across
 * lib/posthog.ts, lib/pageview.ts and lib/posthogLoader.ts — deliberately
 * WITHOUT the `__primePosthogForTests` seam.
 *
 * analytics.test.ts / pageview.test.ts prime the loader so THEIR OWN
 * gating/sanitization logic can be asserted synchronously; priming would hide
 * exactly the bug this file exists to guard against — a declined visitor's
 * `resetAnalytics()` (logout) used to unconditionally queue a
 * `reset()+opt_out_capturing()` closure and kick off the SDK fetch, and if
 * that closure survived (still queued) until the visitor later re-consented
 * within the same tab, flushing it would silently opt them back OUT the
 * instant the SDK finished loading — with the Privacy toggle reading ON.
 *
 * `loadFresh()` calls `vi.resetModules()`, so `@/lib/analyticsConsent` must
 * also be re-imported PER TEST (see the `consent` var below) rather than
 * driven through a top-level static import — the fresh `posthog.ts` this file
 * exercises reads consent through ITS OWN freshly-imported (and separately
 * memoized) instance of that module. analytics.test.ts hit this identically.
 */

const capture = vi.fn();
const init = vi.fn();
const register = vi.fn();
const optIn = vi.fn();
const optOut = vi.fn();
const resetFn = vi.fn();
const identifyFn = vi.fn();

// No factory-call spy: vitest caches the mock factory's result across
// `vi.resetModules()`, so "the factory ran" only held for whichever test ran
// FIRST and failed under `--sequence.shuffle`. Tests assert on the fresh
// loader's own state instead — something each test itself causes.
vi.mock('posthog-js', () => ({
  default: {
    init,
    register,
    capture,
    reset: resetFn,
    opt_in_capturing: optIn,
    opt_out_capturing: optOut,
    identify: identifyFn,
    captureException: vi.fn(),
  },
}));

/** Import the real posthog.ts + pageview.ts + posthogLoader.ts + the consent
 *  module they'll actually read, all fresh, with a PostHog key configured. */
async function loadFresh() {
  vi.resetModules();
  vi.doMock('@/lib/env', () => ({
    env: {
      VITE_SUPABASE_URL: 'https://test.supabase.co',
      VITE_SUPABASE_ANON_KEY: 'anon',
      VITE_API_URL: 'http://localhost:3000',
      VITE_POSTHOG_KEY: 'phc_test_key',
    },
  }));
  const posthog = await import('@/lib/posthog');
  const pageview = await import('@/lib/pageview');
  const loader = await import('@/lib/posthogLoader');
  const consent = await import('@/lib/analyticsConsent');
  return { ...posthog, ...pageview, ...loader, ...consent };
}

/** Flush pending microtasks — enough ticks for a dynamic import() plus its
 *  chained `.then(configure)` to fully settle. A macrotask boundary always
 *  runs after every microtask queued before it. Used as a belt-and-suspenders
 *  on top of directly awaiting `loadPosthogModule()` below. */
const flush = (): Promise<void> => new Promise((resolve) => setTimeout(resolve, 0));

beforeEach(() => {
  capture.mockClear();
  init.mockClear();
  register.mockClear();
  optIn.mockClear();
  optOut.mockClear();
  resetFn.mockClear();
  identifyFn.mockClear();
  handedToLoader.length = 0;
  localStorage.clear();
});

afterEach(() => {
  vi.doUnmock('@/lib/env');
});

describe('a declined visitor gets an ANONYMOUS client at boot (flag on)', () => {
  it('initAnalytics loads + inits posthog-js, never opts in, never identifies; logout resets without opting out', async () => {
    const {
      initAnalytics,
      resetAnalytics,
      identifyUser,
      setAnalyticsConsent,
      loadPosthogModule,
      getLoadedPosthogModule,
    } = await loadFresh();
    setAnalyticsConsent(false);
    // Fresh loader (vi.resetModules in loadFresh): nothing loaded yet, so a
    // loaded module below can only come from THIS test's initAnalytics.
    expect(getLoadedPosthogModule()).toBeNull();

    initAnalytics(); // declined -> 'anonymous' -> loads and configures
    // Awaiting the SAME shared promise resolves only AFTER the already-
    // attached `.then(configure)` has run (Promise callbacks on one promise
    // fire in attachment order), so this is a deterministic wait for
    // `configure()` to have fully executed — no arbitrary timeout needed.
    await loadPosthogModule();
    await flush();

    expect(getLoadedPosthogModule()).not.toBeNull();
    expect(getLoadedPosthogModule()?.init).toBe(init); // the mocked posthog-js, loaded here
    expect(init).toHaveBeenCalledTimes(1);
    expect(optIn).not.toHaveBeenCalled(); // nothing to un-remember; SDK default

    identifyUser('user-1'); // the auth store on sign-in
    expect(identifyFn).not.toHaveBeenCalled(); // identifyAllowed('anonymous') is false

    resetAnalytics(); // logout while declined
    expect(resetFn).toHaveBeenCalledTimes(1); // fresh random id, queue dropped
    expect(optOut).not.toHaveBeenCalled(); // capture continues anonymously
  });
});

describe('logging out while declined leaves no stale opt-out to fire after re-consenting', () => {
  it('opt_in_capturing runs once consent is granted; opt_out_capturing is never called', async () => {
    const { initAnalytics, resetAnalytics, setAnalyticsConsent, loadPosthogModule } =
      await loadFresh();
    setAnalyticsConsent(false);

    initAnalytics(); // declined -> anonymous client
    await loadPosthogModule();
    await flush();
    resetAnalytics(); // logout while declined -> reset only, nothing to leave behind

    setAnalyticsConsent(true); // re-consent, same tab/session
    initAnalytics(); // warm cache -> configures synchronously, opts in for real
    await flush();

    expect(optIn).toHaveBeenCalledTimes(1);
    expect(optOut).not.toHaveBeenCalled();
  });
});

type AnalyticsModeModule = typeof import('@/lib/analyticsMode');
type PosthogLoaderModule = typeof import('@/lib/posthogLoader');

/** Every `withPosthog` hand-off from lib/posthog.ts, by kind, in order. */
const handedToLoader: string[] = [];

/**
 * Wrap the REAL loader's `withPosthog` so every hand-off is recorded before it
 * is queued (or run). The queue itself has no getter, and `markPosthogReady`
 * silently drops `consentControl` entries — so without this, a logout that
 * queued a stale reset/opt-out (and did not fetch) was invisible. Call BEFORE
 * `loadFresh`; the describe below unmocks it.
 */
function watchLoaderHandOffs(): void {
  vi.doMock('@/lib/posthogLoader', async (importOriginal) => {
    const actual = await importOriginal<PosthogLoaderModule>();
    const withPosthog: PosthogLoaderModule['withPosthog'] = (action, kind) => {
      handedToLoader.push(kind ?? 'capture');
      actual.withPosthog(action, kind);
    };
    return { ...actual, withPosthog };
  });
}

/**
 * Force the DECLINED mode to 'off' — what ANONYMOUS_ANALYTICS_WHEN_DECLINED=false
 * resolves to — without editing the constant (same override as
 * analytics.test.ts). Call BEFORE `loadFresh`; the describe below unmocks it.
 */
function forceDeclinedModeOff(): void {
  vi.doMock('@/lib/analyticsMode', async (importOriginal) => {
    const actual = await importOriginal<AnalyticsModeModule>();
    const resolveAnalyticsMode = (consented: boolean): 'full' | 'off' =>
      consented ? 'full' : 'off';
    // Read consent through the SAME fresh module instance posthog.ts will use.
    const consent = await import('@/lib/analyticsConsent');
    const currentAnalyticsMode = () => resolveAnalyticsMode(consent.getAnalyticsConsent());
    return {
      ...actual,
      ANONYMOUS_ANALYTICS_WHEN_DECLINED: false,
      resolveAnalyticsMode,
      currentAnalyticsMode,
      analyticsCollectionAllowed: () => actual.collectionAllowed(currentAnalyticsMode()),
    };
  });
}

/**
 * THE CONFIGURATION WHERE THE HEADER'S BUG IS REACHABLE.
 *
 * With the flag ON (as shipped) a declined visitor has a loaded anonymous
 * client and `resetAnalytics` never opts out, so the describe above cannot
 * exercise the "SDK not loaded" guard at all. With the flag OFF the declined
 * mode is 'off': nothing is loaded at boot, and logout computes
 * `shouldStayOptedOut = true` — exactly the reset+opt-out closure the guard
 * exists to never queue.
 *
 * The guard's observable is the FETCH: without it, logout queues the closure
 * AND starts loading posthog-js for a visitor who said no. (The loader also
 * drops queued `consentControl` entries at `markPosthogReady`, so the stale
 * opt-out is defended twice; the fetch is what only the guard prevents.)
 */
describe('flag OFF: logging out while declined neither fetches the SDK nor leaves an opt-out behind', () => {
  afterEach(() => {
    vi.doUnmock('@/lib/analyticsMode');
    vi.doUnmock('@/lib/posthogLoader');
  });

  it('never loads posthog-js on logout; re-consenting opts in once and nothing opts out', async () => {
    forceDeclinedModeOff();
    watchLoaderHandOffs();
    const {
      initAnalytics,
      resetAnalytics,
      setAnalyticsConsent,
      loadPosthogModule,
      getLoadedPosthogModule,
    } = await loadFresh();
    setAnalyticsConsent(false);

    initAnalytics(); // declined -> 'off' -> constructs and fetches nothing
    await flush();
    expect(getLoadedPosthogModule()).toBeNull();

    resetAnalytics(); // logout while declined, flag off
    await flush();
    expect(getLoadedPosthogModule()).toBeNull(); // no fetch
    // …AND nothing queued: the guard must stop the reset/opt-out closure from
    // ever reaching the loader, not merely stop the fetch.
    expect(handedToLoader).toEqual([]);
    expect(resetFn).not.toHaveBeenCalled();
    expect(optOut).not.toHaveBeenCalled();

    setAnalyticsConsent(true); // re-consent, same tab/session
    initAnalytics();
    await loadPosthogModule();
    await flush();

    expect(init).toHaveBeenCalledTimes(1);
    expect(optIn).toHaveBeenCalledTimes(1);
    expect(resetFn).not.toHaveBeenCalled();
    expect(optOut).not.toHaveBeenCalled();
    // Re-consent flushed no stale consent-control entry: none was ever handed over.
    expect(handedToLoader).not.toContain('consentControl');
  });
});

describe('trackPageview fired before the SDK loads is delivered once initAnalytics finishes', () => {
  it('delivers the queued $pageview end-to-end', async () => {
    const { initAnalytics, trackPageview, setAnalyticsConsent, loadPosthogModule } =
      await loadFresh();
    setAnalyticsConsent(true);

    trackPageview('/login'); // fires before ANY load has started
    expect(capture).not.toHaveBeenCalled();

    initAnalytics();
    await loadPosthogModule();
    await flush();

    expect(capture).toHaveBeenCalledWith(
      '$pageview',
      expect.objectContaining({ $pathname: '/login' })
    );
  });
});

describe('consent withdrawn WHILE the SDK is still loading is honored at configure time', () => {
  it('configures as ANONYMOUS (init + register, NO opt-in) if the visitor declines before the dynamic import resolves', async () => {
    const { initAnalytics, setAnalyticsConsent, loadPosthogModule } = await loadFresh();
    setAnalyticsConsent(true);

    initAnalytics(); // starts the (async) load while consenting
    // Declines in the SAME synchronous tick — before the mocked dynamic
    // import has had a chance to resolve. `configure()` must re-read consent
    // itself rather than trust the `mode` `initAnalytics` saw before the await:
    // the 'full' decision it started with must NOT produce an opt-in.
    setAnalyticsConsent(false);

    await loadPosthogModule();
    await flush();

    expect(init).toHaveBeenCalledTimes(1);
    expect(register).toHaveBeenCalledTimes(1); // $ip: null etc. apply anonymously too
    expect(optIn).not.toHaveBeenCalled();
  });

  it('a genuinely consenting initAnalytics afterward opts in for real', async () => {
    const { initAnalytics, setAnalyticsConsent, loadPosthogModule } = await loadFresh();
    setAnalyticsConsent(true);
    initAnalytics();
    setAnalyticsConsent(false);
    await loadPosthogModule();
    await flush();
    expect(optIn).not.toHaveBeenCalled();

    // Re-consenting and calling initAnalytics again must upgrade the running
    // anonymous client to 'full' — the earlier decline must not have left it
    // stuck without an opt-in.
    setAnalyticsConsent(true);
    initAnalytics();
    await flush();

    expect(optIn).toHaveBeenCalledTimes(1);
  });
});
