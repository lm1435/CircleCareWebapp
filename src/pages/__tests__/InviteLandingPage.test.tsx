import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { HelmetProvider } from 'react-helmet-async';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import '@/i18n';
import { apiClient } from '@/lib/api';
import InviteLandingPage from '@/pages/InviteLandingPage';

// @/lib/api is mocked globally in src/test/setup.ts. The real apiClient's
// response interceptor unwraps to the `{ success, data, error }` envelope,
// so the mock resolves with the envelope directly.
const mockedPost = vi.mocked(apiClient.post);

const validEnvelope = {
  success: true,
  data: {
    invite: {
      member_type: 'caregiver',
      circle: {
        name: "Rose's Care Team",
        recipient_name: 'Rose',
      },
      invited_by_name: 'Sarah',
      expires_at: '2026-07-01T00:00:00.000Z',
    },
  },
};

function renderPage(code = 'ABC123') {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  return render(
    <HelmetProvider>
      <QueryClientProvider client={queryClient}>
        <MemoryRouter initialEntries={[`/invite/${code}`]}>
          <Routes>
            <Route path="/invite/:code" element={<InviteLandingPage />} />
          </Routes>
        </MemoryRouter>
      </QueryClientProvider>
    </HelmetProvider>
  );
}

describe('InviteLandingPage', () => {
  beforeEach(() => {
    mockedPost.mockReset();
  });

  it('shows a loading skeleton while the preview request is pending', () => {
    mockedPost.mockReturnValue(new Promise(() => {})); // never resolves
    renderPage();

    expect(screen.getByRole('status')).toHaveTextContent('Loading your invitation');
    expect(screen.queryByRole('heading', { level: 1 })).not.toBeInTheDocument();
  });

  it('calls the public preview endpoint with an empty body', async () => {
    mockedPost.mockResolvedValue(validEnvelope);
    renderPage('abc123');

    await waitFor(() => {
      expect(mockedPost).toHaveBeenCalledWith('/invites/code/abc123/preview', {});
    });
  });

  it('renders inviter, care recipient, circle name, and role for a valid invite', async () => {
    mockedPost.mockResolvedValue(validEnvelope);
    renderPage();

    expect(
      await screen.findByRole('heading', {
        level: 1,
        name: 'Sarah invited you to help care for Rose',
      })
    ).toBeInTheDocument();
    expect(screen.getByText("Rose's Care Team")).toBeInTheDocument();
    expect(screen.getByText('Caregiver')).toBeInTheDocument();
    // Invite code fallback (normalized uppercase)
    expect(screen.getByText('ABC123')).toBeInTheDocument();
    // Download buttons present
    expect(screen.getByRole('link', { name: 'Download on the App Store' })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Get it on Google Play' })).toBeInTheDocument();
  });

  it('renders the care recipient role badge', async () => {
    mockedPost.mockResolvedValue({
      success: true,
      data: {
        invite: { ...validEnvelope.data.invite, member_type: 'care_recipient' },
      },
    });
    renderPage();

    expect(await screen.findByText('Care Recipient')).toBeInTheDocument();
  });

  it('shows the warm error state with download buttons for an invalid invite', async () => {
    mockedPost.mockRejectedValue({
      success: false,
      error: { code: 'INVALID_CODE', message: 'Invalid invite code' },
    });
    renderPage();

    expect(
      await screen.findByRole('heading', {
        level: 1,
        name: 'This invite has expired or is invalid',
      })
    ).toBeInTheDocument();
    expect(screen.getByText(/send you a new invite/i)).toBeInTheDocument();
    // Download buttons still shown on the error state
    expect(screen.getByRole('link', { name: 'Download on the App Store' })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Get it on Google Play' })).toBeInTheDocument();
  });

  it('shows the error state for an expired invite', async () => {
    mockedPost.mockRejectedValue({
      success: false,
      error: { code: 'INVITE_EXPIRED', message: 'This invite has expired' },
    });
    renderPage();

    expect(
      await screen.findByRole('heading', {
        level: 1,
        name: 'This invite has expired or is invalid',
      })
    ).toBeInTheDocument();
  });

  it('copies the invite code to the clipboard and announces success', async () => {
    // fireEvent (not userEvent) — userEvent.setup() installs its own
    // clipboard stub that would shadow this mock.
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, 'clipboard', {
      value: { writeText },
      configurable: true,
    });

    mockedPost.mockResolvedValue(validEnvelope);
    renderPage('abc123');

    const copyButton = await screen.findByRole('button', { name: 'Copy invite code' });
    fireEvent.click(copyButton);

    await waitFor(() => expect(writeText).toHaveBeenCalledWith('ABC123'));
    // Button reflects the copied state and the aria-live region announces it
    expect(await screen.findByRole('button', { name: 'Copied' })).toBeInTheDocument();
    expect(screen.getByText('Invite code copied to clipboard')).toBeInTheDocument();
  });
});
