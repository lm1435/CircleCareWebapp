import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import '@/i18n';
import i18n from '@/i18n';
import { ToastProvider } from '@/components/ui';
import { TodayCareTeam } from '@/components/overview/TodayCareTeam';
import { getCircleDetail, type CircleDetail, type CircleMember } from '@/api/circleMembers';

// 1.4.3 web/mobile parity: Today shows the care team and the circle's Manage rows, as mobile's
// CircleDetailScreen does. Actions are the Members page's own (useCareTeamManager).
vi.mock('@/api/circleMembers', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/api/circleMembers')>();
  return { ...actual, getCircleDetail: vi.fn() };
});
vi.mock('@/api/circles', () => ({ getCircles: vi.fn().mockResolvedValue([]) }));
let currentUserId: string | null = 'u-owner';
vi.mock('@/store/authStore', () => ({
  useAuthStore: (selector: (s: { user: { id: string } | null }) => unknown) =>
    selector({ user: currentUserId ? { id: currentUserId } : null }),
}));

const mockGetCircleDetail = vi.mocked(getCircleDetail);

function member(overrides: Partial<CircleMember> = {}): CircleMember {
  return {
    id: 'u2',
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

const OWNER = member({ id: 'u-owner', first_name: 'Luis', last_name: 'Meza', role: 'owner', email: 'luis@example.com' });
const MANAGER = member({ id: 'u-mgr', first_name: 'Mara', last_name: 'Gil', role: 'manager', email: 'mara@example.com' });
const PLAIN = member();

function detail(over: Partial<CircleDetail> = {}): CircleDetail {
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
    members: [OWNER, MANAGER, PLAIN],
    pending_invites: [],
    access_level: 'full',
    is_premium_circle: true,
    can_edit: true,
    view_only: false,
    ...over,
  };
}

function renderTeam(): void {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <QueryClientProvider client={queryClient}>
      <ToastProvider>
        <MemoryRouter initialEntries={['/circles/c1']}>
          <Routes>
            <Route path="/circles/:circleId" element={<TodayCareTeam circleId="c1" />} />
            <Route path="/circles/:circleId/settings" element={<div data-testid="settings-page" />} />
          </Routes>
        </MemoryRouter>
      </ToastProvider>
    </QueryClientProvider>
  );
}

const PENDING = {
  id: 'inv1',
  invited_email: 'new@example.com',
  member_type: 'caregiver' as const,
  created_at: '2026-11-10T00:00:00Z',
  expires_at: '2099-01-01T00:00:00Z',
  is_expired: false,
  invite_url: 'https://my.circlecare.app/invite/abc',
};

