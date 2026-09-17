import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * CONSENT IS PER-BROWSER, NOT PER-TAB.
 *
 * `lib/analyticsConsent` memoizes the answer in a module variable, and a module
 * variable is per DOCUMENT. `setAnalyticsConsent` updates it synchronously, so
 * the tab that makes the change is right immediately — and every OTHER open tab
 * kept its old value until it was reloaded or navigated. Two tabs on the same
 * circle, unticked in one: the other went on stamping `circle_id` on every
 * event.
 *
 * That is precisely the property `before_send` exists to provide.
 * `currentAnalyticsMode()` is re-read PER EVENT rather than resolved once at
 * init, so a mid-session withdrawal takes effect on the very next capture — a
 * guarantee that held within a tab and failed silently across them.
 *
 * WHY THE SDK DOES NOT ALREADY COVER THIS. posthog-js re-reads its own opt-out
 * flag (`__ph_opt_in_out_<token>`, localStorage — the store is chosen by
 * `opt_out_capturing_persistence_type`, which defaults to 'localStorage'
 * INDEPENDENTLY of our `persistence: 'memory'`) on every single capture:
 * `capture()` → `is_capturing()` → `has_opted_out_capturing()` → a fresh
 * `getItem`, with only the store OBJECT memoized, never the value (verified in
 * the installed posthog-js@1.386.6 `dist/module.js`). So if we ever wrote that
 * flag, capture-blocking would propagate across tabs by itself. We do not:
 * with `ANONYMOUS_ANALYTICS_WHEN_DECLINED` on, `disableAnalytics` performs
 * `reset()` ONLY and deliberately never calls `opt_out_capturing()`, because
 * the declined cohort is meant to stay visible anonymously. Our `before_send`
 * gate is therefore the ONLY thing standing between a withdrawal and a stable
 * id — and it is the thing that was stale.
 *
 * So the leak is precisely "kept capturing WITH `circle_id` and UUID-bearing
 * URLs un-stripped", not "kept capturing at all".
 *
 * These tests drive the REAL `before_send` posthog is initialized with, so what
 * they assert is what would actually be transmitted.
 */

const capture = vi.fn();
const init = vi.fn();
const register = vi.fn();
const optIn = vi.fn();
const optOut = vi.fn();
const resetFn = vi.fn();
const identifyFn = vi.fn();

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

const CONSENT_KEY = 'cc_analytics_enabled';

/** The real posthog.ts + the consent module instance it actually reads. */
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
  const consent = await import('@/lib/analyticsConsent');
  const mode = await import('@/lib/analyticsMode');
  const loader = await import('@/lib/posthogLoader');
  return { ...posthog, ...consent, ...mode, ...loader };
}

const flush = (): Promise<void> => new Promise((resolve) => setTimeout(resolve, 0));

type BeforeSend = (event: { event: string; properties: Record<string, unknown> } | null) => {
  properties: Record<string, unknown>;
} | null;

/** Boot the SDK the way the app does and hand back its live `before_send`. */
async function bootAndGetBeforeSend(
  loaded: Awaited<ReturnType<typeof loadFresh>>
): Promise<BeforeSend> {
  loaded.initAnalytics();
  await loaded.loadPosthogModule();
  await flush();
  const config = init.mock.calls[0][1] as { before_send: BeforeSend };
  return config.before_send;
}

/**
 * What the browser delivers to every OTHER document when one tab writes. The
 * writing tab is excluded by spec, which is exactly why this cannot be
 * simulated with a plain `setItem`.
 */
function otherTabWrote(key: string | null, newValue: string | null, oldValue: string | null): void {
  window.dispatchEvent(
    new StorageEvent('storage', { key, newValue, oldValue, storageArea: localStorage })
  );
}

const EVENT = () => ({
  event: 'circle_viewed',
  properties: { circle_id: 'c-123', platform: 'web', distinct_id: 'anon-1' },
});

beforeEach(() => {
  capture.mockClear();
  init.mockClear();
  register.mockClear();
  optIn.mockClear();
  optOut.mockClear();
  resetFn.mockClear();
  identifyFn.mockClear();
  localStorage.clear();
});

