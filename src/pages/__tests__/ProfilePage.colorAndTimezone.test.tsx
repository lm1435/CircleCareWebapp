import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import type { ReactNode } from 'react';
import '@/i18n';
import ProfilePage from '@/pages/ProfilePage';
import type { User, UnitPreferences } from '@/api/users';
import { avatarGradientForKey } from '@/components/ui/Avatar';
import { __resetAnalyticsConsentCache } from '@/lib/analyticsConsent';

// approved-recs-2026-09-30 B6 — ProfilePage: member colour picker + the PK10
// time-zone change warning. (Original header follows.)
// Stage 7 Task 7.6 — ProfilePage tests. The Stage 7 hooks are unit-tested in
// useProfile.test.tsx; here we assert the PAGE wires them correctly: a toggle
// fires the right hook, the language radio fires useUpdateProfile({language}),
// and delete-account confirm runs the hook → clears the cache → signOut →
// redirect. Hooks + auth store + read api fns are mocked.

const navigate = vi.fn();
vi.mock('react-router-dom', async (importOriginal) => {
  const actual = await importOriginal<typeof import('react-router-dom')>();
  return { ...actual, useNavigate: () => navigate };
});

// Read api fns the page calls via useQuery.
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

// Mutable so the quiet-hours tests can seed a user whose Postgres TIME columns
// come back WITH seconds. Reset to USER in beforeEach.
let currentUser: User = USER;

vi.mock('@/api/users', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/api/users')>();
  return {
    ...actual,
    getCurrentUser: vi.fn(() => Promise.resolve(currentUser)),
    getUnitPreferences: vi.fn(() => Promise.resolve(UNITS)),
    // PK10 helper read: nobody depends on the owner's zone in these tests.
    getTimezoneDependentCircles: () => mockDependent(),
    // The name form's own save (inline error, no hook toast).
    updateProfile: (data: unknown) => mockUpdateProfileRequest(data),
  };
});
const mockUpdateProfileRequest = vi.fn();
const mockDependent = vi.fn();

// Mutation hooks — capture the mutate calls.
const updateProfile = vi.fn();
const updateAvatarColor = vi.fn();
const updateNotif = vi.fn();
const updateQuiet = vi.fn();
const updateUnits = vi.fn();
const updateDigest = vi.fn();
const deleteAccount = vi.fn();
const deleteReset = vi.fn();
// Mutable so the delete-failure test can flip the mutation into its error state.
let deleteAccountState: { isError: boolean } = { isError: false };
// Which saves are "in flight" (isPending) — the busy-focus tests flip these.
let pending: { profile?: boolean; color?: boolean; quiet?: boolean; digest?: boolean } = {};
vi.mock('@/hooks/useProfile', () => ({
  useUpdateProfile: () => ({ mutate: updateProfile, isPending: Boolean(pending.profile) }),
  useUpdateAvatarColor: () => ({ mutate: updateAvatarColor, isPending: Boolean(pending.color) }),
  useUpdateNotificationPrefs: () => ({ mutate: updateNotif, isPending: false }),
  useUpdateQuietHours: () => ({ mutate: updateQuiet, isPending: Boolean(pending.quiet) }),
  useUpdateUnitPrefs: () => ({ mutate: updateUnits, isPending: false }),
  useUpdateEmailDigest: () => ({ mutate: updateDigest, isPending: Boolean(pending.digest) }),
  useDeleteAccount: () => ({
    mutate: deleteAccount,
    isPending: false,
    isError: deleteAccountState.isError,
    reset: deleteReset,
  }),
}));

// Subscription tier read (drives the email-digest premium note visibility).
let subscriptionTier: 'free' | 'premium' = 'free';
vi.mock('@/hooks/useSubscriptionStatus', () => ({
  useSubscriptionStatus: () => ({ data: { tier: subscriptionTier } }),
}));

// The weekly-summary section only shows to circle owners / premium-circle members.
vi.mock('@/hooks/useCircles', () => ({
  useCircles: () => ({ data: [{ role: 'owner', is_premium_circle: false }] }),
}));

const showToast = vi.fn();
vi.mock('@/components/ui', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/components/ui')>();
  return { ...actual, useToast: () => ({ showToast }) };
});

