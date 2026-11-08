import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter, Route, Routes, useLocation } from 'react-router-dom';
import '@/i18n';
import ProfilePage from '@/pages/ProfilePage';
import type { User, UnitPreferences } from '@/api/users';

// Design pass 2026-11-08 (owner-approved "Settings grouping" mock): the Profile page is
// the header plus four grouped lists; each row shows its current value and opens its
// own page. Same groups, order and EN labels as mobile ProfileScreen.

const USER: User = {
  id: 'u1',
  email: 'sam@example.com',
  first_name: 'Sam',
  last_name: 'Doe',
  timezone: 'America/Denver',
  language: 'en',
  avatar_color: 'clay',
  notification_preferences: {},
  quiet_hours_start: null,
  quiet_hours_end: null,
  email_digest_enabled: false,
  email_digest_day: 0,
  created_at: '2026-01-01T00:00:00Z',
  updated_at: '2026-01-01T00:00:00Z',
} as unknown as User;
let currentUser: User = USER;
let units: UnitPreferences = { weight_unit: 'lbs', glucose_unit: 'mg/dL' };

vi.mock('@/api/users', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/api/users')>();
  return {
    ...actual,
    getCurrentUser: vi.fn(() => Promise.resolve(currentUser)),
    getUnitPreferences: vi.fn(() => Promise.resolve(units)),
    getTimezoneDependentCircles: vi.fn(() => Promise.resolve([])),
  };
});

vi.mock('@/hooks/useProfile', () => ({
  useUpdateProfile: () => ({ mutate: vi.fn(), isPending: false }),
  useUpdateAvatarColor: () => ({ mutate: vi.fn(), isPending: false }),
  useUpdateNotificationPrefs: () => ({ mutate: vi.fn(), isPending: false }),
  useUpdateQuietHours: () => ({ mutate: vi.fn(), isPending: false }),
  useUpdateUnitPrefs: () => ({ mutate: vi.fn(), isPending: false }),
  useUpdateEmailDigest: () => ({ mutate: vi.fn(), isPending: false }),
  useDeleteAccount: () => ({ mutate: vi.fn(), isPending: false, isError: false, reset: vi.fn() }),
}));

let subscriptionTier: 'free' | 'premium' = 'free';
vi.mock('@/hooks/useSubscriptionStatus', () => ({
  useSubscriptionStatus: () => ({ data: { tier: subscriptionTier }, isLoading: false }),
}));
vi.mock('@/hooks/useWebBilling', () => ({
  useManageSubscription: () => ({ mutate: vi.fn(), isPending: false }),
  useWebCustomerInfo: () => ({ data: undefined }),
  useWebPlans: () => ({ data: undefined }),
}));

let mockCircles: Array<{ id: string; role: 'owner' | 'member'; is_premium_circle: boolean }> = [];
vi.mock('@/hooks/useCircles', () => ({
  useCircles: () => ({ data: mockCircles }),
}));
vi.mock('@/hooks/usePremiumGate', () => ({
  usePremiumGate: () => ({ promptUpgrade: vi.fn(), promptLapsed: vi.fn() }),
}));
vi.mock('@/store/authStore', () => ({
  useAuthStore: (selector: (s: unknown) => unknown) =>
    selector({ signOut: vi.fn(), user: { id: 'u1' }, isAuthenticated: true }),
}));
vi.mock('@/components/ui', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/components/ui')>();
  return { ...actual, useToast: () => ({ showToast: vi.fn() }) };
});
vi.mock('@/lib/analyticsConsentSync', () => ({ syncAnalyticsConsent: vi.fn() }));
const settingsSectionViewed = vi.fn();
vi.mock('@/lib/analytics', () => ({
  Analytics: {
    settingsSectionViewed: (...args: unknown[]) => settingsSectionViewed(...args),
    notificationGroupToggled: vi.fn(),
    languageChanged: vi.fn(),
    accountDeleted: vi.fn(),
    errorOccurred: vi.fn(),
    themePreferenceChanged: vi.fn(),
    registerThemeProperties: vi.fn(),
    trialChargeNoticeShown: vi.fn(),
  },
}));

