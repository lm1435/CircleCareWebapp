import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import '@/i18n';
import MembersPage from '@/pages/MembersPage';
import type { CircleDetail, CircleMember, PendingCircleInvite } from '@/api/circleMembers';

// Stage 5 Task 5.4/5.7 — owner-only member management wiring. The read-only
// roster behavior is covered by MembersPage.test.tsx; this suite focuses on the
// owner/non-owner gating and that confirm dialogs fire the right hook.

const navigate = vi.fn();
vi.mock('react-router-dom', async (importOriginal) => {
  const actual = await importOriginal<typeof import('react-router-dom')>();
  return { ...actual, useNavigate: () => navigate };
});

const removeMember = vi.fn();
const leaveCircle = vi.fn();
const setMedResponsible = vi.fn();
vi.mock('@/hooks/useCircleMembers', () => ({
  useRemoveMember: () => ({ mutate: removeMember, isPending: false }),
  useLeaveCircle: () => ({ mutate: leaveCircle, isPending: false }),
  useSetMedicationResponsible: () => ({ mutate: setMedResponsible, isPending: false }),
}));

const cancelInvite = vi.fn();
vi.mock('@/hooks/useInvites', () => ({
  useCancelInvite: () => ({ mutate: cancelInvite, isPending: false }),
  // InviteMemberModal (rendered when "Invite member" is clicked) uses this.
  useCreateInvite: () => ({ mutate: vi.fn(), isPending: false }),
}));

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

beforeEach(() => {
  vi.clearAllMocks();
  currentUserId = 'u-owner';
  useCircleResult.circle = undefined;
  useCircleResult.members = [];
});

describe('MembersPage — owner management', () => {
  it('shows the Invite member button for the owner', () => {
    setCircle([makeMember({ id: 'u-owner', role: 'owner' })]);
    renderPage();
    expect(screen.getByRole('button', { name: 'Invite member' })).toBeInTheDocument();
  });

  it('hides the Invite member button and shows Leave for a non-owner', () => {
    currentUserId = 'u1';
    setCircle([
      makeMember({ id: 'u-owner', first_name: 'Luis', role: 'owner' }),
      makeMember({ id: 'u1' }),
    ]);
    renderPage();
    expect(screen.queryByRole('button', { name: 'Invite member' })).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Leave circle' })).toBeInTheDocument();
  });

  it('shows the solo-owner prompt to invite the first caregiver and opens the modal', async () => {
    const user = userEvent.setup();
    setCircle([makeMember({ id: 'u-owner', role: 'owner' })]);
    renderPage();
    expect(screen.getByText('Care is easier together')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Invite your first caregiver' }));
    expect(screen.getByRole('dialog')).toHaveTextContent('Invite a member');
  });

  it('hides the solo-owner prompt once another member exists', () => {
    setCircle([
      makeMember({ id: 'u-owner', role: 'owner' }),
      makeMember({ id: 'u1', first_name: 'Ana' }),
    ]);
    renderPage();
    expect(screen.queryByText('Care is easier together')).not.toBeInTheDocument();
  });

  it('opens the invite modal when the owner clicks Invite member', async () => {
    const user = userEvent.setup();
    setCircle([makeMember({ id: 'u-owner', role: 'owner' })]);
    renderPage();
    await user.click(screen.getByRole('button', { name: 'Invite member' }));
    expect(screen.getByRole('dialog')).toHaveTextContent('Invite a member');
  });

  it('owner-removing a caregiver fires useRemoveMember after confirm', async () => {
    const user = userEvent.setup();
    setCircle([
      makeMember({ id: 'u-owner', first_name: 'Luis', role: 'owner' }),
      makeMember({ id: 'u1', first_name: 'Ana' }),
    ]);
    renderPage();

    await user.click(screen.getByRole('button', { name: 'Remove Ana Reyes' }));
    const dialog = screen.getByRole('dialog');
    await user.click(within(dialog).getByRole('button', { name: 'Remove' }));

    expect(removeMember).toHaveBeenCalledTimes(1);
    expect(removeMember.mock.calls[0][0]).toEqual({ userId: 'u1' });
  });

  it('does not offer remove/med-manager actions for the care recipient', () => {
    setCircle([
      makeMember({ id: 'u-owner', role: 'owner' }),
      makeMember({ id: 'u3', first_name: 'Rose', is_care_recipient: true }),
    ]);
    renderPage();
    expect(screen.queryByRole('button', { name: /Remove Rose/ })).not.toBeInTheDocument();
  });

  it('toggling the medication manager fires useSetMedicationResponsible with the user id', async () => {
    const user = userEvent.setup();
    setCircle([
      makeMember({ id: 'u-owner', role: 'owner' }),
      makeMember({ id: 'u1', first_name: 'Ana', is_medication_responsible: false }),
    ]);
    renderPage();

    await user.click(screen.getByRole('button', { name: 'Make med manager' }));
    expect(setMedResponsible).toHaveBeenCalledWith('u1', expect.anything());
    expect(setMedResponsible.mock.calls[0][0]).toBe('u1');
  });

  it('clearing the medication manager passes null', async () => {
    const user = userEvent.setup();
    setCircle([
      makeMember({ id: 'u-owner', role: 'owner' }),
      makeMember({ id: 'u1', first_name: 'Ana', is_medication_responsible: true }),
    ]);
    renderPage();

    await user.click(screen.getByRole('button', { name: 'Remove med manager' }));
    expect(setMedResponsible.mock.calls[0][0]).toBeNull();
  });

  it('leaving the circle fires useLeaveCircle and navigates to /circles', async () => {
    const user = userEvent.setup();
    currentUserId = 'u1';
    leaveCircle.mockImplementation((_vars, opts) => opts?.onSuccess?.());
    setCircle([
      makeMember({ id: 'u-owner', first_name: 'Luis', role: 'owner' }),
      makeMember({ id: 'u1' }),
    ]);
    renderPage();

    await user.click(screen.getByRole('button', { name: 'Leave circle' }));
    const dialog = screen.getByRole('dialog');
    await user.click(within(dialog).getByRole('button', { name: 'Leave circle' }));

    expect(leaveCircle).toHaveBeenCalledTimes(1);
    expect(navigate).toHaveBeenCalledWith('/circles');
  });

  it('lists pending invites and cancels one via useCancelInvite after confirm', async () => {
    const user = userEvent.setup();
    const invite: PendingCircleInvite = {
      id: 'inv-1',
      invited_email: 'pending@example.com',
      created_at: '2026-06-01T00:00:00Z',
      expires_at: '2026-06-08T00:00:00Z',
    };
    setCircle([makeMember({ id: 'u-owner', role: 'owner' })], { pending_invites: [invite] });
    renderPage();

    expect(screen.getByText('pending@example.com')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Cancel invite for pending@example.com' }));
    const dialog = screen.getByRole('dialog');
    await user.click(within(dialog).getByRole('button', { name: 'Cancel invite' }));

    expect(cancelInvite).toHaveBeenCalledTimes(1);
    expect(cancelInvite.mock.calls[0][0]).toEqual({ inviteId: 'inv-1' });
  });
});
