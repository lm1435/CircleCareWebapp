import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import '@/i18n';
import MembersPage from '@/pages/MembersPage';
import type { CircleDetail, CircleMember, PendingCircleInvite } from '@/api/circleMembers';

// Manager role (docs/plans/manager-role.md) — MembersPage as OWNER (switch on /
// off), MANAGER, MEMBER and against an OLDER backend (no viewer_permissions).
// Same mocks as MembersPage.manage.test.tsx; that suite pins the owner path
// with no `viewer_permissions` at all (the older-backend fallback).
//
// Mobile-parity Task 22: per-member and per-invite actions moved behind a
// `MoreMenu` (spec §6.7), so every action here is a two-step interaction —
// open the row's menu (its trigger is uniquely labelled per row/email so
// several rows' triggers never collide), then activate the menuitem.

const navigate = vi.fn();
vi.mock('react-router-dom', async (importOriginal) => {
  const actual = await importOriginal<typeof import('react-router-dom')>();
  return { ...actual, useNavigate: () => navigate };
});

const removeMember = vi.fn();
const leaveCircle = vi.fn();
const setMedResponsible = vi.fn();
const setMemberRole = vi.fn();
vi.mock('@/hooks/useCircleMembers', () => ({
  useSetMemberRole: () => ({ mutate: setMemberRole, isPending: false }),
  useRemoveMember: () => ({ mutate: removeMember, isPending: false }),
  useLeaveCircle: () => ({ mutate: leaveCircle, isPending: false }),
  useSetMedicationResponsible: () => ({ mutate: setMedResponsible, isPending: false }),
}));

const cancelInvite = vi.fn();
const resendInvite = vi.fn();
vi.mock('@/hooks/useInvites', () => ({
  useCancelInvite: () => ({ mutate: cancelInvite, isPending: false }),
  useResendInvite: () => ({ mutate: resendInvite, isPending: false }),
  // InviteMemberModal (rendered when "Invite member" is clicked) uses this.
  useCreateInvite: () => ({ mutate: vi.fn(), isPending: false }),
}));

vi.mock('@/lib/analytics', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/analytics')>();
  return { ...actual, Analytics: { ...actual.Analytics, inviteLinkCopied: vi.fn() } };
});

const showToast = vi.fn();
vi.mock('@/components/ui', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/components/ui')>();
  return { ...actual, useToast: () => ({ showToast }) };
});

let currentUserId: string | null = 'u-owner';
vi.mock('@/store/authStore', () => ({
  useAuthStore: (selector: (s: { user: { id: string } | null }) => unknown) =>
    selector({ user: currentUserId ? { id: currentUserId } : null }),
}));

const useCircleResult: {
  circle: CircleDetail | undefined;
  members: CircleMember[];
  isLoading: boolean;
  isError: boolean;
  refetch: () => void;
} = {
  circle: undefined,
  members: [],
  isLoading: false,
  isError: false,
  refetch: vi.fn(),
};
vi.mock('@/hooks/useDailyUpdate', () => ({ useDailyUpdateEnabled: () => false }));
vi.mock('@/hooks/useCircle', () => ({
  useCircle: () => useCircleResult,
}));

function makeMember(overrides: Partial<CircleMember> = {}): CircleMember {
  return {
    id: 'u1',
    email: 'ana@example.com',
    first_name: 'Ana',
    last_name: 'Reyes',
    role: 'member',
    is_care_recipient: false,
    is_medication_responsible: false,
    joined_at: '2026-02-10T15:00:00Z',
    timezone: 'America/Chicago',
    ...overrides,
  };
}

function makeDetail(
  members: CircleMember[],
  overrides: Partial<CircleDetail> = {}
): CircleDetail {
  return {
    id: 'c1',
    name: "Mom's Care",
    recipient_name: 'Rose',
    recipient_photo_url: null,
    recipient_dob: null,
    recipient_conditions: null,
    owner_id: 'u-owner',
    created_at: '2026-01-01T00:00:00Z',
    is_self_care: false,
    care_recipient_timezone: 'America/Chicago',
    members,
    pending_invites: [],
    access_level: 'full',
    is_premium_circle: true,
    can_edit: true,
    view_only: false,
    ...overrides,
  };
}


