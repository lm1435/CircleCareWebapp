import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import '@/i18n';
import PendingInvitesPage from '@/pages/PendingInvitesPage';
import { Analytics } from '@/lib/analytics';
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

// R4-5 onboarding funnel — accepting an invite must report completion (the
// once-per-browser guard lives inside the mocked module).
const trackOnboardingCompleted = vi.fn();
vi.mock('@/lib/onboardingAnalytics', () => ({
  trackOnboardingCompleted: (path: string) => trackOnboardingCompleted(path),
}));

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
    // R4-5: successful accept reports onboarding completion via the join path.
    expect(trackOnboardingCompleted).toHaveBeenCalledWith('joined');
  });

  // WB4 — this list is a THIRD invite_accepted source (distinct from the
  // invite-link landing page and the join-by-code modal); it must be explicit
  // rather than an implicit "no source" event.
  it('fires invite_accepted with an explicit source (WB4)', async () => {
    const inviteAccepted = vi.spyOn(Analytics, 'inviteAccepted');
    const user = userEvent.setup();
    usePendingInvitesResult.data = [makeInvite()];
    acceptMutate.mockImplementation((_vars, opts) => opts?.onSuccess?.());
    renderPage();

    await user.click(screen.getByRole('button', { name: 'Accept' }));
    expect(inviteAccepted).toHaveBeenCalledWith('c1', 'in_app');
  });

  it('does NOT report onboarding completion when the accept fails', async () => {
    const user = userEvent.setup();
    usePendingInvitesResult.data = [makeInvite()];
    acceptMutate.mockImplementation((_vars, opts) => opts?.onError?.(new Error('boom')));
    renderPage();

    await user.click(screen.getByRole('button', { name: 'Accept' }));
    expect(trackOnboardingCompleted).not.toHaveBeenCalled();
  });

  it('offers an Open circle link to the joined circle after a successful accept', async () => {
    const user = userEvent.setup();
    usePendingInvitesResult.data = [makeInvite()];
    acceptMutate.mockImplementation((_vars, opts) => opts?.onSuccess?.());
    renderPage();

    await user.click(screen.getByRole('button', { name: 'Accept' }));

    expect(screen.getByText("You joined Mom's Care.")).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Open circle' })).toHaveAttribute(
      'href',
      '/circles/c1'
    );
  });

  it('explains that invitations can simply be left pending', () => {
    usePendingInvitesResult.data = [makeInvite()];
    renderPage();
    expect(
      screen.getByText(
        'Not ready to join? You can simply leave an invitation here — nothing happens until you accept.'
      )
    ).toBeInTheDocument();
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
