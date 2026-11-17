import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { setAnalyticsConsent, __resetAnalyticsConsentCache } from '../analyticsConsent';

// note_draft_restored / note_draft_discarded (owner 2026-11-16): ONE enum property, `source`.
// Never text, mood, categories, date or circle_id. Same names + props as mobile
// (mobile/src/__tests__/services/analyticsNoteDraft.test.ts).

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

describe('Analytics.noteDraft* (enum only)', () => {
  it('P: restored + discarded carry only the source enum', async () => {
    const A = await load();
    A.noteDraftRestored({ source: 'session' });
    A.noteDraftRestored({ source: 'failed_post' });
    A.noteDraftDiscarded({ source: 'failed_post' });
    expect(capture.mock.calls).toEqual([
      ['note_draft_restored', { source: 'session' }],
      ['note_draft_restored', { source: 'failed_post' }],
      ['note_draft_discarded', { source: 'failed_post' }],
    ]);
  });

  it('N: a stray (non-enum) source never reaches PostHog as free text', async () => {
    const A = await load();
    A.noteDraftDiscarded({ source: 'Slept badly' as never });
    expect(capture.mock.calls).toEqual([['note_draft_discarded', { source: 'session' }]]);
  });
});
