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
  it('shift_task_added: source enum + two booleans', async () => {
    const A = await load();
    A.shiftTaskAdded({ source: 'saved_sheet', oneOff: true, shiftRepeats: false });
    expect(last()).toEqual(['shift_task_added', { source: 'saved_sheet', one_off: true, shift_repeats: false }]);
    A.shiftTaskAdded({ source: 'bogus', oneOff: false, shiftRepeats: true });
    expect(last()[1]).toEqual({ source: 'shift_detail', one_off: false, shift_repeats: true });
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
});
