import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { setAnalyticsConsent, __resetAnalyticsConsentCache } from '../analyticsConsent';

// The shifts analytics vocabulary (docs/plans/care-shifts.md, Analytics): enums,
// booleans and count buckets only, whitelisted. NEVER a circle id, a name or a time.

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

const last = () => capture.mock.calls[capture.mock.calls.length - 1] as [string, Record<string, unknown>];

describe('shifts analytics', () => {
  it('shifts_view_opened buckets the open count', async () => {
    const A = await load();
    for (const [n, bucket] of [[0, '0'], [1, '1-2'], [2, '1-2'], [3, '3+'], [40, '3+']] as const) {
      A.shiftsViewOpened({ range: 'day', openCount: n });
      expect(last()).toEqual(['shifts_view_opened', { range: 'day', open_count_bucket: bucket, access: 'full' }]);
    }
    A.shiftsViewOpened({ range: 'bogus', openCount: 0 });
    expect(last()[1].range).toBe('day');
    A.shiftsViewOpened({ range: 'week', openCount: 1, access: 'readonly' });
    expect(last()).toEqual(['shifts_view_opened', { range: 'week', open_count_bucket: '1-2', access: 'readonly' }]);
    A.shiftsViewOpened({ range: 'week', openCount: 1, access: 'bogus' });
    expect(last()[1].access).toBe('full');
  });

  it('shift_created carries only enums / booleans and buckets the duration', async () => {
    const A = await load();
    A.shiftCreated({
      repeats: true,
      recurrence: 'days',
      assigned: true,
      assignedSelf: true,
      reminder: '2h',
      overnight: true,
      durationMinutes: 720,
      source: 'add_next',
    });
    expect(last()).toEqual([
      'shift_created',
      {
        repeats: true,
        recurrence: 'days',
        assigned: true,
        assigned_self: true,
        reminder: '2h',
        overnight: true,
        duration_bucket: '8-12h',
        source: 'add_next',
      },
    ]);
    for (const [m, b] of [[239, '<4h'], [240, '4-8h'], [480, '4-8h'], [481, '8-12h'], [721, '>12h']] as const) {
      A.shiftCreated({ repeats: false, recurrence: 'none', assigned: false, assignedSelf: false, reminder: 'off', overnight: false, durationMinutes: m, source: 'shifts_view' });
      expect(last()[1].duration_bucket).toBe(b);
    }
  });

  it('the rest of the events, with the exact names and no ids', async () => {
    const A = await load();
    A.shiftAddNextTapped();
    expect(last()).toEqual(['shift_add_next_tapped', {}]);
    A.shiftTaken({ scope: 'future' });
    expect(last()).toEqual(['shift_taken', { scope: 'future', reminder_changed: false }]);
    A.shiftTaken({ scope: 'occurrence', reminderChanged: true });
    expect(last()).toEqual(['shift_taken', { scope: 'occurrence', reminder_changed: true }]);
    A.shiftTakeConflict();
    expect(last()).toEqual(['shift_take_conflict', {}]);
    A.shiftDropped({ scope: 'occurrence', within24h: true, byRole: 'manager' });
    expect(last()).toEqual(['shift_dropped', { scope: 'occurrence', within_24h: true, by_role: 'manager' }]);
    A.shiftAssigned({ scope: 'future', byRole: 'owner' });
    expect(last()).toEqual(['shift_assigned', { scope: 'future', by_role: 'owner' }]);
    A.shiftAssigned({ scope: 'future', byRole: 'self' });
    expect(last()[1].by_role).toBe('manager');
    A.shiftAssigned({ scope: 'future', byRole: 'manager' });
    expect(last()[1].by_role).toBe('manager');
    A.shiftEdited({ timeChanged: true, scope: 'future' });
    expect(last()).toEqual(['shift_edited', { time_changed: true, scope: 'future' }]);
    A.shiftDeleted({ scope: 'occurrence' });
    expect(last()).toEqual(['shift_deleted', { scope: 'occurrence' }]);
    A.shiftsTeaserShown({ source: 'add_menu' });
    expect(last()).toEqual(['shifts_teaser_shown', { source: 'add_menu' }]);
    A.shiftsTeaserCtaTapped();
    expect(last()).toEqual(['shifts_teaser_cta_tapped', {}]);
    for (const [, props] of capture.mock.calls as Array<[string, Record<string, unknown>]>) {
      expect(Object.keys(props)).not.toContain('circle_id');
    }
  });
});
