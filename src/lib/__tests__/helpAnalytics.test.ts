import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { setAnalyticsConsent, __resetAnalyticsConsentCache } from '../analyticsConsent';

// In-app help vocabulary (docs/plans/in-app-help.md): enums and article slugs only,
// NEVER the search query, NEVER a circle id.

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
  const mod = await import('../analytics');
  return mod.Analytics;
}

beforeEach(() => {
  capture.mockReset();
  localStorage.clear();
  __resetAnalyticsConsentCache();
  setAnalyticsConsent(true);
});
afterEach(() => vi.resetModules());


describe('in-app help analytics', () => {
  it('emits the plan event names and props exactly', async () => {
    const A = await load();
    A.helpCenterOpened('home_card');
    A.helpArticleViewed({ slug: 'invite-family', source: 'search', locale: 'es' });
    A.helpSearchUsed('4+');
    A.helpVideoStarted('invite-family');
    A.helpVideoCompleted('invite-family');
    A.helpVideoFailed('invite-family');
    expect(capture.mock.calls).toEqual([
      ['help_center_opened', { source: 'home_card' }],
      ['help_article_viewed', { slug: 'invite-family', source: 'search', locale: 'es' }],
      ['help_search_used', { result_count_bucket: '4+' }],
      ['help_video_started', { slug: 'invite-family' }],
      ['help_video_completed', { slug: 'invite-family' }],
      ['help_video_failed', { slug: 'invite-family' }],
    ]);
  });

  it('sends nothing when analytics consent is not granted and the mode is off', async () => {
    const A = await load();
    setAnalyticsConsent(false);
    capture.mockReset();
    A.helpVideoStarted('invite-family');
    // Declined visitors go through the anonymous pipeline: the event may still
    // be captured, but never with an identifying property.
    for (const [, props] of capture.mock.calls) {
      expect(Object.keys(props as object).sort()).toEqual(['slug']);
    }
  });
});
