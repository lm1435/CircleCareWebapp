import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import '@/i18n';
import { CareTeam } from '../CareTeam';
import { useRemoveMember, useSetMedicationResponsible } from '@/hooks/useCircleMembers';
import type { CircleDetail, CircleMember } from '@/api/circleMembers';

const removeMutate = vi.fn();
const setMedMutate = vi.fn();
vi.mock('@/hooks/useCircleMembers', () => ({
  useRemoveMember: vi.fn(),
  useSetMedicationResponsible: vi.fn(),
}));

// Home had no instrumentation on web; the solo nudge's CTA is the one press
// that says whether the biggest retention lever on the surface is working.
const soloInviteTapped = vi.fn();
vi.mock('@/lib/analytics', () => ({
  Analytics: { soloInviteTapped: (...args: unknown[]) => soloInviteTapped(...args) },
}));

const OWNER = 'u-owner';

function member(overrides: Partial<CircleMember> & { id: string }): CircleMember {
  return {
    email: `${overrides.id}@example.com`,
    first_name: null,
    last_name: null,
    role: 'member',
    is_care_recipient: false,
    is_medication_responsible: false,
    joined_at: '2026-01-01T00:00:00Z',
    timezone: null,
    ...overrides,
  };
}

function circleWith(overrides?: Partial<CircleDetail>): CircleDetail {
  return {
    id: 'c1',
    recipient_name: 'Rose',
    is_self_care: false,
    owner_id: OWNER,
    pending_invites: [],
    ...overrides,
  } as CircleDetail;
}

function renderTeam(opts?: {
  members?: CircleMember[];
  circle?: CircleDetail;
  isOwner?: boolean;
  currentUserId?: string;
}): void {
  render(
    <MemoryRouter>
      <CareTeam
        circleId="c1"
        circle={opts?.circle ?? circleWith()}
        members={
          opts?.members ?? [
            member({ id: OWNER, first_name: 'Pat', last_name: 'Lee', role: 'owner' }),
            member({ id: 'u-rose', first_name: 'Rose', is_care_recipient: true }),
          ]
        }
        currentUserId={opts?.currentUserId ?? OWNER}
        isOwner={opts?.isOwner ?? true}
      />
    </MemoryRouter>
  );
}

