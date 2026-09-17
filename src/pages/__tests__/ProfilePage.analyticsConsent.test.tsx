import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router-dom';
import type { ReactNode } from 'react';
import '@/i18n';
import ProfilePage from '@/pages/ProfilePage';
import type { User, UnitPreferences } from '@/api/users';
import {
  getAnalyticsConsentState,
  hasAnsweredAnalyticsConsent,
  __resetAnalyticsConsentCache,
} from '@/lib/analyticsConsent';

/**
 * THE PROFILE TOGGLE AND THE SIGNUP CHECKBOX ARE ONE DECISION.
 *
 * ProfilePage.test.tsx covers the SERVER sync (`syncAnalyticsConsent`) but not
 * the local record, so the toggle could stop writing consent entirely and stay
 * green — which would mean the signup answer and the settings screen drift:
 * someone accepts at signup, opens Profile, and either sees the wrong state or
 * flips it to no effect. Both surfaces write through
 * `recordAnalyticsConsentDecision`; these tests pin that they agree.
 */

const navigate = vi.fn();
vi.mock('react-router-dom', async (importOriginal) => {
  const actual = await importOriginal<typeof import('react-router-dom')>();
  return { ...actual, useNavigate: () => navigate };
});

const USER: User = {
  id: 'u1',
  email: 'sam@example.com',
  first_name: 'Sam',
  last_name: 'Doe',
  timezone: 'America/Denver',
  language: 'en',
  notification_preferences: {
    medication_confirmations: true,
    missed_medications: true,
    task_assignments: true,
    appointment_reminders: true,
    activity_updates: true,
    chat_messages: true,
    note_nudges: true,
  },
  quiet_hours_start: null,
  quiet_hours_end: null,
  email_digest_enabled: false,
  email_digest_day: 0,
  created_at: '2026-01-01T00:00:00Z',
  updated_at: '2026-01-01T00:00:00Z',
};
const UNITS: UnitPreferences = { weight_unit: 'lbs', glucose_unit: 'mg/dL' };

vi.mock('@/api/users', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/api/users')>();
  return {
    ...actual,
    getCurrentUser: vi.fn(() => Promise.resolve(USER)),
    getUnitPreferences: vi.fn(() => Promise.resolve(UNITS)),
  };
});

vi.mock('@/hooks/useProfile', () => ({
  useUpdateProfile: () => ({ mutate: vi.fn(), isPending: false }),
  useUpdateNotificationPrefs: () => ({ mutate: vi.fn(), isPending: false }),
  useUpdateQuietHours: () => ({ mutate: vi.fn(), isPending: false }),
  useUpdateUnitPrefs: () => ({ mutate: vi.fn(), isPending: false }),
  useUpdateEmailDigest: () => ({ mutate: vi.fn(), isPending: false }),
  useDeleteAccount: () => ({ mutate: vi.fn(), isPending: false, isError: false, reset: vi.fn() }),
}));

vi.mock('@/hooks/useSubscriptionStatus', () => ({
  useSubscriptionStatus: () => ({ data: { tier: 'free' } }),
}));

vi.mock('@/components/ui', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/components/ui')>();
  return { ...actual, useToast: () => ({ showToast: vi.fn() }) };
});

vi.mock('@/store/authStore', () => ({
  useAuthStore: (
    selector: (s: { signOut: () => Promise<void>; user: { id: string } | null }) => unknown
  ) => selector({ signOut: vi.fn(), user: { id: 'u1' } }),
}));

vi.mock('@/lib/analyticsConsentSync', () => ({ syncAnalyticsConsent: vi.fn(() => Promise.resolve()) }));

const identifyUser = vi.fn();
const initAnalytics = vi.fn();
const disableAnalytics = vi.fn();
vi.mock('@/lib/posthog', () => ({
  identifyUser: (...a: unknown[]) => identifyUser(...(a as [])),
  initAnalytics: (...a: unknown[]) => initAnalytics(...(a as [])),
  disableAnalytics: (...a: unknown[]) => disableAnalytics(...(a as [])),
  resetAnalytics: vi.fn(),
  captureException: vi.fn(),
}));

vi.mock('@/lib/analytics', () => ({
  Analytics: {
    languageChanged: vi.fn(),
    timezoneChanged: vi.fn(),
    accountDeleted: vi.fn(),
    errorOccurred: vi.fn(),
  },
}));