function setCircle(
  members: CircleMember[],
  overrides: Partial<CircleDetail> = {}
): void {
  const detail = makeDetail(members, overrides);
  useCircleResult.circle = detail;
  useCircleResult.members = members;
}

function renderPage(): void {
  render(
    <MemoryRouter initialEntries={['/circles/c1/members']}>
      <Routes>
        <Route path="/circles/:circleId/members" element={<MembersPage />} />
      </Routes>
    </MemoryRouter>
  );
}

/** Opens a member row's `MoreMenu` (uniquely labelled "Actions for {{name}}"). */
async function openMemberMenu(user: ReturnType<typeof userEvent.setup>, name: string): Promise<void> {
  await user.click(screen.getByRole('button', { name: `Actions for ${name}` }));
}

/** Opens a pending-invite row's `MoreMenu` (uniquely labelled by email). */
async function openInviteMenu(user: ReturnType<typeof userEvent.setup>, email: string): Promise<void> {
  await user.click(screen.getByRole('button', { name: `Actions for invite to ${email}` }));
}

beforeEach(() => {
  vi.clearAllMocks();
  currentUserId = 'u-owner';
  useCircleResult.circle = undefined;
  useCircleResult.members = [];
});


const OWNER_ON = { viewer_role: 'owner' as const, viewer_permissions: ['manage_members', 'assign_manager'] as ('manage_members' | 'assign_manager')[] };
const OWNER_OFF = { viewer_role: 'owner' as const, viewer_permissions: ['manage_members'] as ('manage_members' | 'assign_manager')[] };
const MANAGER = { viewer_role: 'manager' as const, viewer_permissions: ['manage_members'] as ('manage_members' | 'assign_manager')[] };
const MEMBER = { viewer_role: 'member' as const, viewer_permissions: [] as ('manage_members' | 'assign_manager')[] };

/** Owner Luis, manager Mia, caregiver Ana, view-only caregiver Ben, recipient Rose. */
function roster(): CircleMember[] {
  return [
    makeMember({ id: 'u-owner', first_name: 'Luis', last_name: 'Meza', role: 'owner' }),
    makeMember({ id: 'u-mgr', first_name: 'Mia', last_name: 'Cruz', role: 'manager' }),
    makeMember({ id: 'u1', first_name: 'Ana', last_name: 'Reyes' }),
    makeMember({ id: 'u-vo', first_name: 'Ben', last_name: 'Ortiz', view_only: true }),
    makeMember({ id: 'u-rose', first_name: 'Rose', last_name: 'Diaz', is_care_recipient: true }),
  ];
}

const INVITE: PendingCircleInvite = {
  id: 'inv-1',
  invited_email: 'sam@example.com',
  created_at: '2026-10-01T00:00:00Z',
  expires_at: new Date(Date.now() + 6 * 24 * 60 * 60 * 1000).toISOString(),
  is_expired: false,
  invite_url: 'https://circlecare.app/invite/ABC123',
};

function menuItems(): string[] {
  return screen.getAllByRole('menuitem').map((el) => el.textContent ?? '');
}

