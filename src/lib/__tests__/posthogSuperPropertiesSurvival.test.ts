import { beforeEach, afterEach, describe, expect, it, vi } from 'vitest';

/**
 * THE PRIVACY SUPER PROPERTIES MUST SURVIVE A `reset()`.
 *
 * `lib/posthog.ts` registers three super properties exactly once, inside
 * `configure()`: `$ip: null` (PostHog stores no IP and derives no GeoIP),
 * `platform: 'web'` and `app_env`. The file's own comment states the invariant:
 * "'EVERY event' is only true if the super property is registered FIRST."
 *
 * posthog-js's `reset()` calls `this.persistence.clear()`, which drops the
 * stored super properties along with everything else, then re-registers only
 * `distinct_id`, `$device_id` and `$last_posthog_reset` (verified in the
 * installed posthog-js@1.386.6 `dist/module.js`). Both `resetAnalytics()`
 * (logout) and `disableAnalytics()` (consent withdrawal) call it.
 *
 * So without a re-register, EVERY event after a logout or a withdrawal went out
 * with no `$ip: null` — PostHog then records the source IP and GeoIP-enriches
 * from it — and with no `platform` / `app_env`, which silently mixes web into
 * mobile's numbers and dev traffic into the admin error digest. What fires
 * immediately after a logout is an SPA route change to /login inside the SAME
 * document: `$pageview`, `login_started`, `login_completed`. In the withdrawal
 * case the person whose IP gets captured is precisely the one who just declined.
 *
 * The mock below MODELS posthog-js's real semantics rather than counting calls:
 * `register` merges into a super-property bag, `capture` merges that bag into
 * the event, and `reset` empties it. That is what lets these tests assert the
 * thing that actually matters — what is attached to an event AFTER the reset —
 * instead of asserting that some function was called.
 */

type Props = Record<string, unknown>;

let superProps: Props = {};
const captured: Array<{ name: string; props: Props }> = [];

const init = vi.fn();
const register = vi.fn((props: Props) => {
  superProps = { ...superProps, ...props };
});
const capture = vi.fn((name: string, props?: Props) => {
  captured.push({ name, props: { ...superProps, ...props } });
});
// posthog-js: `reset()` → `persistence.clear()` → the super properties go with
// it. Re-registering distinct_id/$device_id is irrelevant here.
const reset = vi.fn(() => {
  superProps = {};
});
const identify = vi.fn();
const optIn = vi.fn();
const optOut = vi.fn();
const captureExceptionSpy = vi.fn();

vi.mock('posthog-js', () => ({
  default: {
    init,
    register,
    capture,
    identify,
    reset,
    opt_in_capturing: optIn,
    opt_out_capturing: optOut,
    captureException: captureExceptionSpy,
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
  const posthogModule = await import('posthog-js');
  const loader = await import('@/lib/posthogLoader');
  loader.__primePosthogForTests(posthogModule.default);

  const consent = await import('@/lib/analyticsConsent');
  const analytics = await import('@/lib/analytics');
  const posthog = await import('@/lib/posthog');
  return { ...consent, Analytics: analytics.Analytics, ...posthog };
}

/** The last event handed to posthog.capture, with super properties merged in. */
function lastEvent(): { name: string; props: Props } {
  const event = captured[captured.length - 1];
  if (!event) throw new Error('no event captured');
  return event;
}

function expectPrivacyPropertiesOn(event: { name: string; props: Props }): void {
  // `$ip` must be PRESENT and null. A missing key is not "no IP" — it is
  // PostHog falling back to the request IP and GeoIP-enriching from it.
  expect(event.props).toHaveProperty('$ip', null);
  expect(event.props.platform).toBe('web');
  expect(event.props.app_env).toMatch(/^(development|production)$/);
}

beforeEach(() => {
  localStorage.clear();
  superProps = {};
  captured.length = 0;
  vi.clearAllMocks();
});

afterEach(() => {
  vi.doUnmock('@/lib/env');
});

describe('privacy super properties survive every reset()', () => {
  it('keeps $ip/platform/app_env on events captured after a LOGOUT reset', async () => {
    const { setAnalyticsConsent, initAnalytics, resetAnalytics, Analytics } = await loadFresh();
    setAnalyticsConsent(true);
    initAnalytics();

    // Baseline: before any reset the invariant holds.
    Analytics.loginCompleted('email');
    expectPrivacyPropertiesOn(lastEvent());

    // Logout.
    resetAnalytics();

    // What the SPA does next, in the SAME document: route to /login and start
    // a new sign-in. These are the events that were leaking an IP.
    Analytics.loginStarted('email');
    expectPrivacyPropertiesOn(lastEvent());
    Analytics.loginCompleted('email');
    expectPrivacyPropertiesOn(lastEvent());
  });

  it('keeps $ip/platform/app_env on events captured after a CONSENT WITHDRAWAL reset', async () => {
    const { setAnalyticsConsent, initAnalytics, disableAnalytics, Analytics } = await loadFresh();
    setAnalyticsConsent(true);
    initAnalytics();

    // Withdrawal: the declined mode is 'anonymous', so the client keeps
    // capturing — under a fresh random id, and it must still suppress the IP.
    disableAnalytics();
    setAnalyticsConsent(false);

    Analytics.loginStarted('email');
    expectPrivacyPropertiesOn(lastEvent());
  });

  it('re-registers after EVERY reset, not just the first', async () => {
    const { setAnalyticsConsent, initAnalytics, resetAnalytics, Analytics } = await loadFresh();
    setAnalyticsConsent(true);
    initAnalytics();

    resetAnalytics();
    resetAnalytics();
    resetAnalytics();

    Analytics.logout();
    expectPrivacyPropertiesOn(lastEvent());
  });
});
