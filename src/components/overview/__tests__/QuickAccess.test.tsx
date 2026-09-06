import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import '@/i18n';
import { QuickAccess, QUICK_ACCESS_ROWS } from '../QuickAccess';
import { useTasks } from '@/hooks/useTasks';

vi.mock('@/hooks/useTasks', () => ({ useTasks: vi.fn() }));
const mockUseTasks = vi.mocked(useTasks);

// The query is capped at `limit: 1` (only the count is needed) and reads the
// backend's pre-limit `total`, not `tasks.length` — the mock reflects that:
// `tasks` holds at most one row regardless of `count`.
function setOpenTasks(count: number | null): void {
  mockUseTasks.mockReturnValue({
    data:
      count === null
        ? undefined
        : { tasks: count > 0 ? [{ id: 't0' }] : [], total: count },
  } as unknown as ReturnType<typeof useTasks>);
}

function renderQuickAccess(): void {
  render(
    <MemoryRouter>
      <QuickAccess circleId="c1" />
    </MemoryRouter>
  );
}

describe('QuickAccess', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    setOpenTasks(0);
  });

  it('lists mobile\'s seven destinations in mobile\'s order', () => {
    expect(QUICK_ACCESS_ROWS.map((r) => r.id)).toEqual([
      'notes',
      'calendar',
      'medications',
      'tasks',
      'vitals',
      'activityFeed',
      'careInfo',
    ]);
  });

  it('routes each row into this circle', () => {
    renderQuickAccess();
    const hrefs = screen.getAllByRole('link').map((a) => a.getAttribute('href'));
    expect(hrefs).toEqual([
      '/circles/c1/notes',
      '/circles/c1/calendar',
      '/circles/c1/meds',
      '/circles/c1/tasks',
      '/circles/c1/vitals',
      '/circles/c1/activity',
      '/circles/c1/emergency',
    ]);
  });

  it('labels the rows from the shared mobile copy', () => {
    renderQuickAccess();
    for (const label of ['Notes', 'Calendar', 'Meds', 'Tasks', 'Vitals', 'Activity feed', 'Care info']) {
      expect(screen.getByText(label)).toBeInTheDocument();
    }
  });

  it('badges the Tasks row with the open-task count', () => {
    setOpenTasks(3);
    renderQuickAccess();
    expect(screen.getByRole('link', { name: 'Tasks, 3 open' })).toBeInTheDocument();
    expect(screen.getByText('3')).toBeInTheDocument();
  });

  // The badge only needs a COUNT, never the tasks array, so the query asks
  // for one row and reads the backend's `total` instead of `tasks.length`.
  it('queries only status open at limit 1, not the full open-task list', () => {
    renderQuickAccess();
    expect(mockUseTasks).toHaveBeenCalledWith('c1', { status: 'open', limit: 1 });
  });

  // Safety net for a backend that predates `total` — undercounts (since the
  // request itself is capped at 1) rather than crashing.
  it('falls back to tasks.length when the backend has not shipped `total` yet', () => {
    mockUseTasks.mockReturnValue({
      data: { tasks: [{ id: 't0' }] },
    } as unknown as ReturnType<typeof useTasks>);
    renderQuickAccess();
    expect(screen.getByRole('link', { name: 'Tasks, 1 open' })).toBeInTheDocument();
  });

  it('shows no badge when there are no open tasks', () => {
    setOpenTasks(0);
    renderQuickAccess();
    expect(screen.getByRole('link', { name: 'Tasks' })).toBeInTheDocument();
  });

  // `?? 0` is applied at the badge, not at the query: while the count is
  // UNKNOWN a badge has nothing honest to show.
  it('shows no badge while the count is still unknown', () => {
    setOpenTasks(null);
    renderQuickAccess();
    expect(screen.getByRole('link', { name: 'Tasks' })).toBeInTheDocument();
  });
});
