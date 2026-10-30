import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { setAnalyticsConsent, __resetAnalyticsConsentCache } from '../analyticsConsent';

// Unit tests for the email click signal (docs/plans/email-lifecycle-overhaul.md,
// "CTA URLs and click measurement"): `Analytics.emailLinkOpened`. The landing
// logic that decides when and with what props it fires is covered by
// emailLinkLanding.test.ts. Mocking follows lib/__tests__/analytics.test.ts.

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
  it('captures email_link_opened with enum + boolean props only', async () => {
    const { Analytics } = await loadAnalytics();
    Analytics.emailLinkOpened({
      type: 'drip_d1_first_entry',
      appState: 'signed_out',
      landed: true,
      targetFound: false,
    });
    expect(capture).toHaveBeenCalledWith('email_link_opened', {
      type: 'drip_d1_first_entry',
      app_state: 'signed_out',
      landed: true,
      target_found: false,
    });
  });
});
