import { beforeEach, describe, expect, it, vi } from 'vitest';
import { setAnalyticsConsent, __resetAnalyticsConsentCache } from '../analyticsConsent';

// The "Seen by" event: `count` and NOTHING else (no ids, names, circle id or text).

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
      VITE_POSTHOG_KEY: 'phc_test_key',
    },
  }));
  const posthogModule = await import('posthog-js');
  const loader = await import('@/lib/posthogLoader');
  loader.__primePosthogForTests(posthogModule.default);
  return import('@/lib/analytics');
}

describe('Analytics.careNotesSeenRecorded', () => {
  beforeEach(() => {
    capture.mockReset();
    __resetAnalyticsConsentCache();
    setAnalyticsConsent(true);
  });

  it('P4: fires care_notes_seen_recorded with the count', async () => {
    const { Analytics } = await load();
    Analytics.careNotesSeenRecorded({ count: 3 });
    expect(capture).toHaveBeenCalledWith('care_notes_seen_recorded', { count: 3 });
  });

  it('N11: the property set is exactly {count}', async () => {
    const { Analytics } = await load();
    Analytics.careNotesSeenRecorded({ count: 3 });
    const props = capture.mock.calls.find((c) => c[0] === 'care_notes_seen_recorded')![1] as Record<
      string,
      unknown
    >;
    expect(Object.keys(props).sort()).toEqual(['count']);
  });
});

describe('Analytics.careNoteSeenByExpanded', () => {
  beforeEach(() => {
    capture.mockReset();
    __resetAnalyticsConsentCache();
    setAnalyticsConsent(true);
  });

  it('fires care_note_seen_by_expanded with reader_count', async () => {
    const { Analytics } = await load();
    Analytics.careNoteSeenByExpanded({ readerCount: 5, trigger: 'hover' });
    expect(capture).toHaveBeenCalledWith('care_note_seen_by_expanded', {
      reader_count: 5,
      trigger: 'hover',
    });
  });

  it('N5: the property set is exactly {reader_count, trigger} (no ids, names or circle id)', async () => {
    const { Analytics } = await load();
    Analytics.careNoteSeenByExpanded({ readerCount: 5, trigger: 'hover' });
    const props = capture.mock.calls.find((c) => c[0] === 'care_note_seen_by_expanded')![1] as Record<
      string,
      unknown
    >;
    expect(Object.keys(props).sort()).toEqual(['reader_count', 'trigger']);
  });
});
