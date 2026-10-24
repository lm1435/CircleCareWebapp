import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { setAnalyticsConsent, __resetAnalyticsConsentCache } from '../analyticsConsent';

// Notes by doctor (docs/plans/notes-by-doctor.md): `provider_visits_opened`,
// `provider_linked`, `provider_unlinked`. Enums, a count and a boolean ONLY:
// never a doctor's name or id, a visit title, a note, or circle_id.

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

describe('providerVisitBucket', () => {
  it('buckets past visits 0 | 1-5 | 6-20 | 21+ (lower bound inclusive), junk is 0', async () => {
    vi.resetModules();
    const { providerVisitBucket } = await import('@/lib/analytics');
    expect([0, 1, 5, 6, 20, 21, 400].map(providerVisitBucket)).toEqual([
      '0',
      '1-5',
      '1-5',
      '6-20',
      '6-20',
      '21+',
      '21+',
    ]);
    expect([-3, Number.NaN, Number.POSITIVE_INFINITY].map(providerVisitBucket)).toEqual(['0', '0', '0']);
  });
});

describe('Analytics.provider*', () => {
  it('fires each event with exactly its documented properties', async () => {
    const A = await load();
    A.providerVisitsOpened({ source: 'appointment', visit_count_bucket: '6-20', has_notes: true });
    A.providerLinked({ source: 'edit' });
    A.providerUnlinked();
    expect(capture.mock.calls).toEqual([
      ['provider_visits_opened', { source: 'appointment', visit_count_bucket: '6-20', has_notes: true }],
      ['provider_linked', { source: 'edit' }],
      ['provider_unlinked', {}],
    ]);
  });

  it('coerces everything through a whitelist: an unknown source or bucket, a truthy non-boolean', async () => {
    const A = await load();
    A.providerVisitsOpened({
      source: 'Dr. Patel',
      visit_count_bucket: '23 visits',
      has_notes: 'yes' as unknown as boolean,
    });
    A.providerVisitsOpened({ source: 'medical_info', visit_count_bucket: '21+', has_notes: false });
    A.providerLinked({ source: 'a note about knee surgery' });
    expect(capture.mock.calls).toEqual([
      ['provider_visits_opened', { source: 'medical_info', visit_count_bucket: '0', has_notes: false }],
      ['provider_visits_opened', { source: 'medical_info', visit_count_bucket: '21+', has_notes: false }],
      ['provider_linked', { source: 'add' }],
    ]);
  });

  it('never carries a raw count, a circle id, a name or any other free-form property', async () => {
    const A = await load();
    A.providerVisitsOpened({ source: 'medical_info', visit_count_bucket: '1-5', has_notes: false });
    A.providerLinked({ source: 'add' });
    for (const [, props] of capture.mock.calls) {
      for (const key of Object.keys(props as object)) {
        expect(['source', 'visit_count_bucket', 'has_notes']).toContain(key);
      }
      for (const value of Object.values(props as object)) {
        expect(['string', 'boolean']).toContain(typeof value);
      }
    }
  });
});
