import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { HelmetProvider } from 'react-helmet-async';
import '@/i18n';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { apiClient } from '@/lib/api';
import { setPendingInviteCode } from '@/lib/pendingInviteCode';
import { peekPendingInviteeWelcome } from '@/lib/inviteeWelcome';
import { ToastProvider } from '@/components/ui';
import InviteLandingPage from '@/pages/InviteLandingPage';

// Onboarding 1.3.1: the landing page's accept (button AND the post-OTP / post-OAuth
// auto-accept, which is the same handler) parks the invitee welcome and opens it.

const mockedPost = vi.mocked(apiClient.post);

const navigate = vi.fn();
vi.mock('react-router-dom', async (importOriginal) => {
  const actual = await importOriginal<typeof import('react-router-dom')>();
  return { ...actual, useNavigate: () => navigate };
});

const authState = { isAuthenticated: true, isBootstrapping: false, user: { id: 'u1' } };
vi.mock('@/hooks/useAuth', () => ({ useAuth: () => authState }));

const acceptMutate = vi.fn();
vi.mock('@/hooks/useJoinCircle', () => ({
  useAcceptInviteByCode: () => ({ mutateAsync: acceptMutate, isPending: false }),
}));
vi.mock('@/lib/onboardingAnalytics', () => ({ trackOnboardingCompleted: vi.fn() }));

const envelope = (inviter: string | null, memberType = 'caregiver') => ({
  success: true,
  data: {
    invite: {
      member_type: memberType,
      circle: { name: "Rose's Care Team", recipient_name: 'Rose' },
      invited_by_name: inviter,
      expires_at: '2026-07-01T00:00:00.000Z',
    },
  },
});

const joined = (viewOnly: boolean) => ({
  circle: { id: 'cj1', name: "Rose's Care Team", recipient_name: 'Rose', owner_id: 'o-1' },
  view_only: viewOnly,
  message: 'ok',
});

function renderPage() {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <HelmetProvider>
      <QueryClientProvider client={queryClient}>
        <ToastProvider>
          <MemoryRouter initialEntries={['/invite/abc123']}>
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
  mockedPost.mockResolvedValue(envelope('Sam'));
  acceptMutate.mockResolvedValue(joined(false));
});

describe('InviteLandingPage — invitee welcome handoff', () => {
  it('button accept parks the welcome and navigates to /circles/:id/welcome', async () => {
    const user = userEvent.setup();
    renderPage();
    await user.click(await screen.findByRole('button', { name: 'Accept invitation' }));
    await waitFor(() => expect(navigate).toHaveBeenCalledWith('/circles/cj1/welcome'));
    expect(peekPendingInviteeWelcome('u1', 'cj1')).toEqual({
      inviter: 'Sam',
      recipient: 'Rose',
      role: 'caregiver',
      self: false,
    });
  });

  it('post-OTP / OAuth auto-accept (parked code) lands on the welcome too', async () => {
    setPendingInviteCode('ABC123');
    renderPage();
    await waitFor(() => expect(navigate).toHaveBeenCalledWith('/circles/cj1/welcome'));
    expect(acceptMutate).toHaveBeenCalledTimes(1);
  });

  it('a view-only join (accept response) parks the view_only role', async () => {
    acceptMutate.mockResolvedValue(joined(true));
    const user = userEvent.setup();
    renderPage();
    await user.click(await screen.findByRole('button', { name: 'Accept invitation' }));
    await waitFor(() => expect(navigate).toHaveBeenCalled());
    expect(peekPendingInviteeWelcome('u1', 'cj1')?.role).toBe('view_only');
  });

  it('no inviter name parks null (the page renders the no-inviter wording)', async () => {
    mockedPost.mockResolvedValue(envelope(null));
    const user = userEvent.setup();
    renderPage();
    await user.click(await screen.findByRole('button', { name: 'Accept invitation' }));
    await waitFor(() => expect(navigate).toHaveBeenCalled());
    expect(peekPendingInviteeWelcome('u1', 'cj1')?.inviter).toBeNull();
  });

  it('ALREADY_MEMBER (existing member re-accepting) never parks a welcome', async () => {
    acceptMutate.mockRejectedValue({ error: { code: 'ALREADY_MEMBER' } });
    const user = userEvent.setup();
    renderPage();
    await user.click(await screen.findByRole('button', { name: 'Accept invitation' }));
    await waitFor(() => expect(navigate).toHaveBeenCalledWith('/circles'));
    expect(sessionStorage.length).toBe(0);
  });

  it('a null circle in the response falls back to the picker with no welcome', async () => {
    acceptMutate.mockResolvedValue({ circle: null, view_only: false, message: 'ok' });
    const user = userEvent.setup();
    renderPage();
    await user.click(await screen.findByRole('button', { name: 'Accept invitation' }));
    await waitFor(() => expect(navigate).toHaveBeenCalledWith('/circles'));
    expect(sessionStorage.length).toBe(0);
  });
});