afterEach(() => {
  vi.doUnmock('@/lib/env');
});

describe('a withdrawal in another tab', () => {
  /** The control: without a cross-tab change, a consenting tab keeps its ids. */
  it('leaves ids in place while consent still stands', async () => {
    const loaded = await loadFresh();
    loaded.setAnalyticsConsent(true);
    const beforeSend = await bootAndGetBeforeSend(loaded);

    expect(beforeSend(EVENT())?.properties.circle_id).toBe('c-123');
  });

  it('anonymizes the very next event in THIS tab', async () => {
    const loaded = await loadFresh();
    loaded.setAnalyticsConsent(true);
    const beforeSend = await bootAndGetBeforeSend(loaded);

    // The other tab persisted the withdrawal, then the browser told us.
    localStorage.setItem(CONSENT_KEY, 'false');
    otherTabWrote(CONSENT_KEY, 'false', 'true');

    expect(beforeSend(EVENT())?.properties.circle_id).toBeUndefined();
    expect(loaded.currentAnalyticsMode()).toBe('anonymous');
    expect(loaded.getAnalyticsConsentState()).toBe('declined');
  });

  /**
   * NO TEARDOWN IN THE RECEIVING TAB. `disableAnalytics` runs `posthog.reset()`,
   * which drops the pending batch — and, decisively, posthog-js's `reset()`
   * calls `consent.reset()`, which DELETES `__ph_opt_in_out_<token>`. That key
   * is shared localStorage: in an 'off' configuration the withdrawing tab has
   * just written it, so a reset here would opt BOTH tabs back IN. Stripping is
   * what this listener owes; teardown is the withdrawing tab's own job.
   */
  it('does not reset or opt out the receiving tab', async () => {
    const loaded = await loadFresh();
    loaded.setAnalyticsConsent(true);
    await bootAndGetBeforeSend(loaded);
    resetFn.mockClear();

    localStorage.setItem(CONSENT_KEY, 'false');
    otherTabWrote(CONSENT_KEY, 'false', 'true');
    // Flushed, so a teardown reached through a LAZY import (the only way this
    // leaf module could reach lib/posthog without an import cycle) is caught
    // too, not just a synchronous one.
    await flush();

    expect(resetFn).not.toHaveBeenCalled();
    expect(optOut).not.toHaveBeenCalled();
  });
});

describe('the mirror case: an answer arriving in a tab that had none', () => {
  /**
   * A tab loaded while 'unasked' — the signup tab is a DIFFERENT one — never
   * noticed the visitor answering. Under-collection rather than a leak, but the
   * same stale cache, and the same listener covers it.
   */
  it('a GRANT in another tab lifts this one out of anonymous mode', async () => {
    const loaded = await loadFresh();
    expect(loaded.getAnalyticsConsentState()).toBe('unasked');
    const beforeSend = await bootAndGetBeforeSend(loaded);
    expect(beforeSend(EVENT())?.properties.circle_id).toBeUndefined();

    localStorage.setItem(CONSENT_KEY, 'true');
    otherTabWrote(CONSENT_KEY, 'true', null);

    expect(loaded.getAnalyticsConsentState()).toBe('granted');
    expect(loaded.currentAnalyticsMode()).toBe('full');
    expect(beforeSend(EVENT())?.properties.circle_id).toBe('c-123');
  });
});

