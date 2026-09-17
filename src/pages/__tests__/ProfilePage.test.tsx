import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router-dom';
import type { ReactNode } from 'react';
import '@/i18n';
import ProfilePage from '@/pages/ProfilePage';
import type { User, UnitPreferences } from '@/api/users';
import { setAnalyticsConsent, __resetAnalyticsConsentCache } from '@/lib/analyticsConsent';
import { clickTwice } from '@/test/doubleSubmit';

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
    // The name form's own save (inline error, no hook toast).
    updateProfile: (data: unknown) => mockUpdateProfileRequest(data),
  };
});
const mockUpdateProfileRequest = vi.fn();

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
const mockAccountDeleted = vi.fn();
vi.mock('@/lib/analytics', () => ({
  Analytics: {
    languageChanged: (...args: unknown[]) => mockLanguageChanged(...args),
    timezoneChanged: (...args: unknown[]) => mockTimezoneChanged(...args),
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

  it('fires Analytics.languageChanged on a successful language update', async () => {
    updateProfile.mockImplementation((_vars, opts?: { onSuccess?: () => void }) => {
      opts?.onSuccess?.();
    });
    const user = userEvent.setup();
    renderPage();

    const spanish = await screen.findByRole('radio', { name: 'Español' });
    await user.click(spanish);

    expect(mockLanguageChanged).toHaveBeenCalledWith('es');
  });

  it('fires Analytics.timezoneChanged on a successful timezone update', async () => {
    updateProfile.mockImplementation((_vars, opts?: { onSuccess?: () => void }) => {
      opts?.onSuccess?.();
    });
    const user = userEvent.setup();
    renderPage();

    const timezoneSelect = await screen.findByLabelText('Time zone');
    await user.selectOptions(timezoneSelect, 'America/Chicago');

    expect(mockTimezoneChanged).toHaveBeenCalledWith('America/Chicago');
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

    // account_deleted must be queued BEFORE signOut() resets analytics.
    expect(mockAccountDeleted).toHaveBeenCalledTimes(1);
    expect(
      mockAccountDeleted.mock.invocationCallOrder[0]
    ).toBeLessThan(signOut.mock.invocationCallOrder[0]);
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

  it('toggling analytics OFF calls syncAnalyticsConsent(false, <userId>)', async () => {
    setAnalyticsConsent(true); // start ON so the click turns it off
    const user = userEvent.setup();
    renderPage();

    const toggle = await screen.findByRole('switch', { name: /Share usage data/i });
    await user.click(toggle);

    expect(syncAnalyticsConsent).toHaveBeenCalledWith(false, 'u1');
  });

  it('toggling analytics ON calls syncAnalyticsConsent(true, <userId>)', async () => {
    // Defaults OFF — click turns it on.
    const user = userEvent.setup();
    renderPage();

    const toggle = await screen.findByRole('switch', { name: /Share usage data/i });
    await user.click(toggle);

    expect(syncAnalyticsConsent).toHaveBeenCalledWith(true, 'u1');
  });

  /**
   * THE RESTORE DIRECTION. Someone who declined at SIGNUP now has
   * `analytics_consent_withdrawn_at` stamped (the signup surfaces queue that
   * decision — see signupAnalyticsConsentServerHalf.test.tsx), and stamping it
   * suppresses every server-side capture. If accepting later did not clear it,
   * they would stay server-suppressed for the life of the account while this
   * toggle reads ON — the same silent contradiction in the other direction.
   * `syncAnalyticsConsent(true, …)` routes to `restoreAnalyticsConsent`
   * (pinned in lib/__tests__/analyticsConsentSync.test.ts), which is what
   * clears the column.
   */
  it('a signup DECLINE followed by a Profile ACCEPT syncs the restore', async () => {
    setAnalyticsConsent(false); // the state a signup decline leaves behind
    const user = userEvent.setup();
    renderPage();

    const toggle = await screen.findByRole('switch', { name: /Share usage data/i });
    expect(toggle).toHaveAttribute('aria-checked', 'false');
    await user.click(toggle);

    expect(syncAnalyticsConsent).toHaveBeenCalledWith(true, 'u1');
  });

  /**
   * ONE decision, ONE request. Both consent endpoints sit behind a per-user
   * rate limiter, and a toggle that fired twice per click would burn it — and
   * on a fast double-flip could deliver the two decisions out of order.
   */
  it('fires the server sync exactly once per toggle', async () => {
    const user = userEvent.setup();
    renderPage();

    const toggle = await screen.findByRole('switch', { name: /Share usage data/i });
    await user.click(toggle);

    expect(syncAnalyticsConsent).toHaveBeenCalledTimes(1);
  });

  it('points to the sign-in reset flow for password changes', async () => {
    renderPage();
    expect(
      await screen.findByText(
        "To change your password, sign out and choose 'Forgot password?' on the sign-in page."
      )
    ).toBeInTheDocument();
  });

  it('shows the WEB build version footer from package.json', async () => {
    renderPage();
    const pkg = (await import('../../../package.json')).default;
    expect(await screen.findByText(`WEB · v${pkg.version}`)).toBeInTheDocument();
  });
});

// ── Quiet hours: Postgres TIME round-trip ────────────────────────────────
// quiet_hours_start/end are Postgres TIME columns, so the API hands them back
// WITH seconds ("22:00:00"). Editing ONE time field ships the OTHER field
// straight back out of local state, so hydrating the raw value meant the
// untouched field went to the API as "22:00:00" — which HH:MM-only validation
// rejected ("editing only the end time fails to save, editing both works").
describe('ProfilePage — name form', () => {
  async function openNameForm() {
    const user = userEvent.setup();
    renderPage();
    await user.click(await screen.findByRole('button', { name: 'Edit' }));
    const first = screen.getByLabelText(/^First name/);
    await user.clear(first);
    await user.type(first, 'Samantha');
    return user;
  }

  it('a failed name save is shown INLINE in the form (announced, no toast), and a retry clears it', async () => {
    const { Analytics } = await import('@/lib/analytics');
    mockUpdateProfileRequest.mockRejectedValueOnce({ error: { code: 'SERVER_ERROR' } });
    const user = await openNameForm();

    await user.click(screen.getByRole('button', { name: 'Save' }));

    const alert = await screen.findByRole('alert');
    expect(alert).toHaveTextContent("Couldn't save your changes. Please try again.");
    // Next to the form it belongs to: in the same card as the name fields.
    expect(alert.parentElement).toContainElement(
      screen.getByLabelText(/^First name/)
    );
    expect(showToast).not.toHaveBeenCalled();
    expect(document.activeElement).not.toBe(alert);
    // Input kept; the failure still counts for the digest (closed-set code).
    expect(screen.getByLabelText(/^First name/)).toHaveValue('Samantha');
    expect(Analytics.errorOccurred).toHaveBeenCalledWith('profile', 'profile_mutation_error', {
      code: expect.any(String),
    });

    mockUpdateProfileRequest.mockResolvedValueOnce(USER);
    await user.click(screen.getByRole('button', { name: 'Save' }));
    await waitFor(() => expect(showToast).toHaveBeenCalledWith('Name updated.', 'success'));
    expect(screen.queryByRole('alert')).toBeNull();
    expect(mockUpdateProfileRequest).toHaveBeenLastCalledWith({
      first_name: 'Samantha',
      last_name: 'Doe',
    });
  });

  it('renders the inline name error in Spanish', async () => {
    const i18n = (await import('@/i18n')).default;
    await i18n.changeLanguage('es');
    try {
      mockUpdateProfileRequest.mockRejectedValueOnce(new Error('network'));
      const user = userEvent.setup();
      renderPage();
      await user.click(await screen.findByRole('button', { name: 'Editar' }));
      await user.click(screen.getByRole('button', { name: 'Guardar' }));
      expect(await screen.findByRole('alert')).toHaveTextContent(
        'No se pudieron guardar los cambios. Inténtalo de nuevo.'
      );
    } finally {
      await i18n.changeLanguage('en');
    }
  });
});

describe('ProfilePage quiet hours', () => {
  const WITH_SECONDS: User = {
    ...USER,
    quiet_hours_start: '22:00:00',
    quiet_hours_end: '07:00:00',
  };

  it('normalizes seconds-bearing TIME values before they reach the time inputs', async () => {
    currentUser = WITH_SECONDS;
    renderPage();

    // `<input type="time">` expects HH:MM — a seconds-bearing value is handled
    // inconsistently across browsers for a control whose step implies minutes.
    expect(await screen.findByLabelText('Start time')).toHaveValue('22:00');
    expect(screen.getByLabelText(/^End time/)).toHaveValue('07:00');
  });

  it('sends canonical HH:MM for the UNTOUCHED start when only the end time is edited', async () => {
    currentUser = WITH_SECONDS;
    renderPage();

    const end = await screen.findByLabelText(/^End time/);
    fireEvent.change(end, { target: { value: '08:30' } });

    expect(updateQuiet).toHaveBeenCalledTimes(1);
    // The regression: quiet_hours_start must NOT be "22:00:00" here.
    expect(updateQuiet.mock.calls[0][0]).toEqual({
      quiet_hours_start: '22:00',
      quiet_hours_end: '08:30',
    });
  });

  it('sends canonical HH:MM for the UNTOUCHED end when only the start time is edited', async () => {
    currentUser = WITH_SECONDS;
    renderPage();

    const start = await screen.findByLabelText('Start time');
    fireEvent.change(start, { target: { value: '21:15' } });

    expect(updateQuiet).toHaveBeenCalledTimes(1);
    expect(updateQuiet.mock.calls[0][0]).toEqual({
      quiet_hours_start: '21:15',
      quiet_hours_end: '07:00',
    });
  });

  it('disables quiet hours with an explicit null/null payload', async () => {
    const user = userEvent.setup();
    currentUser = WITH_SECONDS;
    renderPage();

    await user.click(await screen.findByRole('switch', { name: /Enable quiet hours/i }));

    expect(updateQuiet).toHaveBeenCalledTimes(1);
    expect(updateQuiet.mock.calls[0][0]).toEqual({
      quiet_hours_start: null,
      quiet_hours_end: null,
    });
  });

  it('re-enables quiet hours with the normalized HH:MM defaults', async () => {
    // No quiet hours stored → toggle ON sends the local defaults, not seconds.
    renderPage();

    const user = userEvent.setup();
    await user.click(await screen.findByRole('switch', { name: /Enable quiet hours/i }));

    expect(updateQuiet).toHaveBeenCalledTimes(1);
    expect(updateQuiet.mock.calls[0][0]).toEqual({
      quiet_hours_start: '22:00',
      quiet_hours_end: '07:00',
    });
  });
});

// Regression — double submit. Account deletion is irreversible, and
// `confirmDisabled={deleteAccount.isPending}` lands a render after the press
// that would double-fire it. A second DELETE arrives after the first has torn
// the account down and leaves an error on screen for a deletion that worked.
describe('ProfilePage — double-delete guard', () => {
  it('fires the delete mutation exactly ONCE when Confirm is pressed twice in the same tick', async () => {
    const user = userEvent.setup();
    // In flight: no callback fires, so the guard is still held on the second
    // press. (clearAllMocks does not undo an earlier test's implementation.)
    deleteAccount.mockImplementation(() => {});
    renderPage();

    await user.click(await screen.findByRole('button', { name: 'Delete my account' }));
    await clickTwice(await screen.findByRole('button', { name: 'Delete account' }));

    expect(deleteAccount).toHaveBeenCalledTimes(1);
  });

  /**
   * THE PAGE'S OWN GUARD, isolated. The test above cannot tell it apart from
   * ConfirmDialog's: the shell wraps `onConfirm` in its own ref, so a same-tick
   * second press is refused there whatever this page does. But
   * `handleDeleteAccount` returns nothing (it calls `mutate`, not
   * `mutateAsync`), so the shell releases its ref on the very next microtask
   * while the DELETE is still in flight — and `isPending` does not reach the
   * button until React Query's batched notify has rendered. A second press
   * after that turn is refused by `deleteGuard` alone.
   */
  it('fires the delete mutation exactly ONCE when Confirm is pressed again a turn later, mid-request', async () => {
    const user = userEvent.setup();
    deleteAccount.mockImplementation(() => {});
    renderPage();

    await user.click(await screen.findByRole('button', { name: 'Delete my account' }));
    const confirm = await screen.findByRole('button', { name: 'Delete account' });

    await act(async () => {
      confirm.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));
      await new Promise((resolve) => setTimeout(resolve, 0));
      confirm.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));
    });

    expect(deleteAccount).toHaveBeenCalledTimes(1);
  });

  /**
   * …AND A FAILED DELETE HANDS THE GUARD BACK. The two tests above only prove
   * the guard is CLAIMED; nothing proved it is ever released. `onSettled` is
   * the only release, and without it the first failure leaves `deleteGuard`
   * held for the life of the page: the dialog stays open with the error
   * showing, inviting a retry, and every later Confirm returns at `claim()` —
   * a button that silently does nothing.
   *
   * React Query's callbacks are held until the "request" returns, as in
   * `InviteMemberModal`'s twin of this test: firing them inside `mutate()`
   * would release the guard before `mutate` came back, which is not the order
   * production runs in.
   */
  it('lets Confirm retry after a FAILED delete (onSettled releases the guard)', async () => {
    const user = userEvent.setup();
    type DeleteCallbacks = {
      onSuccess?: () => void;
      onError?: (error: unknown) => void;
      onSettled?: (data?: unknown, error?: unknown) => void;
    };
    let pending: DeleteCallbacks | undefined;
    deleteAccount.mockImplementation((_vars: unknown, opts?: DeleteCallbacks) => {
      pending = opts;
    });
    renderPage();

    await user.click(await screen.findByRole('button', { name: 'Delete my account' }));
    await user.click(await screen.findByRole('button', { name: 'Delete account' }));
    expect(deleteAccount).toHaveBeenCalledTimes(1);

    // The request fails.
    const failure = new Error('network down');
    const failed = pending;
    await act(async () => {
      failed?.onError?.(failure);
      failed?.onSettled?.(undefined, failure);
    });
    // Still in the dialog, still signed in: the retry is the user's next move.
    expect(screen.getByRole('button', { name: 'Delete account' })).toBeInTheDocument();
    expect(signOut).not.toHaveBeenCalled();

    await user.click(screen.getByRole('button', { name: 'Delete account' }));
    expect(deleteAccount).toHaveBeenCalledTimes(2);

    // And the retry is a real one: when it succeeds, the deletion completes.
    const retried = pending;
    await act(async () => {
      retried?.onSuccess?.();
      retried?.onSettled?.();
    });
    expect(signOut).toHaveBeenCalledTimes(1);
    await waitFor(() => expect(navigate).toHaveBeenCalledWith('/login', { replace: true }));
  });
});
