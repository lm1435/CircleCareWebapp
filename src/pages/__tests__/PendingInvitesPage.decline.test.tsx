import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import i18n from '@/i18n';
import PendingInvitesPage from '@/pages/PendingInvitesPage';
import { Analytics } from '@/lib/analytics';
import type { PendingInvite } from '@/api/invites';

// 1.4.3 invite DECLINE (docs/plans/invite-decline-1-4-3.md), mobile parity with
// PendingInvitesDecline.test.tsx: Decline -> in-page confirm (never window.confirm)
// -> POST /invites/:id/decline -> toast; every refusal code has its own copy.

type MutateOpts = { onSuccess?: (r: unknown) => void; onError?: (e: unknown) => void };
const declineMutate = vi.fn<(vars: { inviteId: string }, opts: MutateOpts) => void>();
const result = { data: [] as PendingInvite[], isPending: false, isError: false, refetch: vi.fn() };

vi.mock('@/hooks/useInvites', () => ({
  usePendingInvites: () => result,
  useAcceptInvite: () => ({ mutate: vi.fn(), isPending: false }),
  useDeclineInvite: () => ({ mutate: declineMutate, isPending: false }),
}));

const showToast = vi.fn();
vi.mock('@/components/ui', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/components/ui')>();
  return { ...actual, useToast: () => ({ showToast }) };
});

const invite: PendingInvite = {
  id: 'inv-1',
  member_type: 'caregiver',
  circle: { id: 'c1', name: "Mom's Care", recipient_name: 'Rose' },
  invited_by: { email: 'luis@example.com', first_name: 'Luis', last_name: 'Meza' },
  created_at: '2026-06-01T00:00:00Z',
  expires_at: new Date(Date.now() + 5 * 86400_000).toISOString(),
};

function renderPage(): void {
  render(
    <MemoryRouter>
      <PendingInvitesPage />
    </MemoryRouter>
  );
}

beforeEach(async () => {
  vi.clearAllMocks();
  vi.spyOn(Analytics, 'inviteDeclineTapped');
  vi.spyOn(Analytics, 'inviteDeclineConfirmed');
  vi.spyOn(Analytics, 'inviteDeclineFailed');
  result.data = [invite];
  await i18n.changeLanguage('en');
});

async function openConfirm(): Promise<HTMLElement> {
  await userEvent.click(screen.getByRole('button', { name: "Decline invite to Mom's Care" }));
  return screen.getByRole('dialog');
}

describe('PendingInvitesPage — decline', () => {
  it('P: confirm names the inviter, then declines by id and toasts success', async () => {
    declineMutate.mockImplementation((_v, o) =>
      o.onSuccess?.({ invite: { id: 'inv-1', status: 'declined' }, already_declined: false })
    );
    const confirmSpy = vi.spyOn(window, 'confirm');
    renderPage();
    const dialog = await openConfirm();
    expect(within(dialog).getByText('Decline this invite?')).toBeInTheDocument();
    expect(within(dialog).getByText(/We'll let Luis Meza know/)).toBeInTheDocument();
    await userEvent.click(within(dialog).getByRole('button', { name: 'Decline' }));
    expect(declineMutate).toHaveBeenCalledWith({ inviteId: 'inv-1' }, expect.any(Object));
    expect(showToast).toHaveBeenCalledWith('Invite declined', 'success');
    expect(Analytics.inviteDeclineTapped).toHaveBeenCalledWith('caregiver');
    expect(Analytics.inviteDeclineConfirmed).toHaveBeenCalledWith('caregiver', false);
    expect(confirmSpy).not.toHaveBeenCalled();
    expect(screen.queryByRole('dialog')).toBeNull();
  });

  it('P: a repeat decline (already_declined) is still success', async () => {
    declineMutate.mockImplementation((_v, o) =>
      o.onSuccess?.({ invite: { id: 'inv-1', status: 'declined' }, already_declined: true })
    );
    renderPage();
    const dialog = await openConfirm();
    await userEvent.click(within(dialog).getByRole('button', { name: 'Decline' }));
    expect(Analytics.inviteDeclineConfirmed).toHaveBeenCalledWith('caregiver', true);
    expect(showToast).toHaveBeenCalledWith('Invite declined', 'success');
  });

  it('N: "Keep invite" sends nothing', async () => {
    renderPage();
    const dialog = await openConfirm();
    const keep = within(dialog).getAllByRole('button', { name: 'Keep invite' });
    await userEvent.click(keep[keep.length - 1]);
    expect(declineMutate).not.toHaveBeenCalled();
    expect(Analytics.inviteDeclineConfirmed).not.toHaveBeenCalled();
    expect(screen.getByRole('button', { name: 'Accept' })).toBeInTheDocument();
  });

  it('N: a double click on Decline in the confirm is ONE request', async () => {
    declineMutate.mockImplementation(() => undefined); // held: never settles
    renderPage();
    const dialog = await openConfirm();
    const confirm = within(dialog).getByRole('button', { name: 'Decline' });
    await userEvent.click(confirm);
    await userEvent.click(confirm);
    expect(declineMutate).toHaveBeenCalledTimes(1);
  });

  it.each([
    ['INVITE_EXPIRED', 'This invite has expired.'],
    ['INVITE_CANCELLED', 'This invite is no longer active.'],
    ['INVITE_ALREADY_USED', 'This invite was already used.'],
    ['RATE_LIMIT', 'Too many tries. Please wait a few minutes and try again.'],
    ['SERVER_ERROR', "We couldn't decline this invite. Please try again."],
  ])('N: %s toasts its own copy and records the failure, never success', async (code, copy) => {
    declineMutate.mockImplementation((_v, o) => o.onError?.({ error: { code } }));
    renderPage();
    const dialog = await openConfirm();
    await userEvent.click(within(dialog).getByRole('button', { name: 'Decline' }));
    expect(showToast).toHaveBeenCalledWith(copy, 'error');
    expect(showToast).not.toHaveBeenCalledWith('Invite declined', 'success');
    expect(Analytics.inviteDeclineFailed).toHaveBeenCalledWith(code);
    expect(Analytics.inviteDeclineConfirmed).not.toHaveBeenCalled();
  });

  it('P: ES copy', async () => {
    await i18n.changeLanguage('es');
    renderPage();
    await userEvent.click(screen.getByRole('button', { name: "Rechazar la invitación a Mom's Care" }));
    const dialog = screen.getByRole('dialog');
    expect(within(dialog).getByText('¿Rechazar esta invitación?')).toBeInTheDocument();
    expect(within(dialog).getAllByRole('button', { name: 'Conservar invitación' }).length).toBeGreaterThan(0);
  });
});
