import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { setAnalyticsConsent, __resetAnalyticsConsentCache } from '../analyticsConsent';

// Unit tests for the email click signal (docs/plans/email-lifecycle-overhaul.md,
// "CTA URLs and click measurement"): `Analytics.emailLinkOpened` and the boot
// helper `trackEmailLinkFromLocation` that reads `?src=` and fires it at most
// once per page load. Mocking follows lib/__tests__/analytics.test.ts.

const capture = vi.fn();
const identify = vi.fn();
const reset = vi.fn();
const init = vi.fn();
const register = vi.fn();
const optOut = vi.fn();
const optIn = vi.fn();
const captureExceptionSpy = vi.fn();

vi.mock('posthog-js', () => ({
  default: {
    init,
    register,
    capture,
    identify,
    reset,
    opt_out_capturing: optOut,
    opt_in_capturing: optIn,
    captureException: captureExceptionSpy,
  },
}));

/** Import lib/analytics with VITE_POSTHOG_KEY set, and prime posthog-js as
 *  already-loaded so `capture` resolves synchronously — see
 *  lib/__tests__/analytics.test.ts's `loadWithKey` for the full rationale. */
async function loadAnalytics() {
  vi.resetModules();
  vi.doMock('@/lib/env', () => ({
    env: {
      VITE_SUPABASE_URL: 'https://test.supabase.co',
      VITE_SUPABASE_ANON_KEY: 'anon',
      VITE_API_URL: 'http://localhost:3000',
      VITE_POSTHOG_KEY: 'phc_test_key',
    },
  }));
  const posthogModule = await import('posthog-js');
  const loader = await import('@/lib/posthogLoader');
  loader.__primePosthogForTests(posthogModule.default);
  return import('@/lib/analytics');
}

beforeEach(() => {
  capture.mockClear();
  __resetAnalyticsConsentCache();
  setAnalyticsConsent(true);
});

afterEach(() => {
  vi.doUnmock('@/lib/env');
});

describe('Analytics.emailLinkOpened', () => {
  it('captures email_link_opened with { src }', async () => {
    const { Analytics } = await loadAnalytics();
    Analytics.emailLinkOpened('drip_d1_first_entry');
    expect(capture).toHaveBeenCalledWith('email_link_opened', { src: 'drip_d1_first_entry' });
  });
});

describe('trackEmailLinkFromLocation', () => {
  it('fires email_link_opened once with the src param, even if called twice (StrictMode double-mount)', async () => {
    const { trackEmailLinkFromLocation, __resetEmailLinkTrackedForTests } = await loadAnalytics();
    __resetEmailLinkTrackedForTests();

    trackEmailLinkFromLocation('?src=drip_d1_first_entry');
    trackEmailLinkFromLocation('?src=drip_d1_first_entry');

    expect(capture).toHaveBeenCalledTimes(1);
    expect(capture).toHaveBeenCalledWith('email_link_opened', { src: 'drip_d1_first_entry' });
  });

  it('never fires when there is no src param', async () => {
    const { trackEmailLinkFromLocation, __resetEmailLinkTrackedForTests } = await loadAnalytics();
    __resetEmailLinkTrackedForTests();

    trackEmailLinkFromLocation('');
    trackEmailLinkFromLocation('?utm_source=newsletter');

    expect(capture).not.toHaveBeenCalled();
  });

  it('never fires when src is present but empty', async () => {
    const { trackEmailLinkFromLocation, __resetEmailLinkTrackedForTests } = await loadAnalytics();
    __resetEmailLinkTrackedForTests();

    trackEmailLinkFromLocation('?src=');

    expect(capture).not.toHaveBeenCalled();
  });

  it('guard persists across calls even once a later call carries a src (only the first load matters)', async () => {
    const { trackEmailLinkFromLocation, __resetEmailLinkTrackedForTests } = await loadAnalytics();
    __resetEmailLinkTrackedForTests();

    trackEmailLinkFromLocation('?src=welcome');
    trackEmailLinkFromLocation('?src=trial_reminder');

    expect(capture).toHaveBeenCalledTimes(1);
    expect(capture).toHaveBeenCalledWith('email_link_opened', { src: 'welcome' });
  });
});
