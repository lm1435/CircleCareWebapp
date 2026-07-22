import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router-dom';
import type { ReactNode } from 'react';
import '@/i18n';
import ProfilePage from '@/pages/ProfilePage';
import type { User, UnitPreferences } from '@/api/users';

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

vi.mock('@/api/users', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/api/users')>();
  return {
    ...actual,
    getCurrentUser: vi.fn(() => Promise.resolve(USER)),
    getUnitPreferences: vi.fn(() => Promise.resolve(UNITS)),
  };
});

// Mutation hooks — capture the mutate calls.
const updateProfile = vi.fn();
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
  useAuthStore: (selector: (s: { signOut: () => Promise<void> }) => unknown) =>
    selector({ signOut }),
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
});

describe('ProfilePage', () => {
  it('fires useUpdateNotificationPrefs when a notification toggle is flipped', async () => {
    const user = userEvent.setup();
    renderPage();

    // Wait for the user query to resolve so the toggles render.
    const toggle = await screen.findByRole('switch', { name: /Medication confirmations/i });
    await user.click(toggle);

    expect(updateNotif).toHaveBeenCalledTimes(1);
    // Was ON → flips to false.
    expect(updateNotif.mock.calls[0][0]).toEqual({ medication_confirmations: false });
  });

  it('fires useUpdateProfile({language}) when the language radio changes', async () => {
    const user = userEvent.setup();
    renderPage();

    const spanish = await screen.findByRole('radio', { name: 'Español' });
    await user.click(spanish);

    expect(updateProfile).toHaveBeenCalledTimes(1);
    expect(updateProfile.mock.calls[0][0]).toEqual({ language: 'es' });
  });

  it('delete-account confirm runs useDeleteAccount, clears cache, signs out, and redirects', async () => {
    const user = userEvent.setup();
    // Make the hook invoke its onSuccess so the cache-clear + signOut path runs.
    deleteAccount.mockImplementation((_vars, opts?: { onSuccess?: () => void }) => {
      opts?.onSuccess?.();
    });
    const { clearSpy } = renderPage();

    // Open the danger-zone confirm dialog.
    const cta = await screen.findByRole('button', { name: 'Delete my account' });
    await user.click(cta);

    // Confirm inside the dialog.
    const confirm = await screen.findByRole('button', { name: 'Delete account' });
    await user.click(confirm);

    expect(deleteAccount).toHaveBeenCalledTimes(1);
    expect(clearSpy).toHaveBeenCalled();
    expect(signOut).toHaveBeenCalledTimes(1);
    await waitFor(() => expect(navigate).toHaveBeenCalledWith('/login', { replace: true }));
  });

  it('keeps the confirm dialog open with the failure visible when deletion errors', async () => {
    const user = userEvent.setup();
    // The mutation is in its error state (a delete attempt failed). The mocked
    // hook isn't reactive, so we seed the state before render. Also pin the
    // mutate implementation to a no-op — clearAllMocks does not undo the
    // previous test's onSuccess-invoking implementation.
    deleteAccount.mockImplementation(() => {});
    deleteAccountState = { isError: true };
    renderPage();

    await user.click(await screen.findByRole('button', { name: 'Delete my account' }));
    // Confirming while the mutation errors must NOT close the dialog.
    await user.click(screen.getByRole('button', { name: 'Delete account' }));

    expect(screen.getByRole('button', { name: 'Delete account' })).toBeInTheDocument();
    expect(screen.getByRole('alert')).toHaveTextContent(/couldn't delete your account/i);
    expect(signOut).not.toHaveBeenCalled();
  });

  it('shows the email-digest premium note for free users and hides it for premium', async () => {
    renderPage();
    expect(await screen.findByText('Included with Premium.')).toBeInTheDocument();
  });

  it('hides the email-digest premium note for premium users', async () => {
    subscriptionTier = 'premium';
    renderPage();
    await screen.findByRole('switch', { name: /weekly digest/i });
    expect(screen.queryByText('Included with Premium.')).not.toBeInTheDocument();
  });

  it('points to the sign-in reset flow for password changes', async () => {
    renderPage();
    expect(
      await screen.findByText(
        "To change your password, sign out and choose 'Forgot password?' on the sign-in page."
      )
    ).toBeInTheDocument();
  });
});
