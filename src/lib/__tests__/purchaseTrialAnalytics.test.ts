import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { setAnalyticsConsent, __resetAnalyticsConsentCache } from '../analyticsConsent';

// 1.4.3 items 2, 4 and 7: the new client events. Enums, counts and booleans only,
// every value coerced through a whitelist (never free text, health data, ids or
// circle_id), and consent-aware like every other Analytics event.

const capture = vi.fn();
const identify = vi.fn();
vi.mock('posthog-js', () => ({
  default: {
    init: vi.fn(),
    register: vi.fn(),
    capture,
    identify,
    reset: vi.fn(),
    opt_out_capturing: vi.fn(),
    opt_in_capturing: vi.fn(),
    captureException: vi.fn(),
  },
}));

async function load() {
  vi.resetModules();
  vi.doMock('@/lib/env', () => ({
    env: {
      VITE_SUPABASE_URL: 'https://test.supabase.co',
      VITE_SUPABASE_ANON_KEY: 'anon',
      VITE_API_URL: 'http://localhost:3000',
      VITE_POSTHOG_KEY: 'phc_test',
    },
  }));
  const posthogModule = await import('posthog-js');
  const loader = await import('@/lib/posthogLoader');
  loader.__primePosthogForTests(posthogModule.default);
  return (await import('@/lib/analytics')).Analytics;
}

beforeEach(() => {
  capture.mockClear();
  __resetAnalyticsConsentCache();
  setAnalyticsConsent(true);
});
afterEach(() => {
  vi.doUnmock('@/lib/env');
  vi.doUnmock('@/lib/analyticsMode');
});

/** The declined mode forced to 'off' (the shipped flag is anonymous; see analytics.test.ts). */
function forceDeclinedModeOff(): void {
  vi.doMock('@/lib/analyticsMode', async (importOriginal) => {
    const actual = await importOriginal<typeof import('@/lib/analyticsMode')>();
    const resolveAnalyticsMode = (consented: boolean): 'full' | 'off' =>
      consented ? 'full' : 'off';
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

describe('purchase and trial events (item 4)', () => {
  it('trial_started carries plan, store, source and paywall_context', async () => {
    const Analytics = await load();
    Analytics.trialStarted({ plan: 'annual', store: 'web', source: 'promise', paywallContext: 'feature' });
    expect(capture).toHaveBeenCalledWith('trial_started', {
      plan: 'annual',
      store: 'web',
      source: 'promise',
      paywall_context: 'feature',
    });
  });

  it('purchase_completed carries the same properties', async () => {
    const Analytics = await load();
    Analytics.purchaseCompleted({ plan: 'monthly', store: 'web', source: 'promise' });
    expect(capture).toHaveBeenCalledWith('purchase_completed', {
      plan: 'monthly',
      store: 'web',
      source: 'promise',
      paywall_context: 'general',
    });
  });

  it('values are coerced through the whitelist: nothing free-form survives', async () => {
    const Analytics = await load();
    Analytics.trialStarted({
      plan: 'annual; DROP' as never,
      store: 'jane@example.com' as never,
      source: 'x' as never,
    });
    expect(capture).toHaveBeenCalledWith('trial_started', {
      plan: 'annual',
      store: 'web',
      source: 'promise',
      paywall_context: 'general',
    });
  });

  it('N4-2 declined with the anonymous pipeline ON: the event goes out, but nobody is identified', async () => {
    const Analytics = await load();
    setAnalyticsConsent(false);
    Analytics.trialStarted({ plan: 'annual', store: 'web', source: 'promise' });
    expect(capture).toHaveBeenCalledTimes(1);
    expect(identify).not.toHaveBeenCalled();
  });

  it('N4-2b declined with the pipeline OFF: nothing is emitted', async () => {
    forceDeclinedModeOff();
    const Analytics = await load();
    setAnalyticsConsent(false);
    Analytics.trialStarted({ plan: 'annual', store: 'web', source: 'promise' });
    Analytics.purchaseCompleted({ plan: 'annual', store: 'web', source: 'promise' });
    Analytics.paywallSuppressedEntitled('paywall');
    Analytics.writeRetryScheduled('task_complete', 3);
    expect(capture).not.toHaveBeenCalled();
  });
});

describe('entitlement events (item 2)', () => {
  it('paywall_suppressed_entitled carries surface and platform web', async () => {
    const Analytics = await load();
    Analytics.paywallSuppressedEntitled('profile');
    expect(capture).toHaveBeenCalledWith('paywall_suppressed_entitled', {
      surface: 'profile',
      platform: 'web',
    });
  });

  it('entitlement_tier_mismatch carries direction and resolved', async () => {
    const Analytics = await load();
    Analytics.entitlementTierMismatch('rc_active_backend_free', true);
    expect(capture).toHaveBeenCalledWith('entitlement_tier_mismatch', {
      direction: 'rc_active_backend_free',
      resolved: true,
    });
  });
});

describe('write retry events (item 7)', () => {
  it('scheduled, succeeded and gave_up carry a closed key and a whole count', async () => {
    const Analytics = await load();
    Analytics.writeRetryScheduled('as_needed_dose', 2);
    Analytics.writeRetrySucceeded('event_note', 1, 'resume');
    Analytics.writeRetryGaveUp('care_note', 11.6);
    expect(capture).toHaveBeenCalledWith('write_retry_scheduled', { key: 'as_needed_dose', count: 2 });
    expect(capture).toHaveBeenCalledWith('write_retry_succeeded', {
      key: 'event_note',
      count: 1,
      via: 'resume',
    });
    expect(capture).toHaveBeenCalledWith('write_retry_gave_up', { key: 'care_note', count: 12 });
  });

  it('an unknown key or via falls back to the closed set', async () => {
    const Analytics = await load();
    Analytics.writeRetrySucceeded('a note body' as never, 1, 'x' as never);
    expect(capture).toHaveBeenCalledWith('write_retry_succeeded', {
      key: 'task_complete',
      count: 1,
      via: 'backoff',
    });
  });
});
