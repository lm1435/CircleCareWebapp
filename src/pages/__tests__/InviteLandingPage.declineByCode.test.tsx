import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { HelmetProvider } from 'react-helmet-async';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { apiClient } from '@/lib/api';
import { consumePendingInviteCode, setPendingInviteCode } from '@/lib/pendingInviteCode';
import { ToastProvider } from '@/components/ui';
import InviteLandingPage from '@/pages/InviteLandingPage';

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
        invite_code: 'ABCD2345',
        member_type: 'caregiver',
        circle: { id: 'circle-1', name: "Rose's Care Team", recipient_name: 'Rose' },
        invited_by: { email: 'sarah@example.com', first_name: 'Sarah', last_name: null },
        expires_at: '2026-12-01T00:00:00.000Z',
        ...(viewer_relationship ? { viewer_relationship } : {}),
      },
    },
  };
}

// 1.4.3 — DECLINE BY CODE on the landing page (the only place a shared-link
// invitee can say no: the invite has no address, so it is never in their
// pending list). Signed in, not the sender/member; confirm first; one call to
// POST /invites/code/:code/decline.

function renderPage(code = 'abcd2345') {
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

const DECLINE_URL = '/invites/code/ABCD2345/decline';
let declineResult: () => Promise<unknown> = () =>
  Promise.resolve({ success: true, data: { invite: { id: 'inv-1', status: 'declined' }, already_declined: false } });

beforeEach(() => {
  vi.clearAllMocks();
  sessionStorage.clear();
  void setPendingInviteCode;
  void consumePendingInviteCode;
  mockedPost.mockImplementation(((url: string) =>
    url === DECLINE_URL ? declineResult() : Promise.resolve(previewEnvelope)) as never);
  acceptMutate.mockImplementation(() => new Promise(() => {}));
  authState = { isAuthenticated: true, isBootstrapping: false };
  declineResult = () =>
    Promise.resolve({ success: true, data: { invite: { id: 'inv-1', status: 'declined' }, already_declined: false } });
});

describe('InviteLandingPage — decline by code (1.4.3)', () => {
  it('LD-P1: a signed-in invitee confirms Decline -> one call to the by-code route, the page says declined', async () => {
    mockedGet.mockResolvedValue(lookupEnvelope('none'));
    const user = userEvent.setup();
    renderPage();
    await user.click(await screen.findByRole('button', { name: 'Decline' }));
    // Confirm dialog first: nothing sent yet.
    expect(mockedPost).not.toHaveBeenCalledWith(DECLINE_URL, {});
    expect(screen.getByText('Decline this invite?')).toBeInTheDocument();
    const dialog = screen.getByRole('dialog');
    await user.click(within(dialog).getByRole('button', { name: 'Decline' }));
    await waitFor(() => expect(mockedPost).toHaveBeenCalledWith(DECLINE_URL, {}));
    expect(mockedPost.mock.calls.filter((c) => c[0] === DECLINE_URL)).toHaveLength(1);
    expect(await screen.findByTestId('invite-declined-notice')).toHaveTextContent('Invite declined');
    expect(screen.queryByRole('button', { name: 'Accept invitation' })).toBeNull();
  });

  it('LD-N1: Keep invite sends nothing', async () => {
    mockedGet.mockResolvedValue(lookupEnvelope('none'));
    const user = userEvent.setup();
    renderPage();
    await user.click(await screen.findByRole('button', { name: 'Decline' }));
    await user.click(within(screen.getByRole('dialog')).getAllByRole('button', { name: 'Keep invite' })[0]);
    expect(mockedPost).not.toHaveBeenCalledWith(DECLINE_URL, {});
    expect(screen.getByRole('button', { name: 'Accept invitation' })).toBeInTheDocument();
  });

  it.each(['inviter', 'member'])('LD-N2: never offered to the %s', async (relationship) => {
    mockedGet.mockResolvedValue(lookupEnvelope(relationship));
    renderPage();
    expect(await screen.findByRole('button', { name: 'Go to circle' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Decline' })).toBeNull();
  });

  it('LD-N3: never offered to a signed-out visitor', async () => {
    authState = { isAuthenticated: false, isBootstrapping: false };
    renderPage();
    expect(await screen.findByRole('button', { name: /Create (an )?account/i })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Decline' })).toBeNull();
  });

  it('LD-N4: an expired invite -> the expired copy, Accept still on screen (nothing declined)', async () => {
    mockedGet.mockResolvedValue(lookupEnvelope('none'));
    declineResult = () => Promise.reject({ success: false, error: { code: 'INVITE_EXPIRED', message: 'x' } });
    const user = userEvent.setup();
    renderPage();
    await user.click(await screen.findByRole('button', { name: 'Decline' }));
    await user.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'Decline' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('This invite has expired.');
    expect(screen.queryByTestId('invite-declined-notice')).toBeNull();
  });

  it('LD-P2: Spanish label', async () => {
    const i18n = (await import('@/i18n')).default;
    await i18n.changeLanguage('es');
    try {
      mockedGet.mockResolvedValue(lookupEnvelope('none'));
      renderPage();
      expect(await screen.findByRole('button', { name: 'Rechazar' })).toBeInTheDocument();
    } finally {
      await i18n.changeLanguage('en');
    }
  });
});

describe('InviteLandingPage — code shape (1.4.3)', () => {
  it('LC-P1: an 8-character code previews', async () => {
    mockedGet.mockResolvedValue(lookupEnvelope('none'));
    renderPage('abcd2345');
    await waitFor(() => expect(mockedPost).toHaveBeenCalledWith('/invites/code/ABCD2345/preview', {}));
  });

  it.each(['ABCD234', 'ABCD23456'])('LC-N1: a %s code (7/9 chars) is the invalid card with no request', async (code) => {
    renderPage(code);
    expect(await screen.findByRole('heading', { level: 1 })).toBeInTheDocument();
    expect(mockedPost).not.toHaveBeenCalled();
  });
});