function LocationProbe() {
  const location = useLocation();
  return <p data-testid="location">{location.pathname}</p>;
}

function renderAt(path: string) {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter initialEntries={[path]}>
        <Routes>
          <Route path="/profile" element={<ProfilePage />} />
          <Route path="/profile/:section" element={<ProfilePage />} />
          <Route path="/circles" element={<p>Circles page</p>} />
          <Route path="/help" element={<p>Help page</p>} />
        </Routes>
        <LocationProbe />
      </MemoryRouter>
    </QueryClientProvider>
  );
}

/** The row's label and its current value, in that order. */
function rowParts(id: string): { label: string; value: string } {
  const row = screen.getByTestId(`settings-row-${id}`);
  return {
    label: within(row).getByTestId('settings-row-label').textContent ?? '',
    value: within(row).queryByTestId('settings-row-value')?.textContent ?? '',
  };
}

beforeEach(() => {
  vi.unstubAllEnvs();
  vi.stubEnv('VITE_DARK_MODE', 'true');
  currentUser = USER;
  units = { weight_unit: 'lbs', glucose_unit: 'mg/dL' };
  subscriptionTier = 'free';
  mockCircles = [{ id: 'c1', role: 'owner', is_premium_circle: false }];
  localStorage.clear();
});
afterEach(() => vi.unstubAllEnvs());