const signOut = vi.fn(() => Promise.resolve());
vi.mock('@/store/authStore', () => ({
  useAuthStore: (
    selector: (s: { signOut: () => Promise<void>; user: { id: string } | null }) => unknown
  ) => selector({ signOut, user: { id: 'u1' } }),
}));

// Analytics-consent server sync: assert the page calls it with the right
// (enabled, userId) pair without exercising the real network call.
const syncAnalyticsConsent = vi.fn((_enabled: boolean, _userId: string) => Promise.resolve());
vi.mock('@/lib/analyticsConsentSync', () => ({
  syncAnalyticsConsent: (enabled: boolean, userId: string) => syncAnalyticsConsent(enabled, userId),
}));


const mockLanguageChanged = vi.fn();
const mockAccountDeleted = vi.fn();
vi.mock('@/lib/analytics', () => ({
  Analytics: {
    languageChanged: (...args: unknown[]) => mockLanguageChanged(...args),
    accountDeleted: (...args: unknown[]) => mockAccountDeleted(...args),
    errorOccurred: vi.fn(),
    settingsSectionViewed: vi.fn(),
    themePreferenceChanged: vi.fn(),
    registerThemeProperties: vi.fn(),
  },
}));

// Each settings block is its own page at /profile/:section (design pass 2026-11-08).
function renderPage(path = '/profile') {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  const clearSpy = vi.spyOn(queryClient, 'clear');
  const wrapper = ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={queryClient}>
      <MemoryRouter initialEntries={[path]}>
        <Routes>
          <Route path="/profile" element={children} />
          <Route path="/profile/:section" element={children} />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>
  );
  render(<ProfilePage />, { wrapper });
  return { clearSpy };
}

beforeEach(() => {
  vi.clearAllMocks();
  deleteAccountState = { isError: false };
  subscriptionTier = 'free';
  currentUser = USER;
  localStorage.clear();
  __resetAnalyticsConsentCache();
});


beforeEach(() => {
  vi.clearAllMocks();
  deleteAccountState = { isError: false };
  subscriptionTier = 'free';
  currentUser = { ...USER, avatar_color: 'moss' };
  pending = {};
  mockDependent.mockResolvedValue([]);
  updateAvatarColor.mockReset();
  updateProfile.mockReset();
  localStorage.clear();
  __resetAnalyticsConsentCache();
});

const zoneRow = () => screen.getByTestId('profile-timezone');

// The profile zone FOLLOWS THE DEVICE and is read-only ("their phone dictates";
// App.tsx DeviceTimezoneSync, utils/deviceTimezoneSync.ts). The page only shows it.
describe('ProfilePage time zone row: read-only, set by the device', () => {
  it('shows the label, the city and the helper line', async () => {
    renderPage('/profile/timezone');
    const row = await screen.findByTestId('profile-timezone');
    expect(row).toHaveTextContent('Time zone');
    expect(row).toHaveTextContent('Denver');
    expect(row).not.toHaveTextContent('America/Denver');
    expect(row).toHaveTextContent(
      'Set by your device. Used for your quiet hours and the times in your reminders and emails.'
    );
  });

  it('is not a control and offers no change flow, even with dependent circles', async () => {
    mockDependent.mockResolvedValue([{ id: 'c1', recipient_name: 'Mom' }]);
    renderPage('/profile/timezone');
    await screen.findByTestId('profile-timezone');
    expect(within(zoneRow()).queryByRole('button')).not.toBeInTheDocument();
    expect(within(zoneRow()).queryByRole('combobox')).not.toBeInTheDocument();
    expect(screen.queryByTestId('timezone-device-notice')).not.toBeInTheDocument();
    expect(screen.queryByText('Change your time zone?')).not.toBeInTheDocument();
    expect(mockDependent).not.toHaveBeenCalled();
    expect(updateProfile).not.toHaveBeenCalled();
  });

  it('names an off-list stored zone by its city, never the raw id', async () => {
    currentUser = { ...USER, timezone: 'America/Boise' };
    renderPage('/profile/timezone');
    const row = await screen.findByTestId('profile-timezone');
    expect(row).toHaveTextContent('Boise');
    expect(row).not.toHaveTextContent('America/Boise');
  });

  it('falls back to a generic name for an id with no city', async () => {
    currentUser = { ...USER, timezone: 'Etc/GMT+5' };
    renderPage('/profile/timezone');
    expect(await screen.findByTestId('profile-timezone')).toHaveTextContent('Custom time zone');
  });
});

