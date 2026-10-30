import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import '@/i18n';
import { MemoryRouter } from 'react-router-dom';
import PendingInvitesPage from '@/pages/PendingInvitesPage';
import { useAuthStore } from '@/store/authStore';
import { peekPendingInviteeWelcome } from '@/lib/inviteeWelcome';

// Onboarding 1.3.1: accepting from the pending-invites list parks the invitee welcome.

const acceptMutate = vi.fn();
vi.mock('@/hooks/useInvites', () => ({
  usePendingInvites: () => ({
    data: [
      {
        id: 'inv-1',
        member_type: 'caregiver',
        circle: { id: 'c1', name: "Mom's Care", recipient_name: 'Rose' },
        invited_by: { email: 'sam@example.com', first_name: 'Sam', last_name: null },
        created_at: '2026-06-01T00:00:00Z',
        expires_at: '2026-06-08T00:00:00Z',
      },
    ],
    isPending: false,
    isError: false,
    refetch: vi.fn(),
  }),
  useAcceptInvite: () => ({ mutate: acceptMutate, isPending: false }),
}));

const navigate = vi.fn();
vi.mock('react-router-dom', async (importOriginal) => {
  const actual = await importOriginal<typeof import('react-router-dom')>();
  return { ...actual, useNavigate: () => navigate };
});
vi.mock('@/components/ui', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/components/ui')>();
  return { ...actual, useToast: () => ({ showToast: vi.fn() }) };
});
vi.mock('@/lib/onboardingAnalytics', () => ({ trackOnboardingCompleted: vi.fn() }));

beforeEach(() => {
  vi.clearAllMocks();
  sessionStorage.clear();
  useAuthStore.setState({ user: { id: 'u1' } as never, isAuthenticated: true });
});
afterEach(() => useAuthStore.setState({ user: null, isAuthenticated: false }));

function accept(result: unknown) {
  acceptMutate.mockImplementation((_v, opts) => opts?.onSuccess?.(result));
  render(
    <MemoryRouter>
      <PendingInvitesPage />
    </MemoryRouter>
  );
  return userEvent.setup().click(screen.getByRole('button', { name: /accept/i }));
}

describe('PendingInvitesPage — invitee welcome handoff', () => {
  it('accept parks the welcome (inviter first name, recipient) and opens it', async () => {
    await accept({ circle: { id: 'c1', name: "Mom's Care", recipient_name: 'Rose' }, view_only: false });
    expect(navigate).toHaveBeenCalledWith('/circles/c1/welcome');
    expect(peekPendingInviteeWelcome('u1', 'c1')).toEqual({
      inviter: 'Sam',
      recipient: 'Rose',
      role: 'caregiver',
      self: false,
    });
  });

  it('a view-only join parks view_only', async () => {
    await accept({ circle: { id: 'c1', name: "Mom's Care", recipient_name: 'Rose' }, view_only: true });
    expect(peekPendingInviteeWelcome('u1', 'c1')?.role).toBe('view_only');
  });

  it('a failed accept parks nothing', async () => {
    acceptMutate.mockImplementation((_v, opts) => opts?.onError?.(new Error('boom')));
    render(
      <MemoryRouter>
        <PendingInvitesPage />
      </MemoryRouter>
    );
    await userEvent.setup().click(screen.getByRole('button', { name: /accept/i }));
    expect(sessionStorage.length).toBe(0);
    expect(navigate).not.toHaveBeenCalled();
  });
});