describe('TodayCareTeam (mobile parity, 1.4.3)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    currentUserId = 'u-owner';
    void i18n.changeLanguage('en');
  });

  it('POSITIVE: owner sees "Care team", the count pill, every member, Invite member and Manage (Edit + Delete)', async () => {
    mockGetCircleDetail.mockResolvedValue(detail());
    renderTeam();
    expect(await screen.findByRole('heading', { name: 'Care team' })).toBeInTheDocument();
    expect(screen.getByTestId('today-care-team-count')).toHaveTextContent('3 members');
    for (const name of ['Luis Meza', 'Mara Gil', 'Ana Reyes']) {
      expect(screen.getByText(name, { exact: false })).toBeInTheDocument();
    }
    expect(screen.getByRole('button', { name: 'Invite member' })).toBeEnabled();
    expect(screen.getByRole('heading', { name: 'Manage' })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Edit circle' })).toHaveAttribute('href', '/circles/c1/settings');
    expect(screen.getByRole('link', { name: 'Delete circle' })).toHaveAttribute(
      'href',
      '/circles/c1/settings#danger'
    );
    // The owner cannot leave (backend blocks it): no Leave row.
    expect(screen.queryByText('Leave circle')).toBeNull();
  });

  it('POSITIVE: the owner gets the member menu on a plain member (same actions as the Members page)', async () => {
    mockGetCircleDetail.mockResolvedValue(detail());
    renderTeam();
    await screen.findByText('Ana Reyes', { exact: false });
    await userEvent.click(screen.getByRole('button', { name: /Ana Reyes/ }));
    expect(await screen.findByRole('menuitem', { name: /Remove/ })).toBeInTheDocument();
  });

  it('POSITIVE: Invite member opens the invite dialog on Today', async () => {
    mockGetCircleDetail.mockResolvedValue(detail());
    renderTeam();
    await userEvent.click(await screen.findByRole('button', { name: 'Invite member' }));
    expect(await screen.findByRole('dialog')).toBeInTheDocument();
  });

  it('POSITIVE: pending invitations show to the owner, with their actions', async () => {
    mockGetCircleDetail.mockResolvedValue(detail({ pending_invites: [PENDING] }));
    renderTeam();
    const pending = await screen.findByTestId('today-pending-invites');
    expect(within(pending).getByText('Pending invitations')).toBeInTheDocument();
    expect(within(pending).getByText('new@example.com')).toBeInTheDocument();
  });

  it('POSITIVE: a member who is the care recipient reads "My care team"', async () => {
    currentUserId = 'u-rose';
    mockGetCircleDetail.mockResolvedValue(
      detail({
        members: [
          OWNER,
          member({ id: 'u-rose', first_name: 'Rose', last_name: 'M', is_care_recipient: true, email: 'r@example.com' }),
        ],
      })
    );
    renderTeam();
    expect(await screen.findByRole('heading', { name: 'My care team' })).toBeInTheDocument();
    expect(screen.getByTestId('today-care-team-count')).toHaveTextContent('2 members');
  });

  it('POSITIVE: a non-owner sees Leave circle (no Manage section), and it asks to confirm', async () => {
    currentUserId = 'u2';
    mockGetCircleDetail.mockResolvedValue(detail());
    renderTeam();
    await userEvent.click(await screen.findByRole('button', { name: 'Leave circle' }));
    expect(await screen.findByRole('dialog')).toHaveTextContent('Leave circle');
    expect(screen.queryByRole('heading', { name: 'Manage' })).toBeNull();
  });

  it('POSITIVE: Spanish copy is mobile wording', async () => {
    await i18n.changeLanguage('es');
    mockGetCircleDetail.mockResolvedValue(detail());
    renderTeam();
    expect(await screen.findByRole('heading', { name: 'Equipo de cuidado' })).toBeInTheDocument();
    expect(screen.getByTestId('today-care-team-count')).toHaveTextContent('3 miembros');
    expect(screen.getByRole('button', { name: 'Invitar miembro' })).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Administrar' })).toBeInTheDocument();
    await i18n.changeLanguage('en');
  });

  it('NEGATIVE: a plain member gets no Invite, no pending list, no member menus, no Edit/Delete', async () => {
    currentUserId = 'u2';
    mockGetCircleDetail.mockResolvedValue(detail({ pending_invites: [PENDING] }));
    renderTeam();
    await screen.findByText('Luis Meza', { exact: false });
    expect(screen.queryByRole('button', { name: 'Invite member' })).toBeNull();
    expect(screen.queryByTestId('today-pending-invites')).toBeNull();
    expect(screen.queryByRole('button', { name: /actions/i })).toBeNull();
    expect(screen.queryByText('Edit circle')).toBeNull();
    expect(screen.queryByText('Delete circle')).toBeNull();
  });

  it('NEGATIVE: a manager can invite but never edits or deletes the circle, and gets no menu on the owner', async () => {
    currentUserId = 'u-mgr';
    mockGetCircleDetail.mockResolvedValue(
      detail({ viewer_permissions: ['manage_members'] } as Partial<CircleDetail>)
    );
    renderTeam();
    expect(await screen.findByRole('button', { name: 'Invite member' })).toBeEnabled();
    expect(screen.queryByText('Edit circle')).toBeNull();
    expect(screen.queryByText('Delete circle')).toBeNull();
    expect(screen.queryByRole('button', { name: /Luis Meza/ })).toBeNull();
    expect(screen.getByRole('button', { name: 'Leave circle' })).toBeInTheDocument();
  });

  it('NEGATIVE: a read-only circle offers no write: Invite is "View only access" (disabled), Edit circle is not a link', async () => {
    mockGetCircleDetail.mockResolvedValue(detail({ can_edit: false }));
    renderTeam();
    const viewOnly = await screen.findByRole('button', { name: 'View only access' });
    expect(viewOnly).toBeDisabled();
    expect(screen.queryByRole('button', { name: 'Invite member' })).toBeNull();
    expect(screen.queryByRole('link', { name: 'Edit circle' })).toBeNull();
    expect(screen.getByTestId('today-edit-circle-disabled')).toHaveAttribute('aria-disabled', 'true');
  });
});
