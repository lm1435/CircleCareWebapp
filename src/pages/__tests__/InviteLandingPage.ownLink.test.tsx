import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { HelmetProvider } from 'react-helmet-async';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { apiClient } from '@/lib/api';
import { consumePendingInviteCode, setPendingInviteCode } from '@/lib/pendingInviteCode';
import { ToastProvider } from '@/components/ui';
import InviteLandingPage from '@/pages/InviteLandingPage';

// THE INVITER'S OWN LINK (2026-10-17). A signed-in owner who opened the invite
// link they had just shared was offered "Accept invitation", and accepting it
// marked the invite used server-side — so the family member it was for got
// "already used". The page now asks the authenticated lookup who is looking
// (`viewer_relationship`) and shows the sender / an existing member a calm note
// and "Go to circle" instead of Accept.

const mockedPost = vi.mocked(apiClient.post);
const mockedGet = vi.mocked(apiClient.get);

const navigate = vi.fn();
vi.mock('react-router-dom', async (importOriginal) => {
  const actual = await importOriginal<typeof import('react-router-dom')>();
  return { ...actual, useNavigate: () => navigate };
});

let authState = { isAuthenticated: true, isBootstrapping: false };
vi.mock('@/hooks/useAuth', () => ({
  useAuth: () => authState,
}));

const acceptMutate = vi.fn();
vi.mock('@/hooks/useJoinCircle', () => ({
  useAcceptInviteByCode: () => ({ mutateAsync: acceptMutate, isPending: false }),
}));

const previewEnvelope = {
  success: true,
  data: {
    invite: {
      member_type: 'caregiver',
      circle: { name: "Rose's Care Team", recipient_name: 'Rose' },
      invited_by_name: 'Sarah',
      expires_at: '2026-12-01T00:00:00.000Z',
    },
  },
};

function lookupEnvelope(viewer_relationship?: string) {
  return {
    success: true,
    data: {
      invite: {
        id: 'inv-1',
        invite_code: 'ABC123',
        member_type: 'caregiver',
        circle: { id: 'circle-1', name: "Rose's Care Team", recipient_name: 'Rose' },
        invited_by: { email: 'sarah@example.com', first_name: 'Sarah', last_name: null },
        expires_at: '2026-12-01T00:00:00.000Z',
        ...(viewer_relationship ? { viewer_relationship } : {}),
      },
    },
  };
}

function renderPage(code = 'abc123') {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <HelmetProvider>
      <QueryClientProvider client={queryClient}>
        <ToastProvider>
          <MemoryRouter initialEntries={[`/invite/${code}`]}>
            <Routes>
              <Route path="/invite/:code" element={<InviteLandingPage />} />
            </Routes>
          </MemoryRouter>
        </ToastProvider>
      </QueryClientProvider>
    </HelmetProvider>
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  sessionStorage.clear();
  mockedPost.mockResolvedValue(previewEnvelope);
  acceptMutate.mockImplementation(() => new Promise(() => {}));
  authState = { isAuthenticated: true, isBootstrapping: false };
});

describe('InviteLandingPage — own / already-member invite link', () => {
  it('the SENDER sees "your own invite link", no Accept, and Go to circle opens the circle', async () => {
    mockedGet.mockResolvedValue(lookupEnvelope('inviter'));
    const user = userEvent.setup();
    renderPage();

    expect(
      await screen.findByRole('heading', { level: 1, name: 'This is your own invite link' })
    ).toBeInTheDocument();
    expect(
      screen.getByText(
        "Share it with the person you're inviting. When they open it, they can join your circle."
      )
    ).toBeInTheDocument();
    // Not "Sarah invited you to help care for Rose" — they are the one inviting.
    expect(screen.queryByText(/invited you/)).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Accept invitation' })).not.toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'Go to circle' }));
    expect(navigate).toHaveBeenCalledWith('/circles/circle-1');
    expect(acceptMutate).not.toHaveBeenCalled();
    expect(mockedGet).toHaveBeenCalledWith('/invites/code/ABC123');
  });

  it('an existing MEMBER sees "already in this circle", no Accept', async () => {
    mockedGet.mockResolvedValue(lookupEnvelope('member'));
    renderPage();

    expect(
      await screen.findByRole('heading', { level: 1, name: "You're already in this circle" })
    ).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Accept invitation' })).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Go to circle' })).toBeInTheDocument();
  });

  it('a sender who signed in from their own link is NOT auto-accepted', async () => {
    setPendingInviteCode('ABC123');
    mockedGet.mockResolvedValue(lookupEnvelope('inviter'));
    renderPage();

    await screen.findByRole('button', { name: 'Go to circle' });
    expect(acceptMutate).not.toHaveBeenCalled();
    // The parked code is dropped so it cannot fire later.
    expect(consumePendingInviteCode()).toBeNull();
  });

  it('"none" (or an older backend without the field) keeps the ordinary Accept', async () => {
    for (const rel of ['none', undefined]) {
      mockedGet.mockResolvedValue(lookupEnvelope(rel));
      const { unmount } = renderPage();
      expect(await screen.findByRole('button', { name: 'Accept invitation' })).toBeInTheDocument();
      expect(screen.queryByText('This is your own invite link')).not.toBeInTheDocument();
      unmount();
    }
  });

  it('a failed viewer lookup falls back to the ordinary Accept', async () => {
    mockedGet.mockRejectedValue({ error: { code: 'SERVER_ERROR' } });
    renderPage();
    expect(await screen.findByRole('button', { name: 'Accept invitation' })).toBeInTheDocument();
  });

  it('signed OUT: no authenticated lookup at all', async () => {
    authState = { isAuthenticated: false, isBootstrapping: false };
    renderPage();
    await screen.findByRole('button', { name: 'Create an account to join' });
    await waitFor(() => expect(mockedPost).toHaveBeenCalled());
    expect(mockedGet).not.toHaveBeenCalled();
  });
});
