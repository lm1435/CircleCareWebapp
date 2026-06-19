import { render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import '@/i18n';
import AuthCallbackPage from '@/pages/AuthCallbackPage';
import { apiClient } from '@/lib/api';
import { tokenAccessor } from '@/lib/tokenAccessor';
import { useAuthStore } from '@/store/authStore';

// Task 45b (page half) — AuthCallbackPage: tokens read from the URL fragment,
// scrubbed via history.replaceState BEFORE any network call, exchanged through
// POST /auth/oauth-session, and never written to any JS-readable storage.

const mockNavigate = vi.fn();
vi.mock('react-router-dom', async () => {
  const actual = await vi.importActual<typeof import('react-router-dom')>('react-router-dom');
  return { ...actual, useNavigate: () => mockNavigate };
});

const mockedPost = vi.mocked(apiClient.post);

const sessionEnvelope = {
  success: true,
  data: {
    session: { access_token: 'exchanged-access', expires_at: 1234567890 },
    user: { id: 'user-1', email: 'pat@example.com', first_name: 'Pat', last_name: 'Rivera' },
  },
};

function renderCallback() {
  return render(
    <MemoryRouter initialEntries={['/auth/callback']}>
      <AuthCallbackPage />
    </MemoryRouter>
  );
}

describe('AuthCallbackPage', () => {
  beforeEach(() => {
    mockNavigate.mockReset();
    mockedPost.mockReset();
    tokenAccessor.clear();
    localStorage.clear();
    sessionStorage.clear();
    useAuthStore.setState({ user: null, isAuthenticated: false, isBootstrapping: false });
    window.history.replaceState(null, '', '/auth/callback');
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('scrubs tokens from the URL BEFORE the network call, exchanges them, and navigates', async () => {
    window.history.replaceState(
      null,
      '',
      '/auth/callback#access_token=oauth-access&refresh_token=oauth-refresh&token_type=bearer'
    );
    const replaceStateSpy = vi.spyOn(window.history, 'replaceState');
    mockedPost.mockResolvedValueOnce(sessionEnvelope as never);

    renderCallback();

    // Scrub happened, and strictly before the oauth-session POST
    expect(replaceStateSpy).toHaveBeenCalledWith(null, '', '/auth/callback');
    expect(replaceStateSpy.mock.invocationCallOrder[0]).toBeLessThan(
      mockedPost.mock.invocationCallOrder[0]
    );
    expect(window.location.hash).toBe('');

    expect(mockedPost).toHaveBeenCalledWith('/auth/oauth-session', {
      access_token: 'oauth-access',
      refresh_token: 'oauth-refresh',
    });

    await waitFor(() => expect(mockNavigate).toHaveBeenCalledWith('/circles', { replace: true }));

    // Session established in memory only — tokens never persisted
    expect(tokenAccessor.getAuthToken()).toBe('exchanged-access');
    expect(useAuthStore.getState().isAuthenticated).toBe(true);
    expect(localStorage.length).toBe(0);
    expect(sessionStorage.length).toBe(0);
  });

  it('shows the error state (with a retry link to /login) when the provider returns an error', async () => {
    window.history.replaceState(null, '', '/auth/callback#error_description=access_denied');

    renderCallback();

    expect(await screen.findByRole('alert')).toBeInTheDocument();
    const loginLink = screen.getByRole('link', { name: 'Back to Login' });
    expect(loginLink).toHaveAttribute('href', '/login');
    expect(mockedPost).not.toHaveBeenCalled();
    expect(mockNavigate).not.toHaveBeenCalled();
  });

  it('shows the error state when tokens are missing from the fragment', async () => {
    renderCallback();

    expect(await screen.findByRole('alert')).toBeInTheDocument();
    expect(mockedPost).not.toHaveBeenCalled();
  });

  it('shows the error state when the oauth-session exchange fails, leaving storage empty', async () => {
    window.history.replaceState(
      null,
      '',
      '/auth/callback#access_token=oauth-access&refresh_token=oauth-refresh'
    );
    mockedPost.mockRejectedValueOnce({
      success: false,
      error: { code: 'INVALID_TOKEN' },
    });

    renderCallback();

    expect(await screen.findByRole('alert')).toBeInTheDocument();
    expect(mockNavigate).not.toHaveBeenCalled();
    expect(tokenAccessor.getAuthToken()).toBeNull();
    expect(localStorage.length).toBe(0);
    expect(sessionStorage.length).toBe(0);
  });
});
