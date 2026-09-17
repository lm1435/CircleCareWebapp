import { StrictMode } from 'react';
import { render, screen, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { HelmetProvider } from 'react-helmet-async';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import '@/i18n';
import { apiClient } from '@/lib/api';
import { queryKeys } from '@/lib/queryKeys';
import { consumePendingInviteCode, setPendingInviteCode } from '@/lib/pendingInviteCode';
import { ToastProvider } from '@/components/ui';
import InviteLandingPage from '@/pages/InviteLandingPage';

// THE SIGN-IN HANDOFF AUTO-ACCEPT, WITH THE REAL MUTATION HOOK, UNDER STRICTMODE.
//
// A visitor who pressed "I already have an account" comes back to
// /invite/:code signed in with the code parked; the page accepts in a MOUNT
// effect. That accept used per-call `mutate(code, { onSuccess, onError })`
// callbacks, which React Query delivers through the component's
// MutationObserver — and StrictMode's mount double-invoke unsubscribes that
// observer mid-request, which detaches it from the mutation for good. The
// POST landed but the toast, the analytics event and the navigation never ran
// (e2e: invites.spec.ts). `useAcceptInviteByCode` is deliberately NOT mocked
// here: a mocked `mutate` that calls its callbacks synchronously cannot show
// the detachment. Only the transport (`apiClient.post`) is.

const mockedPost = vi.mocked(apiClient.post);

const navigate = vi.fn();
vi.mock('react-router-dom', async (importOriginal) => {
  const actual = await importOriginal<typeof import('react-router-dom')>();
  return { ...actual, useNavigate: () => navigate };
});

vi.mock('@/hooks/useAuth', () => ({
  useAuth: () => ({ isAuthenticated: true, isBootstrapping: false }),
}));

const trackOnboardingCompleted = vi.fn();
vi.mock('@/lib/onboardingAnalytics', () => ({
  trackOnboardingCompleted: (path: string) => trackOnboardingCompleted(path),
}));

const inviteAccepted = vi.fn();
vi.mock('@/lib/analytics', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/analytics')>();
  return {
    ...actual,
    Analytics: {
      ...actual.Analytics,
      inviteAccepted: (...args: unknown[]) => inviteAccepted(...args),
    },
  };
});

const CODE = 'ABC123';
const ACCEPT_URL = `/invites/code/${CODE}/accept`;

const previewEnvelope = {
  success: true,
  data: {
    invite: {
      member_type: 'caregiver',
      circle: { name: "Rose's Care Team", recipient_name: 'Rose' },
      invited_by_name: 'Sarah',
      expires_at: '2099-07-01T00:00:00.000Z',
    },
  },
};

/** Preview succeeds; the accept resolves or rejects as the test says. */
function routeApi(accept: () => Promise<unknown>): void {
  mockedPost.mockImplementation(((url: string) =>
    url === ACCEPT_URL ? accept() : Promise.resolve(previewEnvelope)) as never);
}

const acceptCalls = () => mockedPost.mock.calls.filter(([url]) => url === ACCEPT_URL).length;

function renderHandoff() {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  const invalidate = vi.spyOn(queryClient, 'invalidateQueries');
  setPendingInviteCode(CODE);
  render(
    <StrictMode>
      <HelmetProvider>
        <QueryClientProvider client={queryClient}>
          <ToastProvider>
            <MemoryRouter initialEntries={[`/invite/${CODE.toLowerCase()}`]}>
              <Routes>
                <Route path="/invite/:code" element={<InviteLandingPage />} />
              </Routes>
            </MemoryRouter>
          </ToastProvider>
        </QueryClientProvider>
      </HelmetProvider>
    </StrictMode>
  );
  return { invalidate };
}

beforeEach(() => {
  vi.clearAllMocks();
  sessionStorage.clear();
});

describe('InviteLandingPage — sign-in handoff auto-accept (real mutation, StrictMode)', () => {
  it('confirms the join exactly like a direct accept: toast, analytics, circle cache, navigation — once', async () => {
    routeApi(() => Promise.resolve({ success: true, data: {} }));
    const { invalidate } = renderHandoff();

    expect(await screen.findByText('You joined the circle.')).toBeInTheDocument();
    await waitFor(() => expect(navigate).toHaveBeenCalledWith('/circles'));
    expect(trackOnboardingCompleted).toHaveBeenCalledWith('joined');
    expect(inviteAccepted).toHaveBeenCalledWith(undefined, 'invite_link');
    // The hook-level success still invalidates the circle list the picker reads.
    expect(invalidate).toHaveBeenCalledWith({ queryKey: queryKeys.circles });
    // StrictMode double-invokes the mount effect: the accept still fires once,
    // and the parked code is consumed.
    expect(acceptCalls()).toBe(1);
    expect(consumePendingInviteCode()).toBeNull();
  });

  it('an ALREADY_MEMBER handoff lands on the circles list, with no join toast', async () => {
    routeApi(() => Promise.reject({ error: { code: 'ALREADY_MEMBER' } }));
    renderHandoff();

    await waitFor(() => expect(navigate).toHaveBeenCalledWith('/circles'));
    expect(screen.queryByText('You joined the circle.')).not.toBeInTheDocument();
    expect(trackOnboardingCompleted).not.toHaveBeenCalled();
    expect(acceptCalls()).toBe(1);
  });

  it('an expired invite on the handoff shows its own copy and re-enables Accept', async () => {
    routeApi(() => Promise.reject({ error: { code: 'INVITE_EXPIRED' } }));
    renderHandoff();

    expect(await screen.findByRole('alert')).toHaveTextContent(
      'This invitation has expired. Ask whoever invited you to send a new one.'
    );
    // Not stuck on "Accepting…": pending state settles with the request.
    expect(await screen.findByRole('button', { name: 'Accept invitation' })).toBeEnabled();
    expect(navigate).not.toHaveBeenCalled();
    expect(acceptCalls()).toBe(1);
  });

  it('an archived circle on the handoff shows the archived copy', async () => {
    routeApi(() => Promise.reject({ error: { code: 'CIRCLE_ARCHIVED' } }));
    renderHandoff();

    expect(await screen.findByRole('alert')).toHaveTextContent(
      "This circle is no longer active, so the invitation can't be used."
    );
    expect(navigate).not.toHaveBeenCalled();
  });
});
