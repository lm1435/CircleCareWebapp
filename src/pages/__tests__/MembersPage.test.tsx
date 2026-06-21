import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import '@/i18n';
import { ToastProvider } from '@/components/ui';
import MembersPage from '@/pages/MembersPage';
import { getCircleDetail, type CircleDetail, type CircleMember } from '@/api/circleMembers';
import { getCircles } from '@/api/circles';

vi.mock('@/api/circleMembers', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/api/circleMembers')>();
  return { ...actual, getCircleDetail: vi.fn() };
});

// MembersPage now reads through useCircle, which also calls useCircles()
// (GET /circles). Stub it so the page resolves; the read-only roster assertions
// only depend on the circle detail.
vi.mock('@/api/circles', () => ({
  getCircles: vi.fn().mockResolvedValue([]),
}));

const mockGetCircleDetail = vi.mocked(getCircleDetail);
void getCircles;

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

function makeDetail(members: CircleMember[]): CircleDetail {
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
  };
}

function renderMembers(): void {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  render(
    <QueryClientProvider client={queryClient}>
      <ToastProvider>
        <MemoryRouter initialEntries={['/circles/c1/members']}>
          <Routes>
            <Route path="/circles/:circleId/members" element={<MembersPage />} />
          </Routes>
        </MemoryRouter>
      </ToastProvider>
    </QueryClientProvider>
  );
}

describe('MembersPage', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('renders members with names and translated role badges', async () => {
    mockGetCircleDetail.mockResolvedValue(
      makeDetail([
        makeMember({ id: 'u-owner', first_name: 'Luis', last_name: 'Meza', role: 'owner' }),
        makeMember({ id: 'u2' }),
        makeMember({
          id: 'u3',
          first_name: 'Rose',
          last_name: 'Meza',
          is_care_recipient: true,
        }),
      ])
    );
    renderMembers();

    expect(await screen.findByText('Luis Meza')).toBeInTheDocument();
    expect(screen.getByText('Owner')).toBeInTheDocument();
    expect(screen.getByText('Ana Reyes')).toBeInTheDocument();
    expect(screen.getByText('Caregiver')).toBeInTheDocument();
    expect(screen.getByText('Rose Meza')).toBeInTheDocument();
    expect(screen.getByText('Care Recipient')).toBeInTheDocument();

    expect(mockGetCircleDetail).toHaveBeenCalledWith('c1');
  });

  it('sorts the owner first, then care recipient, then caregivers', async () => {
    mockGetCircleDetail.mockResolvedValue(
      makeDetail([
        makeMember({ id: 'u2', first_name: 'Cara', last_name: 'Giver' }),
        makeMember({ id: 'u3', first_name: 'Rose', last_name: 'Meza', is_care_recipient: true }),
        makeMember({ id: 'u-owner', first_name: 'Luis', last_name: 'Meza', role: 'owner' }),
      ])
    );
    renderMembers();

    await screen.findByText('Luis Meza');
    const items = screen.getAllByRole('listitem');
    expect(items[0]).toHaveTextContent('Luis Meza');
    expect(items[1]).toHaveTextContent('Rose Meza');
    expect(items[2]).toHaveTextContent('Cara Giver');
  });

  it('shows the email as the subtitle for named members (mobile convention)', async () => {
    mockGetCircleDetail.mockResolvedValue(
      makeDetail([makeMember({ first_name: 'Ana', last_name: 'Reyes', email: 'ana@example.com' })])
    );
    renderMembers();

    const row = (await screen.findByText('Ana Reyes')).closest('li')!;
    expect(within(row).getByText('ana@example.com')).toBeInTheDocument();
  });

  it('marks a heart overlay for the care recipient', async () => {
    mockGetCircleDetail.mockResolvedValue(
      makeDetail([
        makeMember({ id: 'u3', first_name: 'Rose', last_name: 'Meza', is_care_recipient: true }),
      ])
    );
    renderMembers();

    await screen.findByText('Rose Meza');
    expect(screen.getByRole('img', { name: 'Care Recipient' })).toBeInTheDocument();
  });

  it('marks a bell overlay for the medication-responsible caregiver', async () => {
    mockGetCircleDetail.mockResolvedValue(
      makeDetail([
        makeMember({ id: 'u2', first_name: 'Med', last_name: 'Manager', is_medication_responsible: true }),
      ])
    );
    renderMembers();

    await screen.findByText('Med Manager');
    expect(screen.getByRole('img', { name: 'Manages medication reminders' })).toBeInTheDocument();
  });

  it('falls back to the email when the member has no name', async () => {
    mockGetCircleDetail.mockResolvedValue(
      makeDetail([makeMember({ first_name: null, last_name: null })])
    );
    renderMembers();

    expect(await screen.findByText('ana@example.com')).toBeInTheDocument();
  });

  it('shows a View Only indicator only on members flagged view_only', async () => {
    mockGetCircleDetail.mockResolvedValue(
      makeDetail([
        makeMember({ id: 'u2', first_name: 'Vista', last_name: 'Solo', view_only: true }),
        makeMember({ id: 'u3', first_name: 'Full', last_name: 'Access' }),
      ])
    );
    renderMembers();

    const flagged = (await screen.findByText('Vista Solo')).closest('li')!;
    const unflagged = screen.getByText('Full Access').closest('li')!;
    expect(within(flagged).getByText('View Only')).toBeInTheDocument();
    expect(within(unflagged).queryByText('View Only')).not.toBeInTheDocument();
  });

  it('renders an empty state when the circle has no members', async () => {
    mockGetCircleDetail.mockResolvedValue(makeDetail([]));
    renderMembers();

    expect(await screen.findByText('No members in this circle yet.')).toBeInTheDocument();
  });

  it('shows skeleton rows while loading', () => {
    mockGetCircleDetail.mockReturnValue(new Promise<CircleDetail>(() => {}));
    renderMembers();

    expect(screen.getByRole('list', { name: 'Loading...' })).toHaveAttribute('aria-busy', 'true');
  });

  it('shows an error state and retries on demand', async () => {
    const user = userEvent.setup();
    mockGetCircleDetail.mockRejectedValueOnce(new Error('network'));
    mockGetCircleDetail.mockResolvedValueOnce(makeDetail([makeMember()]));
    renderMembers();

    expect(await screen.findByRole('alert')).toHaveTextContent('Unable to load members');

    await user.click(screen.getByRole('button', { name: 'Retry' }));
    expect(await screen.findByText('Ana Reyes')).toBeInTheDocument();
  });
});
