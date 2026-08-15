import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { HelmetProvider } from 'react-helmet-async';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import '@/i18n';
import { apiClient } from '@/lib/api';
import { consumePendingInviteCode, setPendingInviteCode } from '@/lib/pendingInviteCode';
import { ToastProvider } from '@/components/ui';
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

// R4-5 onboarding funnel — a successful landing-page accept must report
// completion (once-per-browser guard lives inside the mocked module).
const trackOnboardingCompleted = vi.fn();
vi.mock('@/lib/onboardingAnalytics', () => ({
  trackOnboardingCompleted: (path: string) => trackOnboardingCompleted(path),
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
  mockedPost.mockResolvedValue(validEnvelope);
  authState = { isAuthenticated: false, isBootstrapping: false };
});

describe('InviteLandingPage — accept flow', () => {
  // An invitee is by definition likely to have no account yet, so create-account
  // is the PRIMARY action. Routing them to /login first is what produced 17 web
  // invite opens and 0 accepts through 2026-08-13.
  it('signed-out: create-account is primary and routes to signup preserving the invite', async () => {
    const user = userEvent.setup();
    renderPage('abc123');

    const createAccount = await screen.findByRole('button', {
      name: 'Create an account to join',
    });
    await user.click(createAccount);

    expect(navigate).toHaveBeenCalledWith('/signup', {
      state: { from: { pathname: '/invite/ABC123' } },
    });
    // The code is ALSO parked in sessionStorage — router state cannot survive
    // the OAuth redirect or the signup → verify-email flow. This is the ONLY
    // thing that brings the invitee back: SignUpPage hands off to
    // /verify-email, which has no router state to honor.
    expect(consumePendingInviteCode()).toBe('ABC123');
    expect(acceptMutate).not.toHaveBeenCalled();
  });

  it('signed-out: "I already have an account" still routes to login preserving the invite', async () => {
    const user = userEvent.setup();
    renderPage('abc123');

    const signIn = await screen.findByRole('button', {
      name: 'I already have an account',
    });
    await user.click(signIn);

    expect(navigate).toHaveBeenCalledWith('/login', {
      state: { from: { pathname: '/invite/ABC123' } },
    });
    expect(consumePendingInviteCode()).toBe('ABC123');
    expect(acceptMutate).not.toHaveBeenCalled();
  });

  it('authenticated render clears any parked pending code (already at the destination)', async () => {
    setPendingInviteCode('ABC123');
    authState = { isAuthenticated: true, isBootstrapping: false };
    renderPage('abc123');

    await screen.findByRole('button', { name: 'Accept invitation' });

    expect(consumePendingInviteCode()).toBeNull();
  });

  it('signed-in: accepts the invite, confirms with a toast, and navigates to the circle picker', async () => {
    authState = { isAuthenticated: true, isBootstrapping: false };
    acceptMutate.mockImplementation((_code, opts) => opts?.onSuccess?.());
    const user = userEvent.setup();
    renderPage('abc123');

    const acceptBtn = await screen.findByRole('button', { name: 'Accept invitation' });
    await user.click(acceptBtn);

    expect(acceptMutate).toHaveBeenCalledWith('ABC123', expect.anything());
    // Success is confirmed via toast — the circle picker gives no feedback.
    expect(await screen.findByText('You joined the circle.')).toBeInTheDocument();
    await waitFor(() => expect(navigate).toHaveBeenCalledWith('/circles'));
    // R4-5: successful accept reports onboarding completion via the join path.
    expect(trackOnboardingCompleted).toHaveBeenCalledWith('joined');
  });

  it('signed-in: an already-member result does NOT report onboarding completion', async () => {
    authState = { isAuthenticated: true, isBootstrapping: false };
    acceptMutate.mockImplementation((_code, opts) =>
      opts?.onError?.({ error: { code: 'ALREADY_MEMBER' } })
    );
    const user = userEvent.setup();
    renderPage('abc123');

    await user.click(await screen.findByRole('button', { name: 'Accept invitation' }));

    await waitFor(() => expect(navigate).toHaveBeenCalledWith('/circles'));
    // They already have circles — the picker will report 'existing' instead.
    expect(trackOnboardingCompleted).not.toHaveBeenCalled();
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
      "We couldn't add you to the circle just now. Try again — and if it keeps not working, ask for a fresh invite."
    );
    expect(navigate).not.toHaveBeenCalled();
  });
});
