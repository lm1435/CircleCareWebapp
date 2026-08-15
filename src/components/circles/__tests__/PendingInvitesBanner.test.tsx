import { render, screen } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router-dom';
import '@/i18n';
import { PendingInvitesBanner } from '@/components/circles/PendingInvitesBanner';
import { getPendingInvites, type PendingInvite } from '@/api/invites';

vi.mock('@/api/invites', () => ({
  getPendingInvites: vi.fn(),
}));

const mockGetPendingInvites = vi.mocked(getPendingInvites);

/**
 * PARITY GUARD. Mobile's CircleListScreen has always shown an invite banner; on
 * web, /invites was reachable only from the no-circles empty state, so a user
 * who already had a circle could never reach an invitation. The gap was masked
 * for as long as GET /invites/pending could not return a row (it resolved the
 * circle + inviter through the RLS client, which hides both from an invitee who
 * is not a member yet).
 */
function makeInvite(overrides: Partial<PendingInvite> = {}): PendingInvite {
  return {
    id: 'inv-1',
    member_type: 'caregiver',
    circle: { id: 'c1', name: "Todd's Circle", recipient_name: 'Todd' },
    invited_by: { email: 'luis@example.com', first_name: 'Luis', last_name: 'Meza' },
    created_at: '2026-08-02T00:00:00Z',
    expires_at: '2026-08-09T00:00:00Z',
    ...overrides,
  } as PendingInvite;
}

function renderBanner(): void {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter>
        <PendingInvitesBanner />
      </MemoryRouter>
    </QueryClientProvider>
  );
}

describe('PendingInvitesBanner', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('links to the invitations page when one invite is pending', async () => {
    mockGetPendingInvites.mockResolvedValue([makeInvite()]);
    renderBanner();

    const link = await screen.findByRole('link');
    expect(link).toHaveAttribute('href', '/invites');
    expect(screen.getByText('You have 1 pending invitation')).toBeInTheDocument();
    expect(screen.getByText('Review invitation')).toBeInTheDocument();
  });

  it('pluralizes the count and the call to action', async () => {
    mockGetPendingInvites.mockResolvedValue([makeInvite(), makeInvite({ id: 'inv-2' })]);
    renderBanner();

    expect(await screen.findByText('You have 2 pending invitations')).toBeInTheDocument();
    expect(screen.getByText('Review invitations')).toBeInTheDocument();
  });

  it('renders nothing when there are no pending invites', async () => {
    mockGetPendingInvites.mockResolvedValue([]);
    renderBanner();

    await vi.waitFor(() => expect(mockGetPendingInvites).toHaveBeenCalled());
    expect(screen.queryByRole('link')).not.toBeInTheDocument();
  });

  it('stays silent when the request fails — it is a nudge, never a blocker', async () => {
    mockGetPendingInvites.mockRejectedValue(new Error('offline'));
    renderBanner();

    await vi.waitFor(() => expect(mockGetPendingInvites).toHaveBeenCalled());
    expect(screen.queryByRole('link')).not.toBeInTheDocument();
  });
});
