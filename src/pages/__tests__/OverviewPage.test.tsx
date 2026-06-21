import { render, screen } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import '@/i18n';
import OverviewPage from '@/pages/OverviewPage';
import { useCircle } from '@/hooks/useCircle';
import { useTasks } from '@/hooks/useTasks';
import { useActivityFeed } from '@/hooks/useActivityFeed';
import { useAuthStore } from '@/store/authStore';

// Mock the data hooks — OverviewPage is a composition layer; we assert it wires
// each hook's data into the right card, not the hooks' own fetching.
vi.mock('@/hooks/useCircle', () => ({ useCircle: vi.fn() }));
vi.mock('@/hooks/useTasks', () => ({ useTasks: vi.fn() }));
vi.mock('@/hooks/useActivityFeed', () => ({ useActivityFeed: vi.fn() }));

// Heavy children render their own data; stub them to keep this test focused.
vi.mock('@/components/meds/TodaysMeds', () => ({
  TodaysMeds: () => <div data-testid="todays-meds" />,
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
const mockUseTasks = vi.mocked(useTasks);
const mockUseActivityFeed = vi.mocked(useActivityFeed);

function setHooks(opts?: {
  isSelfCare?: boolean;
  members?: Array<{ id: string; first_name: string | null; last_name: string | null; email: string; is_care_recipient: boolean; role: string }>;
  tasks?: Array<{ id: string; title: string }>;
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
  mockUseTasks.mockReturnValue({
    data: { tasks: opts?.tasks ?? [], timezone: 'America/New_York' },
    isLoading: false,
  } as unknown as ReturnType<typeof useTasks>);
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

  it('lists up to 3 open tasks with a "+N more" note', () => {
    setHooks({
      tasks: [
        { id: 't1', title: 'Refill prescription' },
        { id: 't2', title: 'Call doctor' },
        { id: 't3', title: 'Buy groceries' },
        { id: 't4', title: 'Schedule ride' },
      ],
    });
    renderOverview();
    expect(screen.getByText('Refill prescription')).toBeInTheDocument();
    expect(screen.getByText('Buy groceries')).toBeInTheDocument();
    expect(screen.queryByText('Schedule ride')).not.toBeInTheDocument();
    expect(screen.getByText('+1 more')).toBeInTheDocument();
  });

  it('shows the empty task state and links into each section', () => {
    setHooks();
    renderOverview();
    expect(screen.getByText('No open tasks right now.')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'View all tasks' })).toHaveAttribute(
      'href',
      '/circles/c1/tasks'
    );
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