describe('MembersPage — owner with the manager switch ON', () => {
  it('offers Make manager on a plain caregiver, Remove as manager on a manager, and keeps med + remove', async () => {
    const user = userEvent.setup();
    setCircle(roster(), OWNER_ON);
    renderPage();

    await openMemberMenu(user, 'Ana Reyes');
    expect(menuItems()).toEqual(['Make medication manager', 'Make manager', 'Remove']);
    await user.keyboard('{Escape}');

    await openMemberMenu(user, 'Mia Cruz');
    expect(menuItems()).toEqual(['Make medication manager', 'Remove as manager', 'Remove']);
  });

  it('never offers Make manager on a view-only seat (the backend refuses it)', async () => {
    const user = userEvent.setup();
    setCircle(roster(), OWNER_ON);
    renderPage();
    await openMemberMenu(user, 'Ben Ortiz');
    expect(menuItems()).toEqual(['Make medication manager', 'Remove']);
  });

  it('confirms, then PATCHes the role with the member name for the toast', async () => {
    const user = userEvent.setup();
    setCircle(roster(), OWNER_ON);
    renderPage();
    await openMemberMenu(user, 'Ana Reyes');
    await user.click(screen.getByRole('menuitem', { name: 'Make manager' }));
    const dialog = screen.getByRole('dialog');
    expect(dialog).toHaveTextContent('Make Ana Reyes a manager?');
    expect(dialog).toHaveTextContent('Only you can change circle settings');
    await user.click(within(dialog).getByRole('button', { name: 'Make manager' }));
    expect(setMemberRole).toHaveBeenCalledTimes(1);
    expect(setMemberRole.mock.calls[0][0]).toEqual({ userId: 'u1', role: 'manager', name: 'Ana Reyes' });
  });

  it('demotes a manager back to member after confirm', async () => {
    const user = userEvent.setup();
    setCircle(roster(), OWNER_ON);
    renderPage();
    await openMemberMenu(user, 'Mia Cruz');
    await user.click(screen.getByRole('menuitem', { name: 'Remove as manager' }));
    const dialog = screen.getByRole('dialog');
    expect(dialog).toHaveTextContent('Remove Mia Cruz as manager?');
    await user.click(within(dialog).getByRole('button', { name: 'Remove as manager' }));
    expect(setMemberRole.mock.calls[0][0]).toEqual({ userId: 'u-mgr', role: 'member', name: 'Mia Cruz' });
  });

  it('cancelling the confirm sends nothing', async () => {
    const user = userEvent.setup();
    setCircle(roster(), OWNER_ON);
    renderPage();
    await openMemberMenu(user, 'Ana Reyes');
    await user.click(screen.getByRole('menuitem', { name: 'Make manager' }));
    const cancel = within(screen.getByRole('dialog'))
      .getAllByRole('button', { name: 'Cancel' })
      .find((b) => b.textContent === 'Cancel')!;
    await user.click(cancel);
    expect(setMemberRole).not.toHaveBeenCalled();
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });

  it('shows the Manager badge on a manager row', () => {
    setCircle(roster(), OWNER_ON);
    renderPage();
    const row = screen.getByText(/Mia Cruz/).closest('li')!;
    expect(within(row).getByText('Manager')).toBeInTheDocument();
  });
});

describe('MembersPage — owner with the switch OFF (no assign_manager): identical to today', () => {
  it('offers no manager item anywhere', async () => {
    const user = userEvent.setup();
    setCircle(roster(), OWNER_OFF);
    renderPage();
    await openMemberMenu(user, 'Ana Reyes');
    expect(menuItems()).toEqual(['Make medication manager', 'Remove']);
    expect(screen.queryByRole('menuitem', { name: /^(Make manager|Remove as manager)$/ })).toBeNull();
  });

  it('matches an older backend (no viewer fields) item for item', async () => {
    const user = userEvent.setup();
    setCircle(roster(), OWNER_OFF);
    const { unmount } = render(
      <MemoryRouter initialEntries={['/circles/c1/members']}>
        <Routes>
          <Route path="/circles/:circleId/members" element={<MembersPage />} />
        </Routes>
      </MemoryRouter>
    );
    await openMemberMenu(user, 'Ana Reyes');
    const withFields = menuItems();
    unmount();

    setCircle(roster(), {});
    renderPage();
    await openMemberMenu(user, 'Ana Reyes');
    expect(menuItems()).toEqual(withFields);
  });
});