describe('ProfilePage member colour', () => {
  it('renders the picker with the saved colour checked and the preview in that colour', async () => {
    renderPage('/profile/color');
    const group = await screen.findByRole('radiogroup', { name: 'Choose your color' });
    expect(within(group).getByRole('radio', { name: 'Sage green' })).toBeChecked();
    expect(within(group).getByRole('radio', { name: 'Coral' })).not.toBeChecked();
  });

  it('previews the saved colour on the avatar next to the picker', async () => {
    renderPage('/profile/color');
    await screen.findByRole('radiogroup', { name: 'Choose your color' });
    // "Sam Doe" hashes to amber; the member saved moss, so the preview is moss.
    const [from, to] = avatarGradientForKey('moss');
    const preview = screen
      .getAllByText('S')
      .find((el) => el.style.backgroundImage.startsWith('linear-gradient'));
    expect(preview?.style.backgroundImage).toBe(`linear-gradient(135deg, ${from}, ${to})`);
  });

  it('saves a new pick and confirms with a live-region message', async () => {
    updateAvatarColor.mockImplementation((_k: string, opts?: { onSuccess?: () => void }) =>
      opts?.onSuccess?.()
    );
    const user = userEvent.setup();
    renderPage('/profile/color');
    await user.click(await screen.findByRole('radio', { name: 'Coral' }));
    expect(updateAvatarColor).toHaveBeenCalledWith('coral', expect.anything());
    expect(screen.getByTestId('avatar-color-saved')).toHaveTextContent('Color updated.');
    expect(screen.getByTestId('avatar-color-saved')).toHaveAttribute('role', 'status');
  });

  it('does not re-save the colour that is already selected', async () => {
    const user = userEvent.setup();
    renderPage('/profile/color');
    await user.click(await screen.findByRole('radio', { name: 'Sage green' }));
    expect(updateAvatarColor).not.toHaveBeenCalled();
  });

  it('shows no confirmation when the save has not succeeded', async () => {
    const user = userEvent.setup();
    renderPage('/profile/color');
    await user.click(await screen.findByRole('radio', { name: 'Coral' }));
    expect(screen.getByTestId('avatar-color-saved')).toBeEmptyDOMElement();
  });
});

// WCAG 2.4.3: a native `disabled` on the control the keyboard user just changed
// drops focus to <body> while the save runs. These controls go `aria-disabled`
// instead: still focusable, changes ignored until the save settles.
describe('ProfilePage saves in flight keep keyboard focus', () => {
  function expectBusyButFocusable(control: HTMLElement) {
    control.focus();
    expect(control).toHaveFocus();
    expect(control).not.toBeDisabled();
    expect(control).toHaveAttribute('aria-disabled', 'true');
  }

  it('digest delivery-day select', async () => {
    currentUser = { ...USER, email_digest_enabled: true, email_digest_day: 1 };
    pending = { digest: true };
    renderPage('/profile/digest');
    const select = await screen.findByLabelText('Delivery day');
    expectBusyButFocusable(select);
    await userEvent.setup().selectOptions(select, '3');
    expect(select).toHaveValue('1');
    expect(updateDigest).not.toHaveBeenCalled();
  });

  it('quiet-hours start and end fields', async () => {
    currentUser = { ...USER, quiet_hours_start: '22:00', quiet_hours_end: '07:00' };
    pending = { quiet: true };
    renderPage('/profile/quietHours');
    for (const name of [/^Start time/, /^End time/]) {
      const field = await screen.findByLabelText(name);
      expectBusyButFocusable(field);
      expect(field).toHaveAttribute('readonly');
    }
    expect(updateQuiet).not.toHaveBeenCalled();
  });

  it('avatar colour swatches', async () => {
    pending = { color: true };
    const user = userEvent.setup();
    renderPage('/profile/color');
    const coral = await screen.findByRole('radio', { name: 'Coral' });
    expectBusyButFocusable(coral);
    await user.click(coral);
    expect(updateAvatarColor).not.toHaveBeenCalled();
  });
});