describe('what the listener ignores', () => {
  it('an unrelated storage key changes nothing', async () => {
    const loaded = await loadFresh();
    loaded.setAnalyticsConsent(true);
    const beforeSend = await bootAndGetBeforeSend(loaded);

    // Something else entirely — including a key whose VALUE looks like ours.
    localStorage.setItem('cc_something_else', 'false');
    otherTabWrote('cc_something_else', 'false', 'true');

    expect(loaded.getAnalyticsConsentState()).toBe('granted');
    expect(beforeSend(EVENT())?.properties.circle_id).toBe('c-123');
  });

  /**
   * THE CASE THAT MAKES THE KEY CHECK LOAD-BEARING, rather than merely tidy.
   *
   * When `localStorage.setItem` throws — private mode, enterprise policy —
   * `setAnalyticsConsent` keeps the answer IN MEMORY on purpose, so the session
   * still honours a choice whose durability was lost. That is the one state
   * where cache and store legitimately disagree, and a listener that
   * invalidated on ANY storage event would throw the visitor's own recorded
   * "yes" away on the next unrelated write by any other module, silently
   * downgrading them to 'unasked'.
   */
  it('does not discard an in-memory answer the store never accepted', async () => {
    const loaded = await loadFresh();
    const setItem = vi
      .spyOn(Storage.prototype, 'setItem')
      .mockImplementation(() => {
        throw new Error('storage denied');
      });
    loaded.setAnalyticsConsent(true); // kept in memory only
    setItem.mockRestore();
    expect(loaded.getAnalyticsConsentState()).toBe('granted');
    expect(localStorage.getItem(CONSENT_KEY)).toBeNull();

    // Any other module writing anything — here, the consent retry marker.
    otherTabWrote('analytics_consent_pending_sync', '{}', null);

    expect(loaded.getAnalyticsConsentState()).toBe('granted');
  });

  /**
   * `key === null` is a whole-store `clear()` from another tab, which took our
   * key with it. Not "an unrelated key" — the one case where a null key must
   * still invalidate. Re-reading lands on 'unasked', which strips.
   */
  it('a clear() in another tab (null key) invalidates and fails toward stripping', async () => {
    const loaded = await loadFresh();
    loaded.setAnalyticsConsent(true);
    const beforeSend = await bootAndGetBeforeSend(loaded);

    localStorage.clear();
    otherTabWrote(null, null, null);

    expect(loaded.getAnalyticsConsentState()).toBe('unasked');
    expect(beforeSend(EVENT())?.properties.circle_id).toBeUndefined();
  });
});

describe('subscribers', () => {
  it('are notified of a cross-tab change, once, with the new value', async () => {
    const loaded = await loadFresh();
    loaded.setAnalyticsConsent(true);
    const seen: boolean[] = [];
    loaded.subscribeToAnalyticsConsent((enabled) => seen.push(enabled));

    localStorage.setItem(CONSENT_KEY, 'false');
    otherTabWrote(CONSENT_KEY, 'false', 'true');

    expect(seen).toEqual([false]);
  });

  it('are not notified when the arriving value matches what this tab already had', async () => {
    const loaded = await loadFresh();
    loaded.setAnalyticsConsent(true);
    const seen: boolean[] = [];
    loaded.subscribeToAnalyticsConsent((enabled) => seen.push(enabled));

    localStorage.setItem(CONSENT_KEY, 'true');
    otherTabWrote(CONSENT_KEY, 'true', 'true');

    expect(seen).toEqual([]);
  });
});

describe('the listener itself', () => {
  /**
   * ONE LIVE HANDLER PER WINDOW, however many times the module is evaluated
   * (`vi.resetModules()` here, HMR in dev). Counting registrations alone would
   * pin vitest's module-registry behaviour rather than ours, so this matches
   * each registered handler against its retirement by IDENTITY: whatever the
   * reload count, exactly one of them may still be listening at the end.
   */
  it('does not stack across repeated module loads', async () => {
    const addSpy = vi.spyOn(window, 'addEventListener');
    const removeSpy = vi.spyOn(window, 'removeEventListener');

    await loadFresh();
    await loadFresh();

    const added = addSpy.mock.calls
      .filter(([type]) => type === 'storage')
      .map(([, handler]) => handler);
    const removed = removeSpy.mock.calls
      .filter(([type]) => type === 'storage')
      .map(([, handler]) => handler);
    const live = added.filter((handler) => !removed.includes(handler));

    expect(added.length).toBeGreaterThan(1); // it really did reload
    expect(live).toHaveLength(1);

    addSpy.mockRestore();
    removeSpy.mockRestore();
  });
});