describe('MembersPage — MANAGER', () => {
  beforeEach(() => {
    currentUserId = 'u-mgr';
  });

  it('gets the Invite action, the manager subtitle and Leave circle', () => {
    setCircle(roster(), MANAGER);
    renderPage();
    expect(screen.getAllByRole('button', { name: 'Invite member' }).length).toBeGreaterThan(0);
    expect(
      screen.getByText('Everyone in this care circle. As a manager, you can invite people and remove caregivers.')
    ).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Leave circle' })).toBeInTheDocument();
  });

  it('can Remove a plain caregiver — and that is the ONLY item (no med reminders, no role)', async () => {
    const user = userEvent.setup();
    setCircle(roster(), MANAGER);
    renderPage();
    await openMemberMenu(user, 'Ana Reyes');
    expect(menuItems()).toEqual(['Remove']);
    await user.click(screen.getByRole('menuitem', { name: 'Remove' }));
    await user.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'Remove' }));
    expect(removeMember.mock.calls[0][0]).toEqual({ userId: 'u1' });
  });

  it('can remove a view-only caregiver too (role is still member)', async () => {
    const user = userEvent.setup();
    setCircle(roster(), MANAGER);
    renderPage();
    await openMemberMenu(user, 'Ben Ortiz');
    expect(menuItems()).toEqual(['Remove']);
  });

  it('has NO actions on the owner, another manager, the care recipient or their own row', () => {
    setCircle(
      [...roster(), makeMember({ id: 'u-mgr2', first_name: 'Ivy', last_name: 'Park', role: 'manager' })],
      MANAGER
    );
    renderPage();
    for (const name of ['Luis Meza', 'Ivy Park', 'Rose Diaz', 'Mia Cruz']) {
      expect(screen.queryByRole('button', { name: `Actions for ${name}` })).toBeNull();
    }
    expect(screen.getByRole('button', { name: 'Actions for Ana Reyes' })).toBeInTheDocument();
  });

  it('sees the pending-invite list with Copy link and Cancel, and can cancel', async () => {
    const user = userEvent.setup();
    setCircle(roster(), { ...MANAGER, pending_invites: [INVITE] });
    renderPage();
    expect(screen.getByRole('heading', { name: 'Pending invites' })).toBeInTheDocument();
    await openInviteMenu(user, 'sam@example.com');
    expect(menuItems()).toEqual(['Copy link', 'Cancel invite']);
    await user.click(screen.getByRole('menuitem', { name: 'Cancel invite' }));
    await user.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'Cancel invite' }));
    expect(cancelInvite.mock.calls[0][0]).toEqual({ inviteId: 'inv-1' });
  });

  it('never gets the solo-owner nudge', () => {
    setCircle([makeMember({ id: 'u-mgr', first_name: 'Mia', role: 'manager' })], MANAGER);
    renderPage();
    expect(screen.queryByText('Care is easier together')).toBeNull();
  });
});

describe('MembersPage — MEMBER (and a demoted manager)', () => {
  beforeEach(() => {
    currentUserId = 'u1';
  });

  it('gets no Invite, no pending list, no row actions', () => {
    // A defensive server could still send rows; the list must stay hidden.
    setCircle(roster(), { ...MEMBER, pending_invites: [INVITE] });
    renderPage();
    expect(screen.queryByRole('button', { name: 'Invite member' })).toBeNull();
    expect(screen.queryByRole('heading', { name: 'Pending invites' })).toBeNull();
    expect(screen.queryAllByRole('button', { name: /^Actions for (?!invite)/ })).toHaveLength(0);
    expect(screen.getByText('Everyone helping coordinate care in this circle.')).toBeInTheDocument();
  });

  it('a demoted manager (stored manager, empty permissions) is treated as a member', () => {
    currentUserId = 'u-mgr';
    setCircle(roster(), { viewer_role: 'manager', viewer_permissions: [] });
    renderPage();
    expect(screen.queryByRole('button', { name: 'Invite member' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Actions for Ana Reyes' })).toBeNull();
  });
});
