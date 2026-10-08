import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import '@/i18n';
import VerifyEmailPage from '@/pages/VerifyEmailPage';
import { apiClient } from '@/lib/api';
import { setPendingInviteCode } from '@/lib/pendingInviteCode';
import { peekPendingSignupEmail, setPendingSignupEmail } from '@/lib/pendingSignupEmail';
import { tokenAccessor } from '@/lib/tokenAccessor';
import { useAuthStore } from '@/store/authStore';
import { clickTwice, neverSettles } from '@/test/doubleSubmit';

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

// What POST /auth/verify-otp really answers for a wrong OR an expired code: 400
// VERIFICATION_FAILED (backend/src/routes/auth.ts, both branches). `apiClient` rejects with that
// unwrapped envelope, never an AxiosError.
const rejectedCode = {
  success: false,
  error: { code: 'VERIFICATION_FAILED', message: 'Invalid or expired verification code.' },
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

/** The six boxes, in order. */
const otpBoxes = (): HTMLInputElement[] =>
  Array.from({ length: 6 }, (_, i) => screen.getByLabelText(`Digit ${i + 1} of 6`) as HTMLInputElement);
/** What the six boxes currently hold, as one string. */
const otpValue = (): string => otpBoxes().map((box) => box.value).join('');
/** The `otp` of every POST /auth/verify-otp so far, in order. */
const verifyCodes = (): string[] =>
  mockedPost.mock.calls
    .filter(([url]) => url === '/auth/verify-otp')
    .map(([, body]) => (body as { otp: string }).otp);

/** No response at all: offline / DNS / CORS. `apiClient` rejects with the AxiosError itself. */
const networkError = () =>
  Object.assign(new Error('Network Error'), { name: 'AxiosError', code: 'ERR_NETWORK' });

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

  it('resumes a pending invite handoff: PEEKS the parked code (does not consume) and lands on /invite/CODE', async () => {
    setPendingInviteCode('ABC234');
    mockAuthEndpoints();
    renderVerify();

    await enterOtp();

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

  it('leaves the pending code parked when the cookie exchange fails (login completes the handoff)', async () => {
    setPendingInviteCode('ABC234');
    mockedPost.mockImplementation(((url: string) => {
      if (url === '/auth/verify-otp') return Promise.resolve(verifyOtpEnvelope);
      return Promise.reject({ success: false, error: { code: 'INVALID_TOKEN' } });
    }) as never);
    renderVerify();

    await enterOtp();

    // Verified but not signed in — a normal login will work now, and its
    // pending-code fallback finishes the invite handoff. LoginPage shows the
    // "email verified, sign in" notice off this router state.
    await waitFor(() =>
      expect(mockNavigate).toHaveBeenCalledWith('/login', {
        replace: true,
        state: { emailVerified: true },
      })
    );
    expect(sessionStorage.getItem('cc_pending_invite_code')).toBe('ABC234');
  });

  describe('parked signup email', () => {
    function renderVerifyNoState() {
      return render(
        <MemoryRouter initialEntries={['/verify-email']}>
          <VerifyEmailPage />
        </MemoryRouter>
      );
    }

    it('uses the parked email when it arrives without router state (SignUpPage browser-back redirect / reload)', async () => {
      setPendingSignupEmail('pat@example.com');
      mockAuthEndpoints();
      renderVerifyNoState();

      // The address is known, so no email field is asked for.
      expect(screen.queryByLabelText(/^Email/)).toBeNull();
      expect(screen.getByText(/pat@example\.com/)).toBeInTheDocument();
      await enterOtp();

      expect(mockedPost).toHaveBeenCalledWith('/auth/verify-otp', {
        email: 'pat@example.com',
        otp: '123456',
      });
    });

    it('router-state email wins over a parked one', async () => {
      setPendingSignupEmail('other@example.com');
      mockAuthEndpoints();
      renderVerify();
      await enterOtp();
      expect(mockedPost).toHaveBeenCalledWith('/auth/verify-otp', {
        email: 'pat@example.com',
        otp: '123456',
      });
    });

    it('clears the parked email after a SUCCESSFUL verification', async () => {
      setPendingSignupEmail('pat@example.com');
      mockAuthEndpoints();
      renderVerify();
      await enterOtp();
      await waitFor(() => expect(mockNavigate).toHaveBeenCalledWith('/circles', { replace: true }));
      expect(peekPendingSignupEmail()).toBeNull();
    });

    it('keeps the parked email when the code is rejected (so the person can retry)', async () => {
      setPendingSignupEmail('pat@example.com');
      mockedPost.mockRejectedValue(rejectedCode as never);
      renderVerify();
      await enterOtp();
      await screen.findByRole('alert');
      expect(peekPendingSignupEmail()).toBe('pat@example.com');
    });
  });

  // WCAG 3.3.1: an incomplete-OTP error must move focus. Typing a full code
  // auto-submits, so this drives it through the manual Verify button with a
  // short code instead.
  it('focuses the first OTP box when submitted with an incomplete code', async () => {
    const user = userEvent.setup();
    renderVerify();

    await user.click(screen.getByLabelText('Digit 1 of 6'));
    await user.paste('123');
    await user.click(screen.getByRole('button', { name: 'Verify email' }));

    expect(mockedPost).not.toHaveBeenCalled();
    expect(screen.getByLabelText('Digit 1 of 6')).toHaveFocus();
  });

  it('shows an inline error for an invalid code and does not navigate', async () => {
    mockedPost.mockRejectedValue(rejectedCode);
    renderVerify();

    await enterOtp('999999');

    expect(await screen.findByRole('alert')).toBeInTheDocument();
    expect(mockNavigate).not.toHaveBeenCalled();
    expect(tokenAccessor.getAuthToken()).toBeNull();
  });

  // A code that is KEPT in the boxes (a network failure: see "a rejected code" below) can be typed
  // over in place: the person clicks the first box and types it again with the last digit fixed. A
  // keystroke EQUAL to the box's own digit used to fire no change event, so the field stalled on the
  // first one and the corrected code was never sent. Keystrokes that change nothing must not
  // re-submit the old code either (the page submits on every report of a full code): the corrected
  // code is the one and only further verify request.
  it('re-submits only the corrected code when a kept code is typed over in place', async () => {
    mockAuthEndpoints();
    mockedPost.mockRejectedValueOnce(networkError());
    renderVerify();

    const user = await enterOtp('123456');
    expect(await screen.findByRole('alert')).toBeInTheDocument();
    expect(otpValue()).toBe('123456');

    await user.click(screen.getByLabelText('Digit 1 of 6'));
    await user.keyboard('123457');

    await waitFor(() => expect(mockNavigate).toHaveBeenCalledWith('/circles', { replace: true }));
    expect(verifyCodes()).toEqual(['123456', '123457']);
  });
});

// A REJECTED code. The page submits on every report of a full code, so a rejected code left in the
// boxes was a trap: retyping over it changes a full code on every keystroke, and each half-corrected
// code (199999, 129999, 123999 ...) went to POST /auth/verify-otp on its own. In production the
// first one disables the boxes, the rest of the typing is lost, and the OTP rate limit (10 per 15
// minutes) is spent on codes nobody meant to send. So a definite rejection EMPTIES the boxes and puts
// focus back on the first one; the error message stays up until the next attempt starts (the page's
// own clearing rule: `verify` resets it), and nothing is sent until a whole new code is typed.
describe('VerifyEmailPage — a rejected code', () => {
  beforeEach(() => {
    mockNavigate.mockReset();
    mockedPost.mockReset();
    tokenAccessor.clear();
    sessionStorage.clear();
    useAuthStore.setState({ user: null, isAuthenticated: false, isBootstrapping: false });
  });

  it('empties every box and focuses the first one, and the error message stays visible', async () => {
    mockedPost.mockRejectedValueOnce(rejectedCode);
    renderVerify();

    await enterOtp('999999');

    const alert = await screen.findByRole('alert');
    expect(alert).toHaveTextContent("That code didn't work");
    await waitFor(() => expect(screen.getByLabelText('Digit 1 of 6')).toHaveFocus());
    expect(otpValue()).toBe('');
    for (const box of otpBoxes()) {
      expect(box).toBeEnabled();
      expect(box).toHaveAttribute('aria-invalid', 'true');
    }
    // Screen readers: the alert is announced as it appears, the group still names itself and is
    // described by that same alert, and the focused box keeps its own label.
    expect(screen.getByRole('group', { name: '6-digit code' })).toHaveAttribute(
      'aria-describedby',
      alert.id
    );
    expect(screen.getByRole('textbox', { name: 'Digit 1 of 6' })).toHaveFocus();
    expect(mockNavigate).not.toHaveBeenCalled();
  });

  it('sends nothing while the new code is incomplete, then exactly one request with the new code', async () => {
    mockAuthEndpoints();
    mockedPost.mockRejectedValueOnce(rejectedCode);
    renderVerify();

    const user = await enterOtp('999999');
    await screen.findByRole('alert');
    await waitFor(() => expect(screen.getByLabelText('Digit 1 of 6')).toHaveFocus());

    // Type the new code straight away: focus is already on box 1, no click needed.
    await user.keyboard('123');
    expect(otpValue()).toBe('123');
    expect(verifyCodes()).toEqual(['999999']);
    // The message is not taken down by typing; the next attempt (below) is what replaces it.
    expect(screen.getByRole('alert')).toHaveTextContent("That code didn't work");

    await user.keyboard('456');
    await waitFor(() => expect(mockNavigate).toHaveBeenCalledWith('/circles', { replace: true }));
    expect(verifyCodes()).toEqual(['999999', '123456']);
    expect(mockedPost).toHaveBeenCalledWith('/auth/verify-otp', {
      email: 'pat@example.com',
      otp: '123456',
    });
  });

  it('retyping a different code in one go sends that code once (no half-corrected codes)', async () => {
    // The probe that found this: 123456 typed over a rejected 999999 sent 199999, 129999, 123999,
    // 123499, 123459 and 123456.
    mockAuthEndpoints();
    mockedPost.mockRejectedValueOnce(rejectedCode);
    renderVerify();

    const user = await enterOtp('999999');
    await screen.findByRole('alert');
    await waitFor(() => expect(screen.getByLabelText('Digit 1 of 6')).toBeEnabled());

    // Click the first box (the person's own habit) and type the whole new code.
    await user.click(screen.getByLabelText('Digit 1 of 6'));
    await user.keyboard('123456');

    await waitFor(() => expect(mockNavigate).toHaveBeenCalledWith('/circles', { replace: true }));
    expect(verifyCodes()).toEqual(['999999', '123456']);
  });

  it('clears and refocuses again when the second code is rejected too', async () => {
    mockAuthEndpoints();
    mockedPost.mockRejectedValueOnce(rejectedCode).mockRejectedValueOnce(rejectedCode);
    renderVerify();

    const user = await enterOtp('999999');
    await screen.findByRole('alert');
    await waitFor(() => expect(screen.getByLabelText('Digit 1 of 6')).toHaveFocus());

    await user.keyboard('888888');
    await waitFor(() => expect(verifyCodes()).toEqual(['999999', '888888']));
    // The message went away when the second attempt began and is back for its rejection.
    expect(await screen.findByRole('alert')).toHaveTextContent("That code didn't work");
    await waitFor(() => expect(screen.getByLabelText('Digit 1 of 6')).toHaveFocus());
    expect(otpValue()).toBe('');

    await user.keyboard('123456');
    await waitFor(() => expect(mockNavigate).toHaveBeenCalledWith('/circles', { replace: true }));
    expect(verifyCodes()).toEqual(['999999', '888888', '123456']);
  });

  it('a manual Verify press on a rejected code clears the boxes the same way', async () => {
    // No email in router state: the code is not auto-submitted, the button is the way in.
    mockedPost.mockRejectedValueOnce(rejectedCode);
    const user = userEvent.setup();
    render(
      <MemoryRouter initialEntries={[{ pathname: '/verify-email' }]}>
        <VerifyEmailPage />
      </MemoryRouter>
    );

    await user.type(screen.getByLabelText(/^email/i), 'pat@example.com');
    await user.click(screen.getByLabelText('Digit 1 of 6'));
    await user.keyboard('999999');
    expect(mockedPost).not.toHaveBeenCalled();
    await user.click(screen.getByRole('button', { name: 'Verify email' }));

    expect(await screen.findByRole('alert')).toHaveTextContent("That code didn't work");
    await waitFor(() => expect(screen.getByLabelText('Digit 1 of 6')).toHaveFocus());
    expect(otpValue()).toBe('');
    expect(verifyCodes()).toEqual(['999999']);
  });

  // The server did NOT say the code is wrong: nothing reached it, it fell over, or it refused to
  // look. The code the person typed may be perfectly good, so it stays, and Verify sends it again
  // without any retyping. (The page words every failure after a code with the same message; only a
  // 429 gets its own. What differs is what happens to the boxes.)
  const kept: [string, unknown][] = [
    ['a network failure (no response)', networkError()],
    ['a timeout', Object.assign(new Error('timeout of 30000ms exceeded'), { name: 'AxiosError', code: 'ECONNABORTED' })],
    ['a 5xx the backend named', { success: false, error: { code: 'SERVER_ERROR', message: 'Internal server error' } }],
    ['a 502 with an empty body', Object.assign(new Error('Request failed with status code 502'), { name: 'AxiosError', response: { status: 502, data: '' } })],
    ['an edge error page (HTML body)', '<html><body>502 Bad Gateway</body></html>'],
    ['a rate limit', { success: false, error: { code: 'RATE_LIMIT', message: 'Too many requests' } }],
  ];

  it.each(kept)('keeps the typed code after %s, and Verify retries it', async (_name, failure) => {
    mockAuthEndpoints();
    mockedPost.mockRejectedValueOnce(failure);
    renderVerify();

    const user = await enterOtp('123456');

    expect(await screen.findByRole('alert')).toBeInTheDocument();
    expect(otpValue()).toBe('123456');
    for (const box of otpBoxes()) expect(box).toBeEnabled();
    expect(verifyCodes()).toEqual(['123456']);

    // Retry: the Verify button, nothing retyped.
    await user.click(screen.getByRole('button', { name: 'Verify email' }));
    await waitFor(() => expect(mockNavigate).toHaveBeenCalledWith('/circles', { replace: true }));
    expect(verifyCodes()).toEqual(['123456', '123456']);
  });
});

// RESEND CODE. A resend invalidates the code in the boxes, so a SUCCESSFUL one empties them and puts
// focus on the first (mobile does the same). Left full, the stale code is a trap exactly like a
// rejected one: the page submits on every report of a full code, so typing the new code over it
// changes a full code on every keystroke and sends each half-corrected code. A FAILED resend sent
// nothing new, so the person's code is left as it is, and the page's own resend error / cooldown
// handling is untouched.
describe('VerifyEmailPage — Resend code', () => {
  beforeEach(() => {
    mockNavigate.mockReset();
    mockedPost.mockReset();
    tokenAccessor.clear();
    sessionStorage.clear();
    useAuthStore.setState({ user: null, isAuthenticated: false, isBootstrapping: false });
  });

  const resendOk = { success: true, data: { message: 'Verification code sent.' } };
  const resendButton = () => screen.getByRole('button', { name: /^Send a new code/ });

  /** verify-otp and the session exchange succeed; resend-otp answers with `resend`. */
  function mockWithResend(resend: () => Promise<unknown>) {
    mockedPost.mockImplementation(((url: string) => {
      if (url === '/auth/verify-otp') return Promise.resolve(verifyOtpEnvelope);
      if (url === '/auth/oauth-session') return Promise.resolve(sessionEnvelope);
      if (url === '/auth/resend-otp') return resend();
      return Promise.reject(new Error(`unexpected POST ${url}`));
    }) as never);
  }

  /** A full code left in the boxes by a network failure (the page keeps it). */
  async function keptFullCode(code: string) {
    mockedPost.mockRejectedValueOnce(networkError());
    const user = await enterOtp(code);
    expect(await screen.findByRole('alert')).toBeInTheDocument();
    expect(otpValue()).toBe(code);
    await waitFor(() => expect(screen.getByLabelText('Digit 1 of 6')).toBeEnabled());
    return user;
  }

  it('a successful Resend empties every box and focuses the first one', async () => {
    mockWithResend(() => Promise.resolve(resendOk));
    renderVerify();
    const user = await keptFullCode('123456');

    await user.click(resendButton());

    expect(await screen.findByRole('status')).toHaveTextContent(
      'A new verification code has been sent to your email.'
    );
    expect(otpValue()).toBe('');
    expect(screen.getByLabelText('Digit 1 of 6')).toHaveFocus();
    expect(screen.getByRole('textbox', { name: 'Digit 1 of 6' })).toHaveFocus();
    expect(mockedPost).toHaveBeenCalledWith('/auth/resend-otp', { email: 'pat@example.com' });
    // The cooldown is armed as before.
    expect(screen.getByRole('button', { name: /^Send a new code in \d+s$/ })).toBeDisabled();
  });

  it('a partly typed code is emptied by a successful Resend too', async () => {
    mockWithResend(() => Promise.resolve(resendOk));
    renderVerify();
    const user = userEvent.setup();
    await user.click(screen.getByLabelText('Digit 1 of 6'));
    await user.keyboard('123');
    expect(otpValue()).toBe('123');

    await user.click(resendButton());

    await waitFor(() => expect(otpValue()).toBe(''));
    expect(screen.getByLabelText('Digit 1 of 6')).toHaveFocus();
  });

  it('after a Resend, typing a different code over the stale one sends only the new code', async () => {
    // The cascade: with the stale 123456 still in the boxes, 654321 typed over it sent 623456,
    // 653456 ... one request per keystroke.
    mockWithResend(() => Promise.resolve(resendOk));
    renderVerify();
    const user = await keptFullCode('123456');

    await user.click(resendButton());
    await waitFor(() => expect(screen.getByRole('status')).toBeInTheDocument());

    // Click the first box (the person's own habit) and type the whole new code.
    await user.click(screen.getByLabelText('Digit 1 of 6'));
    await user.keyboard('654321');

    await waitFor(() => expect(mockNavigate).toHaveBeenCalledWith('/circles', { replace: true }));
    expect(verifyCodes()).toEqual(['123456', '654321']);
  });

  it('after a Resend, the new code typed straight away (no click) is sent once', async () => {
    mockWithResend(() => Promise.resolve(resendOk));
    renderVerify();
    const user = await keptFullCode('123456');

    await user.click(resendButton());
    await waitFor(() => expect(screen.getByLabelText('Digit 1 of 6')).toHaveFocus());
    await user.keyboard('654321');

    await waitFor(() => expect(mockNavigate).toHaveBeenCalledWith('/circles', { replace: true }));
    expect(verifyCodes()).toEqual(['123456', '654321']);
  });

  // The page's existing resend error handling (a 429 from our limiter says wait; anything else is
  // "couldn't resend") is unchanged, and none of it costs the person their code.
  const resendFails: [string, unknown, string][] = [
    ['a network failure', networkError(), "We couldn't resend the code. Please try again."],
    [
      'our own rate limit (RATE_LIMIT)',
      { success: false, error: { code: 'RATE_LIMIT', message: 'Too many requests' } },
      'Too many attempts. Please wait a few minutes before trying again.',
    ],
  ];

  it.each(resendFails)('%s leaves the typed code in the boxes', async (_name, failure, message) => {
    mockWithResend(() => Promise.reject(failure));
    renderVerify();
    const user = await keptFullCode('123456');

    await user.click(resendButton());

    expect(await screen.findByRole('alert')).toHaveTextContent(message);
    expect(otpValue()).toBe('123456');
    // No cooldown was armed, so Resend is still there to press again.
    expect(screen.getByRole('button', { name: 'Send a new code' })).toBeEnabled();
    expect(verifyCodes()).toEqual(['123456']);
  });
});

// "Have a verification code?" / signup-with-an-unverified-address arrivals, the expiry hint, and
// the visible cooldown when the mail provider's per-address send window is open.
describe('VerifyEmailPage — notices, hint and cooldown', () => {
  beforeEach(() => {
    mockNavigate.mockReset();
    mockedPost.mockReset();
    tokenAccessor.clear();
    sessionStorage.clear();
    useAuthStore.setState({ user: null, isAuthenticated: false, isBootstrapping: false });
  });

  function renderWithState(state: Record<string, unknown>) {
    return render(
      <MemoryRouter initialEntries={[{ pathname: '/verify-email', state }]}>
        <VerifyEmailPage />
      </MemoryRouter>
    );
  }

  it('always shows the expiry hint', () => {
    renderVerify();
    expect(screen.getByText('Codes expire — use the newest email.')).toBeInTheDocument();
  });

  it('a plain arrival (signup) shows no notice and offers the new-code action immediately', () => {
    renderVerify();
    expect(screen.queryByRole('status')).toBeNull();
    expect(screen.getByRole('button', { name: 'Send a new code' })).toBeEnabled();
  });

  it("notice 'sent' shows the neutral copy and starts behind the cooldown", () => {
    renderWithState({ email: 'pat@example.com', notice: 'sent' });
    expect(screen.getByRole('status')).toHaveTextContent(
      "If that email has an account waiting for verification, we've sent a new code."
    );
    expect(screen.getByRole('button', { name: /^Send a new code in \d+s$/ })).toBeDisabled();
  });

  it("notice 'rateLimited' shows the \"we just sent one\" copy and starts behind the cooldown", () => {
    renderWithState({ email: 'pat@example.com', notice: 'rateLimited' });
    expect(screen.getByRole('status')).toHaveTextContent(
      'We just sent one — check your inbox (and spam). You can request another in a minute.'
    );
    expect(screen.getByRole('button', { name: /^Send a new code in \d+s$/ })).toBeDisabled();
  });

  it('a resend that hits EMAIL_RATE_LIMIT says so, arms the cooldown, and shows no error alert', async () => {
    mockedPost.mockRejectedValueOnce({
      success: false,
      error: { code: 'EMAIL_RATE_LIMIT', message: 'Wait 60 seconds' },
    });
    renderVerify();
    const user = userEvent.setup();
    await user.click(screen.getByRole('button', { name: 'Send a new code' }));
    expect(await screen.findByRole('status')).toHaveTextContent('We just sent one');
    expect(screen.queryByRole('alert')).toBeNull();
    expect(screen.getByRole('button', { name: /^Send a new code in \d+s$/ })).toBeDisabled();
  });
});

// Regression — double submit on Resend. /auth/resend-otp sits on the
// 10-per-15-minutes `otpRateLimit` bucket and mails a real code that
// invalidates the previous one, so a double fire both spends a limiter slot
// and can leave the user typing a code that is already dead. `isResending`
// and `cooldown` are both STATE — neither can reject a second click dispatched
// before React commits the first one's render.
//
// `verify` is deliberately NOT covered here: `submittedRef` was already a
// synchronous ref checked on its first line (the same idiom), and
// "auto-submits once when the code completes" above exercises it.
describe('VerifyEmailPage — double-submit guard', () => {
  beforeEach(() => {
    mockNavigate.mockReset();
    mockedPost.mockReset();
    tokenAccessor.clear();
    sessionStorage.clear();
    useAuthStore.setState({ user: null, isAuthenticated: false, isBootstrapping: false });
  });

  it('resends exactly ONE code when Resend is pressed twice in the same tick', async () => {
    mockedPost.mockImplementation((() => neverSettles()) as never);
    renderVerify();

    await clickTwice(screen.getByRole('button', { name: 'Send a new code' }));

    expect(mockedPost).toHaveBeenCalledTimes(1);
    expect(mockedPost).toHaveBeenCalledWith('/auth/resend-otp', { email: 'pat@example.com' });
  });
});
