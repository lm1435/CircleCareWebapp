import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import '@/i18n';
import { InviteMemberModal } from '../InviteMemberModal';
import { Analytics } from '@/lib/analytics';
import type { CircleDetail } from '@/api/circleMembers';

/**
 * Free-tier seat PRE-CHECK in the invite modal (lib/inviteSeatPrecheck).
 *
 * Web had NO pre-check: the cap only appeared as a note after the 402, so a
 * free owner who had just sent invite #1 filled the whole form for #2 and was
 * refused on submit. The backend counts active caregivers + LIVE pending
 * caregiver invites; so does this card now. Mobile twin:
 * mobile/src/__tests__/screens/InviteMemberScreenSeatPrecheck.test.tsx.
 *
 *   P1 free owner + 1 live pending caregiver invite sees the card before submit
 *   P2 Upgrade on that card opens /upgrade (invite_cap) and fires analytics
 *   P3 the OLDEST live invite is the one named
 *   P4 members filling the cap keep the members-full copy
 *   N1 expired invite (server flag) not counted
 *   N2 expired invite (expires_at past, no flag) not counted
 *   N3 care-recipient invite not counted
 *   N4 manager never sees Upgrade
 *   N5 premium owner never capped
 *   N6 revoking the pending invite frees the seat
 *   N7 view-only member not counted
 *   N8 care-recipient role can still be invited while the seat is held
 *   N9 the refetch after a successful send fires no invite_cap_reached
 *      behind "Invitation sent"
 */

const mutate = vi.fn();
vi.mock('@/hooks/useInvites', () => ({
  useCreateInvite: () => ({ mutate, isPending: false }),
}));
vi.mock('@/components/ui', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/components/ui')>();
  return { ...actual, useToast: () => ({ showToast: vi.fn() }) };
});
vi.mock('@/lib/webBillingConfig', () => ({ isWebBillingConfigured: () => true }));
const navigate = vi.fn();
vi.mock('react-router-dom', async (importOriginal) => {
  const actual = await importOriginal<typeof import('react-router-dom')>();
  return { ...actual, useNavigate: () => navigate };
});
vi.mock('@/hooks/useDailyUpdate', () => ({ useDailyUpdateEnabled: () => false }));

const DAY = 24 * 60 * 60 * 1000;
const future = (): string => new Date(Date.now() + 5 * DAY).toISOString();
const past = (): string => new Date(Date.now() - DAY).toISOString();

type Seat = Pick<CircleDetail, 'members' | 'pending_invites' | 'is_premium_circle'>;
type Member = CircleDetail['members'][number];
type Invite = NonNullable<CircleDetail['pending_invites']>[number];

const person = (id: string, role: Member['role'], extra: Partial<Member> = {}): Member => ({
  id,
  email: `${id}@example.com`,
  first_name: null,
  last_name: null,
  role,
  is_care_recipient: false,
  is_medication_responsible: false,
  joined_at: '2026-11-01T00:00:00Z',
  timezone: null,
  ...extra,
});

const invite = (id: string, email: string, extra: Partial<Invite> = {}): Invite => ({
  id,
  invited_email: email,
  created_at: '2026-11-10T10:00:00Z',
  expires_at: future(),
  member_type: 'caregiver',
  is_expired: false,
  ...extra,
});

function seat(opts: { premium?: boolean; members?: Member[]; invites?: Invite[] } = {}): Seat {
  return {
    is_premium_circle: opts.premium ?? false,
    members: opts.members ?? [person('u1', 'owner')],
    pending_invites: opts.invites ?? [],
  };
}

function renderModal(circle: Seat, viewerIsOwner = true) {
  const ui = (c: Seat) => (
    <InviteMemberModal
      circleId="circle-1"
      isSelfCare={false}
      viewerIsOwner={viewerIsOwner}
      ownerName="Luis"
      circle={c}
      onClose={vi.fn()}
    />
  );
  const utils = render(ui(circle));
  return { ...utils, rerenderWith: (c: Seat) => utils.rerender(ui(c)) };
}

function expectFormOpen(): void {
  expect(screen.queryByTestId('invite-cap-card')).toBeNull();
  expect(screen.queryByTestId('invite-owner-limit-card')).toBeNull();
  expect(screen.getByLabelText(/^Email/)).toBeInTheDocument();
  expect(screen.getByRole('button', { name: 'Send invitation' })).toBeInTheDocument();
}