describe('ProfilePage settings list', () => {
  it('renders four groups, in mobile order, each a labelled list of rows', async () => {
    renderAt('/profile');
    await screen.findByTestId('settings-group-you');
    const groups = screen.getAllByTestId(/^settings-group-/).map((g) => g.dataset.testid);
    expect(groups).toEqual([
      'settings-group-you',
      'settings-group-notifications',
      'settings-group-preferences',
      'settings-group-privacyAccount',
    ]);
    const headings = screen.getAllByRole('heading', { level: 2 }).map((h) => h.textContent);
    expect(headings).toEqual(['You', 'Notifications', 'Preferences', 'Privacy & account']);
    // Each group's list is named by its heading.
    expect(screen.getByRole('list', { name: 'Preferences' })).toBeInTheDocument();

    const rowsOf = (group: string) =>
      within(screen.getByTestId(`settings-group-${group}`))
        .getAllByRole('link')
        .map((r) => within(r).getByTestId('settings-row-label').textContent);
    expect(rowsOf('you')).toEqual(['Subscription', 'My circles', 'Your color']);
    expect(rowsOf('notifications')).toEqual(['Alerts', 'Quiet hours', 'Weekly care summary']);
    expect(rowsOf('preferences')).toEqual(['Appearance', 'Language', 'Units', 'Time zone']);
    expect(rowsOf('privacyAccount')).toEqual([
      'Privacy & security',
      'Download my data',
      'Help & support',
      'Account',
    ]);
  });

  it('keeps the header (name, edit pencil, email) and the version footer; no inline controls', async () => {
    renderAt('/profile');
    expect(await screen.findByRole('heading', { level: 1, name: 'Sam Doe' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Edit name' })).toBeInTheDocument();
    expect(screen.getByText('sam@example.com')).toBeInTheDocument();
    // The page is "Settings" (mobile parity), shown as the eyebrow above the name.
    expect(screen.getByText('Settings')).toBeInTheDocument();
    expect(screen.getByText(/^WEB · v/)).toBeInTheDocument();
    expect(screen.queryByRole('switch')).toBeNull();
    expect(screen.queryByRole('radiogroup')).toBeNull();
    expect(screen.queryByRole('button', { name: 'Delete my account' })).toBeNull();
  });

  it('shows each row value in grey: plan, circle count, color, alerts, quiet hours, digest, prefs', async () => {
    renderAt('/profile');
    await screen.findByTestId('settings-row-subscription');
    expect(rowParts('subscription').value).toBe('Free');
    expect(rowParts('circles').value).toBe('1');
    expect(rowParts('color').value).toBe('Clay');
    expect(rowParts('alerts').value).toBe('All on');
    expect(rowParts('quietHours').value).toBe('Off');
    // Free owner: the summary is a Premium feature (same as mobile).
    expect(rowParts('digest').value).toBe('Premium');
    expect(rowParts('appearance').value).toBe('System');
    expect(rowParts('language').value).toBe('English');
    expect(rowParts('units').value).toBe('lbs · °F');
    expect(rowParts('timezone').value).toBe('Denver');
    expect(rowParts('privacy').value).toBe('');
    expect(rowParts('account').value).toBe('');
    // Value text is the muted grey, never an accent.
    const value = within(screen.getByTestId('settings-row-alerts')).getByTestId('settings-row-value');
    expect(value.className).toMatch(/text-ink-2/);
  });

  it('values follow the saved settings', async () => {
    subscriptionTier = 'premium';
    mockCircles = [
      { id: 'c1', role: 'owner', is_premium_circle: true },
      { id: 'c2', role: 'member', is_premium_circle: false },
    ];
    currentUser = {
      ...USER,
      language: 'es',
      avatar_color: 'moss',
      quiet_hours_start: '22:00:00',
      quiet_hours_end: '07:00:00',
      email_digest_enabled: true,
      email_digest_day: 1,
      notification_preferences: { tips_and_suggestions: false },
    } as unknown as User;
    units = { weight_unit: 'kg', glucose_unit: 'mmol/L', temperature_unit: '°C' };
    renderAt('/profile');
    await waitFor(() => expect(rowParts('subscription').value).toBe('Premium'));
    expect(rowParts('circles').value).toBe('2');
    expect(rowParts('color').value).toBe('Sage green');
    expect(rowParts('alerts').value).toBe('Some off');
    expect(rowParts('quietHours').value).toMatch(/^10:00\s?PM – 7:00\s?AM$/);
    expect(rowParts('digest').value).toBe('Monday');
    expect(rowParts('language').value).toBe('Español');
    expect(within(screen.getByTestId('settings-row-language')).getByText('Español')).toHaveAttribute(
      'lang',
      'es'
    );
    expect(rowParts('units').value).toBe('kg · °C');
  });

  it('alerts read "All off" when every group is off, and the digest "Off" when not sent', async () => {
    subscriptionTier = 'premium';
    currentUser = {
      ...USER,
      notification_preferences: {
        medication_confirmations: false,
        missed_medications: false,
        task_assignments: false,
        appointment_reminders: false,
        note_nudges: false,
        event_notes: false,
        care_notes: false,
        tips_and_suggestions: false,
        shift_alerts: false,
      },
    } as unknown as User;
    renderAt('/profile');
    await screen.findByTestId('settings-row-alerts');
    expect(rowParts('alerts').value).toBe('All off');
    expect(rowParts('digest').value).toBe('Off');
  });

  it('keeps the weekly summary gating: no row for a free member with no premium circle', async () => {
    mockCircles = [{ id: 'c1', role: 'member', is_premium_circle: false }];
    renderAt('/profile');
    await screen.findByTestId('settings-row-alerts');
    expect(screen.queryByTestId('settings-row-digest')).toBeNull();
  });

  it('hides the Appearance row while the dark-mode build flag is off', async () => {
    vi.stubEnv('VITE_DARK_MODE', 'false');
    renderAt('/profile');
    await screen.findByTestId('settings-row-language');
    expect(screen.queryByTestId('settings-row-appearance')).toBeNull();
  });

  it('a row is a link to its own page; My circles and Help go to the existing pages', async () => {
    renderAt('/profile');
    await screen.findByTestId('settings-row-alerts');
    expect(screen.getByTestId('settings-row-alerts')).toHaveAttribute('href', '/profile/alerts');
    expect(screen.getByTestId('settings-row-quietHours')).toHaveAttribute(
      'href',
      '/profile/quietHours'
    );
    expect(screen.getByTestId('settings-row-circles')).toHaveAttribute('href', '/circles');
    expect(screen.getByTestId('settings-row-help')).toHaveAttribute('href', '/help');
    // The accessible name carries the value, so a screen reader hears "Alerts, All on".
    expect(screen.getByRole('link', { name: /Alerts.*All on/ })).toBeInTheDocument();
  });

  it('opening a row shows its page (title, controls, back link) without the list or header', async () => {
    const user = userEvent.setup();
    renderAt('/profile');
    await user.click(await screen.findByTestId('settings-row-alerts'));
    expect(screen.getByTestId('location')).toHaveTextContent('/profile/alerts');
    expect(await screen.findByRole('heading', { level: 1, name: 'Alerts' })).toBeInTheDocument();
    expect(screen.getByTestId('settings-page-alerts')).toBeInTheDocument();
    expect(screen.getAllByRole('switch')).toHaveLength(5);
    expect(screen.queryByTestId('settings-group-you')).toBeNull();
    expect(screen.queryByTestId('profile-header')).toBeNull();

    await user.click(screen.getByRole('link', { name: 'Settings' }));
    expect(screen.getByTestId('location')).toHaveTextContent(/^\/profile$/);
    expect(await screen.findByTestId('settings-group-you')).toBeInTheDocument();
  });

  it.each([
    ['subscription', 'Subscription'],
    ['color', 'Your color'],
    ['alerts', 'Alerts'],
    ['quietHours', 'Quiet hours'],
    ['digest', 'Weekly care summary'],
    ['appearance', 'Appearance'],
    ['language', 'Language'],
    ['units', 'Units'],
    ['timezone', 'Time zone'],
    ['privacy', 'Privacy & security'],
    ['data', 'Download my data'],
    ['account', 'Account'],
  ])('/profile/%s has its page with heading "%s"', async (section, title) => {
    renderAt(`/profile/${section}`);
    expect(await screen.findByRole('heading', { level: 1, name: title })).toBeInTheDocument();
    expect(screen.getByTestId(`settings-page-${section}`)).toBeInTheDocument();
  });

  it('reports settings_section_viewed once per page opened, never for the list', async () => {
    const user = userEvent.setup();
    settingsSectionViewed.mockClear();
    renderAt('/profile');
    await screen.findByTestId('settings-row-units');
    expect(settingsSectionViewed).not.toHaveBeenCalled();
    await user.click(screen.getByTestId('settings-row-units'));
    await screen.findByRole('heading', { level: 1, name: 'Units' });
    expect(settingsSectionViewed).toHaveBeenCalledTimes(1);
    expect(settingsSectionViewed).toHaveBeenCalledWith('units');
  });

  it('an unknown section falls back to the list', async () => {
    renderAt('/profile/nope');
    expect(await screen.findByTestId('settings-group-you')).toBeInTheDocument();
    expect(screen.getByTestId('location')).toHaveTextContent(/^\/profile$/);
  });

  it('the header pencil opens the Account page with the name fields open and focused', async () => {
    const user = userEvent.setup();
    renderAt('/profile');
    await user.click(await screen.findByRole('button', { name: 'Edit name' }));
    expect(screen.getByTestId('location')).toHaveTextContent('/profile/account');
    const first = await screen.findByLabelText('First name');
    await waitFor(() => expect(first).toHaveFocus());
  });

  it('the Account page keeps the email, password note and the delete-account danger flow', async () => {
    const user = userEvent.setup();
    renderAt('/profile/account');
    expect(await screen.findByText('sam@example.com')).toBeInTheDocument();
    expect(screen.getByText(/Forgot password\?/)).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Delete my account' }));
    expect(await screen.findByRole('dialog', { name: 'Delete your account?' })).toBeInTheDocument();
  });

  it('the Time zone page keeps the zone and its helper', async () => {
    renderAt('/profile/timezone');
    const tz = await screen.findByTestId('profile-timezone');
    expect(within(tz).getByText('Denver')).toBeInTheDocument();
    expect(within(tz).getByText(/Set by your device/)).toBeInTheDocument();
  });
});
