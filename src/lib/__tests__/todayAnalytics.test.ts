import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { setAnalyticsConsent, __resetAnalyticsConsentCache } from '../analyticsConsent';

// The Today / add-menu analytics contract (docs/plans/simple-ui-1-3-1.md,
// "Analytics contract"): the same names and props as mobile; enums, counts and
// booleans only; NO circle_id.

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

const last = () =>
  capture.mock.calls[capture.mock.calls.length - 1] as [string, Record<string, unknown>];

describe('Today analytics contract', () => {
  it('today_viewed carries has_items, next_up_count and the one coaching element', async () => {
    const A = await load();
    A.todayViewed({ has_items: true, next_up_count: 4, coaching: 'next_step' });
    expect(last()).toEqual([
      'today_viewed',
      { has_items: true, next_up_count: 4, coaching: 'next_step' },
    ]);
    A.todayViewed({ has_items: false, next_up_count: 0, coaching: 'none' });
    expect(last()[1]).toEqual({ has_items: false, next_up_count: 0, coaching: 'none' });
  });

  it('next_up_action carries action, item_type and position', async () => {
    const A = await load();
    A.nextUpAction({ action: 'taken', item_type: 'medication', position: 1 });
    expect(last()).toEqual([
      'next_up_action',
      { action: 'taken', item_type: 'medication', position: 1 },
    ]);
    A.nextUpAction({ action: 'done', item_type: 'task', position: 3 });
    expect(last()[1]).toEqual({ action: 'done', item_type: 'task', position: 3 });
    A.nextUpAction({ action: 'open', item_type: 'appointment', position: 2 });
    expect(last()[1]).toEqual({ action: 'open', item_type: 'appointment', position: 2 });
  });

  it('today_all_items_opened has no props', async () => {
    const A = await load();
    A.todayAllItemsOpened();
    expect(last()).toEqual(['today_all_items_opened', {}]);
  });

  it.each([
    ['nextStepShown', 'next_step_shown'],
    ['nextStepTapped', 'next_step_tapped'],
    ['nextStepDismissed', 'next_step_dismissed'],
    ['nextStepCompleted', 'next_step_completed'],
  ] as const)('%s sends %s with the step enum only', async (method, event) => {
    const A = await load();
    for (const step of ['first_med', 'invite', 'reminders'] as const) {
      A[method](step);
      expect(last()).toEqual([event, { step }]);
    }
  });

  it.each([
    ['coachingHintShown', 'coaching_hint_shown'],
    ['coachingHintDismissed', 'coaching_hint_dismissed'],
    ['coachingHintActed', 'coaching_hint_acted'],
  ] as const)('%s sends %s with the hint enum and an upsell boolean only', async (method, event) => {
    const A = await load();
    for (const hint of ['first_dose', 'shifts_second_caregiver'] as const) {
      A[method](hint);
      expect(last()).toEqual([event, { hint, upsell: false }]);
    }
    A[method]('shifts_second_caregiver', { upsell: true });
    expect(last()).toEqual([event, { hint: 'shifts_second_caregiver', upsell: true }]);
  });

  it('add menu events: opened from nav, option enum, closed empty', async () => {
    const A = await load();
    A.addMenuOpened();
    expect(last()).toEqual(['add_menu_opened', { from: 'nav' }]);
    for (const option of ['medication', 'appointment', 'task', 'note', 'shift'] as const) {
      A.addMenuOptionTapped(option);
      expect(last()).toEqual(['add_menu_option_tapped', { option }]);
    }
    A.addMenuClosedEmpty();
    expect(last()).toEqual(['add_menu_closed_empty', {}]);
  });

  it('large_text_layout carries the screen and the boolean', async () => {
    const A = await load();
    A.largeTextLayout('today', true);
    expect(last()).toEqual(['large_text_layout', { screen: 'today', active: true }]);
    A.largeTextLayout('add_menu', false);
    expect(last()).toEqual(['large_text_layout', { screen: 'add_menu', active: false }]);
  });

  it('quick_access_tapped accepts the new shifts destination', async () => {
    const A = await load();
    A.quickAccessTapped('shifts');
    expect(last()).toEqual(['quick_access_tapped', { destination: 'shifts' }]);
  });

  it('no Today event ever carries a circle_id', async () => {
    const A = await load();
    A.todayViewed({ has_items: true, next_up_count: 1, coaching: 'none' });
    A.nextUpAction({ action: 'open', item_type: 'task', position: 1 });
    A.todayAllItemsOpened();
    A.nextStepShown('invite');
    A.coachingHintShown('first_dose');
    A.addMenuOpened();
    A.addMenuOptionTapped('shift');
    A.addMenuClosedEmpty();
    A.largeTextLayout('today', false);
    expect(capture.mock.calls.length).toBe(8 + 1);
    for (const [, props] of capture.mock.calls) {
      expect(Object.keys((props ?? {}) as object)).not.toContain('circle_id');
    }
  });

  it('is a safe no-op when PostHog is not configured', async () => {
    const A = await load(null);
    A.todayViewed({ has_items: true, next_up_count: 1, coaching: 'none' });
    A.addMenuOpened();
    A.nextStepShown('invite');
    expect(capture).not.toHaveBeenCalled();
  });
});
