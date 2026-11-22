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

  it('shift_created reminder_count (1.4.2): a 0-4 integer, clamped; absent = not sent', async () => {
    const A = await load();
    const base = { repeats: false, recurrence: 'none', assigned: false, assignedSelf: false, reminder: '1h', overnight: false, durationMinutes: 60, source: 'shifts_view' };
    A.shiftCreated({ ...base, reminderCount: 2 });
    expect(last()[1]).toMatchObject({ reminder: '1h', reminder_count: 2 });
    A.shiftCreated({ ...base, reminderCount: 99 });
    expect(last()[1].reminder_count).toBe(4);
    A.shiftCreated({ ...base, reminderCount: 'x' as never });
    expect(last()[1].reminder_count).toBe(0);
    A.shiftCreated(base);
    expect(last()[1]).not.toHaveProperty('reminder_count');
  });

  it('shift_created and shift_edited carry the form layout enum only when the caller sends "simple"', async () => {
    const A = await load();
    const base = { repeats: false, recurrence: 'none', assigned: false, assignedSelf: false, reminder: 'off', overnight: false, durationMinutes: 60, source: 'shifts_view' };
    A.shiftCreated({ ...base, layout: 'simple' });
    expect(last()[1].layout).toBe('simple');
    A.shiftCreated(base);
    expect(last()[1]).not.toHaveProperty('layout');
    A.shiftEdited({ timeChanged: false, scope: 'occurrence', layout: 'simple' });
    expect(last()).toEqual(['shift_edited', { time_changed: false, scope: 'occurrence', layout: 'simple' }]);
    // Anything but the known enum is dropped (never free text).
    A.shiftEdited({ timeChanged: false, scope: 'occurrence', layout: 'Mom needs help' as never });
    expect(last()[1]).not.toHaveProperty('layout');
  });

  it('shift_created names the new repeats and buckets a rotation\'s on / off counts', async () => {
    const A = await load();
    const base = { repeats: true, assigned: false, assignedSelf: false, reminder: 'off', overnight: false, durationMinutes: 1440, source: 'shifts_view' };
    for (const r of ['every_other_day', 'monthly', 'yearly'] as const) {
      A.shiftCreated({ ...base, recurrence: r });
      expect(last()[1].recurrence).toBe(r);
      expect(last()[1]).not.toHaveProperty('cycle_on_bucket');
    }
    A.shiftCreated({ ...base, recurrence: 'cycle', cycleOnBucket: '8-14', cycleOffBucket: '4-7' });
    expect(last()[1]).toMatchObject({ recurrence: 'cycle', cycle_on_bucket: '8-14', cycle_off_bucket: '4-7' });
    // Never the raw count, never free text.
    A.shiftCreated({ ...base, recurrence: 'cycle', cycleOnBucket: '14', cycleOffBucket: 'abc' });
    expect(last()[1]).toMatchObject({ cycle_on_bucket: '1-3', cycle_off_bucket: '1-3' });
    A.shiftCreated({ ...base, recurrence: 'bogus' });
    expect(last()[1].recurrence).toBe('none');
  });

  it('shift_series_rescheduled carries enums and the platform only', async () => {
    const A = await load();
    A.shiftSeriesRescheduled({ changed: 'both', fromRecurrence: 'cycle', toRecurrence: 'weekly' });
    expect(last()).toEqual([
      'shift_series_rescheduled',
      { changed: 'both', from_recurrence: 'cycle', to_recurrence: 'weekly', platform: 'web' },
    ]);
    A.shiftSeriesRescheduled({ changed: 'Mom', fromRecurrence: 'x', toRecurrence: 'y' });
    expect(last()[1]).toEqual({ changed: 'date', from_recurrence: 'none', to_recurrence: 'none', platform: 'web' });
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

  // ── 1.4.3 shift task add / edit (plan section 5): enums / booleans / counts only ──────────────────
  it('shift_task_add_opened: closed enums, no ids', async () => {
    const A = await load();
    A.shiftTaskAddOpened({ source: 'saved_sheet', shiftRepeats: true, coverer: 'me', timeDefault: 'next_half_hour' });
    expect(last()).toEqual([
      'shift_task_add_opened',
      { source: 'saved_sheet', shift_repeats: true, coverer: 'me', time_default: 'next_half_hour' },
    ]);
    // Owner 2026-11-22: a new shift task opens with no time, reported as 'none'.
    A.shiftTaskAddOpened({ source: 'shift_detail', shiftRepeats: true, coverer: 'other', timeDefault: 'none' });
    expect(last()[1]).toEqual({ source: 'shift_detail', shift_repeats: true, coverer: 'other', time_default: 'none' });
    A.shiftTaskAddOpened({ source: 'bogus', shiftRepeats: false, coverer: 'bogus', timeDefault: 'bogus' });
    expect(last()[1]).toEqual({ source: 'shift_detail', shift_repeats: false, coverer: 'open', time_default: 'shift_start' });
  });

  it('shift_task_saved: mode / source enums, fields_used clamped 0-4, booleans', async () => {
    const A = await load();
    A.shiftTaskSaved({ mode: 'edit', source: 'tasks', fieldsUsed: 9, oneOff: true, nextDay: true, timeChanged: true, nameChanged: false, detailsSaved: true });
    expect(last()).toEqual([
      'shift_task_saved',
      { mode: 'edit', source: 'tasks', fields_used: 4, one_off: true, next_day: true, time_changed: true, name_changed: false, details_saved: true },
    ]);
    A.shiftTaskSaved({ mode: 'x', source: 'x', fieldsUsed: -2, oneOff: false, nextDay: false, timeChanged: false, nameChanged: false, detailsSaved: false });
    expect(last()[1]).toMatchObject({ mode: 'add', source: 'shift_detail', fields_used: 0, details_saved: false });
  });

  it('shift_task_edit_opened and shift_task_save_failed use closed enums', async () => {
    const A = await load();
    A.shiftTaskEditOpened({ source: 'calendar', linked: true, state: 'completed', recurring: false });
    expect(last()).toEqual(['shift_task_edit_opened', { source: 'calendar', linked: true, state: 'completed', recurring: false }]);
    A.shiftTaskSaveFailed({ mode: 'edit', reason: 'outside_window' });
    expect(last()).toEqual(['shift_task_save_failed', { mode: 'edit', reason: 'outside_window' }]);
    A.shiftTaskSaveFailed({ mode: 'edit', reason: 'Margaret at 5 Elm St' });
    expect(last()[1].reason).toBe('other');
  });

  it('shift_task_deleted keeps its scope and gains the surface only when given', async () => {
    const A = await load();
    A.shiftTaskDeleted({ scope: 'future' });
    expect(last()).toEqual(['shift_task_deleted', { scope: 'future' }]);
    A.shiftTaskDeleted({ scope: 'all', surface: 'editor' });
    expect(last()).toEqual(['shift_task_deleted', { scope: 'all', surface: 'editor' }]);
    A.shiftTaskDeleted({ scope: 'all', surface: 'bogus' });
    expect(last()[1].surface).toBe('editor');
  });

  it('N12 none of the new events can carry a circle id, a title or free text', async () => {
    const A = await load();
    A.shiftTaskAddOpened({ source: 'shift_detail', shiftRepeats: true, coverer: 'other', timeDefault: 'shift_start' });
    A.shiftTaskSaved({ mode: 'add', source: 'shift_detail', fieldsUsed: 1, oneOff: false, nextDay: false, timeChanged: false, nameChanged: true, detailsSaved: true });
    A.shiftTaskEditOpened({ source: 'tasks', linked: true, state: 'open', recurring: true });
    A.shiftTaskSaveFailed({ mode: 'add', reason: 'other' });
    for (const call of capture.mock.calls as Array<[string, Record<string, unknown>]>) {
      for (const [key, value] of Object.entries(call[1])) {
        expect(key).not.toMatch(/circle|title|name$|text|details$/i);
        expect(typeof value === 'string' ? value.length < 24 : true).toBe(true);
      }
    }
  });

  it('entry_form_opened accepts the two shift entries', async () => {
    const A = await load();
    A.entryFormOpened({ type: 'task', entry: 'shift_detail' });
    expect(last()).toEqual(['entry_form_opened', { type: 'task', entry: 'shift_detail' }]);
    A.entryFormOpened({ type: 'task', entry: 'shift_saved_sheet' });
    expect(last()[1].entry).toBe('shift_saved_sheet');
  });
});
