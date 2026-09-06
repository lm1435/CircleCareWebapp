import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * lib/bootErrorBuffer.ts — the pre-init window error/rejection buffer.
 *
 * Two layers:
 *  1. UNIT (the `sink` seam): what gets stored, the cap, sanitisation at
 *     store time, listener removal, never-throws.
 *  2. INTEGRATION through the REAL `initAnalytics` (fresh modules, real lazy
 *     loader, mocked posthog-js — same technique as
 *     posthogConsentIntegration.test.ts): a consenting visitor's boot errors
 *     reach `posthog.captureException` tagged `boundary: 'boot'`; a declining
 *     visitor's are DISCARDED, not deferred.
 *
 * jsdom has `ErrorEvent` but no `PromiseRejectionEvent`, so rejections are
 * dispatched as a plain Event with a `reason` property — which is all the
 * listener reads.
 */

const captureExceptionSpy = vi.fn();
const init = vi.fn();
const register = vi.fn();

vi.mock('posthog-js', () => ({
  default: {
    init,
    register,
    capture: vi.fn(),
    identify: vi.fn(),
    reset: vi.fn(),
    opt_in_capturing: vi.fn(),
    opt_out_capturing: vi.fn(),
    captureException: captureExceptionSpy,
  },
}));

function dispatchError(error: unknown, message = 'boom'): void {
  window.dispatchEvent(new ErrorEvent('error', { error, message }));
}

function dispatchRejection(reason: unknown): void {
  window.dispatchEvent(Object.assign(new Event('unhandledrejection'), { reason }));
}

const flushMicrotasks = (): Promise<void> => new Promise((resolve) => setTimeout(resolve, 0));

async function loadBuffer() {
  vi.resetModules();
  return import('@/lib/bootErrorBuffer');
}

/** Fresh posthog.ts + bootErrorBuffer.ts + consent. `key` is explicit on
 *  purpose (no default): `undefined` must mean "no key", and a default
 *  parameter would silently swallow it. */
async function loadFreshWithKey(key: string | undefined) {
  vi.resetModules();
  vi.doMock('@/lib/env', () => ({
    env: {
      VITE_SUPABASE_URL: 'https://test.supabase.co',
      VITE_SUPABASE_ANON_KEY: 'anon',
      VITE_API_URL: 'http://localhost:3000',
      VITE_POSTHOG_KEY: key,
    },
  }));
  const buffer = await import('@/lib/bootErrorBuffer');
  const posthog = await import('@/lib/posthog');
  const loader = await import('@/lib/posthogLoader');
  const consent = await import('@/lib/analyticsConsent');
  return { ...buffer, ...posthog, ...loader, ...consent };
}

// Vitest's jsdom environment wraps `window.addEventListener` and, while NO
// user 'error' listener is registered, re-throws any dispatched `ErrorEvent`
// carrying an `error` as an uncaught exception (vitest/dist/chunks: 
// `catchWindowErrors`). Several tests below dispatch AFTER the buffer has
// removed its own listeners — the whole point being that nobody of ours is
// listening — so a no-op listener keeps vitest's count above zero for the
// duration of each test. It does nothing else.
const keepVitestQuiet = (): void => {};

beforeEach(() => {
  captureExceptionSpy.mockClear();
  init.mockClear();
  register.mockClear();
  localStorage.clear();
  window.addEventListener('error', keepVitestQuiet);
});

afterEach(() => {
  window.removeEventListener('error', keepVitestQuiet);
  vi.doUnmock('@/lib/env');
  vi.restoreAllMocks();
});

