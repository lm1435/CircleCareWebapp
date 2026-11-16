import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { setAnalyticsConsent, __resetAnalyticsConsentCache } from '../analyticsConsent';

// chunk_reload (stale lazy chunk after a deploy): enum props only, through the
// consent-gated capture. Never the chunk URL or error text.

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

beforeEach(() => {
  capture.mockClear();
  __resetAnalyticsConsentCache();
  setAnalyticsConsent(true);
});
afterEach(() => {
  vi.doUnmock('@/lib/env');
});

describe('chunk_reload analytics', () => {
  it('P2c: emits chunk_reload with exactly the source/outcome enums', async () => {
    const A = await load();
    A.chunkReload({ source: 'preload_error', outcome: 'reloaded' });
    A.chunkReload({ source: 'error_boundary', outcome: 'suppressed_loop' });
    expect(capture.mock.calls).toEqual([
      ['chunk_reload', { source: 'preload_error', outcome: 'reloaded' }],
      ['chunk_reload', { source: 'error_boundary', outcome: 'suppressed_loop' }],
    ]);
  });

  it('N4: an out-of-vocabulary value is clamped to an enum, never forwarded as text', async () => {
    const A = await load();
    A.chunkReload({
      source: 'https://my.circlecare.app/assets/TasksPage-x.js' as never,
      outcome: 'free text' as never,
    });
    expect(capture).toHaveBeenCalledWith('chunk_reload', {
      source: 'error_boundary',
      outcome: 'reloaded',
    });
  });
});
