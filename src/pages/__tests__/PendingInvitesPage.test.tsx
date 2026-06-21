import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import '@/i18n';
import PendingInvitesPage from '@/pages/PendingInvitesPage';
import type { PendingInvite } from '@/api/invites';

// Stage 5 Task 5.5/5.7 — the current user's pending invites with Accept.

const acceptMutate = vi.fn();
let acceptPending = false;
const usePendingInvitesResult: {
  data: PendingInvite[] | undefined;
  isPending: boolean;
  isError: boolean;
  refetch: () => void;
} = { data: [], isPending: false, isError: false, refetch: vi.fn() };

vi.mock('@/hooks/useInvites', () => ({
  usePendingInvites: () => usePendingInvitesResult,
  useAcceptInvite: () => ({ mutate: acceptMutate, isPending: acceptPending }),
}));

const showToast = vi.fn();
vi.mock('@/components/ui', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/components/ui')>();
  return { ...actual, useToast: () => ({ showToast }) };
});

function makeInvite(overrides: Partial<PendingInvite> = {}): PendingInvite {
  return {
    id: 'inv-1',
    member_type: 'caregiver',
    circle: { id: 'c1', name: "Mom's Care", recipient_name: 'Rose' },
    invited_by: { email: 'luis@example.com', first_name: 'Luis', last_name: 'Meza' },
    created_at: '2026-06-01T00:00:00Z',
    expires_at: '2026-06-08T00:00:00Z',
    ...overrides,
  };
}

function renderPage(): void {
  render(
    <MemoryRouter>
      <PendingInvitesPage />
    </MemoryRouter>
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  acceptPending = false;
  usePendingInvitesResult.data = [];
  usePendingInvitesResult.isPending = false;
  usePendingInvitesResult.isError = false;
});

describe('PendingInvitesPage', () => {
  it('renders an empty state when there are no invites', () => {
    usePendingInvitesResult.data = [];
    renderPage();
    expect(screen.getByText('No pending invitations')).toBeInTheDocument();
  });

  it('lists invites with the inviter and recipient', () => {
    usePendingInvitesResult.data = [makeInvite()];
    renderPage();
    expect(
      screen.getByText('Luis Meza invited you to help care for Rose')
    ).toBeInTheDocument();
    expect(screen.getByText("Mom's Care")).toBeInTheDocument();
  });

  it('falls back to the inviter email when there is no name', () => {
    usePendingInvitesResult.data = [
      makeInvite({ invited_by: { email: 'anon@example.com', first_name: null, last_name: null } }),
    ];
    renderPage();
    expect(
      screen.getByText('anon@example.com invited you to help care for Rose')
    ).toBeInTheDocument();
  });

  it('accepting an invite fires useAcceptInvite with the invite id', async () => {
    const user = userEvent.setup();
    usePendingInvitesResult.data = [makeInvite()];
    renderPage();

    await user.click(screen.getByRole('button', { name: 'Accept' }));
    expect(acceptMutate).toHaveBeenCalledTimes(1);
    expect(acceptMutate.mock.calls[0][0]).toEqual({ inviteId: 'inv-1' });
  });

  it('toasts on a successful accept', async () => {
    const user = userEvent.setup();
    usePendingInvitesResult.data = [makeInvite()];
    acceptMutate.mockImplementation((_vars, opts) => opts?.onSuccess?.());
    renderPage();

    await user.click(screen.getByRole('button', { name: 'Accept' }));
    expect(showToast).toHaveBeenCalledWith("You joined Mom's Care.", 'success');
  });

  it('renders an error state with retry', async () => {
    const user = userEvent.setup();
    usePendingInvitesResult.isError = true;
    renderPage();
    expect(screen.getByRole('alert')).toHaveTextContent('Unable to load invitations');
    await user.click(screen.getByRole('button', { name: 'Retry' }));
    expect(usePendingInvitesResult.refetch).toHaveBeenCalled();
  });
});
