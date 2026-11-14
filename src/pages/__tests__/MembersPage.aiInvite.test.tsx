import { render, screen } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import i18n from 'i18next';
import '@/i18n';
import MembersPage from '@/pages/MembersPage';
import type { CircleDetail, CircleMember } from '@/api/circleMembers';

// 1.4.2 (care-assistant understanding fix): the assistant's "Invite someone" button lands on
// Members with `state.openInvite`, which opens the same invite dialog the header button opens, for
// a viewer who may invite (owner / manager). The flag is consumed (history entry replaced). A
// viewer who may not invite just sees the roster. Harness: MembersPage.manage.test.tsx.

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

function renderWithState(state: unknown): void {
  render(
    <MemoryRouter initialEntries={[{ pathname: '/circles/c1/members', state }]}>
      <Routes>
        <Route path="/circles/:circleId/members" element={<MembersPage />} />
      </Routes>
    </MemoryRouter>
  );
}

const inviteTitle = (): string => i18n.t('members:invite.title');

beforeEach(async () => {
  vi.clearAllMocks();
  currentUserId = 'u-owner';
  await i18n.changeLanguage('en');
  setCircle([makeMember({ id: 'u-owner', role: 'owner' }), makeMember()]);
});

describe('MembersPage — open the invite dialog from the assistant', () => {
  it('P: the owner lands with the invite dialog open, and the flag is consumed', async () => {
    renderWithState({ openInvite: true });
    expect(await screen.findByRole('dialog', { name: inviteTitle() })).toBeInTheDocument();
    expect(navigate).toHaveBeenCalledWith('/circles/c1/members', { replace: true, state: null });
  });

  it('N: a member who may not invite sees the roster, never the dialog', () => {
    currentUserId = 'u1';
    renderWithState({ openInvite: true });
    expect(screen.queryByRole('dialog', { name: inviteTitle() })).not.toBeInTheDocument();
    expect(navigate).toHaveBeenCalledWith('/circles/c1/members', { replace: true, state: null });
  });

  it('N: without the flag nothing opens', () => {
    renderWithState(null);
    expect(screen.queryByRole('dialog', { name: inviteTitle() })).not.toBeInTheDocument();
    expect(navigate).not.toHaveBeenCalled();
  });
});
