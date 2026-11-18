import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import MembersPage from '@/pages/MembersPage';
import type { CircleDetail, CircleMember, DeclinedCircleInvite } from '@/api/circleMembers';
import i18n from '@/i18n';

// 1.4.3 shared-link invites (invited_email null) on Members: the row says "Shared link",
// never a raw null. Harness from MembersPage.declined.test.tsx /
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

const DAY = 86400000;
function linkInvite(overrides: Partial<NonNullable<CircleDetail['pending_invites']>[number]> = {}) {
  return {
    id: 'l1',
    invited_email: null,
    created_at: '2026-11-17T00:00:00Z',
    expires_at: new Date(Date.now() + 5 * DAY).toISOString(),
    member_type: 'caregiver' as const,
    is_expired: false,
    invite_url: 'https://my.circlecare.app/invite/ABCD2345',
    ...overrides,
  };
}

async function openRowMenu(user: ReturnType<typeof userEvent.setup>): Promise<void> {
  await user.click(screen.getByRole('button', { name: 'Actions for invite to a shared link' }));
}

describe('MembersPage — shared-link invites (1.4.3)', () => {
  it('ML-P1: a live link invite renders "Shared link" with its countdown, never "null"', () => {
    setCircle([owner], { pending_invites: [linkInvite()], declined_invites: undefined });
    renderPage();
    expect(screen.getByText('Shared link')).toBeInTheDocument();
    expect(screen.getByText(/Invitation for a shared link expires in/)).toBeInTheDocument();
    expect(document.body.textContent).not.toMatch(/\bnull\b/);
  });

  it('ML-P2: Copy link is offered on a live link invite', async () => {
    const user = userEvent.setup();
    setCircle([owner], { pending_invites: [linkInvite()], declined_invites: undefined });
    renderPage();
    await openRowMenu(user);
    expect(screen.getByRole('menuitem', { name: 'Copy link' })).toBeInTheDocument();
  });

  it('ML-P3: Resend on an expired link invite renews it and says so (no "sent again to null")', async () => {
    const user = userEvent.setup();
    resendInvite.mockImplementation((_vars, opts: MutateOpts) => opts?.onSuccess?.());
    setCircle([owner], {
      pending_invites: [linkInvite({ is_expired: true, expires_at: new Date(Date.now() - DAY).toISOString() })],
      declined_invites: undefined,
    });
    renderPage();
    await openRowMenu(user);
    await user.click(screen.getByRole('menuitem', { name: 'Resend' }));
    expect(resendInvite).toHaveBeenCalledWith({ inviteId: 'l1' }, expect.anything());
    expect(showToast).toHaveBeenCalledWith('Invite link renewed', 'success');
    expect(showToast).not.toHaveBeenCalledWith(expect.stringMatching(/null|sent again/), 'success');
  });

  it('ML-N1: an EMAIL invite keeps its address and its "sent again" toast', async () => {
    const user = userEvent.setup();
    resendInvite.mockImplementation((_vars, opts: MutateOpts) => opts?.onSuccess?.());
    setCircle([owner], {
      pending_invites: [
        linkInvite({ id: 'e1', invited_email: 'pat@example.com', is_expired: true, expires_at: new Date(Date.now() - DAY).toISOString() }),
      ],
      declined_invites: undefined,
    });
    renderPage();
    expect(screen.queryByText('Shared link')).toBeNull();
    await user.click(screen.getByRole('button', { name: 'Actions for invite to pat@example.com' }));
    await user.click(screen.getByRole('menuitem', { name: 'Resend' }));
    expect(showToast).toHaveBeenCalledWith('Invitation sent again to pat@example.com.', 'success');
  });

  it('ML-P4: cancelling a link invite confirms with link copy, not an empty address', async () => {
    const user = userEvent.setup();
    setCircle([owner], { pending_invites: [linkInvite()], declined_invites: undefined });
    renderPage();
    await openRowMenu(user);
    await user.click(screen.getByRole('menuitem', { name: 'Cancel invite' }));
    expect(
      screen.getByText('Anyone holding this link will no longer be able to join with it.')
    ).toBeInTheDocument();
  });

  it('ML-P5: a declined link invite reads "Shared link" with Remove only', () => {
    setCircle([owner], { declined_invites: [declined({ invited_email: null })] });
    renderPage();
    const section = screen.getByTestId('declined-invites-section');
    expect(within(section).getByText('Shared link')).toBeInTheDocument();
    expect(within(section).getByRole('button', { name: 'Remove declined invite for a shared link' })).toBeInTheDocument();
    // ML-N2: no "Invite again" (there is no address to send to).
    expect(within(section).queryByText('Invite again')).toBeNull();
    expect(section.textContent).not.toMatch(/\bnull\b/);
  });

  it('ML-P6: ES copy for a link row', async () => {
    await i18n.changeLanguage('es');
    setCircle([owner], { pending_invites: [linkInvite()], declined_invites: [declined({ id: 'd2', invited_email: null })] });
    renderPage();
    expect(screen.getAllByText('Enlace compartido')).toHaveLength(2);
  });
});
