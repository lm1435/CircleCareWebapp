import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import '@/i18n';
import LoginPage from '@/pages/LoginPage';
import { apiClient } from '@/lib/api';
import { setPendingInviteCode } from '@/lib/pendingInviteCode';
import { supabase } from '@/lib/supabase';
import { tokenAccessor } from '@/lib/tokenAccessor';
import { useAuthStore } from '@/store/authStore';
import { clickTwice, neverSettles, submitFormTwice } from '@/test/doubleSubmit';

// Task 45 — LoginPage. `@/lib/api` + `@/lib/supabase` are mocked by the global
// setup. The `X-Session-Mode: cookie` header itself is attached by the real
// api client's request interceptor for /auth/* URLs — asserted in
// src/lib/__tests__/api.test.ts; here we assert the page calls that client.

const mockNavigate = vi.fn();
vi.mock('react-router-dom', async () => {
  const actual = await vi.importActual<typeof import('react-router-dom')>('react-router-dom');
  return { ...actual, useNavigate: () => mockNavigate };
});

const mockedPost = vi.mocked(apiClient.post);

const successEnvelope = {
  success: true,
  data: {
    session: { access_token: 'access-token', expires_at: 1234567890 },
    user: { id: 'user-1', email: 'pat@example.com', first_name: 'Pat', last_name: 'Rivera' },
  },
};

function renderLogin(state?: { from?: { pathname?: string }; emailVerified?: boolean }) {
  return render(
    <MemoryRouter initialEntries={[{ pathname: '/login', state: state ?? null }]}>
      <LoginPage />
    </MemoryRouter>
  );
}

async function fillAndSubmit(email = 'pat@example.com', password = 'Secret#123', state?: {
  from?: { pathname?: string };
}) {
  const user = userEvent.setup();
  renderLogin(state);
  // Labels carry a RequiredMarker (" * (required)") now that the fields pass
  // `required`, so match the leading label text rather than the exact string.
  await user.type(screen.getByLabelText(/^Email/), email);
  await user.type(screen.getByLabelText(/^Password/), password);
  await user.click(screen.getByRole('button', { name: 'Sign in' }));
  return user;
}