const capReached = vi.spyOn(Analytics, 'inviteCapReached');
const upgradeTapped = vi.spyOn(Analytics, 'inviteCapUpgradeTapped');

beforeEach(() => {
  vi.clearAllMocks();
});

describe('InviteMemberModal seat pre-check — positive', () => {
  it('P1 free owner with 1 live pending caregiver invite sees the card before submit', () => {
    renderModal(seat({ invites: [invite('i1', 'ana@example.com')] }));
    const card = screen.getByTestId('invite-cap-card');
    expect(card).toHaveTextContent('Your free invitation is in use');
    expect(card).toHaveTextContent('held by a pending invite to ana@example.com');
    expect(screen.queryByLabelText(/^Email/)).toBeNull();
    expect(screen.queryByRole('button', { name: 'Send invitation' })).toBeNull();
    expect(mutate).not.toHaveBeenCalled();
    expect(capReached).toHaveBeenCalledTimes(1);
    expect(capReached).toHaveBeenCalledWith({ caregiverCount: 1, reason: 'pending_invite_seat' });
  });

  it('P2 Upgrade on the card opens the invite_cap upgrade page and fires invite_cap_upgrade_tapped', async () => {
    const user = userEvent.setup();
    renderModal(seat({ invites: [invite('i1', 'ana@example.com')] }));
    await user.click(screen.getByTestId('invite-cap-upgrade-button'));
    expect(navigate).toHaveBeenCalledWith('/upgrade', { state: { paywallContext: 'invite_cap' } });
    expect(upgradeTapped).toHaveBeenCalledWith('pending_invite_seat');
  });

  it('P3 names the OLDEST live invite, as the backend 402 does', () => {
    renderModal(
      seat({
        invites: [
          invite('i2', 'newer@example.com', { created_at: '2026-11-12T10:00:00Z' }),
          invite('i1', 'older@example.com', { created_at: '2026-11-11T10:00:00Z' }),
        ],
      })
    );
    expect(screen.getByTestId('invite-cap-card')).toHaveTextContent('older@example.com');
    expect(screen.getByTestId('invite-cap-card')).not.toHaveTextContent('newer@example.com');
  });

  it('P4 members filling the cap keep the members-full copy', async () => {
    const user = userEvent.setup();
    renderModal(
      seat({
        members: [person('u1', 'owner'), person('u3', 'member')],
        invites: [invite('i1', 'ana@example.com')],
      })
    );
    const card = screen.getByTestId('invite-cap-card');
    expect(card).toHaveTextContent('Upgrade to invite more caregivers');
    expect(card).not.toHaveTextContent('ana@example.com');
    await user.click(screen.getByTestId('invite-cap-upgrade-button'));
    expect(upgradeTapped).toHaveBeenCalledWith('members_full');
    expect(capReached).toHaveBeenCalledWith({ caregiverCount: 2, reason: 'members_full' });
  });
});