describe('unit: buffering before flush', () => {
  it('holds errors thrown before flush and replays each through the sink as boundary "boot"', async () => {
    const buf = await loadBuffer();
    buf.installBootErrorBuffer();

    dispatchError(new TypeError('Cannot read properties of undefined'));
    dispatchRejection(new Error('auth bootstrap failed'));
    expect(buf.__bootErrorCountForTests()).toBe(2);

    const sink = vi.fn();
    buf.flushBootErrors(sink);

    expect(sink).toHaveBeenCalledTimes(2);
    expect(sink).toHaveBeenNthCalledWith(1, expect.any(Error), 'boot');
    expect(sink).toHaveBeenNthCalledWith(2, expect.any(Error), 'boot');
    const [first] = sink.mock.calls[0] as [Error, string];
    expect(first.name).toBe('TypeError');
    expect(first.message).toBe('Cannot read properties of undefined');
    expect(buf.BOOT_BOUNDARY).toBe('boot');
    expect(buf.__bootErrorCountForTests()).toBe(0);
  });

  it('caps at MAX_BOOT_ERRORS (10), keeping the earliest', async () => {
    const buf = await loadBuffer();
    buf.installBootErrorBuffer();

    for (let i = 0; i < 25; i += 1) dispatchError(new Error(`error ${i}`));
    expect(buf.__bootErrorCountForTests()).toBe(10);
    expect(buf.MAX_BOOT_ERRORS).toBe(10);

    const sink = vi.fn();
    buf.flushBootErrors(sink);
    expect(sink).toHaveBeenCalledTimes(10);
    const messages = sink.mock.calls.map(([e]) => (e as Error).message);
    expect(messages[0]).toBe('error 0');
    expect(messages[9]).toBe('error 9');
  });

  it('removes both listeners after flush: a later error is NOT buffered or replayed', async () => {
    const buf = await loadBuffer();
    buf.installBootErrorBuffer();
    dispatchError(new Error('before'));

    const sink = vi.fn();
    buf.flushBootErrors(sink);
    expect(sink).toHaveBeenCalledTimes(1);

    dispatchError(new Error('after'));
    dispatchRejection(new Error('after rejection'));
    expect(buf.__bootErrorCountForTests()).toBe(0);

    buf.flushBootErrors(sink);
    expect(sink).toHaveBeenCalledTimes(1);
  });

  it('discard drops everything unsent and stops listening', async () => {
    const buf = await loadBuffer();
    buf.installBootErrorBuffer();
    dispatchError(new Error('lost on purpose'));
    expect(buf.__bootErrorCountForTests()).toBe(1);

    buf.discardBootErrors();
    expect(buf.__bootErrorCountForTests()).toBe(0);

    dispatchError(new Error('after discard'));
    expect(buf.__bootErrorCountForTests()).toBe(0);
  });

  it('sanitizes at STORE time — an unflushed buffer never holds an email, token or query string', async () => {
    const buf = await loadBuffer();
    buf.installBootErrorBuffer();

    dispatchError(
      new Error(
        'Failed to fetch /api/invites?email=pat@example.com for eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxIn0.sig'
      )
    );
    dispatchRejection('rejected for maria@example.com');

    const sink = vi.fn();
    buf.flushBootErrors(sink);
    const messages = sink.mock.calls.map(([e]) => (e as Error).message);
    expect(messages[0]).toBe('Failed to fetch /api/invites for [token]');
    expect(messages[1]).toBe('rejected for [email]');
    for (const m of messages) {
      expect(m).not.toMatch(/@/);
      expect(m).not.toMatch(/eyJ/);
    }
  });

  it('wraps non-Error rejection reasons without retaining the object itself', async () => {
    const buf = await loadBuffer();
    buf.installBootErrorBuffer();

    const node = document.createElement('div');
    node.textContent = 'Margaret Ortiz, Lisinopril 10mg';
    dispatchRejection(node);
    dispatchRejection({ some: 'object' });
    dispatchRejection(undefined);
    // A cross-origin script error: `error` is null, only `message` is set.
    dispatchError(null, 'Script error.');

    const sink = vi.fn();
    buf.flushBootErrors(sink);
    const sent = sink.mock.calls.map(([e]) => e as Error);
    expect(sent).toHaveLength(4);
    expect(sent[0]?.message).toBe('[object HTMLDivElement]');
    expect(sent[0]?.message).not.toContain('Margaret');
    expect(sent[1]?.message).toBe('[object Object]');
    expect(sent[2]?.message).toBe('Unhandled promise rejection');
    expect(sent[3]?.message).toBe('Script error.');
    for (const e of sent) expect(e).toBeInstanceOf(Error);
  });

  it('never throws: install when addEventListener throws, flush with a throwing sink', async () => {
    const buf = await loadBuffer();
    const add = vi.spyOn(window, 'addEventListener').mockImplementation(() => {
      throw new Error('listeners unavailable');
    });
    expect(() => buf.installBootErrorBuffer()).not.toThrow();
    add.mockRestore();

    // Nothing was registered, so nothing is buffered — and flush/discard are
    // still safe to call.
    dispatchError(new Error('unheard'));
    expect(buf.__bootErrorCountForTests()).toBe(0);
    expect(() => buf.flushBootErrors(vi.fn())).not.toThrow();
    expect(() => buf.discardBootErrors()).not.toThrow();

    // A sink that throws on one entry must not stop the others.
    buf.installBootErrorBuffer();
    dispatchError(new Error('one'));
    dispatchError(new Error('two'));
    const sink = vi.fn().mockImplementationOnce(() => {
      throw new Error('sink exploded');
    });
    expect(() => buf.flushBootErrors(sink)).not.toThrow();
    expect(sink).toHaveBeenCalledTimes(2);
  });

  it('install is idempotent — a second call does not double-buffer', async () => {
    const buf = await loadBuffer();
    buf.installBootErrorBuffer();
    buf.installBootErrorBuffer();
    dispatchError(new Error('once'));
    expect(buf.__bootErrorCountForTests()).toBe(1);
    buf.discardBootErrors();
  });
});

