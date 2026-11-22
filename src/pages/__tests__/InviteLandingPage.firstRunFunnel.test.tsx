import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { HelmetProvider } from 'react-helmet-async';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import '@/i18n';
import { apiClient } from '@/lib/api';
import { setPendingInviteCode } from '@/lib/pendingInviteCode';
import { Analytics } from '@/lib/analytics';
import { ToastProvider } from '@/components/ui';
import InviteLandingPage from '@/pages/InviteLandingPage';
import { resetFirstRunFunnelForTests, setFirstRunPath } from '@/lib/firstRunFunnel';

// FIRST RUN FUNNEL (owner 2026-11-22): the invite link is the invited path's `join` step. Setup copied
// from InviteLandingPage.accept.test.tsx. Mocks useAuth +
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
  useAcceptInviteByCode: () => ({ mutateAsync: acceptMutate, isPending: false }),
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
  // clearAllMocks keeps implementations: default to an accept still in flight.
  acceptMutate.mockImplementation(() => new Promise(() => {}));
  authState = { isAuthenticated: false, isBootstrapping: false };
});

let viewed: ReturnType<typeof vi.spyOn>;
let completed: ReturnType<typeof vi.spyOn>;
let failed: ReturnType<typeof vi.spyOn>;
beforeEach(() => {
  resetFirstRunFunnelForTests();
  viewed = vi.spyOn(Analytics, 'firstRunStepViewed').mockImplementation(() => {});
  completed = vi.spyOn(Analytics, 'firstRunStepCompleted').mockImplementation(() => {});
  failed = vi.spyOn(Analytics, 'firstRunStepFailed').mockImplementation(() => {});
  vi.spyOn(Analytics, 'inviteAccepted').mockImplementation(() => {});
  vi.spyOn(Analytics, 'errorOccurred').mockImplementation(() => {});
});
afterEach(() => vi.restoreAllMocks());

describe('InviteLandingPage — first run funnel (join)', () => {
  it('POSITIVE: a signed-out arrival views join once, path invited', async () => {
    renderPage('abc123');
    await screen.findByRole('button', { name: 'Create an account to join' });
    expect(viewed).toHaveBeenCalledTimes(1);
    expect(viewed).toHaveBeenCalledWith(undefined, 'join', 'invited');
    expect(failed).not.toHaveBeenCalled();
    expect(completed).not.toHaveBeenCalled();
  });

  it('POSITIVE: an expired link is a failed join with expired_code; a spent one with invite_invalid', async () => {
    mockedPost.mockRejectedValueOnce({ success: false, error: { code: 'INVITE_EXPIRED', message: 'x' } });
    const first = renderPage('abc123');
    await waitFor(() => expect(failed).toHaveBeenCalledWith('join', 'expired_code', 'invited'));
    first.unmount();
    resetFirstRunFunnelForTests();
    mockedPost.mockRejectedValueOnce({ success: false, error: { code: 'INVITE_ALREADY_USED', message: 'x' } });
    renderPage('zzz999');
    await waitFor(() => expect(failed).toHaveBeenLastCalledWith('join', 'invite_invalid', 'invited'));
    expect(failed).toHaveBeenCalledTimes(2);
  });

  it('POSITIVE: a malformed code fails with invalid_code without a request', async () => {
    renderPage('abc12');
    await waitFor(() => expect(failed).toHaveBeenCalledWith('join', 'invalid_code', 'invited'));
    expect(failed).toHaveBeenCalledTimes(1);
  });

  it('POSITIVE: the hand-off accept (invited run) completes join only after the server answered', async () => {
    setFirstRunPath('invited');
    setPendingInviteCode('ABC123');
    authState = { isAuthenticated: true, isBootstrapping: false };
    let resolve: ((v: unknown) => void) | null = null;
    acceptMutate.mockImplementation(() => new Promise((r) => (resolve = r)));
    renderPage('abc123');
    await screen.findByRole('button', { name: 'Joining…' });
    expect(completed).not.toHaveBeenCalled();
    resolve!({ circle: { id: 'c-9', name: 'Rose', recipient_name: 'Rose', owner_id: 'o' }, view_only: false });
    await waitFor(() => expect(completed).toHaveBeenCalledWith('join', expect.any(String), 'invited', undefined));
    expect(completed).toHaveBeenCalledTimes(1);
    expect(failed).not.toHaveBeenCalled();
  });

  it('POSITIVE: a refused accept in an invited run is a failed join with its reason', async () => {
    setFirstRunPath('invited');
    authState = { isAuthenticated: true, isBootstrapping: false };
    acceptMutate.mockRejectedValue({ success: false, error: { code: 'INVITE_EXPIRED', message: 'x' } });
    renderPage('abc123');
    await userEvent.setup().click(await screen.findByRole('button', { name: 'Accept invitation' }));
    await waitFor(() => expect(failed).toHaveBeenCalledWith('join', 'expired_code', 'invited'));
    expect(completed).not.toHaveBeenCalled();
  });

  it('NEGATIVE: a signed-in member opening a link (no invited run) sends no funnel event, even on accept', async () => {
    authState = { isAuthenticated: true, isBootstrapping: false };
    acceptMutate.mockResolvedValue({ circle: { id: 'c-9', name: 'Rose', recipient_name: 'Rose', owner_id: 'o' } });
    renderPage('abc123');
    await userEvent.setup().click(await screen.findByRole('button', { name: 'Accept invitation' }));
    await waitFor(() => expect(navigate).toHaveBeenCalled());
    expect(viewed).not.toHaveBeenCalled();
    expect(completed).not.toHaveBeenCalled();
    expect(failed).not.toHaveBeenCalled();
  });

  it('NEGATIVE: ALREADY_MEMBER is not a failed join', async () => {
    setFirstRunPath('invited');
    authState = { isAuthenticated: true, isBootstrapping: false };
    acceptMutate.mockRejectedValue({ success: false, error: { code: 'ALREADY_MEMBER', message: 'x' } });
    renderPage('abc123');
    await userEvent.setup().click(await screen.findByRole('button', { name: 'Accept invitation' }));
    await waitFor(() => expect(navigate).toHaveBeenCalledWith('/circles'));
    expect(failed).not.toHaveBeenCalled();
  });

  it('NEGATIVE: the invite code never reaches a funnel property', async () => {
    mockedPost.mockRejectedValueOnce({ success: false, error: { code: 'INVITE_NOT_FOUND', message: 'ABC123' } });
    renderPage('abc123');
    await waitFor(() => expect(failed).toHaveBeenCalled());
    expect(JSON.stringify([viewed.mock.calls, failed.mock.calls])).not.toMatch(/abc123/i);
  });
});
