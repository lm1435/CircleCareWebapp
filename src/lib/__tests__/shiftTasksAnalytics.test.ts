import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { setAnalyticsConsent, __resetAnalyticsConsentCache } from '../analyticsConsent';

// docs/plans/shift-tasks.md section 8: enums / booleans / buckets only, whitelisted. NEVER circle_id,
// an id, a title or a time.

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

describe('shift tasks analytics', () => {
  it('shift flow (2026-11-08): saved-dialog layout, Custom repeat opened, Take reminder expanded: booleans only', async () => {
    const A = await load();
    A.shiftSavedSheetAction({ action: 'add_next', repeating: true });
    expect(last()[0]).toBe('shift_saved_sheet_action');
    expect(last()[1]).toEqual(expect.objectContaining({ action: 'add_next', repeating: true }));
    A.shiftRepeatCustomOpened({ editing: 'yes' as unknown as boolean });
    expect(last()[0]).toBe('shift_repeat_custom_opened');
    expect(last()[1]).toEqual(expect.objectContaining({ editing: false }));
    A.shiftTakeReminderExpanded();
    expect(last()[0]).toBe('shift_take_reminder_expanded');
    expect(JSON.stringify(capture.mock.calls)).not.toContain('circle_id');
  });

  it('shift_task_added: source enum + two booleans', async () => {
    const A = await load();
    A.shiftTaskAdded({ source: 'saved_sheet', oneOff: true, shiftRepeats: false });
    expect(last()).toEqual(['shift_task_added', { source: 'saved_sheet', one_off: true, shift_repeats: false, next_day: false }]);
    A.shiftTaskAdded({ source: 'bogus', oneOff: false, shiftRepeats: true });
    expect(last()[1]).toEqual({ source: 'shift_detail', one_off: false, shift_repeats: true, next_day: false });
    A.shiftTaskAdded({ source: 'shift_detail', oneOff: false, shiftRepeats: true, nextDay: true });
    expect(last()[1]).toMatchObject({ next_day: true });
  });

  it('shift_task_completed: surface enum', async () => {
    const A = await load();
    for (const surface of ['shift_detail', 'today', 'tasks', 'calendar']) {
      A.shiftTaskCompleted({ surface });
      expect(last()).toEqual(['shift_task_completed', { surface }]);
    }
    A.shiftTaskCompleted({ surface: 'elsewhere' });
    expect(last()[1]).toEqual({ surface: 'tasks' });
  });

  it('shift_task_list_viewed: two buckets', async () => {
    const A = await load();
    A.shiftTaskListViewed({ tasksBucket: '2-3', doneBucket: 'some' });
    expect(last()).toEqual(['shift_task_list_viewed', { tasks_bucket: '2-3', done_bucket: 'some' }]);
    A.shiftTaskListViewed({ tasksBucket: '9', doneBucket: 'x' });
    expect(last()[1]).toEqual({ tasks_bucket: '0', done_bucket: 'none' });
  });

  it('shift_also_happening_expanded has no props', async () => {
    const A = await load();
    A.shiftAlsoHappeningExpanded();
    expect(last()).toEqual(['shift_also_happening_expanded', {}]);
  });

  it('shift_saved_sheet_action and shift_task_deleted: closed enums', async () => {
    const A = await load();
    for (const action of ['add_task', 'add_next', 'done']) {
      A.shiftSavedSheetAction({ action });
      expect(last()).toEqual(['shift_saved_sheet_action', { action }]);
    }
    for (const scope of ['occurrence', 'future', 'all']) {
      A.shiftTaskDeleted({ scope });
      expect(last()).toEqual(['shift_task_deleted', { scope }]);
    }
    A.shiftTaskDeleted({ scope: 'everything' });
    expect(last()[1]).toEqual({ scope: 'occurrence' });
  });

  it('shift_edit_tasks_warning_shown: bucket + kind', async () => {
    const A = await load();
    A.shiftEditTasksWarningShown({ countBucket: '2-3', kind: 'repeat' });
    expect(last()).toEqual(['shift_edit_tasks_warning_shown', { count_bucket: '2-3', kind: 'repeat' }]);
  });

  it('no payload ever carries circle_id', async () => {
    const A = await load();
    A.shiftTaskAdded({ source: 'saved_sheet', oneOff: false, shiftRepeats: true });
    A.shiftTaskCompleted({ surface: 'today' });
    A.shiftTaskListViewed({ tasksBucket: '1', doneBucket: 'all' });
    A.shiftAlsoHappeningExpanded();
    A.shiftSavedSheetAction({ action: 'done' });
    A.shiftTaskDeleted({ scope: 'all' });
    for (const [, props] of capture.mock.calls) expect(props).not.toHaveProperty('circle_id');
  });

  it('shift_item_added (Add to this shift): the type enum only; anything else falls back, nothing else rides along', async () => {
    const A = await load();
    for (const type of ['task', 'medication', 'appointment'] as const) {
      A.shiftItemAdded({ type });
      expect(last()[0]).toBe('shift_item_added');
      expect(last()[1]).toEqual(expect.objectContaining({ type }));
    }
    A.shiftItemAdded({ type: 'Metformin 500mg' });
    expect(last()[1]).toEqual(expect.objectContaining({ type: 'task' }));
    expect(JSON.stringify(last()[1])).not.toContain('Metformin');
    expect(JSON.stringify(capture.mock.calls)).not.toContain('circle_id');
  });

  it('add-from-shift events: enums and booleans only; stray strings fall back and nothing identifying rides along', async () => {
    const A = await load();
    A.shiftAddChooserOpened({ shiftRepeating: true, listEmpty: false });
    expect(last()).toEqual(['shift_add_chooser_opened', expect.objectContaining({ shift_repeating: true, list_empty: false })]);
    A.shiftAddChooserClosed({ choice: 'medication' });
    expect(last()[1]).toEqual(expect.objectContaining({ choice: 'medication' }));
    A.shiftAddChooserClosed({ choice: 'Metformin 500mg' });
    expect(last()[1]).toEqual(expect.objectContaining({ choice: 'cancel' }));
    A.shiftItemAdded({ type: 'appointment', shiftRepeating: true });
    expect(last()[1]).toEqual(expect.objectContaining({ type: 'appointment', shift_repeating: true }));
    A.shiftItemAddAbandoned({ type: 'task', shiftRepeating: 'yes' as unknown as boolean, reason: 'because I felt like it' });
    expect(last()[0]).toBe('shift_item_add_abandoned');
    expect(last()[1]).toEqual(expect.objectContaining({ type: 'appointment', shift_repeating: false, reason: 'cancel' }));
    A.shiftItemAddAbandoned({ type: 'medication', shiftRepeating: false, reason: 'refused_time' });
    expect(last()[1]).toEqual(expect.objectContaining({ type: 'medication', reason: 'refused_time' }));
    expect(JSON.stringify(capture.mock.calls)).not.toMatch(/circle_id|Metformin|felt like/);
  });
});
