import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * END-TO-END PROOF of what each of the three consent states actually does to
 * the wire, against the REAL lib/posthog.ts + lib/posthogLoader.ts.
 *
 * The claims this file exists to make falsifiable:
 *   accepted -> identify() fires, and `circle_id` survives onto the event.
 *   declined -> the client is built, never opted in, never identified, and
 *               `circle_id` is stripped by `before_send`.
 *   unasked  -> byte-identical to declined on the wire, but a DIFFERENT record.
 *
 * Deliberately without the `__primePosthogForTests` seam, for the same reason
 * posthogConsentIntegration.test.ts avoids it: the bug shapes here live in the
 * lazy-load/consent interaction, and priming hides them.
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
  const loader = await import('@/lib/posthogLoader');
  const consent = await import('@/lib/analyticsConsent');
  const decision = await import('@/lib/analyticsConsentDecision');
  return { ...posthog, ...loader, ...consent, ...decision };
}

const flush = (): Promise<void> => new Promise((resolve) => setTimeout(resolve, 0));

/** The `before_send` hook the SDK was actually configured with. */
function beforeSend(): (event: { properties: Record<string, unknown> } | null) => {
  properties: Record<string, unknown>;
} | null {
  const options = init.mock.calls[0]?.[1] as
    | { before_send?: (e: unknown) => unknown }
    | undefined;
  if (!options?.before_send) throw new Error('posthog.init was never called with before_send');
  return options.before_send as never;
}

const EVENT = {
  event: 'circle_viewed',
  properties: {
    distinct_id: 'random-memory-id',
    circle_id: '11111111-2222-3333-4444-555555555555',
    $current_url: 'https://app.circlecare.app/circles/11111111-2222-3333-4444-555555555555/calendar',
    member_count: 4,
  },
};

beforeEach(() => {
  for (const m of [capture, init, register, optIn, optOut, resetFn, identifyFn]) m.mockClear();
  localStorage.clear();
});

afterEach(() => {
  vi.doUnmock('@/lib/env');
});

describe('a signup that ACCEPTS', () => {
  it('is identified, opted in, and keeps circle_id on its events', async () => {
    const { recordAnalyticsConsentDecision, loadPosthogModule, identifyUser } = await loadFresh();

    // No explicit `initAnalytics()` here: recording an ACCEPTANCE must
    // configure the client by itself, or a visitor who consents at signup
    // keeps running whatever client they booted with until the next reload.
    recordAnalyticsConsentDecision(true);
    await loadPosthogModule();
    await flush();

    expect(init).toHaveBeenCalledTimes(1);
    expect(optIn).toHaveBeenCalledTimes(1);

    identifyUser('user-1');
    expect(identifyFn.mock.calls).toEqual([['user-1']]);

    const sent = beforeSend()(structuredClone(EVENT));
    expect(sent?.properties.circle_id).toBe(EVENT.properties.circle_id);
    // Per-circle breakdowns are exactly what full consent buys.
    expect(sent?.properties.$current_url).toContain(EVENT.properties.circle_id);
  });
});

describe('a signup that DECLINES', () => {
  it('gets the anonymous client: initialised, never opted in, never identified', async () => {
    const { recordAnalyticsConsentDecision, loadPosthogModule, identifyUser, initAnalytics } =
      await loadFresh();

    recordAnalyticsConsentDecision(false);
    initAnalytics();
    await loadPosthogModule();
    await flush();

    expect(init).toHaveBeenCalledTimes(1); // the client EXISTS (crash visibility)
    expect(register).toHaveBeenCalledTimes(1); // $ip: null applies anonymously too
    expect(optIn).not.toHaveBeenCalled();

    identifyUser('user-1');
    expect(identifyFn).not.toHaveBeenCalled();
  });

  it('has circle_id stripped and UUIDs masked in the URL', async () => {
    const { recordAnalyticsConsentDecision, loadPosthogModule, initAnalytics } = await loadFresh();

    recordAnalyticsConsentDecision(false);
    initAnalytics();
    await loadPosthogModule();
    await flush();

    const sent = beforeSend()(structuredClone(EVENT));
    expect(sent?.properties).not.toHaveProperty('circle_id');
    expect(sent?.properties.$current_url).not.toContain(EVENT.properties.circle_id);
    // Ingestion still needs a distinct id, and non-identifying props survive.
    expect(sent?.properties.distinct_id).toBe('random-memory-id');
    expect(sent?.properties.member_count).toBe(4);
  });
});

describe('a visitor who has NOT been asked', () => {
  it('is on the wire identical to a decliner — nothing under their identity', async () => {
    const { loadPosthogModule, identifyUser, initAnalytics, getAnalyticsConsentState } =
      await loadFresh();

    expect(getAnalyticsConsentState()).toBe('unasked');
    initAnalytics();
    await loadPosthogModule();
    await flush();

    expect(optIn).not.toHaveBeenCalled();
    identifyUser('user-1');
    expect(identifyFn).not.toHaveBeenCalled();

    const sent = beforeSend()(structuredClone(EVENT));
    expect(sent?.properties).not.toHaveProperty('circle_id');
  });

  it('is nonetheless a DIFFERENT RECORD from a decliner', async () => {
    const { recordAnalyticsConsentDecision, getAnalyticsConsentState, hasAnsweredAnalyticsConsent } =
      await loadFresh();

    expect(getAnalyticsConsentState()).toBe('unasked');
    expect(hasAnsweredAnalyticsConsent()).toBe(false);

    recordAnalyticsConsentDecision(false);

    expect(getAnalyticsConsentState()).toBe('declined');
    expect(hasAnsweredAnalyticsConsent()).toBe(true);
  });
});

describe('the answer survives a reload', () => {
  it('a fresh page load re-reads GRANTED and identifies without re-asking', async () => {
    const first = await loadFresh();
    first.recordAnalyticsConsentDecision(true);

    // A new page load: every module is constructed again, only localStorage
    // carries over.
    const { initAnalytics, loadPosthogModule, identifyUser, hasAnsweredAnalyticsConsent } =
      await loadFresh();
    expect(hasAnsweredAnalyticsConsent()).toBe(true);

    initAnalytics();
    await loadPosthogModule();
    await flush();
    identifyUser('user-1');

    expect(optIn).toHaveBeenCalled();
    expect(identifyFn.mock.calls).toEqual([['user-1']]);
  });

  it('a fresh page load re-reads DECLINED and does not re-ask', async () => {
    const first = await loadFresh();
    first.recordAnalyticsConsentDecision(false);

    const { hasAnsweredAnalyticsConsent, getAnalyticsConsentState } = await loadFresh();

    expect(hasAnsweredAnalyticsConsent()).toBe(true);
    expect(getAnalyticsConsentState()).toBe('declined');
  });
});
