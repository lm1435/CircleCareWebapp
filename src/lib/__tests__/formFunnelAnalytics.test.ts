import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { setAnalyticsConsent, __resetAnalyticsConsentCache } from '../analyticsConsent';

// The simple-UI form funnel on the wire: names and props are the cross-platform
// contract (docs/plans/simple-ui-1-3-1.md). Enums, counts and booleans only; never
// a circle_id.

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

describe('form funnel events', () => {
  it('entry_form_opened {type, entry}', async () => {
    const A = await load();
    A.entryFormOpened({ type: 'medication', entry: 'add_menu' });
    expect(capture).toHaveBeenCalledWith('entry_form_opened', {
      type: 'medication',
      entry: 'add_menu',
    });
  });

  it('entry_form_step_completed {type, step}', async () => {
    const A = await load();
    A.entryFormStepCompleted({ type: 'appointment', step: 'who' });
    expect(capture).toHaveBeenCalledWith('entry_form_step_completed', {
      type: 'appointment',
      step: 'who',
    });
  });

  it('time_chip_selected {chip}', async () => {
    const A = await load();
    A.timeChipSelected({ chip: 'bedtime' });
    expect(capture).toHaveBeenCalledWith('time_chip_selected', { chip: 'bedtime' });
    A.timeChipSelected({ chip: 'other' });
    expect(capture).toHaveBeenLastCalledWith('time_chip_selected', { chip: 'other' });
  });

  it('appointment_form_abandoned {last_field, entry_source, seconds_open} buckets like the medication twin', async () => {
    const A = await load();
    A.appointmentFormAbandoned({ lastField: 'who', entrySource: 'next_step', secondsOpen: 12 });
    expect(capture).toHaveBeenLastCalledWith('appointment_form_abandoned', {
      last_field: 'who',
      entry_source: 'next_step',
      seconds_open: 10,
    });
    A.appointmentFormAbandoned({ lastField: 'none', entrySource: 'other', secondsOpen: 100 });
    expect(capture).toHaveBeenLastCalledWith('appointment_form_abandoned', {
      last_field: 'none',
      entry_source: 'other',
      seconds_open: 90,
    });
    // Same bucketing as medication_form_abandoned for the same duration.
    A.medicationFormAbandoned({
      lastField: 'name',
      hasName: true,
      hasSchedule: false,
      entry: 'form',
      entrySource: 'add_menu',
      secondsOpen: 100,
    });
    expect(capture.mock.calls.at(-1)?.[1].seconds_open).toBe(90);
  });

  it('medication_form_abandoned carries `entry_source`', async () => {
    const A = await load();
    A.medicationFormAbandoned({
      lastField: 'time',
      hasName: true,
      hasSchedule: true,
      entry: 'form',
      entrySource: 'empty_state',
      secondsOpen: 4,
    });
    expect(capture).toHaveBeenCalledWith('medication_form_abandoned', {
      last_field: 'time',
      has_name: true,
      has_schedule: true,
      entry: 'form',
      entry_source: 'empty_state',
      seconds_open: 5,
    });
  });

  it('large_text_layout {screen, active} for the three screens of this workstream', async () => {
    const A = await load();
    for (const screen of ['med_form', 'appt_form', 'meds'] as const) {
      A.largeTextLayout(screen, true);
      expect(capture).toHaveBeenLastCalledWith('large_text_layout', { screen, active: true });
    }
  });

  it('none of them carries a circle_id', async () => {
    const A = await load();
    A.entryFormOpened({ type: 'task', entry: 'other' });
    A.entryFormStepCompleted({ type: 'medication', step: 'what' });
    A.timeChipSelected({ chip: 'morning' });
    A.appointmentFormAbandoned({ lastField: 'title', entrySource: 'other', secondsOpen: 1 });
    A.largeTextLayout('meds', false);
    for (const call of capture.mock.calls) expect(call[1]).not.toHaveProperty('circle_id');
  });
});
