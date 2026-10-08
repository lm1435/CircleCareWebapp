import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { setAnalyticsConsent, __resetAnalyticsConsentCache } from '../analyticsConsent';

// Daily update analytics (plan §7): booleans and enums only. NEVER a circle id,
// a name, or a count. Emitted only through the consent-gated `capture`.

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

async function load(key: string | null = 'phc_test') {
  vi.resetModules();
  vi.doMock('@/lib/env', () => ({
    env: {
      VITE_SUPABASE_URL: 'https://test.supabase.co',
      VITE_SUPABASE_ANON_KEY: 'anon',
      VITE_API_URL: 'http://localhost:3000',
      VITE_POSTHOG_KEY: key ?? undefined,
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

function fireAll(A: Awaited<ReturnType<typeof load>>): void {
  A.dailyUpdateCardShown({ is_owner: true, is_solo: false, has_still_to_do: true });
  A.dailyUpdateOpened('card', false);
  A.dailyUpdateOpened('link', true);
  A.dailyUpdateDismissed();
  A.dailyUpdateTurnedOff();
  A.dailyUpdateInviteTapped();
}

describe('daily update analytics', () => {
  it('sends the §7 event names with boolean / enum properties only', async () => {
    const A = await load();
    fireAll(A);
    expect(capture.mock.calls).toEqual([
      ['daily_update_card_shown', { is_owner: true, is_solo: false, has_still_to_do: true }],
      ['daily_update_opened', { source: 'card', dated: false }],
      ['daily_update_opened', { source: 'link', dated: true }],
      ['daily_update_dismissed', undefined],
      ['daily_update_turned_off', { source: 'card' }],
      ['daily_update_invite_tapped', undefined],
    ]);
    for (const [, props] of capture.mock.calls) {
      for (const [k, v] of Object.entries((props ?? {}) as Record<string, unknown>)) {
        expect(k).not.toMatch(/circle|name|count|id$/i);
        expect(typeof v === 'boolean' || typeof v === 'string').toBe(true);
      }
    }
  });

  it('consent gate: nothing is captured when collection is not allowed', async () => {
    vi.doMock('@/lib/analyticsMode', async (importOriginal) => ({
      ...(await importOriginal<typeof import('@/lib/analyticsMode')>()),
      analyticsCollectionAllowed: () => false,
    }));
    const A = await load();
    fireAll(A);
    expect(capture).not.toHaveBeenCalled();
  });

  it('no PostHog key: a silent no-op', async () => {
    const A = await load(null);
    fireAll(A);
    expect(capture).not.toHaveBeenCalled();
  });
});
