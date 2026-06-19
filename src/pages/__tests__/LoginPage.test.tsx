import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import '@/i18n';
import LoginPage from '@/pages/LoginPage';
import { apiClient } from '@/lib/api';
import { supabase } from '@/lib/supabase';
import { tokenAccessor } from '@/lib/tokenAccessor';
import { useAuthStore } from '@/store/authStore';

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

function renderLogin() {
  return render(
    <MemoryRouter initialEntries={['/login']}>
      <LoginPage />
    </MemoryRouter>
  );
}

async function fillAndSubmit(email = 'pat@example.com', password = 'Secret#123') {
  const user = userEvent.setup();
  renderLogin();
  await user.type(screen.getByLabelText('Email'), email);
  await user.type(screen.getByLabelText('Password'), password);
  await user.click(screen.getByRole('button', { name: 'Sign In' }));
  return user;
}

describe('LoginPage', () => {
  beforeEach(() => {
    mockNavigate.mockReset();
    mockedPost.mockReset();
    tokenAccessor.clear();
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

  it('validates locally and never calls the API with an empty form', async () => {
    const user = userEvent.setup();
    renderLogin();

    await user.click(screen.getByRole('button', { name: 'Sign In' }));

    expect(await screen.findByText('Email is required')).toBeInTheDocument();
    expect(mockedPost).not.toHaveBeenCalled();
    expect(mockNavigate).not.toHaveBeenCalled();
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
    expect(alert).toHaveTextContent('Apple sign-in failed');
  });
});