describe('LoginPage', () => {
  beforeEach(() => {
    mockNavigate.mockReset();
    mockedPost.mockReset();
    tokenAccessor.clear();
    sessionStorage.clear();
    useAuthStore.setState({ user: null, isAuthenticated: false, isBootstrapping: false });
  });

  it('submits credentials through the cookie-mode auth client and navigates to /circles', async () => {
    mockedPost.mockResolvedValueOnce(successEnvelope as never);

    await fillAndSubmit();

    expect(mockedPost).toHaveBeenCalledWith('/auth/login', {
      email: 'pat@example.com',
      password: 'Secret#123',
    });
    await waitFor(() => expect(mockNavigate).toHaveBeenCalledWith('/circles', { replace: true }));

    // signIn ran: access token in memory only, never in storage
    expect(tokenAccessor.getAuthToken()).toBe('access-token');
    expect(useAuthStore.getState().isAuthenticated).toBe(true);
    expect(localStorage.length).toBe(0);
    expect(sessionStorage.length).toBe(0);
  });

  it('falls back to a parked pending invite code when there is no router state', async () => {
    // login → signup → back-to-login round trips lose state.from; the invite
    // landing page parked the code in sessionStorage for exactly this case.
    setPendingInviteCode('ABC234');
    mockedPost.mockResolvedValueOnce(successEnvelope as never);

    await fillAndSubmit();

    await waitFor(() =>
      expect(mockNavigate).toHaveBeenCalledWith('/invite/ABC234', { replace: true })
    );
    // Peeked, NOT consumed — InviteLandingPage's auto-accept effect must still
    // find the parked code when it mounts (it consumes and clears it there).
    expect(sessionStorage.getItem('cc_pending_invite_code')).toBe('ABC234');
  });

  it('prefers state.from over the parked code and leaves the code for the landing page to clear', async () => {
    setPendingInviteCode('ABC234');
    mockedPost.mockResolvedValueOnce(successEnvelope as never);

    await fillAndSubmit('pat@example.com', 'Secret#123', {
      from: { pathname: '/invite/ABC234' },
    });

    await waitFor(() =>
      expect(mockNavigate).toHaveBeenCalledWith('/invite/ABC234', { replace: true })
    );
    // NOT consumed here — InviteLandingPage clears it on its authenticated render.
    expect(sessionStorage.getItem('cc_pending_invite_code')).toBe('ABC234');
  });

  it('routes EMAIL_NOT_VERIFIED to /verify-email with the email in router STATE (not query params)', async () => {
    mockedPost.mockImplementation(((url: string) => {
      if (url === '/auth/login') {
        return Promise.reject({
          success: false,
          error: {
            code: 'EMAIL_NOT_VERIFIED',
            requiresVerification: true,
            email: 'unverified@example.com',
          },
        });
      }
      return Promise.resolve({ success: true, data: { message: 'sent' } });
    }) as never);

    await fillAndSubmit('unverified@example.com');

    await waitFor(() =>
      expect(mockNavigate).toHaveBeenCalledWith('/verify-email', {
        state: { email: 'unverified@example.com', notVerified: true },
      })
    );
  });

  it('shows an inline alert (not a toast) on invalid credentials and does not navigate', async () => {
    mockedPost.mockRejectedValueOnce({
      success: false,
      error: { code: 'LOGIN_FAILED', message: 'Invalid email or password.' },
    });

    await fillAndSubmit();

    const alert = await screen.findByRole('alert');
    expect(alert).toHaveTextContent('Invalid email or password.');
    expect(mockNavigate).not.toHaveBeenCalled();
    expect(tokenAccessor.getAuthToken()).toBeNull();
  });

  it('tells a rate-limited (429 RATE_LIMIT) user to WAIT, never the generic "try again" copy', async () => {
    mockedPost.mockRejectedValueOnce({
      success: false,
      error: { code: 'RATE_LIMIT', message: 'Too many authentication attempts, please try again later' },
    });

    await fillAndSubmit();

    const alert = await screen.findByRole('alert');
    expect(alert).toHaveTextContent(
      'Too many attempts. Please wait a few minutes before trying again.'
    );
    expect(alert).not.toHaveTextContent("We couldn't sign you in. Please try again.");
    expect(alert).not.toHaveTextContent('Invalid email or password.');
    expect(mockNavigate).not.toHaveBeenCalled();
  });

  it('validates locally and never calls the API with an empty form', async () => {
    const user = userEvent.setup();
    renderLogin();

    await user.click(screen.getByRole('button', { name: 'Sign in' }));

    expect(await screen.findByText('Email is required.')).toBeInTheDocument();
    expect(mockedPost).not.toHaveBeenCalled();
    expect(mockNavigate).not.toHaveBeenCalled();
  });

  // Login is deliberately UNCAPPED: signup/reset bound new passwords to 72
  // UTF-8 bytes (GoTrue/bcrypt's real limit), but an EXISTING account may
  // already carry a password that predates that rule, or one accepted by a
  // different client. Capping login would lock such a user out entirely, with
  // no way to fix it (mirrors mobile: login uses `requiredString`, not
  // `passwordSchema`).
  it('does not cap password length — an existing long password is still submittable', async () => {
    const longPassword = 'x'.repeat(200);
    await fillAndSubmit('pat@example.com', longPassword);

    await waitFor(() =>
      expect(mockedPost).toHaveBeenCalledWith('/auth/login', {
        email: 'pat@example.com',
        password: longPassword,
      })
    );
    expect(screen.queryByText(/72 characters/)).not.toBeInTheDocument();
  });

  it('renders both provider buttons with a brand glyph and an accessible name', () => {
    renderLogin();
    const apple = screen.getByRole('button', { name: 'Continue with Apple' });
    const google = screen.getByRole('button', { name: 'Continue with Google' });
    // Brand glyphs are inline SVGs inside the buttons (no extra deps).
    expect(apple.querySelector('svg')).toBeInTheDocument();
    expect(google.querySelector('svg')).toBeInTheDocument();
  });

  it('starts the Google OAuth handshake through the Supabase broker', async () => {
    const signInWithOAuth = vi.mocked(supabase.auth.signInWithOAuth);
    signInWithOAuth.mockResolvedValueOnce({
      data: { provider: 'google', url: 'https://accounts.google.com/oauth' },
      error: null,
    } as never);

    const user = userEvent.setup();
    renderLogin();
    await user.click(screen.getByRole('button', { name: 'Continue with Google' }));

    expect(signInWithOAuth).toHaveBeenCalledWith({
      provider: 'google',
      options: {
        redirectTo: `${window.location.origin}/auth/callback`,
        skipBrowserRedirect: false,
      },
    });
    // No backend call happens until the /auth/callback exchange
    expect(mockedPost).not.toHaveBeenCalled();
    // Provider is parked so /auth/callback can attribute login_completed to it
    // after the full-page redirect drops this closure's `provider`.
    expect(sessionStorage.getItem('cc_pending_auth_method')).toBe('google');
  });

  it('shows an inline error when the OAuth broker fails', async () => {
    const signInWithOAuth = vi.mocked(supabase.auth.signInWithOAuth);
    signInWithOAuth.mockResolvedValueOnce({
      data: { provider: 'apple', url: null },
      error: { message: 'not configured' },
    } as never);

    const user = userEvent.setup();
    renderLogin();
    await user.click(screen.getByRole('button', { name: 'Continue with Apple' }));

    const alert = await screen.findByRole('alert');
    expect(alert).toHaveTextContent(
      "We couldn't sign you in with Apple. Please try again, or use your email and password."
    );
  });

  it('shows the "email verified, sign in" notice when arriving from VerifyEmailPage', () => {
    renderLogin({ emailVerified: true });

    const notice = screen.getByRole('status');
    expect(notice).toHaveTextContent(
      'Your email is verified. Sign in with your password to continue.'
    );
  });

  it('does not show the verified notice on a plain visit', () => {
    renderLogin();

    expect(screen.queryByRole('status')).not.toBeInTheDocument();
  });

  it('renders the AuthShell hero headline (Task W5 copy alignment with the mobile hero)', () => {
    renderLogin();

    // A <p>, not a heading — the page's actual heading is the form card's
    // <h1> ("Welcome back"), and an <h2> here would render before it in the
    // DOM and break heading order.
    expect(screen.getByText('Care for them together.')).toBeInTheDocument();
  });

  it('never renders a back button (login is the root of the signed-out flow)', () => {
    renderLogin();
    expect(screen.queryByRole('button', { name: 'Back' })).not.toBeInTheDocument();
  });
});

