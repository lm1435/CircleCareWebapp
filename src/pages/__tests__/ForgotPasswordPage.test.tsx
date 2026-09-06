import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import '@/i18n';
import ForgotPasswordPage from '@/pages/ForgotPasswordPage';
import { apiClient } from '@/lib/api';

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
