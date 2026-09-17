import { render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import '@/i18n';
import AuthCallbackPage from '@/pages/AuthCallbackPage';
import { apiClient } from '@/lib/api';
import { setPendingInviteCode } from '@/lib/pendingInviteCode';
import { setPendingAuthMethod } from '@/lib/pendingAuthMethod';
import { setPendingTermsConsent } from '@/lib/pendingTermsConsent';
import { Analytics } from '@/lib/analytics';
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

  it('scrubs the URL strictly BEFORE any analytics event fires', async () => {
    const loginCompleted = vi.spyOn(Analytics, 'loginCompleted');
    window.history.replaceState(
      null,
      '',
      '/auth/callback#access_token=oauth-access&refresh_token=oauth-refresh&token_type=bearer'
    );
    const replaceStateSpy = vi.spyOn(window.history, 'replaceState');
    mockedPost.mockResolvedValueOnce(sessionEnvelope as never);

    renderCallback();

    await waitFor(() => expect(loginCompleted).toHaveBeenCalledTimes(1));

    // The token fragment was gone from the URL before login_completed could be
    // captured by analytics/session tooling.
    expect(replaceStateSpy.mock.invocationCallOrder[0]).toBeLessThan(
      loginCompleted.mock.invocationCallOrder[0]
    );
    expect(window.location.hash).toBe('');
  });

  it('fires login_completed with the persisted provider exactly once on a successful exchange', async () => {
    const loginCompleted = vi.spyOn(Analytics, 'loginCompleted');
    setPendingAuthMethod('google');
    window.history.replaceState(
      null,
      '',
      '/auth/callback#access_token=oauth-access&refresh_token=oauth-refresh&token_type=bearer'
    );
    mockedPost.mockResolvedValueOnce(sessionEnvelope as never);

    renderCallback();

    await waitFor(() => expect(mockNavigate).toHaveBeenCalledWith('/circles', { replace: true }));
    expect(loginCompleted).toHaveBeenCalledTimes(1);
    expect(loginCompleted).toHaveBeenCalledWith('google');
    // Provider consumed — a later unrelated sign-in must not inherit it.
    expect(sessionStorage.getItem('cc_pending_auth_method')).toBeNull();
  });

  it("falls back to the generic 'oauth' method when no provider was persisted", async () => {
    const loginCompleted = vi.spyOn(Analytics, 'loginCompleted');
    window.history.replaceState(
      null,
      '',
      '/auth/callback#access_token=oauth-access&refresh_token=oauth-refresh&token_type=bearer'
    );
    mockedPost.mockResolvedValueOnce(sessionEnvelope as never);

    renderCallback();

    await waitFor(() => expect(mockNavigate).toHaveBeenCalledWith('/circles', { replace: true }));
    expect(loginCompleted).toHaveBeenCalledTimes(1);
    expect(loginCompleted).toHaveBeenCalledWith('oauth');
  });

  it('does NOT fire any completion event when the exchange fails', async () => {
    const loginCompleted = vi.spyOn(Analytics, 'loginCompleted');
    setPendingAuthMethod('apple');
    window.history.replaceState(
      null,
      '',
      '/auth/callback#access_token=oauth-access&refresh_token=oauth-refresh'
    );
    mockedPost.mockRejectedValueOnce({ success: false, error: { code: 'INVALID_TOKEN' } });

    renderCallback();

    expect(await screen.findByRole('alert')).toBeInTheDocument();
    expect(loginCompleted).not.toHaveBeenCalled();
  });

  it('relays parked signup consent as termsAccepted: true and consumes it', async () => {
    // SignUpPage parks this before its OAuth redirect (checkbox state cannot
    // survive the full-page navigation).
    setPendingTermsConsent();
    window.history.replaceState(
      null,
      '',
      '/auth/callback#access_token=oauth-access&refresh_token=oauth-refresh&token_type=bearer'
    );
    mockedPost.mockResolvedValueOnce(sessionEnvelope as never);

    renderCallback();

    await waitFor(() => expect(mockNavigate).toHaveBeenCalledWith('/circles', { replace: true }));
    expect(mockedPost).toHaveBeenCalledWith('/auth/oauth-session', {
      access_token: 'oauth-access',
      refresh_token: 'oauth-refresh',
      termsAccepted: true,
    });
    // Consumed — a later, unrelated OAuth login must not inherit the consent flag.
    expect(sessionStorage.getItem('cc_pending_terms_consent')).toBeNull();
  });

  it('sends NO termsAccepted field when nothing was parked (LoginPage-initiated OAuth)', async () => {
    window.history.replaceState(
      null,
      '',
      '/auth/callback#access_token=oauth-access&refresh_token=oauth-refresh&token_type=bearer'
    );
    mockedPost.mockResolvedValueOnce(sessionEnvelope as never);

    renderCallback();

    await waitFor(() => expect(mockNavigate).toHaveBeenCalledWith('/circles', { replace: true }));
    expect(mockedPost).toHaveBeenCalledWith('/auth/oauth-session', {
      access_token: 'oauth-access',
      refresh_token: 'oauth-refresh',
    });
  });

  it('resumes a pending invite handoff: PEEKS the parked code (does not consume) and lands on /invite/CODE', async () => {
    setPendingInviteCode('ABC234');
    window.history.replaceState(
      null,
      '',
      '/auth/callback#access_token=oauth-access&refresh_token=oauth-refresh&token_type=bearer'
    );
    mockedPost.mockResolvedValueOnce(sessionEnvelope as never);

    renderCallback();

    await waitFor(() =>
      expect(mockNavigate).toHaveBeenCalledWith('/invite/ABC234', { replace: true })
    );
    // WB1 regression: this page must NOT consume the code itself — it only
    // decides where to detour. InviteLandingPage's own effect consumes it
    // and auto-accepts; if this page cleared it first (the old bug), the
    // landing page would find nothing parked and auto-accept would never
    // arm, stranding the visitor on a card they have to tap manually.
    expect(sessionStorage.getItem('cc_pending_invite_code')).toBe('ABC234');
  });

  it('leaves the pending invite code parked when the exchange fails (retry via /login)', async () => {
    setPendingInviteCode('ABC234');
    window.history.replaceState(
      null,
      '',
      '/auth/callback#access_token=oauth-access&refresh_token=oauth-refresh'
    );
    mockedPost.mockRejectedValueOnce({ success: false, error: { code: 'INVALID_TOKEN' } });

    renderCallback();

    expect(await screen.findByRole('alert')).toBeInTheDocument();
    expect(mockNavigate).not.toHaveBeenCalled();
    // Still parked — the "Back to Sign In" retry can complete the handoff.
    expect(sessionStorage.getItem('cc_pending_invite_code')).toBe('ABC234');
  });

  it('shows the error state (with a retry link to /login) when the provider returns an error', async () => {
    window.history.replaceState(null, '', '/auth/callback#error_description=server_error');

    renderCallback();

    expect(await screen.findByRole('alert')).toBeInTheDocument();
    const loginLink = screen.getByRole('link', { name: 'Back to Sign In' });
    expect(loginLink).toHaveAttribute('href', '/login');
    expect(mockedPost).not.toHaveBeenCalled();
    expect(mockNavigate).not.toHaveBeenCalled();
  });

  it('shows the gentle cancelled state (not an error) when the user denies OAuth consent', async () => {
    window.history.replaceState(
      null,
      '',
      '/auth/callback#error=access_denied&error_description=The+user+denied+the+request'
    );

    renderCallback();

    expect(
      await screen.findByText("No problem — you can sign in whenever you're ready.")
    ).toBeInTheDocument();
    // Deliberate cancel is not announced as an error
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
    // ...but it is still announced politely, same as any other status update.
    expect(screen.getByRole('status')).toHaveTextContent(
      "No problem — you can sign in whenever you're ready."
    );
    expect(screen.getByRole('link', { name: 'Back to Sign In' })).toHaveAttribute('href', '/login');
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

  // ── Failure funnel ────────────────────────────────────────────────────────
  // Every terminal OAuth outcome used to report NOTHING here: login_started
  // fired at the button, the browser left for the provider, and a broken
  // return leg produced no event at all — so web OAuth failures were invisible
  // in the funnel. The codes are stable and mirror mobile's OAuthErrorCode
  // members; provider prose (`error_description`) must never be one of them.

  it('reports OAUTH_PROVIDER_ERROR with the parked provider, never the provider prose', async () => {
    const loginFailed = vi.spyOn(Analytics, 'loginFailed');
    setPendingAuthMethod('google');
    window.history.replaceState(
      null,
      '',
      '/auth/callback#error=server_error&error_description=Account+pat@example.com+is+blocked'
    );

    renderCallback();

    expect(await screen.findByRole('alert')).toBeInTheDocument();
    expect(loginFailed).toHaveBeenCalledWith('google', 'OAUTH_PROVIDER_ERROR');
    // The free-text description never reaches analytics in any form.
    const [, reason] = loginFailed.mock.calls[0];
    expect(reason).not.toContain('pat@example.com');
    expect(reason).not.toContain('blocked');
    // Read-and-clear: the parked provider cannot be attributed to a later sign-in.
    expect(sessionStorage.length).toBe(0);
  });

  it("reports OAUTH_NO_TOKENS under the generic 'oauth' method when the fragment is empty", async () => {
    const loginFailed = vi.spyOn(Analytics, 'loginFailed');

    renderCallback();

    expect(await screen.findByRole('alert')).toBeInTheDocument();
    expect(loginFailed).toHaveBeenCalledWith('oauth', 'OAUTH_NO_TOKENS');
  });

  it('reports NO failure event when the user cancels, but still clears the parked provider', async () => {
    const loginFailed = vi.spyOn(Analytics, 'loginFailed');
    setPendingAuthMethod('apple');
    window.history.replaceState(null, '', '/auth/callback#error=access_denied');

    renderCallback();

    expect(
      await screen.findByText("No problem — you can sign in whenever you're ready.")
    ).toBeInTheDocument();
    // A deliberate cancel is not a failure — mirrors mobile, which skips
    // analytics on CANCELLED.
    expect(loginFailed).not.toHaveBeenCalled();
    expect(sessionStorage.length).toBe(0);
  });

  it("reports the backend's own error code when the token exchange is rejected", async () => {
    const loginFailed = vi.spyOn(Analytics, 'loginFailed');
    setPendingAuthMethod('apple');
    window.history.replaceState(
      null,
      '',
      '/auth/callback#access_token=oauth-access&refresh_token=oauth-refresh'
    );
    mockedPost.mockRejectedValueOnce({ success: false, error: { code: 'INVALID_TOKEN' } });

    renderCallback();

    expect(await screen.findByRole('alert')).toBeInTheDocument();
    expect(loginFailed).toHaveBeenCalledWith('apple', 'INVALID_TOKEN');
  });

  it('falls back to OAUTH_SESSION_FAILED when the exchange never reached the backend', async () => {
    const loginFailed = vi.spyOn(Analytics, 'loginFailed');
    window.history.replaceState(
      null,
      '',
      '/auth/callback#access_token=oauth-access&refresh_token=oauth-refresh'
    );
    // A raw network rejection: no envelope, so no `err.error.code` to report.
    mockedPost.mockRejectedValueOnce({ code: 'ERR_NETWORK', isAxiosError: true });

    renderCallback();

    expect(await screen.findByRole('alert')).toBeInTheDocument();
    expect(loginFailed).toHaveBeenCalledWith('oauth', 'OAUTH_SESSION_FAILED');
  });
});

// ── Parked TERMS acceptance on every failure path ──────────────────────────
// SignUpPage parks '1' before its provider redirect. Every callback that does
// NOT complete must drop it: left behind, the next successful callback in the
// same tab (a returning user's OAuth LOGIN, which parks nothing) consumed it
// and relayed `termsAccepted: true` for an account that ticked nothing.

describe('AuthCallbackPage — parked terms acceptance never survives a failed callback', () => {
  const TERMS_KEY = 'cc_pending_terms_consent';

  beforeEach(() => {
    mockNavigate.mockReset();
    mockedPost.mockReset();
    tokenAccessor.clear();
    localStorage.clear();
    sessionStorage.clear();
    useAuthStore.setState({ user: null, isAuthenticated: false, isBootstrapping: false });
    window.history.replaceState(null, '', '/auth/callback');
    setPendingTermsConsent();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('provider error: clears the parked terms', async () => {
    window.history.replaceState(null, '', '/auth/callback#error=server_error&error_description=boom');
    renderCallback();
    expect(await screen.findByRole('alert')).toBeInTheDocument();
    expect(sessionStorage.getItem(TERMS_KEY)).toBeNull();
    expect(mockedPost).not.toHaveBeenCalled();
  });

  it('provider access_denied (cancel): clears the parked terms', async () => {
    window.history.replaceState(null, '', '/auth/callback?error=access_denied');
    renderCallback();
    expect(
      await screen.findByText("No problem — you can sign in whenever you're ready.")
    ).toBeInTheDocument();
    expect(sessionStorage.getItem(TERMS_KEY)).toBeNull();
  });

  it('missing tokens: clears the parked terms', async () => {
    window.history.replaceState(null, '', '/auth/callback#token_type=bearer');
    renderCallback();
    expect(await screen.findByRole('alert')).toBeInTheDocument();
    expect(sessionStorage.getItem(TERMS_KEY)).toBeNull();
  });

  it('oauth-session rejection: clears the parked terms', async () => {
    window.history.replaceState(null, '', '/auth/callback#access_token=a&refresh_token=r');
    mockedPost.mockRejectedValueOnce({ success: false, error: { code: 'INVALID_TOKEN' } });
    renderCallback();
    expect(await screen.findByRole('alert')).toBeInTheDocument();
    expect(sessionStorage.getItem(TERMS_KEY)).toBeNull();
  });

  it('exchange that never reached the backend (catch): clears the parked terms', async () => {
    window.history.replaceState(null, '', '/auth/callback#access_token=a&refresh_token=r');
    mockedPost.mockRejectedValueOnce(new Error('Network Error'));
    renderCallback();
    expect(await screen.findByRole('alert')).toBeInTheDocument();
    expect(sessionStorage.getItem(TERMS_KEY)).toBeNull();
  });

  it('a failed provider callback followed by an OAuth login relays NO termsAccepted', async () => {
    window.history.replaceState(null, '', '/auth/callback#error=server_error');
    const first = renderCallback();
    expect(await screen.findByRole('alert')).toBeInTheDocument();
    first.unmount();

    // Second handshake: a LOGIN, nothing parked by the login page.
    window.history.replaceState(
      null,
      '',
      '/auth/callback#access_token=login-access&refresh_token=login-refresh&token_type=bearer'
    );
    mockedPost.mockResolvedValueOnce(sessionEnvelope as never);
    renderCallback();

    await waitFor(() => expect(mockNavigate).toHaveBeenCalledWith('/circles', { replace: true }));
    // signIn's own side effects may POST elsewhere; only the exchange matters.
    const exchanges = mockedPost.mock.calls.filter(([url]) => url === '/auth/oauth-session');
    expect(exchanges).toEqual([
      ['/auth/oauth-session', { access_token: 'login-access', refresh_token: 'login-refresh' }],
    ]);
  });
});
