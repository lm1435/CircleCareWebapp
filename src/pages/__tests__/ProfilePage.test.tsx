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
vi.mock('@/hooks/useProfile', () => ({
  useUpdateProfile: () => ({ mutate: updateProfile, isPending: false }),
  useUpdateNotificationPrefs: () => ({ mutate: updateNotif, isPending: false }),
  useUpdateQuietHours: () => ({ mutate: updateQuiet, isPending: false }),
  useUpdateUnitPrefs: () => ({ mutate: updateUnits, isPending: false }),
  useUpdateEmailDigest: () => ({ mutate: updateDigest, isPending: false }),
  useDeleteAccount: () => ({ mutate: deleteAccount, isPending: false }),
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
});
