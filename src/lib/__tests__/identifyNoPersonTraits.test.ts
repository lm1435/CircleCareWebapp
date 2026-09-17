import { beforeEach, afterEach, describe, expect, it, vi } from 'vitest';

/**
 * IDENTIFY BY OPAQUE ID ONLY — no email, no person traits, on web as on mobile.
 *
 * `lib/posthog.ts` used to call `posthog.identify(userId, { email })`, and the
 * `email` was threaded through from `authStore.signIn` / `bootstrap` and
 * `recordAnalyticsConsentDecision`. Mobile deliberately does not: its
 * `Analytics.identifyUser(userId)` takes NO traits bag, and documents why —
 * "Removing the parameter removes the door" (services/analytics.ts:2204-2224).
 * The founder's decision is that web matches. `userId` is already a UUID, which
 * is all a join key has to be.
 *
 * THESE TESTS ASSERT THE ABSENCE OF SOMETHING, which is the easy kind to write
 * so that it passes for the wrong reason. So they:
 *   - call through a deliberately loose reference with an email as a second
 *     argument, so a re-added traits bag is actually EXERCISED rather than
 *     merely unreachable through the type;
 *   - assert the exact argument LIST, so `identify(id, {})` — a traits bag that
 *     happens to be empty today and one keystroke from not being — fails too;
 *   - scan every argument of every identify call for the address, so a trait
 *     under a different key name (`$email`, `user_email`, …) fails as well.
 */

const init = vi.fn();
const register = vi.fn();
const capture = vi.fn();
const identify = vi.fn();
const reset = vi.fn();
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

const EMAIL = 'pat@example.com';

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
  const posthog = await import('@/lib/posthog');
  const decision = await import('@/lib/analyticsConsentDecision');
  return { ...consent, ...posthog, ...decision };
}

/**
 * Every argument of every `posthog.identify` call, flattened to a string. If an
 * address is anywhere in there — under any key, at any depth — this finds it.
 */
function everythingSentToIdentify(): string {
  return JSON.stringify(identify.mock.calls);
}

beforeEach(() => {
  localStorage.clear();
  vi.clearAllMocks();
});

afterEach(() => {
  vi.doUnmock('@/lib/env');
});

describe('identifyUser sends the id and nothing else', () => {
  it('calls posthog.identify with the user id as the ONLY argument', async () => {
    const { setAnalyticsConsent, initAnalytics, identifyUser } = await loadFresh();
    setAnalyticsConsent(true);
    initAnalytics();

    identifyUser('user-42');

    // `toEqual` on the argument LIST, not `toHaveBeenCalledWith('user-42')` —
    // the latter passes for `identify('user-42', undefined)` in some matchers
    // and says nothing about a second argument that is an object.
    expect(identify.mock.calls).toEqual([['user-42']]);
  });

  it('ignores an email even when a caller hands it one', async () => {
    const { setAnalyticsConsent, initAnalytics, identifyUser } = await loadFresh();
    setAnalyticsConsent(true);
    initAnalytics();

    // The old signature, called on purpose. The point is not that TypeScript
    // now rejects it (it does) — it is that the RUNTIME drops it, so a call
    // site that reappears through an `any`, a JS import, or a future edit
    // cannot transmit an address.
    const loose = identifyUser as unknown as (id: string, email?: string) => void;
    loose('user-42', EMAIL);

    expect(identify.mock.calls).toEqual([['user-42']]);
    expect(everythingSentToIdentify()).not.toContain(EMAIL);
    expect(everythingSentToIdentify()).not.toContain('@');
  });

  it('takes exactly one parameter — the door is removed, not merely unused', async () => {
    const { identifyUser } = await loadFresh();
    // Mobile's rationale, applied here: a `Record<string, any>` traits bag that
    // is never passed anything is still one keystroke from sending an email.
    expect(identifyUser.length).toBe(1);
  });

  it('sends no email through the consent-acceptance re-identify either', async () => {
    const { setAnalyticsConsent, initAnalytics, recordAnalyticsConsentDecision } =
      await loadFresh();
    // Start declined so accepting takes the full init + re-identify path.
    setAnalyticsConsent(false);
    initAnalytics();

    const record = recordAnalyticsConsentDecision as unknown as (
      accepted: boolean,
      user?: { id: string; email?: string }
    ) => void;
    record(true, { id: 'user-42', email: EMAIL });

    expect(identify.mock.calls).toEqual([['user-42']]);
    expect(everythingSentToIdentify()).not.toContain(EMAIL);
  });
});
