import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { HelmetProvider } from 'react-helmet-async';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import '@/i18n';
import { apiClient } from '@/lib/api';
import InviteLandingPage from '@/pages/InviteLandingPage';

// Auth-aware accept flow added for web parity with mobile. Mocks useAuth +
// the accept mutation + navigation; the preview request uses the global
// @/lib/api mock so the invite block renders.

const mockedPost = vi.mocked(apiClient.post);

const navigate = vi.fn();
vi.mock('react-router-dom', async (importOriginal) => {
  const actual = await importOriginal<typeof import('react-router-dom')>();
  return { ...actual, useNavigate: () => navigate };
});

let authState = { isAuthenticated: false, isBootstrapping: false };
vi.mock('@/hooks/useAuth', () => ({
  useAuth: () => authState,
}));

const acceptMutate = vi.fn();
vi.mock('@/hooks/useJoinCircle', () => ({
  useAcceptInviteByCode: () => ({ mutate: acceptMutate, isPending: false }),
}));

const validEnvelope = {
  success: true,
  data: {
    invite: {
      member_type: 'caregiver',
      circle: { name: "Rose's Care Team", recipient_name: 'Rose' },
      invited_by_name: 'Sarah',
      expires_at: '2026-07-01T00:00:00.000Z',
    },
  },
};

function renderPage(code = 'abc123') {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
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

beforeEach(() => {
  vi.clearAllMocks();
  mockedPost.mockResolvedValue(validEnvelope);
  authState = { isAuthenticated: false, isBootstrapping: false };
});

describe('InviteLandingPage — accept flow', () => {
  it('signed-out: shows "Sign in to accept" and routes to login preserving the invite', async () => {
    const user = userEvent.setup();
    renderPage('abc123');

    const signIn = await screen.findByRole('button', { name: 'Sign in to accept' });
    await user.click(signIn);

    expect(navigate).toHaveBeenCalledWith('/login', {
      state: { from: { pathname: '/invite/ABC123' } },
    });
    expect(acceptMutate).not.toHaveBeenCalled();
  });

  it('signed-in: accepts the invite and navigates to the circle picker', async () => {
    authState = { isAuthenticated: true, isBootstrapping: false };
    acceptMutate.mockImplementation((_code, opts) => opts?.onSuccess?.());
    const user = userEvent.setup();
    renderPage('abc123');

    const acceptBtn = await screen.findByRole('button', { name: 'Accept invitation' });
    await user.click(acceptBtn);

    expect(acceptMutate).toHaveBeenCalledWith('ABC123', expect.anything());
    await waitFor(() => expect(navigate).toHaveBeenCalledWith('/circles'));
  });

  it('signed-in: an already-member result still lands on the circle picker', async () => {
    authState = { isAuthenticated: true, isBootstrapping: false };
    acceptMutate.mockImplementation((_code, opts) =>
      opts?.onError?.({ error: { code: 'ALREADY_MEMBER' } })
    );
    const user = userEvent.setup();
    renderPage('abc123');

    await user.click(await screen.findByRole('button', { name: 'Accept invitation' }));

    await waitFor(() => expect(navigate).toHaveBeenCalledWith('/circles'));
  });

  it('signed-in: a failed accept surfaces a localized error', async () => {
    authState = { isAuthenticated: true, isBootstrapping: false };
    acceptMutate.mockImplementation((_code, opts) =>
      opts?.onError?.({ error: { code: 'SERVER_ERROR' } })
    );
    const user = userEvent.setup();
    renderPage('abc123');

    await user.click(await screen.findByRole('button', { name: 'Accept invitation' }));

    expect(await screen.findByRole('alert')).toHaveTextContent(
      "We couldn't accept this invitation. Please try again."
    );
    expect(navigate).not.toHaveBeenCalled();
  });
});
