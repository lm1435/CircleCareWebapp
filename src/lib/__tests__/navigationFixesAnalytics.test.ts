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

// Navigation fixes 1.4.4 (docs/plans/navigation-fixes-1-4-4.md, P6 + N9): same names and enums as
// mobile; enums only, so a declined-consent viewer's events carry no id of any kind.
describe('navigation fixes analytics', () => {
  it('P6: care_team_opened carries only the source enum', async () => {
    const A = await load();
    A.careTeamOpened('header');
    expect(last()).toEqual(['care_team_opened', { source: 'header' }]);
    A.careTeamOpened('today_row');
    expect(last()).toEqual(['care_team_opened', { source: 'today_row' }]);
  });

  it("P6: circle_settings_opened (the owner's gear) carries only the source enum", async () => {
    const A = await load();
    A.circleSettingsOpened('today_header');
    expect(last()).toEqual(['circle_settings_opened', { source: 'today_header', viewer: 'owner' }]);
    A.circleSettingsOpened('today_header', 'care_recipient');
    expect(last()).toEqual(['circle_settings_opened', { source: 'today_header', viewer: 'care_recipient' }]);
  });

  it('1.4.4: circle_details_saved carries only the viewer enum and two booleans (no ids, no values)', async () => {
    const A = await load();
    A.circleDetailsSaved({ viewer: 'care_recipient', name_changed: false, dob_changed: true });
    expect(last()).toEqual([
      'circle_details_saved',
      { viewer: 'care_recipient', name_changed: false, dob_changed: true },
    ]);
    A.circleDetailsSaved({ viewer: 'owner', name_changed: true, dob_changed: false });
    expect(last()).toEqual([
      'circle_details_saved',
      { viewer: 'owner', name_changed: true, dob_changed: false },
    ]);
    // NEGATIVE: an unexpected viewer value collapses to the enum; nothing else rides along.
    A.circleDetailsSaved({ viewer: 'someone@example.com' as never, name_changed: true, dob_changed: true });
    expect(last()).toEqual([
      'circle_details_saved',
      { viewer: 'owner', name_changed: true, dob_changed: true },
    ]);
  });

  it('P6: account_settings_opened carries only the source enum', async () => {
    const A = await load();
    A.accountSettingsOpened('today_header');
    expect(last()).toEqual(['account_settings_opened', { source: 'today_header' }]);
  });

  it('N9: with analytics declined, neither event carries a circle_id or any other id', async () => {
    setAnalyticsConsent(false);
    const A = await load();
    A.careTeamOpened('header');
    A.careTeamOpened('today_row');
    A.accountSettingsOpened('today_header');
    A.circleSettingsOpened('today_header');
    A.circleDetailsSaved({ viewer: 'care_recipient', name_changed: true, dob_changed: true });
    for (const call of capture.mock.calls as Array<[string, Record<string, unknown> | undefined]>) {
      expect(Object.keys(call[1] ?? {}).filter((k) => /(^|_)id$/.test(k))).toEqual([]);
    }
  });
});
