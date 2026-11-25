import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import '@/i18n';
import i18n from '@/i18n';
import { CareTeamRow } from '@/components/overview/CareTeamRow';
import { Analytics } from '@/lib/analytics';
import { getCircleDetail, type CircleDetail, type CircleMember } from '@/api/circleMembers';

// The ONE Care team row on Today (plan P3, N3, N4, N5, P6): names + avatars + pending, opens the page.
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

const OWNER = member({ id: 'u-owner', first_name: 'Luis', last_name: 'Meza', role: 'owner', email: 'l@example.com' });
const MANAGER = member({ id: 'u-mgr', first_name: 'Mara', last_name: 'Gil', role: 'manager', email: 'm@example.com' });
const PLAIN = member();
const extra = (i: number): CircleMember =>
  member({ id: `x${i}`, first_name: `Extra${i}`, last_name: 'Z', email: `x${i}@example.com` });

const PENDING = {
  id: 'inv1',
  invited_email: 'new@example.com',
  member_type: 'caregiver' as const,
  created_at: '2026-11-10T00:00:00Z',
  expires_at: '2099-01-01T00:00:00Z',
  is_expired: false,
  invite_url: 'https://my.circlecare.app/invite/abc',
};

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

function renderRow(): void {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter initialEntries={['/circles/c1']}>
        <Routes>
          <Route path="/circles/:circleId" element={<CareTeamRow circleId="c1" />} />
          <Route path="/circles/:circleId/members" element={<div data-testid="members-page" />} />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>
  );
}

/** Avatar discs in the stack (the "+N" chip is not one). */
const avatarCount = (): number =>
  Array.from(screen.getByTestId('today-care-team-avatars').children).filter(
    (c) => c.getAttribute('data-testid') !== 'today-care-team-extra'
  ).length;

describe('CareTeamRow (Today, 1.4.4)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    currentUserId = 'u-owner';
    void i18n.changeLanguage('en');
  });
  afterEach(() => vi.restoreAllMocks());

  it('P3: names line starts with "You", avatars are stacked, a manager sees " · N pending"', async () => {
    mockGetCircleDetail.mockResolvedValue(detail({ pending_invites: [PENDING, { ...PENDING, id: 'inv2' }] }));
    renderRow();
    const names = await screen.findByTestId('today-care-team-names');
    expect(names).toHaveTextContent('You, Mara and Ana · 2 pending');
    expect(avatarCount()).toBe(3);
    expect(screen.getByText('Care team')).toBeInTheDocument();
  });

  it('P3: it is a link to the Care team page and fires care_team_opened(today_row)', async () => {
    const spy = vi.spyOn(Analytics, 'careTeamOpened').mockImplementation(() => {});
    mockGetCircleDetail.mockResolvedValue(detail());
    renderRow();
    const link = await screen.findByTestId('today-care-team-link');
    expect(link).toHaveAttribute('href', '/circles/c1/members');
    await userEvent.click(link);
    expect(spy).toHaveBeenCalledWith('today_row');
    expect(await screen.findByTestId('members-page')).toBeInTheDocument();
  });

  it('P3: the recipient reads "My care team"', async () => {
    currentUserId = 'u-rose';
    mockGetCircleDetail.mockResolvedValue(
      detail({ members: [OWNER, member({ id: 'u-rose', first_name: 'Rose', is_care_recipient: true, email: 'r@example.com' })] })
    );
    renderRow();
    expect(await screen.findByText('My care team')).toBeInTheDocument();
    expect(screen.getByTestId('today-care-team-names')).toHaveTextContent('You and Luis');
  });

  it('N3: a member who cannot manage members sees no pending count', async () => {
    currentUserId = 'u2';
    mockGetCircleDetail.mockResolvedValue(detail({ pending_invites: [PENDING] }));
    renderRow();
    const names = await screen.findByTestId('today-care-team-names');
    expect(names).toHaveTextContent('You, Luis and Mara');
    expect(names.textContent).not.toMatch(/pending/);
    expect(screen.queryByTestId('today-care-team-pending')).toBeNull();
  });

  it('N3: a manager with nothing pending shows no " · 0 pending"', async () => {
    currentUserId = 'u-mgr';
    mockGetCircleDetail.mockResolvedValue(detail({ viewer_permissions: ['manage_members'] } as Partial<CircleDetail>));
    renderRow();
    expect((await screen.findByTestId('today-care-team-names')).textContent).not.toMatch(/pending/);
  });

  it('N5: five people show four avatars and "+1"; four show no "+N"', async () => {
    mockGetCircleDetail.mockResolvedValue(detail({ members: [OWNER, MANAGER, PLAIN, extra(1), extra(2)] }));
    renderRow();
    await screen.findByTestId('today-care-team-names');
    expect(avatarCount()).toBe(4);
    expect(screen.getByTestId('today-care-team-extra')).toHaveTextContent('+1');
    expect(screen.getByTestId('today-care-team-names')).toHaveTextContent('You, Mara, Ana and 2 more');
  });

  it('N5: four people show no "+N" and every name', async () => {
    mockGetCircleDetail.mockResolvedValue(detail({ members: [OWNER, MANAGER, PLAIN, extra(1)] }));
    renderRow();
    const names = await screen.findByTestId('today-care-team-names');
    expect(names).toHaveTextContent('You, Mara, Ana and Extra1');
    expect(screen.queryByTestId('today-care-team-extra')).toBeNull();
    expect(avatarCount()).toBe(4);
  });

  it('N1: the row carries no members list, Manage or Leave circle', async () => {
    mockGetCircleDetail.mockResolvedValue(detail());
    renderRow();
    await screen.findByTestId('today-care-team-names');
    expect(screen.queryByText('Manage')).toBeNull();
    expect(screen.queryByText('Leave circle')).toBeNull();
    expect(screen.queryByText('Invite member')).toBeNull();
    expect(screen.queryByText('Mara Gil')).toBeNull();
  });

  it('P7: Spanish names line and pending wording', async () => {
    await i18n.changeLanguage('es');
    mockGetCircleDetail.mockResolvedValue(detail({ pending_invites: [PENDING] }));
    renderRow();
    expect(await screen.findByTestId('today-care-team-names')).toHaveTextContent('Tú, Mara y Ana · 1 pendiente');
    await i18n.changeLanguage('en');
  });
});
