import { screen, render, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router-dom';
import '@/i18n';
import ProfilePage from '@/pages/ProfilePage';
import type { NotificationPreferences, User, UnitPreferences } from '@/api/users';

// REGRESSION (e2e/flows/profile-notification-groups.spec.ts, formerly profile-note-switches, 2026-09-28): the
// notification switches render straight from the currentUser query and are
// disabled only while the PATCH is pending. `useUpdateNotificationPrefs` used
// to ONLY invalidate on success, so between the PATCH resolving and the
// currentUser refetch landing, every switch was re-ENABLED but still showed
// its PRE-toggle value. A second click in that window re-sent the value just
// saved (the switch could not be turned back), and the Tasks group's
// event_notes pin read the stale event_notes value (re-enabling Notes a moment
// after the user turned it off).
//
// Unlike ProfilePage.test.tsx, these tests run the REAL mutation hook against
// a real QueryClient; only the network functions are mocked. The refetch that
// follows a PATCH is held open forever to model the gap deterministically.

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

// Server-side state the mocked PATCH merges into (mirrors the backend's
// `{ ...current, ...body }` merge, without the legacy shim — every body this
// client sends that touches note_nudges carries event_notes explicitly).
let serverPrefs: NotificationPreferences = { ...USER.notification_preferences };
let getCalls = 0;
const patchBodies: Partial<NotificationPreferences>[] = [];

vi.mock('@/api/users', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/api/users')>();
  return {
    ...actual,
    // First load resolves; every later GET (the post-PATCH refetch) hangs.
    getCurrentUser: vi.fn(() => {
      getCalls += 1;
      if (getCalls === 1) return Promise.resolve({ ...USER, notification_preferences: serverPrefs });
      return new Promise<User>(() => {});
    }),
    getUnitPreferences: vi.fn(() => Promise.resolve(UNITS)),
    updateNotificationPrefs: vi.fn((body: Partial<NotificationPreferences>) => {
      patchBodies.push(body);
      serverPrefs = { ...serverPrefs, ...body };
      return Promise.resolve({ ...USER, notification_preferences: serverPrefs });
    }),
  };
});

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
  ) => selector({ signOut: () => Promise.resolve(), user: { id: 'u1' } }),
}));

vi.mock('@/lib/analyticsConsentSync', () => ({
  syncAnalyticsConsent: () => Promise.resolve(),
}));

vi.mock('@/lib/analytics', () => ({
  Analytics: {
    notificationGroupToggled: vi.fn(),
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
  render(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter>
        <ProfilePage />
      </MemoryRouter>
    </QueryClientProvider>
  );
}

beforeEach(() => {
  serverPrefs = { ...USER.notification_preferences };
  getCalls = 0;
  patchBodies.length = 0;
  localStorage.clear();
});

describe('ProfilePage notification groups — PATCH-resolved, refetch-pending gap', () => {
  it('a group shows the saved value once the PATCH resolves, so a second click turns it back', async () => {
    const user = userEvent.setup();
    renderPage();

    const tips = await screen.findByRole('switch', { name: /Daily update & tips/i });
    expect(tips).toHaveAttribute('aria-checked', 'true');

    await user.click(tips);
    // PATCH resolved, refetch still in flight: the switch is usable again and
    // must already show OFF.
    await waitFor(() => expect(tips).not.toHaveAttribute('aria-disabled'));
    expect(getCalls).toBeGreaterThan(1); // the refetch really is pending
    expect(tips).toHaveAttribute('aria-checked', 'false');

    await user.click(tips);
    await waitFor(() => expect(patchBodies).toHaveLength(2));
    expect(patchBodies).toEqual([
      { tips_and_suggestions: false },
      { tips_and_suggestions: true },
    ]);
    await waitFor(() => expect(tips).toHaveAttribute('aria-checked', 'true'));
  });

  it('Notes off then Tasks off: the Tasks body pins event_notes to the value just saved, not the stale one', async () => {
    const user = userEvent.setup();
    renderPage();

    const notes = await screen.findByRole('switch', { name: /^Notes/i });
    const tasks = screen.getByRole('switch', { name: /Tasks & appointments/i });

    await user.click(notes);
    await waitFor(() => expect(tasks).not.toHaveAttribute('aria-disabled'));

    await user.click(tasks);
    await waitFor(() => expect(patchBodies).toHaveLength(2));
    expect(patchBodies[0]).toEqual({ event_notes: false, care_notes: false });
    // A stale cache would pin event_notes: true here and silently re-enable
    // Notes (the backend note_nudges shim is bypassed only by an explicit pin).
    expect(patchBodies[1]).toEqual({
      task_assignments: false,
      appointment_reminders: false,
      note_nudges: false,
      event_notes: false,
    });
    expect(serverPrefs.event_notes).toBe(false);
  });
});
