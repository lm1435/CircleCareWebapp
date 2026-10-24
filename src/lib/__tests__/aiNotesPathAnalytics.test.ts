import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { setAnalyticsConsent, __resetAnalyticsConsentCache } from '../analyticsConsent';

// AI notes path (FIND_NOTES): `ai_notes_path_suggested`, `ai_notes_path_action_tapped`,
// and `provider_visits_opened.source = 'ai_chat'`. Enums, booleans and a bounded
// count ONLY: never a doctor's name or id, the typed question, or circle_id.
// Same names + props as mobile (mobile/src/__tests__/services/analyticsAiNotesPath.test.ts).

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

describe('Analytics.aiNotesPath*', () => {
  it('fires each event with exactly its documented properties', async () => {
    const A = await load();
    A.aiNotesPathSuggested({ target: 'doctor', doctor_named: true, doctor_matched: true, action_count: 1 });
    A.aiNotesPathActionTapped({ action: 'open_provider' });
    A.providerVisitsOpened({ source: 'ai_chat', visit_count_bucket: '1-5', has_notes: true });
    expect(capture.mock.calls).toEqual([
      ['ai_notes_path_suggested', { target: 'doctor', doctor_named: true, doctor_matched: true, action_count: 1 }],
      ['ai_notes_path_action_tapped', { action: 'open_provider' }],
      ['provider_visits_opened', { source: 'ai_chat', visit_count_bucket: '1-5', has_notes: true }],
    ]);
  });

  it('coerces strays to the closed sets: no name, text or id can ride along', async () => {
    const A = await load();
    A.aiNotesPathSuggested({
      target: 'Dr. Patel',
      doctor_named: 'Patel' as unknown as boolean,
      doctor_matched: undefined,
      action_count: 999,
    });
    A.aiNotesPathActionTapped({ action: '550e8400-e29b-41d4-a716-446655440001' });
    expect(capture.mock.calls).toEqual([
      ['ai_notes_path_suggested', { target: 'notes', doctor_named: false, doctor_matched: false, action_count: 6 }],
      ['ai_notes_path_action_tapped', { action: 'open_notes' }],
    ]);
    expect(JSON.stringify(capture.mock.calls)).not.toMatch(/Patel|550e8400|circle/i);
  });
});
