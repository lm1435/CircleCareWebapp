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
const moduleFactory = vi.fn();

vi.mock('posthog-js', () => {
  moduleFactory();
  return {
    default: {
      init,
      register,
      capture,
      reset: resetFn,
      opt_in_capturing: optIn,
      opt_out_capturing: optOut,
      identify: vi.fn(),
      captureException: vi.fn(),
    },
  };
});

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
  moduleFactory.mockClear();
  localStorage.clear();
});

afterEach(() => {
  vi.doUnmock('@/lib/env');
});

describe('a declined visitor never triggers the SDK fetch', () => {
  it('initAnalytics then resetAnalytics (logout) never imports posthog-js', async () => {
    const { initAnalytics, resetAnalytics, setAnalyticsConsent } = await loadFresh();
    setAnalyticsConsent(false);

    initAnalytics(); // consent gate returns early — mode is 'off'
    resetAnalytics(); // logout — the getLoadedPosthogModule() guard returns early
    await flush();

    // The load-bearing assertion: posthog-js's module factory never ran at
    // all, i.e. `import('posthog-js')` was never attempted.
    expect(moduleFactory).not.toHaveBeenCalled();
    expect(init).not.toHaveBeenCalled();
    expect(resetFn).not.toHaveBeenCalled();
    expect(optOut).not.toHaveBeenCalled();
  });
});

describe('logging out while declined leaves no stale opt-out to fire after re-consenting', () => {
  it('opt_in_capturing runs once consent is granted; opt_out_capturing is never called', async () => {
    const { initAnalytics, resetAnalytics, setAnalyticsConsent, loadPosthogModule } =
      await loadFresh();
    setAnalyticsConsent(false);

    initAnalytics(); // declined -> no-op
    resetAnalytics(); // logout while declined -> guarded no-op (the fix)

    setAnalyticsConsent(true); // re-consent, same tab/session
    initAnalytics(); // now loads and configures for real — attaches its
    // `.then(configure)` to the shared load promise FIRST.
    // Awaiting the SAME shared promise resolves only AFTER that already-
    // attached `.then(configure)` has run (Promise callbacks on one promise
    // fire in attachment order), so this is a deterministic wait for
    // `configure()` to have fully executed — no arbitrary timeout needed.
    await loadPosthogModule();
    await flush();

    expect(optIn).toHaveBeenCalledTimes(1);
    expect(optOut).not.toHaveBeenCalled();
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
  it('never calls init/register/opt-in if the visitor declines before the dynamic import resolves', async () => {
    const { initAnalytics, setAnalyticsConsent, loadPosthogModule } = await loadFresh();
    setAnalyticsConsent(true);

    initAnalytics(); // starts the (async) load while consenting
    // Declines in the SAME synchronous tick — before the mocked dynamic
    // import has had a chance to resolve. `configure()` must re-read consent
    // itself rather than trust the `mode` `initAnalytics` saw before the await.
    setAnalyticsConsent(false);

    await loadPosthogModule();
    await flush();

    expect(init).not.toHaveBeenCalled();
    expect(register).not.toHaveBeenCalled();
    expect(optIn).not.toHaveBeenCalled();
  });

  it('a genuinely consenting initAnalytics afterward still configures for real (not stuck "ready")', async () => {
    const { initAnalytics, setAnalyticsConsent, loadPosthogModule } = await loadFresh();
    setAnalyticsConsent(true);
    initAnalytics();
    setAnalyticsConsent(false);
    await loadPosthogModule();
    await flush();
    expect(init).not.toHaveBeenCalled();

    // Re-consenting and calling initAnalytics again must still configure for
    // real — the earlier decline must not have left the instance stuck in a
    // half-ready state that skips init forever.
    setAnalyticsConsent(true);
    initAnalytics();
    await loadPosthogModule();
    await flush();

    expect(init).toHaveBeenCalledTimes(1);
  });
});
