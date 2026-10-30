import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import '@/i18n';
import { MemoryRouter } from 'react-router-dom';
import { JoinCircleModal } from '../JoinCircleModal';
import { useAuthStore } from '@/store/authStore';
import { peekPendingInviteeWelcome } from '@/lib/inviteeWelcome';

// Onboarding 1.3.1: the join-by-code modal parks the invitee welcome (and drops the
// toast, the welcome being the confirmation) before handing the circle to onJoined.

const lookupMutate = vi.fn();
const acceptMutate = vi.fn();
vi.mock('@/hooks/useJoinCircle', () => ({
  useLookupInviteByCode: () => ({ mutate: lookupMutate, isPending: false }),
  useAcceptInviteByCode: () => ({ mutate: acceptMutate, isPending: false }),
}));
const showToast = vi.fn();
vi.mock('@/components/ui', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/components/ui')>();
  return { ...actual, useToast: () => ({ showToast }) };
});
vi.mock('@/lib/onboardingAnalytics', () => ({ trackOnboardingCompleted: vi.fn() }));

const INVITE = {
  id: 'invite-1',
  invite_code: 'ABC123',
  member_type: 'caregiver' as const,
  circle: { id: 'circle-1', name: "Rose's Circle", recipient_name: 'Rose' },
  invited_by: { email: 'ada@example.com', first_name: 'Ada', last_name: null },
  expires_at: '2026-07-01T00:00:00Z',
};

beforeEach(() => {
  vi.clearAllMocks();
  sessionStorage.clear();
  useAuthStore.setState({ user: { id: 'u1' } as never, isAuthenticated: true });
});
afterEach(() => useAuthStore.setState({ user: null, isAuthenticated: false }));

async function join(viewOnly: boolean) {
  lookupMutate.mockImplementation((_c, opts) => opts?.onSuccess?.(INVITE));
  acceptMutate.mockImplementation((_c, opts) =>
    opts?.onSuccess?.({ circle: INVITE.circle, view_only: viewOnly, message: 'ok' })
  );
  const onJoined = vi.fn();
  render(
    <MemoryRouter>
      <JoinCircleModal onClose={vi.fn()} onJoined={onJoined} />
    </MemoryRouter>
  );
  const user = userEvent.setup();
  const [first] = within(screen.getByRole('group', { name: 'Invite code' })).getAllByRole('textbox');
  await user.click(first);
  await user.paste('ABC123');
  await user.click(screen.getByRole('button', { name: /look up|find|continue|next/i }));
  await user.click(await screen.findByRole('button', { name: 'Join circle' }));
  await waitFor(() => expect(onJoined).toHaveBeenCalledWith('circle-1'));
}

describe('JoinCircleModal — invitee welcome handoff', () => {
  it('parks the welcome for the joined circle and does not toast', async () => {
    await join(false);
    expect(peekPendingInviteeWelcome('u1', 'circle-1')).toEqual({
      inviter: 'Ada',
      recipient: 'Rose',
      role: 'caregiver',
      self: false,
    });
    expect(showToast).not.toHaveBeenCalled();
  });

  it('view-only join parks view_only', async () => {
    await join(true);
    expect(peekPendingInviteeWelcome('u1', 'circle-1')?.role).toBe('view_only');
  });
});