describe('InviteMemberModal seat pre-check — negative', () => {
  it('N1 an expired invite (server is_expired) does not take the seat', () => {
    renderModal(
      seat({ invites: [invite('i1', 'ana@example.com', { is_expired: true, expires_at: past() })] })
    );
    expectFormOpen();
    expect(capReached).not.toHaveBeenCalled();
  });

  it('N2 an invite past expires_at with no server flag does not take the seat', () => {
    renderModal(
      seat({
        invites: [invite('i1', 'ana@example.com', { is_expired: undefined, expires_at: past() })],
      })
    );
    expectFormOpen();
  });

  it('N3 a care-recipient invite does not take a caregiver seat', () => {
    renderModal(seat({ invites: [invite('i1', 'mom@example.com', { member_type: 'care_recipient' })] }));
    expectFormOpen();
  });

  it('N4 a manager never sees Upgrade: ask-the-owner card only', () => {
    renderModal(
      seat({
        members: [person('u1', 'owner'), person('u2', 'manager')],
        invites: [invite('i1', 'ana@example.com')],
      }),
      false
    );
    const card = screen.getByTestId('invite-owner-limit-card');
    expect(card).toHaveTextContent('This circle is full');
    expect(card).toHaveTextContent('Only Luis, the circle owner, can upgrade');
    expect(screen.queryByTestId('invite-cap-upgrade-button')).toBeNull();
    expect(screen.queryByRole('button', { name: 'Upgrade' })).toBeNull();
    expect(navigate).not.toHaveBeenCalled();
    expect(upgradeTapped).not.toHaveBeenCalled();
  });

  it('N5 a premium owner is never capped by pending invites', () => {
    renderModal(
      seat({
        premium: true,
        members: [person('u1', 'owner'), person('u3', 'member')],
        invites: [invite('i1', 'ana@example.com'), invite('i2', 'bo@example.com')],
      })
    );
    expectFormOpen();
    expect(capReached).not.toHaveBeenCalled();
  });

  it('N6 revoking the pending invite frees the seat: the form comes back', () => {
    const { rerenderWith } = renderModal(seat({ invites: [invite('i1', 'ana@example.com')] }));
    expect(screen.getByTestId('invite-cap-card')).toBeInTheDocument();
    // useCancelInvite invalidates circleDetail; the refetch serves no pending invite.
    rerenderWith(seat({ invites: [] }));
    expectFormOpen();
  });

  it('N7 a view-only member does not take a seat', () => {
    renderModal(seat({ members: [person('u1', 'owner'), person('u3', 'member', { view_only: true })] }));
    expectFormOpen();
  });

  it('N8 the care-recipient role can still be invited while the caregiver seat is held', async () => {
    const user = userEvent.setup();
    renderModal(seat({ invites: [invite('i1', 'ana@example.com')] }));
    expect(screen.getByTestId('invite-cap-card')).toBeInTheDocument();
    await user.click(screen.getByTestId('invite-role-recipient'));
    expectFormOpen();
  });

  it('N9 a send that fills the seat fires no invite_cap_reached behind "Invitation sent"', async () => {
    const user = userEvent.setup();
    mutate.mockImplementation((_vars, opts) =>
      opts?.onSuccess?.({ invite: { invite_code: 'ABC123', invite_url: 'https://my.circlecare.app/invite/ABC123' } })
    );
    const { rerenderWith } = renderModal(seat());
    await user.type(screen.getByLabelText(/^Email/), 'ana@example.com');
    await user.click(screen.getByRole('button', { name: 'Send invitation' }));
    expect(await screen.findByText('Invitation sent')).toBeInTheDocument();
    rerenderWith(seat({ invites: [invite('i9', 'ana@example.com')] }));
    expect(screen.getByText('Invitation sent')).toBeInTheDocument();
    expect(capReached).not.toHaveBeenCalled();
  });

  it('no `circle` prop (older caller): no pre-check, the post-402 note stays the fallback', () => {
    render(<InviteMemberModal circleId="circle-1" isSelfCare={false} viewerIsOwner onClose={vi.fn()} />);
    expectFormOpen();
  });
});

// 1.4.3: a SHARED-LINK invite (no address) holds the seat.
describe('InviteMemberModal seat pre-check — shared-link invite (1.4.3)', () => {
  it('PL-P1: a live link invite holds the seat -> held-seat card naming a shared link, no Share/Send', () => {
    render(
      <InviteMemberModal
        viewerIsOwner
        circleId="circle-1"
        isSelfCare={false}
        onClose={vi.fn()}
        circle={seat({ members: [person('owner', 'owner')], invites: [invite('inv-link', null as unknown as string)] })}
      />
    );
    expect(screen.getByTestId('invite-cap-card')).toHaveTextContent('Your free invitation is in use');
    expect(screen.getByTestId('invite-cap-card')).toHaveTextContent(/shared invite link/i);
    expect(screen.getByTestId('invite-cap-card')).not.toHaveTextContent(/null/);
    expect(screen.queryByRole('button', { name: 'Share invite link' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Send invitation' })).toBeNull();
  });

  it('PL-N1: an EXPIRED link invite holds no seat: both invite buttons are offered', () => {
    render(
      <InviteMemberModal
        viewerIsOwner
        circleId="circle-1"
        isSelfCare={false}
        onClose={vi.fn()}
        circle={seat({
          members: [person('owner', 'owner')],
          invites: [invite('inv-link', null as unknown as string, { is_expired: true, expires_at: past() })],
        })}
      />
    );
    expect(screen.queryByTestId('invite-cap-card')).toBeNull();
    expect(screen.getByRole('button', { name: 'Share invite link' })).toBeInTheDocument();
  });
});
