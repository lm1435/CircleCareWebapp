import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import '@/i18n';
import VerifyEmailPage from '@/pages/VerifyEmailPage';
import { apiClient } from '@/lib/api';
import { setPendingInviteCode } from '@/lib/pendingInviteCode';
import { tokenAccessor } from '@/lib/tokenAccessor';
import { useAuthStore } from '@/store/authStore';

// VerifyEmailPage — OTP verification is the last hop of the sign-up flow, so
// it is a post-auth landing decision: it must resume a pending invite handoff
// (parked in sessionStorage by the invite landing page) instead of always
// dropping new users on /circles. `@/lib/api` is mocked by the global setup.

const mockNavigate = vi.fn();
vi.mock('react-router-dom', async () => {
  const actual = await vi.importActual<typeof import('react-router-dom')>('react-router-dom');
  return { ...actual, useNavigate: () => mockNavigate };
});

const mockedPost = vi.mocked(apiClient.post);

const verifyOtpEnvelope = {
  success: true,
  data: {
    session: { access_token: 'body-access', refresh_token: 'body-refresh', expires_at: 1234567890 },
    user: { id: 'user-1', email: 'pat@example.com', first_name: 'Pat', last_name: 'Rivera' },
  },
};

const sessionEnvelope = {
  success: true,
  data: {
    session: { access_token: 'exchanged-access', expires_at: 1234567890 },
    user: { id: 'user-1', email: 'pat@example.com', first_name: 'Pat', last_name: 'Rivera' },
  },
};

function renderVerify() {
  return render(
    <MemoryRouter
      initialEntries={[{ pathname: '/verify-email', state: { email: 'pat@example.com' } }]}
    >
      <VerifyEmailPage />
    </MemoryRouter>
  );
}

/** Paste the full code into the first OTP box — auto-submits when complete. */
async function enterOtp(code = '123456') {
  const user = userEvent.setup();
  const firstBox = screen.getByLabelText('Digit 1 of 6');
  await user.click(firstBox);
  await user.paste(code);
  return user;
}

function mockAuthEndpoints() {
  mockedPost.mockImplementation(((url: string) => {
    if (url === '/auth/verify-otp') return Promise.resolve(verifyOtpEnvelope);
    if (url === '/auth/oauth-session') return Promise.resolve(sessionEnvelope);
    return Promise.reject(new Error(`unexpected POST ${url}`));
  }) as never);
}

describe('VerifyEmailPage', () => {
  beforeEach(() => {
    mockNavigate.mockReset();
    mockedPost.mockReset();
    tokenAccessor.clear();
    sessionStorage.clear();
    useAuthStore.setState({ user: null, isAuthenticated: false, isBootstrapping: false });
  });

  it('verifies the OTP, exchanges for a cookie session, and lands on /circles', async () => {
    mockAuthEndpoints();
    renderVerify();

    await enterOtp();

    expect(mockedPost).toHaveBeenCalledWith('/auth/verify-otp', {
      email: 'pat@example.com',
      otp: '123456',
    });
    await waitFor(() =>
      expect(mockedPost).toHaveBeenCalledWith('/auth/oauth-session', {
        access_token: 'body-access',
        refresh_token: 'body-refresh',
      })
    );
    await waitFor(() => expect(mockNavigate).toHaveBeenCalledWith('/circles', { replace: true }));

    // Cookie-mode session in memory only; the body refresh token is discarded.
    expect(tokenAccessor.getAuthToken()).toBe('exchanged-access');
    expect(useAuthStore.getState().isAuthenticated).toBe(true);
    expect(localStorage.length).toBe(0);
    expect(sessionStorage.length).toBe(0);
  });

  it('resumes a pending invite handoff: consumes the parked code and lands on /invite/CODE', async () => {
    setPendingInviteCode('ABC234');
    mockAuthEndpoints();
    renderVerify();

    await enterOtp();

    await waitFor(() =>
      expect(mockNavigate).toHaveBeenCalledWith('/invite/ABC234', { replace: true })
    );
    // Consumed — the code must not redirect a later sign-in again.
    expect(sessionStorage.length).toBe(0);
  });

  it('leaves the pending code parked when the cookie exchange fails (login completes the handoff)', async () => {
    setPendingInviteCode('ABC234');
    mockedPost.mockImplementation(((url: string) => {
      if (url === '/auth/verify-otp') return Promise.resolve(verifyOtpEnvelope);
      return Promise.reject({ success: false, error: { code: 'INVALID_TOKEN' } });
    }) as never);
    renderVerify();

    await enterOtp();

    // Verified but not signed in — a normal login will work now, and its
    // pending-code fallback finishes the invite handoff.
    await waitFor(() => expect(mockNavigate).toHaveBeenCalledWith('/login', { replace: true }));
    expect(sessionStorage.getItem('cc_pending_invite_code')).toBe('ABC234');
  });

  it('shows an inline error for an invalid code and does not navigate', async () => {
    mockedPost.mockRejectedValue({
      success: false,
      error: { code: 'INVALID_OTP', message: 'Invalid code' },
    });
    renderVerify();

    await enterOtp('999999');

    expect(await screen.findByRole('alert')).toBeInTheDocument();
    expect(mockNavigate).not.toHaveBeenCalled();
    expect(tokenAccessor.getAuthToken()).toBeNull();
  });
});