describe('CareTeam', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(useRemoveMember).mockReturnValue({
      mutate: removeMutate,
    } as unknown as ReturnType<typeof useRemoveMember>);
    vi.mocked(useSetMedicationResponsible).mockReturnValue({
      mutate: setMedMutate,
    } as unknown as ReturnType<typeof useSetMedicationResponsible>);
  });

  it('shows the member-count pill and marks the current user', () => {
    renderTeam();
    expect(screen.getByText('2 members')).toBeInTheDocument();
    expect(screen.getByText('Pat Lee (You)')).toBeInTheDocument();
  });

  it('overlays a coral heart on the care recipient and a moss bell on the med manager', () => {
    renderTeam({
      members: [
        member({ id: OWNER, first_name: 'Pat', role: 'owner' }),
        member({ id: 'u-rose', first_name: 'Rose', is_care_recipient: true }),
        member({ id: 'u-sam', first_name: 'Sam', is_medication_responsible: true }),
      ],
    });
    expect(screen.getByTestId('recipient-dot-u-rose')).toHaveClass('bg-coral');
    expect(screen.getByTestId('med-manager-dot-u-sam')).toHaveClass('bg-moss');
    expect(screen.getByRole('img', { name: 'Care recipient' })).toBeInTheDocument();
    expect(
      screen.getByRole('img', { name: 'Manages medication reminders' })
    ).toBeInTheDocument();
  });

  it('titles the section "My care team" when the viewer IS the care recipient', () => {
    renderTeam({
      currentUserId: 'u-rose',
      isOwner: false,
      members: [
        member({ id: OWNER, first_name: 'Pat', role: 'owner' }),
        member({ id: 'u-rose', first_name: 'Rose', is_care_recipient: true }),
      ],
    });
    expect(screen.getByRole('heading', { name: 'My care team' })).toBeInTheDocument();
  });

  it('gives the owner an Invite button into members', () => {
    renderTeam();
    expect(screen.getByRole('link', { name: 'Invite member' })).toHaveAttribute(
      'href',
      '/circles/c1/members'
    );
  });

  it('hides the Invite button from non-owners', () => {
    renderTeam({ isOwner: false, currentUserId: 'u-sam' });
    expect(screen.queryByRole('link', { name: 'Invite member' })).not.toBeInTheDocument();
  });

  // Mobile's `isTappable`: owner only, never the recipient, never yourself.
  it('offers the action menu only on other, non-recipient members', () => {
    renderTeam({
      members: [
        member({ id: OWNER, first_name: 'Pat', role: 'owner' }),
        member({ id: 'u-rose', first_name: 'Rose', is_care_recipient: true }),
        member({ id: 'u-sam', first_name: 'Sam' }),
      ],
    });
    expect(screen.getAllByRole('button', { name: /^Remove / })).toHaveLength(1);
    expect(screen.getByRole('button', { name: 'Remove Sam' })).toBeInTheDocument();
  });

  it('gives non-owners no member actions at all', () => {
    renderTeam({
      isOwner: false,
      currentUserId: 'u-sam',
      members: [
        member({ id: OWNER, first_name: 'Pat', role: 'owner' }),
        member({ id: 'u-sam', first_name: 'Sam' }),
      ],
    });
    expect(screen.queryByRole('button', { name: /^Remove / })).not.toBeInTheDocument();
  });

  it('toggles the medication manager from the menu', async () => {
    const user = userEvent.setup();
    renderTeam({
      members: [
        member({ id: OWNER, first_name: 'Pat', role: 'owner' }),
        member({ id: 'u-sam', first_name: 'Sam' }),
      ],
    });
    await user.click(screen.getByRole('button', { name: 'Remove Sam' }));
    await user.click(screen.getByRole('menuitem', { name: 'Make medication manager' }));
    expect(setMedMutate).toHaveBeenCalledWith('u-sam');
  });

  // The other half of the toggle: on the CURRENT manager the same entry clears
  // the role, which the API takes as `null` — sending the member's id again
  // would re-assign the role the owner just asked to remove.
  it('clears the medication manager from the menu when the member already holds it', async () => {
    const user = userEvent.setup();
    renderTeam({
      members: [
        member({ id: OWNER, first_name: 'Pat', role: 'owner' }),
        member({ id: 'u-sam', first_name: 'Sam', is_medication_responsible: true }),
      ],
    });
    await user.click(screen.getByRole('button', { name: 'Remove Sam' }));
    expect(screen.queryByRole('menuitem', { name: 'Make medication manager' })).toBeNull();
    await user.click(screen.getByRole('menuitem', { name: 'Remove medication manager' }));
    expect(setMedMutate).toHaveBeenCalledTimes(1);
    expect(setMedMutate).toHaveBeenCalledWith(null);
  });

  it('confirms before removing a member', async () => {
    const user = userEvent.setup();
    renderTeam({
      members: [
        member({ id: OWNER, first_name: 'Pat', role: 'owner' }),
        member({ id: 'u-sam', first_name: 'Sam' }),
      ],
    });
    await user.click(screen.getByRole('button', { name: 'Remove Sam' }));
    await user.click(screen.getByRole('menuitem', { name: 'Remove' }));

    expect(screen.getByText('Remove member?')).toBeInTheDocument();
    expect(removeMutate).not.toHaveBeenCalled();

    await user.click(screen.getByRole('button', { name: 'Remove' }));
    expect(removeMutate).toHaveBeenCalledWith({ userId: 'u-sam' });
  });

  describe('solo invite card', () => {
    it('nudges a lone owner with no live invites', () => {
      renderTeam({ members: [member({ id: OWNER, first_name: 'Pat', role: 'owner' })] });
      expect(screen.getByRole('heading', { name: 'Care is easier together' })).toBeInTheDocument();
      expect(screen.getByText(/help coordinate Rose's care/)).toBeInTheDocument();
      expect(
        screen.getByRole('link', { name: 'Invite your first caregiver' })
      ).toHaveAttribute('href', '/circles/c1/members');
    });

    // `Analytics.soloInviteTapped` takes no arguments — the event carries no
    // circle id — so this pins the press and its EMPTY argument list, not a
    // circle.
    it('reports the CTA press, with no properties', async () => {
      const user = userEvent.setup();
      renderTeam({ members: [member({ id: OWNER, first_name: 'Pat', role: 'owner' })] });
      await user.click(screen.getByRole('link', { name: 'Invite your first caregiver' }));
      expect(soloInviteTapped).toHaveBeenCalledTimes(1);
      expect(soloInviteTapped).toHaveBeenCalledWith();
    });

    it('uses the self-care copy, which names nobody', () => {
      renderTeam({
        circle: circleWith({ is_self_care: true }),
        members: [member({ id: OWNER, first_name: 'Pat', role: 'owner' })],
      });
      expect(screen.getByText(/so you don't carry it alone/)).toBeInTheDocument();
    });

    // An expired invite is not an outstanding one — nobody can act on it, so it
    // must NOT silence the nudge.
    it('stays visible when the only pending invite has expired', () => {
      renderTeam({
        circle: circleWith({
          pending_invites: [
            { id: 'i1', email: 'x@example.com', is_expired: true } as never,
          ],
        }),
        members: [member({ id: OWNER, first_name: 'Pat', role: 'owner' })],
      });
      expect(screen.getByRole('heading', { name: 'Care is easier together' })).toBeInTheDocument();
    });

    it('disappears once a live invite is out', () => {
      renderTeam({
        circle: circleWith({
          pending_invites: [
            { id: 'i1', email: 'x@example.com', is_expired: false } as never,
          ],
        }),
        members: [member({ id: OWNER, first_name: 'Pat', role: 'owner' })],
      });
      expect(
        screen.queryByRole('heading', { name: 'Care is easier together' })
      ).not.toBeInTheDocument();
    });

    it('disappears once a second member has joined', () => {
      renderTeam();
      expect(
        screen.queryByRole('heading', { name: 'Care is easier together' })
      ).not.toBeInTheDocument();
    });
  });
});