describe('integration: initAnalytics decides flush vs discard', () => {
  it('a consenting visitor: boot errors reach posthog.captureException as boundary "boot"', async () => {
    const mod = await loadFreshWithKey('phc_test_key');
    mod.installBootErrorBuffer();
    dispatchError(new RangeError('boot crash'));
    dispatchRejection(new Error('boot rejection'));

    mod.setAnalyticsConsent(true);
    mod.initAnalytics();
    await mod.loadPosthogModule();
    await flushMicrotasks();

    expect(init).toHaveBeenCalledTimes(1);
    expect(captureExceptionSpy).toHaveBeenCalledTimes(2);
    expect(captureExceptionSpy).toHaveBeenNthCalledWith(1, expect.any(Error), {
      boundary: 'boot',
      platform: 'web',
    });
    const [sent] = captureExceptionSpy.mock.calls[0] as [Error, unknown];
    expect(sent.name).toBe('RangeError');
    expect(sent.message).toBe('boot crash');
    expect(mod.__bootErrorCountForTests()).toBe(0);

    // Listeners are gone: a post-init error is posthog-js's to catch, not ours.
    captureExceptionSpy.mockClear();
    dispatchError(new Error('after init'));
    expect(captureExceptionSpy).not.toHaveBeenCalled();
    expect(mod.__bootErrorCountForTests()).toBe(0);
  });

  it('a declining visitor: the buffer is DISCARDED at init, and stays gone after a later consent', async () => {
    const mod = await loadFreshWithKey('phc_test_key');
    mod.installBootErrorBuffer();
    dispatchError(new Error('private crash'));
    expect(mod.__bootErrorCountForTests()).toBe(1);

    mod.setAnalyticsConsent(false);
    mod.initAnalytics();
    await flushMicrotasks();

    expect(init).not.toHaveBeenCalled();
    expect(captureExceptionSpy).not.toHaveBeenCalled();
    expect(mod.__bootErrorCountForTests()).toBe(0);

    // Consenting afterwards must not resurrect what was captured under "no".
    mod.setAnalyticsConsent(true);
    mod.initAnalytics();
    await mod.loadPosthogModule();
    await flushMicrotasks();
    expect(init).toHaveBeenCalledTimes(1);
    expect(captureExceptionSpy).not.toHaveBeenCalled();
  });

  it('no PostHog key: the buffer is released rather than held forever', async () => {
    const mod = await loadFreshWithKey(undefined);
    mod.installBootErrorBuffer();
    dispatchError(new Error('keyless crash'));
    expect(mod.__bootErrorCountForTests()).toBe(1);

    mod.setAnalyticsConsent(true);
    mod.initAnalytics();
    await flushMicrotasks();

    expect(mod.__bootErrorCountForTests()).toBe(0);
    expect(captureExceptionSpy).not.toHaveBeenCalled();
    dispatchError(new Error('still keyless'));
    expect(mod.__bootErrorCountForTests()).toBe(0);
  });
});
