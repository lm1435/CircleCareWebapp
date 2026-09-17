import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import '@/i18n';
import ForgotPasswordPage from '@/pages/ForgotPasswordPage';
import { apiClient } from '@/lib/api';
import { clickTwice, neverSettles, submitFormTwice } from '@/test/doubleSubmit';

// ForgotPasswordPage — request a password-reset OTP. The backend always
// returns success (no account enumeration), so the "sent" state renders
// regardless of whether the account exists.

const mockNavigate = vi.fn();
vi.mock('react-router-dom', async () => {
  const actual = await vi.importActual<typeof import('react-router-dom')>('react-router-dom');
  return { ...actual, useNavigate: () => mockNavigate };
});

const mockedPost = vi.mocked(apiClient.post);

function renderPage() {
  return render(
    <MemoryRouter initialEntries={['/forgot-password']}>
      <ForgotPasswordPage />
    </MemoryRouter>
  );
}

describe('ForgotPasswordPage', () => {
  beforeEach(() => {
    mockNavigate.mockReset();
    mockedPost.mockReset();
  });

  it('validates locally and never calls the API with an empty form', async () => {
    const user = userEvent.setup();
    renderPage();

    await user.click(screen.getByRole('button', { name: 'Send reset code' }));

    expect(await screen.findByText('Email is required.')).toBeInTheDocument();
    expect(mockedPost).not.toHaveBeenCalled();
  });

  it('sends the reset code and shows the check-your-email terminal state', async () => {
    mockedPost.mockResolvedValueOnce({ success: true, data: { message: 'sent' } } as never);
    const user = userEvent.setup();
    renderPage();

    await user.type(screen.getByLabelText(/^Email/), 'pat@example.com');
    await user.click(screen.getByRole('button', { name: 'Send reset code' }));

    expect(mockedPost).toHaveBeenCalledWith('/auth/forgot-password', {
      email: 'pat@example.com',
    });
    expect(
      await screen.findByRole('heading', { level: 1, name: 'Check your email' })
    ).toBeInTheDocument();
    expect(
      screen.getByRole('button', { name: 'Enter reset code' })
    ).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Resend code' })).toBeInTheDocument();
  });

  it('routes to reset-password with the email in router state', async () => {
    mockedPost.mockResolvedValueOnce({ success: true, data: { message: 'sent' } } as never);
    const user = userEvent.setup();
    renderPage();

    await user.type(screen.getByLabelText(/^Email/), 'pat@example.com');
    await user.click(screen.getByRole('button', { name: 'Send reset code' }));
    await screen.findByRole('heading', { level: 1, name: 'Check your email' });

    await user.click(screen.getByRole('button', { name: 'Enter reset code' }));

    expect(mockNavigate).toHaveBeenCalledWith('/reset-password', {
      state: { email: 'pat@example.com' },
    });
  });

  it('shows an inline alert when the send fails', async () => {
    mockedPost.mockRejectedValueOnce(new Error('network'));
    const user = userEvent.setup();
    renderPage();

    await user.type(screen.getByLabelText(/^Email/), 'pat@example.com');
    await user.click(screen.getByRole('button', { name: 'Send reset code' }));

    expect(await screen.findByRole('alert')).toHaveTextContent(
      "We couldn't send the reset code. Please try again."
    );
  });

  it('tells a rate-limited (429 RATE_LIMIT) user to WAIT, never "Please try again"', async () => {
    mockedPost.mockRejectedValueOnce({
      success: false,
      error: { code: 'RATE_LIMIT', message: 'Too many authentication attempts, please try again later' },
    });
    const user = userEvent.setup();
    renderPage();

    await user.type(screen.getByLabelText(/^Email/), 'pat@example.com');
    await user.click(screen.getByRole('button', { name: 'Send reset code' }));

    const alert = await screen.findByRole('alert');
    expect(alert).toHaveTextContent(
      'Too many attempts. Please wait a few minutes before trying again.'
    );
    expect(alert).not.toHaveTextContent("We couldn't send the reset code. Please try again.");
  });

  it('resends the code from the sent state without leaving the page', async () => {
    mockedPost.mockResolvedValue({ success: true, data: { message: 'sent' } } as never);
    const user = userEvent.setup();
    renderPage();

    await user.type(screen.getByLabelText(/^Email/), 'pat@example.com');
    await user.click(screen.getByRole('button', { name: 'Send reset code' }));
    await screen.findByRole('heading', { level: 1, name: 'Check your email' });

    await user.click(screen.getByRole('button', { name: 'Resend code' }));

    await waitFor(() => expect(mockedPost).toHaveBeenCalledTimes(2));
    expect(
      screen.getByRole('heading', { level: 1, name: 'Check your email' })
    ).toBeInTheDocument();
  });

  it('shows an inline alert on the sent view when a resend fails', async () => {
    mockedPost
      .mockResolvedValueOnce({ success: true, data: { message: 'sent' } } as never)
      .mockRejectedValueOnce(new Error('network'));
    const user = userEvent.setup();
    renderPage();

    await user.type(screen.getByLabelText(/^Email/), 'pat@example.com');
    await user.click(screen.getByRole('button', { name: 'Send reset code' }));
    await screen.findByRole('heading', { level: 1, name: 'Check your email' });

    await user.click(screen.getByRole('button', { name: 'Resend code' }));

    expect(await screen.findByRole('alert')).toHaveTextContent(
      "We couldn't send the reset code. Please try again."
    );
    // Still on the sent view — a resend failure doesn't kick the user back
    // to the form.
    expect(
      screen.getByRole('heading', { level: 1, name: 'Check your email' })
    ).toBeInTheDocument();
  });

  it('clears a stale resend-failure alert when going back to the form', async () => {
    mockedPost
      .mockResolvedValueOnce({ success: true, data: { message: 'sent' } } as never)
      .mockRejectedValueOnce(new Error('network'));
    const user = userEvent.setup();
    renderPage();

    await user.type(screen.getByLabelText(/^Email/), 'pat@example.com');
    await user.click(screen.getByRole('button', { name: 'Send reset code' }));
    await screen.findByRole('heading', { level: 1, name: 'Check your email' });

    await user.click(screen.getByRole('button', { name: 'Resend code' }));
    await screen.findByRole('alert');

    await user.click(screen.getByRole('button', { name: 'Back' }));

    expect(
      await screen.findByRole('heading', { level: 1, name: 'Forgot password?' })
    ).toBeInTheDocument();
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  });
});

