import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { setAnalyticsConsent, __resetAnalyticsConsentCache } from '../analyticsConsent';
import {
  backdatedBucket,
  logFailureReason,
  minutesSinceLastBucket,
  removedAgeBucket,
} from '../asNeeded';

// The as-needed (PRN) analytics vocabulary: enums and booleans only, every
// value coerced through a whitelist. NEVER a circle id, a dose/event id, a
// medication name, a note, a reason or a clock time.

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

const ENUM_OR_BOOL = (v: unknown): boolean => typeof v === 'boolean' || typeof v === 'string';

describe('bucketing edges (lower bound inclusive)', () => {
  it('backdatedBucket', () => {
    expect(backdatedBucket(undefined)).toBe('none');
    expect(backdatedBucket(null)).toBe('none');
    expect(backdatedBucket(0)).toBe('none');
    expect(backdatedBucket(-5)).toBe('none');
    expect(backdatedBucket(NaN)).toBe('none');
    expect(backdatedBucket(1)).toBe('<1h');
    expect(backdatedBucket(59)).toBe('<1h');
    expect(backdatedBucket(60)).toBe('1-4h');
    expect(backdatedBucket(239)).toBe('1-4h');
    expect(backdatedBucket(240)).toBe('4-12h');
    expect(backdatedBucket(719)).toBe('4-12h');
    expect(backdatedBucket(720)).toBe('>12h');
    expect(backdatedBucket(2880)).toBe('>12h');
  });

  it('minutesSinceLastBucket', () => {
    expect(minutesSinceLastBucket(null)).toBe('first');
    expect(minutesSinceLastBucket(undefined)).toBe('first');
    expect(minutesSinceLastBucket(0)).toBe('<1h');
    expect(minutesSinceLastBucket(59)).toBe('<1h');
    expect(minutesSinceLastBucket(60)).toBe('1-4h');
    expect(minutesSinceLastBucket(239)).toBe('1-4h');
    expect(minutesSinceLastBucket(240)).toBe('4-12h');
    expect(minutesSinceLastBucket(719)).toBe('4-12h');
    expect(minutesSinceLastBucket(720)).toBe('12-24h');
    expect(minutesSinceLastBucket(1439)).toBe('12-24h');
    expect(minutesSinceLastBucket(1440)).toBe('>24h');
  });

  it('removedAgeBucket', () => {
    expect(removedAgeBucket(0)).toBe('<1h');
    expect(removedAgeBucket(59)).toBe('<1h');
    expect(removedAgeBucket(60)).toBe('<24h');
    expect(removedAgeBucket(1439)).toBe('<24h');
    expect(removedAgeBucket(1440)).toBe('older');
    expect(removedAgeBucket(NaN)).toBe('older');
  });

  it('logFailureReason: no server envelope = network; coded refusals by code', () => {
    expect(logFailureReason(new Error('timeout'))).toBe('network');
    expect(logFailureReason(undefined)).toBe('network');
    expect(logFailureReason({ error: { code: 'VIEW_ONLY' } })).toBe('permission');
    expect(logFailureReason({ error: { code: 'MEDICATION_DISCONTINUED' } })).toBe('discontinued');
    expect(logFailureReason({ error: { code: 'GIVEN_AT_TOO_OLD' } })).toBe('error');
  });
});

describe('Analytics.asNeeded*: event names and props', () => {
  it('every method fires its event with enum/boolean props only', async () => {
    const A = await load();
    A.asNeededMedicationCreated({ source: 'form', has_reason: true });
    A.asNeededDoseLogged({
      surface: 'meds_tab',
      with_note: true,
      backdated_bucket: '1-4h',
      actor: 'recipient',
      after_recent_prompt: true,
      minutes_since_last_bucket: '12-24h',
    });
    A.asNeededDoseUndone({ surface: 'detail' });
    A.asNeededDoseRemoved({ age_bucket: '<24h', own: true });
    A.asNeededDoseLogFailed({ reason: 'permission' });
    A.asNeededRecentConflict({ resolution: 'logged_another' });
    A.asNeededHistoryViewed({ scope: 'all' });

    expect(capture.mock.calls).toEqual([
      ['as_needed_medication_created', { source: 'form', has_reason: true }],
      [
        'as_needed_dose_logged',
        {
          surface: 'meds_tab',
          with_note: true,
          backdated_bucket: '1-4h',
          actor: 'recipient',
          after_recent_prompt: true,
          minutes_since_last_bucket: '12-24h',
        },
      ],
      ['as_needed_dose_undone', { surface: 'detail' }],
      ['as_needed_dose_removed', { age_bucket: '<24h', own: true }],
      ['as_needed_dose_log_failed', { reason: 'permission' }],
      ['as_needed_recent_conflict', { resolution: 'logged_another' }],
      ['as_needed_history_viewed', { scope: 'all' }],
    ]);
    for (const [, props] of capture.mock.calls) {
      for (const v of Object.values(props as Record<string, unknown>)) expect(ENUM_OR_BOOL(v)).toBe(true);
    }
  });

  it('FALSIFIER target: arbitrary strings are coerced to a safe enum, never passed through', async () => {
    const A = await load();
    const hostile = 'Ibuprofen 200 mg, circle 6f1c2c1e-0000-4000-8000-000000000000';
    A.asNeededMedicationCreated({ source: hostile, has_reason: hostile as never });
    A.asNeededDoseLogged({
      surface: hostile,
      with_note: hostile as never,
      backdated_bucket: hostile,
      actor: hostile,
      after_recent_prompt: hostile as never,
      minutes_since_last_bucket: hostile,
    });
    A.asNeededDoseUndone({ surface: hostile });
    A.asNeededDoseRemoved({ age_bucket: hostile, own: hostile as never });
    A.asNeededDoseLogFailed({ reason: hostile });
    A.asNeededRecentConflict({ resolution: hostile });
    A.asNeededHistoryViewed({ scope: hostile });
    const json = JSON.stringify(capture.mock.calls);
    expect(capture).toHaveBeenCalledTimes(7);
    expect(json).not.toContain('Ibuprofen');
    expect(json).not.toContain('circle');
    expect(json).not.toMatch(/[0-9a-f]{8}-[0-9a-f]{4}-/);
    // Booleans only coerce from a literal `true`.
    expect(capture.mock.calls[0][1]).toEqual({ source: 'form', has_reason: false });
  });

  it('consent gate: nothing is captured when collection is not allowed', async () => {
    vi.doMock('@/lib/analyticsMode', async (importOriginal) => ({
      ...(await importOriginal<typeof import('@/lib/analyticsMode')>()),
      analyticsCollectionAllowed: () => false,
    }));
    const A = await load();
    A.asNeededDoseLogged({ surface: 'home' });
    A.asNeededHistoryViewed({ scope: 'all' });
    A.asNeededDoseRemoved({ age_bucket: '<1h', own: false });
    expect(capture).not.toHaveBeenCalled();
  });

  it('no PostHog key: a silent no-op', async () => {
    const A = await load(null);
    A.asNeededDoseLogged({ surface: 'home' });
    expect(capture).not.toHaveBeenCalled();
  });
});
