import { render, screen } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import '@/i18n';
import OverviewPage from '@/pages/OverviewPage';
import { useCircle } from '@/hooks/useCircle';
import { useActivityFeed } from '@/hooks/useActivityFeed';
import { useAuthStore } from '@/store/authStore';

// Mock the data hooks — OverviewPage is a composition layer; we assert it wires
// each hook's data into the right card, not the hooks' own fetching.
vi.mock('@/hooks/useCircle', () => ({ useCircle: vi.fn() }));
vi.mock('@/hooks/useActivityFeed', () => ({ useActivityFeed: vi.fn() }));

// Heavy children render their own data; stub them to keep this test focused.
// OpenTasksCard owns the open-tasks queries, the shared TaskRow, and the undo
// window now — its behavior is covered by
// src/components/tasks/__tests__/OpenTasksCard.test.tsx, so here we only assert
// OverviewPage mounts it with the right props.
vi.mock('@/components/meds/TodaysMeds', () => ({
  TodaysMeds: () => <div data-testid="todays-meds" />,
}));
vi.mock('@/components/tasks/OpenTasksCard', () => ({
  OpenTasksCard: ({ circleId, limit }: { circleId: string; limit?: number }) => (
    <div data-testid="open-tasks-card" data-circle-id={circleId} data-limit={String(limit)} />
  ),
}));
vi.mock('@/components/activity/ActivityItem', () => ({
  ActivityItem: ({ activity }: { activity: { action_type: string } }) => (
    <li>{activity.action_type}</li>
  ),
}));
vi.mock('@/components/circles/GettingStartedChecklist', () => ({
  GettingStartedChecklist: () => <div data-testid="getting-started" />,
}));

const mockUseCircle = vi.mocked(useCircle);
const mockUseActivityFeed = vi.mocked(useActivityFeed);

function setHooks(opts?: {
  isSelfCare?: boolean;
  members?: Array<{ id: string; first_name: string | null; last_name: string | null; email: string; is_care_recipient: boolean; role: string }>;
  activities?: Array<{ id: string; action_type: string }>;
}): void {
  const members = opts?.members ?? [
    { id: 'u1', first_name: 'Pat', last_name: 'Lee', email: 'pat@example.com', is_care_recipient: false, role: 'owner' },
    { id: 'u2', first_name: 'Sam', last_name: 'Ng', email: 'sam@example.com', is_care_recipient: false, role: 'member' },
  ];
  mockUseCircle.mockReturnValue({
    circle: {
      id: 'c1',
      owner_id: 'u1',
      recipient_name: 'Rose',
      is_self_care: opts?.isSelfCare ?? false,
    },
    members,
    timezone: 'America/New_York',
    isLoading: false,
  } as unknown as ReturnType<typeof useCircle>);
  mockUseActivityFeed.mockReturnValue({
    data: { pages: [{ activities: opts?.activities ?? [], hasMore: false }] },
    isLoading: false,
  } as unknown as ReturnType<typeof useActivityFeed>);
}

function renderOverview(): void {
  render(
    <MemoryRouter initialEntries={['/circles/c1']}>
      <Routes>
        <Route path="/circles/:circleId" element={<OverviewPage />} />
      </Routes>
    </MemoryRouter>
  );
}

describe('OverviewPage', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    useAuthStore.setState({
      user: { id: 'u1', email: 'pat@example.com', first_name: 'Pat', last_name: 'Lee' },
      isAuthenticated: true,
    });
  });

  it('shows a "Caring for {name}" hero and the helper count', () => {
    setHooks();
    renderOverview();
    expect(screen.getByRole('heading', { name: 'Caring for Rose' })).toBeInTheDocument();
    // One helper besides the current user (Sam).
    expect(screen.getByText('1 person helping coordinate care.')).toBeInTheDocument();
  });

  it('uses the self-care hero title', () => {
    setHooks({ isSelfCare: true });
    renderOverview();
    expect(screen.getByRole('heading', { name: 'Your care space' })).toBeInTheDocument();
  });

  it('renders the get-started checklist and today\'s meds blocks', () => {
    setHooks();
    renderOverview();
    expect(screen.getByTestId('getting-started')).toBeInTheDocument();
    expect(screen.getByTestId('todays-meds')).toBeInTheDocument();
  });

  // The open-tasks card is the shared, actionable one now (same TaskRow + undo
  // window as the Tasks page). OverviewPage's job is to mount it for this circle
  // capped at 3 rows; the rows themselves are covered in OpenTasksCard.test.
  it('mounts the shared open-tasks card for this circle, capped at 3', () => {
    setHooks();
    renderOverview();
    const card = screen.getByTestId('open-tasks-card');
    expect(card).toHaveAttribute('data-circle-id', 'c1');
    expect(card).toHaveAttribute('data-limit', '3');
  });

  it('links into each section', () => {
    setHooks();
    renderOverview();
    expect(screen.getByRole('link', { name: 'View all activity' })).toHaveAttribute(
      'href',
      '/circles/c1/activity'
    );
    // Owner sees the invite link into members.
    expect(screen.getByRole('link', { name: 'Invite member' })).toHaveAttribute(
      'href',
      '/circles/c1/members'
    );
  });

  it('renders recent activity entries', () => {
    setHooks({ activities: [{ id: 'a1', action_type: 'med_taken' }] });
    renderOverview();
    expect(screen.getByText('med_taken')).toBeInTheDocument();
  });
});