function renderPage() {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  const wrapper = ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={queryClient}>
      <MemoryRouter>{children}</MemoryRouter>
    </QueryClientProvider>
  );
  render(<ProfilePage />, { wrapper });
}

const toggle = () => screen.findByRole('switch', { name: /Share usage data/i });

beforeEach(() => {
  vi.clearAllMocks();
  localStorage.clear();
  __resetAnalyticsConsentCache();
});

describe('the toggle reflects what the signup flow recorded', () => {
  it('reads ON for a visitor who ACCEPTED at signup', async () => {
    localStorage.setItem('cc_analytics_enabled', 'true');
    renderPage();
    expect(await toggle()).toBeChecked();
  });

  it('reads OFF for a visitor who DECLINED at signup', async () => {
    localStorage.setItem('cc_analytics_enabled', 'false');
    renderPage();
    expect(await toggle()).not.toBeChecked();
  });

  it('reads OFF for a visitor who was never asked', async () => {
    renderPage();
    expect(await toggle()).not.toBeChecked();
    // …and the toggle being off has NOT recorded an answer on their behalf.
    expect(hasAnsweredAnalyticsConsent()).toBe(false);
  });
});

describe('the toggle records a decision', () => {
  it('turning it ON records GRANTED and re-identifies the signed-in user', async () => {
    const user = userEvent.setup();
    renderPage();

    await user.click(await toggle());

    expect(getAnalyticsConsentState()).toBe('granted');
    expect(initAnalytics).toHaveBeenCalled();
    // ID ONLY. The toggle knows the signed-in user's email and must not pass
    // it: `recordAnalyticsConsentDecision` takes `{ id }` and nothing more.
    expect(identifyUser.mock.calls).toEqual([['u1']]);
    expect(JSON.stringify(identifyUser.mock.calls)).not.toContain('sam@example.com');
  });

  it('turning it OFF records DECLINED and tears the client down first', async () => {
    localStorage.setItem('cc_analytics_enabled', 'true');
    // "First" is checked, not assumed: the teardown must run while storage
    // still says granted, so the queue is dropped before the emit-path gate
    // (which re-reads storage per event) starts treating the visitor as declined.
    let stateAtTeardown: string | null = null;
    disableAnalytics.mockImplementationOnce(() => {
      stateAtTeardown = localStorage.getItem('cc_analytics_enabled');
    });
    const user = userEvent.setup();
    renderPage();

    await user.click(await toggle());

    expect(getAnalyticsConsentState()).toBe('declined');
    expect(disableAnalytics).toHaveBeenCalledTimes(1);
    expect(stateAtTeardown).toBe('true');
    expect(localStorage.getItem('cc_analytics_enabled')).toBe('false');
    expect(identifyUser).not.toHaveBeenCalled();
  });

  /**
   * ON then OFF from a never-asked start is TWO answers: the ON click records a
   * grant, so the OFF click is a real withdrawal of it and tears down exactly
   * once — on the OFF, never on the ON.
   */
  it('turning ON then OFF ends at DECLINED, an answered state', async () => {
    const user = userEvent.setup();
    renderPage();

    await user.click(await toggle());
    expect(disableAnalytics).not.toHaveBeenCalled();
    await user.click(await toggle());

    expect(getAnalyticsConsentState()).toBe('declined');
    expect(hasAnsweredAnalyticsConsent()).toBe(true);
    expect(disableAnalytics).toHaveBeenCalledTimes(1);
  });

  /**
   * A decline that withdraws NO grant must not `reset()` the anonymous client:
   * that would drop the pending queue to withdraw a consent that was never
   * given. On this page the path is a stale toggle — it rendered ON, then
   * another tab cleared the answer (the cross-tab listener resets this tab to
   * 'unasked') — and the visitor switches it OFF.
   */
  it('switching OFF when no grant is recorded any more never tears the client down', async () => {
    localStorage.setItem('cc_analytics_enabled', 'true');
    const user = userEvent.setup();
    renderPage();
    const sw = await toggle();
    expect(sw).toBeChecked();

    localStorage.removeItem('cc_analytics_enabled');
    window.dispatchEvent(
      new StorageEvent('storage', {
        key: 'cc_analytics_enabled',
        oldValue: 'true',
        newValue: null,
        storageArea: localStorage,
      })
    );
    expect(getAnalyticsConsentState()).toBe('unasked');

    await user.click(sw);

    expect(getAnalyticsConsentState()).toBe('declined');
    expect(disableAnalytics).not.toHaveBeenCalled();
  });
});
