import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * The `variant` enum on the first-run paywall events (owner-approved 2026-11-26).
 * Sent only for the onboarding context; anything outside the enum is 'default'.
 */
const capture = vi.fn();
vi.mock('posthog-js', () => ({
  default: {
    init: vi.fn(),
    register: vi.fn(),
    capture,
    identify: vi.fn(),
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

beforeEach(() => capture.mockClear());
afterEach(() => vi.resetModules());

describe('paywall variant on the analytics events', () => {
  it('positive: every onboarding paywall event carries the variant', async () => {
    const A = await load();
    A.paywallShown('after_first_med', false, 'medication');
    A.planSelectionViewed('onboarding', { variant: 'invite' });
    A.planSelectionCtaTapped({
      plan: 'annual',
      paywallContext: 'onboarding',
      trialShown: true,
      detailsExpanded: false,
      secondsSinceView: 3,
      variant: 'appointment',
    });
    A.planSelectionFreeSelected('onboarding', 'medication');
    A.planSelectionSubscribed('annual', 'onboarding', 'medication');
    A.planSelectionTrialStarted('annual', 'onboarding', 'medication');
    A.planSelectionPurchaseCancelled('annual', 'onboarding', 'medication');
    A.paywallDismissed('onboarding', undefined, 'invite');
    A.paywallDismissed(
      'onboarding',
      { method: 'close', secondsVisible: 2, detailsExpanded: false, scrolled: false },
      'appointment'
    );
    const variants = capture.mock.calls.map((c) => c[1].variant);
    expect(variants).toEqual([
      'medication',
      'invite',
      'appointment',
      'medication',
      'medication',
      'medication',
      'medication',
      'invite',
      'appointment',
    ]);
  });

  it('negative: garbage, missing and non-string variants become "default", never reach PostHog', async () => {
    const A = await load();
    for (const bad of ['emergency', 'skip', '<script>', 'Medication', '', undefined, 7, null]) {
      A.planSelectionViewed('onboarding', { variant: bad as never });
      A.paywallShown('onboarding', false, bad as never);
    }
    expect(capture.mock.calls.every((c) => c[1].variant === 'default')).toBe(true);
    expect(capture).toHaveBeenCalledTimes(16);
  });

  it('negative: non-onboarding contexts never carry the property, even when one is passed', async () => {
    const A = await load();
    for (const ctx of ['general', 'capacity', 'invite_cap', 'feature', 'earned_meds', 'earned_invite', 'shifts'] as const) {
      A.planSelectionViewed(ctx, { variant: 'medication' });
      A.planSelectionFreeSelected(ctx, 'medication');
      A.planSelectionSubscribed('annual', ctx, 'medication');
      A.paywallDismissed(ctx, undefined, 'medication');
    }
    expect(capture.mock.calls.length).toBe(28);
    for (const c of capture.mock.calls) expect(c[1]).not.toHaveProperty('variant');
  });
});
