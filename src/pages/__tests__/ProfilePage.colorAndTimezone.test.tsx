import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router-dom';
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
vi.mock('@/hooks/useProfile', () => ({
  useUpdateProfile: () => ({ mutate: updateProfile, isPending: false }),
  useUpdateAvatarColor: () => ({ mutate: updateAvatarColor, isPending: false }),
  useUpdateNotificationPrefs: () => ({ mutate: updateNotif, isPending: false }),
  useUpdateQuietHours: () => ({ mutate: updateQuiet, isPending: false }),
  useUpdateUnitPrefs: () => ({ mutate: updateUnits, isPending: false }),
  useUpdateEmailDigest: () => ({ mutate: updateDigest, isPending: false }),
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
const mockTimezoneChanged = vi.fn();
const mockTzWarning = vi.fn();
const mockAccountDeleted = vi.fn();
vi.mock('@/lib/analytics', () => ({
  Analytics: {
    languageChanged: (...args: unknown[]) => mockLanguageChanged(...args),
    timezoneChanged: (...args: unknown[]) => mockTimezoneChanged(...args),
    timezoneChangeWarning: (...args: unknown[]) => mockTzWarning(...args),
    accountDeleted: (...args: unknown[]) => mockAccountDeleted(...args),
    errorOccurred: vi.fn(),
  },
}));

function renderPage() {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  const clearSpy = vi.spyOn(queryClient, 'clear');
  const wrapper = ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={queryClient}>
      <MemoryRouter>{children}</MemoryRouter>
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
  mockDependent.mockResolvedValue([]);
  updateAvatarColor.mockReset();
  updateProfile.mockReset();
  localStorage.clear();
  __resetAnalyticsConsentCache();
});

async function pickZone(zone: string) {
  const user = userEvent.setup();
  const select = await screen.findByLabelText('Time zone');
  await user.selectOptions(select, zone);
  return user;
}

describe('ProfilePage time-zone change warning (PK10)', () => {
  it('saves straight away, with no prompt, when no circle depends on the owner zone', async () => {
    renderPage();
    await pickZone('America/Chicago');
    await waitFor(() =>
      expect(updateProfile).toHaveBeenCalledWith({ timezone: 'America/Chicago' }, expect.anything())
    );
    expect(screen.queryByText('Change your time zone?')).not.toBeInTheDocument();
    expect(mockTzWarning).not.toHaveBeenCalled();
  });

  it('asks first, naming recipients and the new zone; saves only after confirming', async () => {
    mockDependent.mockResolvedValue([
      { id: 'c1', recipient_name: 'Mom' },
      { id: 'c2', recipient_name: 'Dad' },
    ]);
    renderPage();
    const user = await pickZone('America/Chicago');
    const dialog = await screen.findByRole('dialog');
    expect(within(dialog).getByText('Change your time zone?')).toBeInTheDocument();
    expect(dialog).toHaveTextContent('Dose times for Mom, Dad follow your time zone');
    expect(dialog).toHaveTextContent('Central');
    expect(updateProfile).not.toHaveBeenCalled();

    await user.click(within(dialog).getByRole('button', { name: 'Change time zone' }));
    expect(updateProfile).toHaveBeenCalledWith({ timezone: 'America/Chicago' }, expect.anything());
    expect(mockTzWarning).toHaveBeenCalledWith(2, true);
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });

  it('Cancel keeps the old zone: nothing saved, the select snaps back', async () => {
    mockDependent.mockResolvedValue([{ id: 'c1', recipient_name: 'Mom' }]);
    renderPage();
    const user = await pickZone('America/Chicago');
    const dialog = await screen.findByRole('dialog');
    // The × close button shares the accessible name; press the footer button.
    const cancel = within(dialog)
      .getAllByRole('button', { name: 'Cancel' })
      .find((b) => b.textContent === 'Cancel')!;
    await user.click(cancel);
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    expect(updateProfile).not.toHaveBeenCalled();
    expect(mockTzWarning).toHaveBeenCalledWith(1, false);
    expect(screen.getByLabelText('Time zone')).toHaveValue('America/Denver');
  });

  it('never blocks a change on a failed helper read', async () => {
    mockDependent.mockRejectedValue(new Error('network'));
    renderPage();
    await pickZone('America/Chicago');
    await waitFor(() =>
      expect(updateProfile).toHaveBeenCalledWith({ timezone: 'America/Chicago' }, expect.anything())
    );
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });
});

describe('ProfilePage member colour', () => {
  it('renders the picker with the saved colour checked and the preview in that colour', async () => {
    renderPage();
    const group = await screen.findByRole('radiogroup', { name: 'Choose your color' });
    expect(within(group).getByRole('radio', { name: 'Sage green' })).toBeChecked();
    expect(within(group).getByRole('radio', { name: 'Coral' })).not.toBeChecked();
  });

  it('previews the saved colour on the avatar next to the picker', async () => {
    renderPage();
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
    renderPage();
    await user.click(await screen.findByRole('radio', { name: 'Coral' }));
    expect(updateAvatarColor).toHaveBeenCalledWith('coral', expect.anything());
    expect(screen.getByTestId('avatar-color-saved')).toHaveTextContent('Color updated.');
    expect(screen.getByTestId('avatar-color-saved')).toHaveAttribute('role', 'status');
  });

  it('does not re-save the colour that is already selected', async () => {
    const user = userEvent.setup();
    renderPage();
    await user.click(await screen.findByRole('radio', { name: 'Sage green' }));
    expect(updateAvatarColor).not.toHaveBeenCalled();
  });

  it('shows no confirmation when the save has not succeeded', async () => {
    const user = userEvent.setup();
    renderPage();
    await user.click(await screen.findByRole('radio', { name: 'Coral' }));
    expect(screen.getByTestId('avatar-color-saved')).toBeEmptyDOMElement();
  });
});