// Regression — double submit. On 2026-09-03 a real user produced three
// `login_started` events inside 52 ms, spent three of the five attempts
// `loginRateLimit` allows per five minutes, and was answered with RATE_LIMIT.
// `isSubmitting` was set but never CHECKED, and `loading`/`disabled` on the
// button lands a render too late to matter — see hooks/useGuardedSubmit.ts.
// These assert the API CALL COUNT: "the button ends up disabled" would pass
// against the bug.
describe('LoginPage — double-submit guard', () => {
  beforeEach(() => {
    mockNavigate.mockReset();
    mockedPost.mockReset();
    vi.mocked(supabase.auth.signInWithOAuth).mockClear();
    tokenAccessor.clear();
    sessionStorage.clear();
    useAuthStore.setState({ user: null, isAuthenticated: false, isBootstrapping: false });
  });

  it('sends exactly ONE /auth/login when the form is submitted twice in the same tick', async () => {
    // Never settles: the first request is still in flight when the second
    // submit arrives, which is the window the guard has to close.
    mockedPost.mockImplementation((() => neverSettles()) as never);
    const user = userEvent.setup();
    const { container } = renderLogin();

    await user.type(screen.getByLabelText(/^Email/), 'pat@example.com');
    await user.type(screen.getByLabelText(/^Password/), 'Secret#123');
    await submitFormTwice(container.querySelector('form') as HTMLFormElement);

    expect(mockedPost).toHaveBeenCalledTimes(1);
  });

  // WHAT THE REJECTED SUBMIT COSTS IF IT IS NOT SWALLOWED. This form is
  // `<form onSubmit={...} noValidate>` with `name="email"` / `name="password"`
  // and no `action`/`method`, so an unprevented submission is a native GET to
  // the current URL: the password lands in the address bar, in browser history
  // and in the `Referer` header of every request that follows, and the page
  // navigates away mid-login. `useGuardedSubmit` calls `preventDefault()`
  // BEFORE its ref check for exactly this reason; reordering those two lines
  // leaves the call-count assertions above green.
  it('swallows the submit it rejects — credentials never reach the URL', async () => {
    const user = userEvent.setup();
    mockedPost.mockImplementation(() => neverSettles());
    const { container } = renderLogin();
    await user.type(screen.getByLabelText(/^Email/), 'pat@example.com');
    await user.type(screen.getByLabelText(/^Password/), 'Secret#123');

    const prevented = await submitFormTwice(container.querySelector('form') as HTMLFormElement);

    expect(mockedPost).toHaveBeenCalledTimes(1);
    expect(prevented).toEqual([true, true]);
  });

  it('is still submittable after a validation failure (the guard releases, it does not latch)', async () => {
    // The validation branches `return` BEFORE isSubmitting is set — if the
    // guard were not released on that path the form would be dead after one
    // mistyped submit.
    const user = userEvent.setup();
    const { container } = renderLogin();
    const form = container.querySelector('form') as HTMLFormElement;

    await submitFormTwice(form);
    expect(mockedPost).not.toHaveBeenCalled();
    expect(await screen.findByText('Email is required.')).toBeInTheDocument();

    // Left in flight on purpose: a resolved login would call signIn(), which
    // fires its own /auth/session-established POST and muddies the count.
    mockedPost.mockImplementation((() => neverSettles()) as never);
    await user.type(screen.getByLabelText(/^Email/), 'pat@example.com');
    await user.type(screen.getByLabelText(/^Password/), 'Secret#123');
    await user.click(screen.getByRole('button', { name: 'Sign in' }));

    await waitFor(() => expect(mockedPost).toHaveBeenCalledTimes(1));
    expect(mockedPost).toHaveBeenCalledWith('/auth/login', {
      email: 'pat@example.com',
      password: 'Secret#123',
    });
  });

  it('starts exactly ONE OAuth handshake when a provider button is pressed twice in the same tick', async () => {
    // Nothing in handleOAuth ever set isSubmitting, so these buttons had no
    // guard at all — two presses meant two `login_started` events and two
    // redirects.
    const signInWithOAuth = vi.mocked(supabase.auth.signInWithOAuth);
    signInWithOAuth.mockImplementation((() => neverSettles()) as never);
    renderLogin();

    await clickTwice(screen.getByRole('button', { name: 'Continue with Google' }));

    expect(signInWithOAuth).toHaveBeenCalledTimes(1);
  });
});
