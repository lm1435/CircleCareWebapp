import { cleanup, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import '@/i18n';
import VerifyRequestPage from '@/pages/VerifyRequestPage';
import { apiClient } from '@/lib/api';
import { neverSettles, submitFormTwice } from '@/test/doubleSubmit';

// VerifyRequestPage — the email step of "Have a verification code?". Mobile twin:
// src/__tests__/screens/auth/VerifyRequestFlow.test.tsx. `@/lib/api` is mocked by
// the global setup.

const mockNavigate = vi.fn();
vi.mock('react-router-dom', async () => {
  const actual = await vi.importActual<typeof import('react-router-dom')>('react-router-dom');
  return { ...actual, useNavigate: () => mockNavigate };
});

const mockedPost = vi.mocked(apiClient.post);

function renderPage(state?: { email?: string }) {
  return render(
    <MemoryRouter initialEntries={[{ pathname: '/verify-email/start', state: state ?? null }]}>
      <VerifyRequestPage />
    </MemoryRouter>
  );
}

const emailField = () => screen.getByLabelText(/^Email/);
const sendButton = () => screen.getByRole('button', { name: 'Send a new code' });

async function submit(email: string) {
  renderPage();
  const user = userEvent.setup();
  await user.type(emailField(), email);
  await user.click(sendButton());
  return user;
}

describe('VerifyRequestPage', () => {
  beforeEach(() => {
    mockNavigate.mockReset();
    mockedPost.mockReset();
  });

  it('shows the heading, an email field and a send button', () => {
    renderPage();
    expect(screen.getByRole('heading', { name: 'Finish verifying your email' })).toBeInTheDocument();
    expect(emailField()).toBeInTheDocument();
    expect(sendButton()).toBeEnabled();
  });

  it('prefills the address passed in router state', () => {
    renderPage({ email: 'pat@example.com' });
    expect(emailField()).toHaveValue('pat@example.com');
  });

  it('rejects an empty and an invalid address without calling the API', async () => {
    const user = userEvent.setup();
    renderPage();
    await user.click(sendButton());
    expect(await screen.findByText('Email is required.')).toBeInTheDocument();
    await user.type(emailField(), 'nope');
    await user.click(sendButton());
    expect(await screen.findByText('Please enter a valid email address.')).toBeInTheDocument();
    expect(mockedPost).not.toHaveBeenCalled();
    expect(mockNavigate).not.toHaveBeenCalled();
  });

  it('success: sends a code and opens the code page with the address in STATE and the neutral notice', async () => {
    mockedPost.mockResolvedValueOnce({ success: true, data: { message: 'Verification code sent.' } });
    await submit('pat@example.com');
    await waitFor(() =>
      expect(mockNavigate).toHaveBeenCalledWith('/verify-email', {
        state: { email: 'pat@example.com', notice: 'sent' },
      })
    );
    expect(mockedPost).toHaveBeenCalledWith('/auth/resend-otp', { email: 'pat@example.com' });
  });

  it('an unknown/confirmed address gets the IDENTICAL outcome (no account enumeration)', async () => {
    // The backend answers 200 for those too — the page has no other signal.
    mockedPost.mockResolvedValue({ success: true, data: { message: 'Verification code sent.' } });
    await submit('known@example.com');
    await waitFor(() => expect(mockNavigate).toHaveBeenCalledTimes(1));
    const known = mockNavigate.mock.calls[0];
    mockNavigate.mockReset();
    cleanup();
    await submit('nobody@example.com');
    await waitFor(() => expect(mockNavigate).toHaveBeenCalledTimes(1));
    const unknown = mockNavigate.mock.calls[0];
    expect(unknown[0]).toBe(known[0]);
    expect(unknown[1].state.notice).toBe(known[1].state.notice);
  });

  it('EMAIL_RATE_LIMIT: opens the code page with the "we just sent one" notice, no error shown', async () => {
    mockedPost.mockRejectedValueOnce({
      success: false,
      error: { code: 'EMAIL_RATE_LIMIT', message: 'Wait a minute' },
    });
    await submit('pat@example.com');
    await waitFor(() =>
      expect(mockNavigate).toHaveBeenCalledWith('/verify-email', {
        state: { email: 'pat@example.com', notice: 'rateLimited' },
      })
    );
    expect(screen.queryByRole('alert')).toBeNull();
  });

  it('our own RATE_LIMIT stays put with the wait copy', async () => {
    mockedPost.mockRejectedValueOnce({
      success: false,
      error: { code: 'RATE_LIMIT', message: 'Too many requests' },
    });
    await submit('pat@example.com');
    expect(await screen.findByRole('alert')).toHaveTextContent('Too many attempts');
    expect(mockNavigate).not.toHaveBeenCalled();
  });

  it('any other failure is retryable and does not claim a code was sent', async () => {
    mockedPost.mockRejectedValueOnce({
      success: false,
      error: { code: 'RESEND_FAILED', message: 'Unable to resend' },
    });
    await submit('pat@example.com');
    expect(await screen.findByRole('alert')).toHaveTextContent(
      "We couldn't send a code. Please try again."
    );
    expect(mockNavigate).not.toHaveBeenCalled();
    expect(sendButton()).toBeEnabled();
  });

  it('a double submit in the same tick sends ONE request', async () => {
    mockedPost.mockImplementation((() => neverSettles()) as never);
    renderPage({ email: 'pat@example.com' });
    await submitFormTwice(screen.getByRole('button', { name: 'Send a new code' }).closest('form')!);
    expect(mockedPost).toHaveBeenCalledTimes(1);
  });
});
