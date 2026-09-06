import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import '@/i18n';
import ResetPasswordPage from '@/pages/ResetPasswordPage';
import { apiClient } from '@/lib/api';

// ResetPasswordPage — reset with the emailed 6-digit recovery OTP. Email
// arrives via router state from ForgotPasswordPage (never via query params);
// without it the page shows the "request a new code" recovery state.

const mockNavigate = vi.fn();
vi.mock('react-router-dom', async () => {
  const actual = await vi.importActual<typeof import('react-router-dom')>('react-router-dom');
  return { ...actual, useNavigate: () => mockNavigate };
});

const mockedPost = vi.mocked(apiClient.post);

function renderWithEmail(email = 'pat@example.com') {
  return render(
    <MemoryRouter initialEntries={[{ pathname: '/reset-password', state: { email } }]}>
      <ResetPasswordPage />
    </MemoryRouter>
  );
}

async function enterOtp(code = '123456') {
  const user = userEvent.setup();
  const firstBox = screen.getByLabelText('Digit 1 of 6');
  await user.click(firstBox);
  await user.paste(code);
  return user;
}

describe('ResetPasswordPage', () => {
  beforeEach(() => {
    mockNavigate.mockReset();
    mockedPost.mockReset();
  });

  it('shows the recovery state (no back-and-forth) when there is no email in router state', () => {
    render(
      <MemoryRouter initialEntries={['/reset-password']}>
        <ResetPasswordPage />
      </MemoryRouter>
    );

    expect(
      screen.getByRole('heading', { level: 1, name: "Let's start fresh" })
    ).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Request a new code' })).toBeInTheDocument();
  });

  it('resets the password and shows the success terminal state', async () => {
    mockedPost.mockResolvedValueOnce({ success: true, data: { message: 'ok' } } as never);
    renderWithEmail();

    await enterOtp();
    const user = userEvent.setup();
    await user.type(screen.getByLabelText(/^New Password/), 'Secret#123');
    await user.type(screen.getByLabelText(/^Confirm Password/), 'Secret#123');
    await user.click(screen.getByRole('button', { name: 'Reset password' }));

    expect(
      await screen.findByRole('heading', { level: 1, name: 'Password reset' })
    ).toBeInTheDocument();
    expect(mockedPost).toHaveBeenCalledWith('/auth/reset-password', {
      email: 'pat@example.com',
      otp: '123456',
      new_password: 'Secret#123',
    });

    await user.click(screen.getByRole('button', { name: 'Sign In' }));
    expect(mockNavigate).toHaveBeenCalledWith('/login', { replace: true });
  });

  it('shows an inline alert when the code is rejected', async () => {
    mockedPost.mockRejectedValueOnce({
      success: false,
      error: { code: 'INVALID_CODE' },
    });
    renderWithEmail();

    await enterOtp();
    const user = userEvent.setup();
    await user.type(screen.getByLabelText(/^New Password/), 'Secret#123');
    await user.type(screen.getByLabelText(/^Confirm Password/), 'Secret#123');
    await user.click(screen.getByRole('button', { name: 'Reset password' }));

    expect(await screen.findByRole('alert')).toHaveTextContent(
      "That code didn't work — it may have expired. Double-check it, or request a new one below."
    );
  });

  // WCAG 3.3.1: an incomplete-OTP error must move focus, not just render text
  // that a screen-reader user submitting blind would never encounter.
  it('focuses the first OTP box when submitted with an incomplete code', async () => {
    const user = userEvent.setup();
    renderWithEmail();

    await user.click(screen.getByRole('button', { name: 'Reset password' }));

    expect(screen.getByLabelText('Digit 1 of 6')).toHaveFocus();
  });

  it('validates the password confirmation locally', async () => {
    renderWithEmail();
    await enterOtp();
    const user = userEvent.setup();
    await user.type(screen.getByLabelText(/^New Password/), 'Secret#123');
    await user.type(screen.getByLabelText(/^Confirm Password/), 'Different#123');
    await user.click(screen.getByRole('button', { name: 'Reset password' }));

    expect(await screen.findByText("Passwords don't match.")).toBeInTheDocument();
    expect(mockedPost).not.toHaveBeenCalled();
  });

  // GoTrue rejects passwords over 72 UTF-8 BYTES (bcrypt's cap, not a
  // character count) — 72 chars → 200, 73 chars → 400, and a 72-JS-char/
  // 140-byte accented password → 400 (verified against the local stack). A
  // client that admits either case fails at the server with an opaque error.
  it('rejects a 73-character password (over the 72-byte server cap)', async () => {
    renderWithEmail();
    await enterOtp();
    const user = userEvent.setup();
    const password = 'Aa1!' + 'x'.repeat(73 - 4);
    expect(password).toHaveLength(73);
    await user.type(screen.getByLabelText(/^New Password/), password);
    await user.type(screen.getByLabelText(/^Confirm Password/), password);
    await user.click(screen.getByRole('button', { name: 'Reset password' }));

    expect(
      await screen.findByText('Password must be 72 characters or fewer.')
    ).toBeInTheDocument();
    expect(mockedPost).not.toHaveBeenCalled();
  });

  it('rejects a 72-character password that is over 72 UTF-8 bytes (accented)', async () => {
    renderWithEmail();
    await enterOtp();
    const user = userEvent.setup();
    // 'Aa1!' (4 ASCII bytes) + 68 'é' (2 bytes each) = 72 chars, 140 bytes.
    const password = 'Aa1!' + 'é'.repeat(68);
    expect(password).toHaveLength(72);
    await user.type(screen.getByLabelText(/^New Password/), password);
    await user.type(screen.getByLabelText(/^Confirm Password/), password);
    await user.click(screen.getByRole('button', { name: 'Reset password' }));

    expect(
      await screen.findByText('Password must be 72 characters or fewer.')
    ).toBeInTheDocument();
    expect(mockedPost).not.toHaveBeenCalled();
  });

  it('accepts a 72-character ASCII password (exactly at the server cap)', async () => {
    mockedPost.mockResolvedValueOnce({ success: true, data: { message: 'reset' } } as never);
    renderWithEmail();
    await enterOtp();
    const user = userEvent.setup();
    const password = 'Aa1!' + 'x'.repeat(72 - 4);
    expect(password).toHaveLength(72);
    await user.type(screen.getByLabelText(/^New Password/), password);
    await user.type(screen.getByLabelText(/^Confirm Password/), password);
    await user.click(screen.getByRole('button', { name: 'Reset password' }));

    await vi.waitFor(() => expect(mockedPost).toHaveBeenCalled());
  });
});