// Regression — double submit. /auth/forgot-password sits on the
// 5-per-5-minutes `authRateLimit` bucket AND mails a real code, so a double
// fire spends a limiter slot and sends a second code that invalidates the
// first one the user is already reading.
describe('ForgotPasswordPage — double-submit guard', () => {
  beforeEach(() => {
    mockNavigate.mockReset();
    mockedPost.mockReset();
  });

  it('sends exactly ONE reset code when the form is submitted twice in the same tick', async () => {
    mockedPost.mockImplementation((() => neverSettles()) as never);
    const user = userEvent.setup();
    const { container } = renderPage();

    await user.type(screen.getByLabelText(/^Email/), 'pat@example.com');
    await submitFormTwice(container.querySelector('form') as HTMLFormElement);

    expect(mockedPost).toHaveBeenCalledTimes(1);
  });

  it('is still submittable after a validation failure (the guard releases, it does not latch)', async () => {
    const user = userEvent.setup();
    const { container } = renderPage();

    await submitFormTwice(container.querySelector('form') as HTMLFormElement);
    expect(mockedPost).not.toHaveBeenCalled();
    expect(await screen.findByText('Email is required.')).toBeInTheDocument();

    mockedPost.mockImplementation((() => neverSettles()) as never);
    await user.type(screen.getByLabelText(/^Email/), 'pat@example.com');
    await user.click(screen.getByRole('button', { name: 'Send reset code' }));

    await waitFor(() => expect(mockedPost).toHaveBeenCalledTimes(1));
  });

  it('resends exactly ONE code when Resend is pressed twice in the same tick', async () => {
    mockedPost.mockResolvedValueOnce({ success: true, data: { message: 'sent' } } as never);
    const user = userEvent.setup();
    renderPage();

    await user.type(screen.getByLabelText(/^Email/), 'pat@example.com');
    await user.click(screen.getByRole('button', { name: 'Send reset code' }));
    await screen.findByRole('heading', { level: 1, name: 'Check your email' });

    // Resend lives on the terminal state and carries its own guard — the send
    // that got us here must not have latched it.
    mockedPost.mockReset();
    mockedPost.mockImplementation((() => neverSettles()) as never);
    await clickTwice(screen.getByRole('button', { name: 'Resend code' }));

    expect(mockedPost).toHaveBeenCalledTimes(1);
  });
});
