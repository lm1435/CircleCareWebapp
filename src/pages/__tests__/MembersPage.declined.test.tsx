import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import MembersPage from '@/pages/MembersPage';
import { Analytics } from '@/lib/analytics';
import type { CircleDetail, CircleMember, DeclinedCircleInvite } from '@/api/circleMembers';
import i18n from '@/i18n';

// 1.4.3 declined invites on Members (docs/plans/invite-decline-1-4-3.md), mobile
// parity with CircleDetailDeclinedInvites.test.tsx. Harness from
// MembersPage.manage.test.tsx.

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
const createInvite = vi.fn();
vi.mock('@/hooks/useInvites', () => ({
  useCancelInvite: () => ({ mutate: cancelInvite, isPending: false }),
  useResendInvite: () => ({ mutate: resendInvite, isPending: false }),
  useCreateInvite: () => ({ mutate: createInvite, isPending: false }),
}));

vi.mock('@/lib/analytics', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/analytics')>();
  return {
    ...actual,
    Analytics: {
      ...actual.Analytics,
      inviteLinkCopied: vi.fn(),
      declinedInviteReinvited: vi.fn(),
      declinedInviteRemoved: vi.fn(),
    },
  };
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

type MutateOpts = { onSuccess?: (r?: unknown) => void; onError?: (e: unknown) => void };

const owner = makeMember({ id: 'u-owner', email: 'owner@example.com', first_name: 'Olga', role: 'owner' });
function declined(overrides: Partial<DeclinedCircleInvite> = {}): DeclinedCircleInvite {
  return {
    id: 'd1',
    invited_email: 'pat@example.com',
    member_type: 'caregiver',
    created_at: '2026-11-17T21:04:00.000Z',
    status: 'declined',
    declined_at: '2026-11-17T22:10:31.000Z',
    ...overrides,
  };
}

beforeEach(async () => {
  vi.clearAllMocks();
  currentUserId = 'u-owner';
  await i18n.changeLanguage('en');
  setCircle([owner], { declined_invites: [declined()] });
});

describe('MembersPage — declined invites', () => {
  it('P: owner sees the row marked Declined with the date, Invite again and Remove', () => {
    renderPage();
    const section = screen.getByTestId('declined-invites-section');
    expect(within(section).getByText('Declined invites')).toBeInTheDocument();
    expect(within(section).getByText('pat@example.com')).toBeInTheDocument();
    expect(within(section).getByText(/^Declined (November 1[78]|1[78] November)$/)).toBeInTheDocument();
    expect(within(section).getByRole('button', { name: 'Invite again: pat@example.com' })).toBeInTheDocument();
    expect(
      within(section).getByRole('button', { name: 'Remove declined invite for pat@example.com' })
    ).toBeInTheDocument();
  });

  it('P: declined_at null reads plain "Declined"', () => {
    setCircle([owner], { declined_invites: [declined({ declined_at: null })] });
    renderPage();
    expect(within(screen.getByTestId('declined-invites-section')).getByText('Declined')).toBeInTheDocument();
  });

  it('P: ES copy', async () => {
    await i18n.changeLanguage('es');
    setCircle([owner], { declined_invites: [declined({ declined_at: null })] });
    renderPage();
    const section = screen.getByTestId('declined-invites-section');
    expect(within(section).getByText('Invitaciones rechazadas')).toBeInTheDocument();
    expect(within(section).getByText('Rechazada')).toBeInTheDocument();
    expect(within(section).getByText('Invitar de nuevo')).toBeInTheDocument();
    expect(within(section).getByText('Quitar')).toBeInTheDocument();
  });

  it('N: no Resend, no Copy link, no actions menu on a declined row', () => {
    renderPage();
    const section = screen.getByTestId('declined-invites-section');
    expect(within(section).queryByText('Resend')).toBeNull();
    expect(within(section).queryByText('Copy link')).toBeNull();
    expect(screen.queryByRole('button', { name: 'Actions for invite to pat@example.com' })).toBeNull();
    expect(screen.queryByText('Pending invites')).toBeNull();
  });

  it('P: Invite again confirms in-page, then creates a NEW invite (email + member type)', async () => {
    setCircle([owner], { declined_invites: [declined({ member_type: 'care_recipient' })] });
    createInvite.mockImplementation((_v: unknown, o: MutateOpts) => o.onSuccess?.());
    renderPage();
    await userEvent.click(screen.getByRole('button', { name: 'Invite again: pat@example.com' }));
    const dialog = screen.getByRole('dialog');
    expect(within(dialog).getByText('Invite again?')).toBeInTheDocument();
    await userEvent.click(within(dialog).getByRole('button', { name: 'Invite again' }));
    expect(createInvite).toHaveBeenCalledWith(
      { email: 'pat@example.com', member_type: 'care_recipient' },
      expect.any(Object)
    );
    expect(resendInvite).not.toHaveBeenCalled();
    expect(Analytics.declinedInviteReinvited).toHaveBeenCalledWith('care_recipient');
    expect(showToast).toHaveBeenCalledWith('Invitation sent to pat@example.com.', 'success');
  });

  it('N: Invite again cancelled at the confirm sends nothing', async () => {
    renderPage();
    await userEvent.click(screen.getByRole('button', { name: 'Invite again: pat@example.com' }));
    const dialog = screen.getByRole('dialog');
    const cancels = within(dialog).getAllByRole('button', { name: 'Cancel' });
    await userEvent.click(cancels[cancels.length - 1]);
    expect(createInvite).not.toHaveBeenCalled();
    expect(Analytics.declinedInviteReinvited).not.toHaveBeenCalled();
  });

  it('N: a refused Invite again (402) records no reinvite and no success toast', async () => {
    createInvite.mockImplementation((_v: unknown, o: MutateOpts) =>
      o.onError?.({ error: { code: 'SUBSCRIPTION_REQUIRED' } })
    );
    renderPage();
    await userEvent.click(screen.getByRole('button', { name: 'Invite again: pat@example.com' }));
    await userEvent.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'Invite again' }));
    expect(Analytics.declinedInviteReinvited).not.toHaveBeenCalled();
    expect(showToast).not.toHaveBeenCalledWith(expect.stringContaining('Invitation sent'), 'success');
  });

  it('P: Remove dismisses through the existing cancel (DELETE)', async () => {
    cancelInvite.mockImplementation((_v: unknown, o: MutateOpts) => o.onSuccess?.());
    renderPage();
    await userEvent.click(screen.getByRole('button', { name: 'Remove declined invite for pat@example.com' }));
    expect(cancelInvite).toHaveBeenCalledWith({ inviteId: 'd1' }, expect.any(Object));
    expect(Analytics.declinedInviteRemoved).toHaveBeenCalledWith('caregiver');
    expect(showToast).toHaveBeenCalledWith('Declined invite removed.', 'success');
  });

  it('N: a plain member never sees declined rows (even if a payload carried them)', () => {
    currentUserId = 'u1';
    setCircle([owner, makeMember()], {
      declined_invites: [declined()],
      viewer_role: 'member',
      viewer_permissions: [],
    });
    renderPage();
    expect(screen.queryByTestId('declined-invites-section')).toBeNull();
    expect(screen.queryByText('pat@example.com')).toBeNull();
  });

  it('N: an absent key renders nothing (1.4.2-shaped payload)', () => {
    setCircle([owner]);
    renderPage();
    expect(screen.queryByTestId('declined-invites-section')).toBeNull();
    expect(screen.queryByText('Declined invites')).toBeNull();
  });
});
