import { act, fireEvent, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import '@/i18n';
import TasksPage from '../TasksPage';
import type { CalendarEvent } from '@/api/calendarEvents';
import type { CircleMember } from '@/api/circleMembers';

// Stage 2, Task 2.6 — TasksPage page slice. Mocks useTasks / useCompleteEvent /
// useCircle / AddEventModal so the test stays focused on page behavior:
//   - status + sort change re-query (useTasks called with the right params)
//   - empty state
//   - complete checkbox gated on canEdit, fires useCompleteEvent
//   - "Add task" opens the modal
//
// Timezone-independent: the page reads `timezone` off the (mocked) tasks
// response, and we pin tasks to a non-relative date so labels never depend on
// the machine clock.

const mockUseTasks = vi.fn();
const mockMutate = vi.fn();
const mockUseCompleteEvent = vi.fn((_circleId: string) => ({
  mutate: mockMutate,
  isPending: false,
}));
const mockUseCircle = vi.fn();

vi.mock('@/hooks/useTasks', () => ({
  useTasks: (circleId: string, opts: unknown) => mockUseTasks(circleId, opts),
}));

vi.mock('@/hooks/useCalendarEvents', () => ({
  useCompleteEvent: (circleId: string) => mockUseCompleteEvent(circleId),
}));

vi.mock('@/hooks/useCircle', () => ({
  useCircle: (circleId: string) => mockUseCircle(circleId),
}));

// Stub AddEventModal — assert open/close via a sentinel, not the real form.
vi.mock('@/components/calendar/AddEventModal', () => ({
  AddEventModal: ({
    event,
    initialType,
    onClose,
  }: {
    event?: CalendarEvent | null;
    initialType?: string;
    onClose: () => void;
  }) => (
    <div role="dialog" aria-label="add-event-modal">
      <span>{event ? 'edit-mode' : 'create-mode'}</span>
      <span>{initialType ?? 'no-initial-type'}</span>
      <button type="button" onClick={onClose}>
        close-modal
      </button>
    </div>
  ),
}));

const TZ = 'America/Chicago';

const MEMBERS: CircleMember[] = [
  {
    id: 'u-assignee',
    email: 'rose@example.com',
    first_name: 'Rose',
    last_name: 'Meza',
    role: 'member',
    is_care_recipient: false,
    is_medication_responsible: false,
    joined_at: '2026-01-01T00:00:00Z',
    timezone: null,
  },
];

function makeTask(overrides: Partial<CalendarEvent>): CalendarEvent {
  return {
    id: 'task-1',
    circle_id: 'circle-1',
    event_type: 'task',
    title: 'Pick up groceries',
    scheduled_date: '2026-03-15',
    scheduled_time: null,
    completed_at: null,
    assigned_to: null,
    created_at: '2026-03-01T00:00:00Z',
    updated_at: '2026-03-01T00:00:00Z',
    ...overrides,
  };
}

function tasksResult(tasks: CalendarEvent[], overrides: Record<string, unknown> = {}) {
  return {
    data: { tasks, today: '2026-03-15', timezone: TZ },
    isLoading: false,
    isError: false,
    refetch: vi.fn(),
    ...overrides,
  };
}

function renderPage() {
  return render(
    <MemoryRouter initialEntries={['/circles/circle-1/tasks']}>
      <Routes>
        <Route path="/circles/:circleId/tasks" element={<TasksPage />} />
      </Routes>
    </MemoryRouter>
  );
}

beforeEach(() => {
  mockUseTasks.mockReset();
  mockMutate.mockReset();
  mockUseCompleteEvent.mockClear();
  mockUseCircle.mockReset();

  mockUseCircle.mockReturnValue({ canEdit: true, members: MEMBERS });
  mockUseTasks.mockReturnValue(
    tasksResult([
      makeTask({ id: 'task-1', title: 'Pick up groceries', assigned_to: 'u-assignee' }),
      makeTask({ id: 'task-2', title: 'Call pharmacy', completed_at: null }),
    ])
  );
});

describe('TasksPage', () => {
  it('queries with default status/sort and renders the task list', () => {
    renderPage();

    expect(mockUseTasks).toHaveBeenCalledWith('circle-1', { status: 'open', sort: 'due_date' });
    expect(screen.getByText('Pick up groceries')).toBeInTheDocument();
    expect(screen.getByText('Call pharmacy')).toBeInTheDocument();
  });

  it('re-queries when the status filter changes', async () => {
    const user = userEvent.setup();
    renderPage();

    await user.selectOptions(screen.getByLabelText('Status'), 'completed');

    expect(mockUseTasks).toHaveBeenLastCalledWith('circle-1', {
      status: 'completed',
      sort: 'due_date',
    });
  });

  it('re-queries when the sort changes', async () => {
    const user = userEvent.setup();
    renderPage();

    await user.selectOptions(screen.getByLabelText('Sort by'), 'assignee');

    expect(mockUseTasks).toHaveBeenLastCalledWith('circle-1', {
      status: 'open',
      sort: 'assignee',
    });
  });

  it('shows the empty state when there are no tasks', () => {
    mockUseTasks.mockReturnValue(tasksResult([]));
    renderPage();

    expect(screen.getByText('No open tasks')).toBeInTheDocument();
    // The empty state offers its own primary CTA when the user can edit (the
    // header "Add task" button is also present, hence getAllByRole).
    expect(screen.getAllByRole('button', { name: 'Add task' }).length).toBeGreaterThan(1);
  });

  // The undo-window tests use fake timers, so they drive the UI with the
  // synchronous fireEvent (userEvent's internal async waits hang under fake
  // timers). beforeEach/afterEach below install + restore the fake clock.
  it('does not commit immediately — starts a pending undo window on check (canEdit)', () => {
    vi.useFakeTimers();
    try {
      renderPage();

      fireEvent.click(
        screen.getByRole('checkbox', { name: 'Mark "Pick up groceries" complete' })
      );

      // Nothing committed yet — we're inside the 5s grace window.
      expect(mockMutate).not.toHaveBeenCalled();
      // The undo affordance is present and the row reads as checked.
      expect(
        screen.getByRole('button', { name: 'Undo completing "Pick up groceries"' })
      ).toBeInTheDocument();
      expect(
        screen.getByRole('checkbox', { name: 'Undo completing "Pick up groceries"' })
      ).toHaveAttribute('aria-checked', 'true');
    } finally {
      vi.useRealTimers();
    }
  });

  it('commits via useCompleteEvent after the undo window elapses', () => {
    vi.useFakeTimers();
    try {
      renderPage();

      fireEvent.click(
        screen.getByRole('checkbox', { name: 'Mark "Pick up groceries" complete' })
      );
      expect(mockMutate).not.toHaveBeenCalled();

      // Elapse the 5s grace period.
      act(() => {
        vi.advanceTimersByTime(5000);
      });

      expect(mockMutate).toHaveBeenCalledTimes(1);
      expect(mockMutate.mock.calls[0][0]).toBe('task-1');
    } finally {
      vi.useRealTimers();
    }
  });

  it('undo cancels the pending completion — mutation never fires', () => {
    vi.useFakeTimers();
    try {
      renderPage();

      fireEvent.click(
        screen.getByRole('checkbox', { name: 'Mark "Pick up groceries" complete' })
      );
      fireEvent.click(
        screen.getByRole('button', { name: 'Undo completing "Pick up groceries"' })
      );

      // Past the window — still nothing committed because undo cleared the timer.
      act(() => {
        vi.advanceTimersByTime(6000);
      });

      expect(mockMutate).not.toHaveBeenCalled();
      // Back to the un-checked / editable state.
      expect(
        screen.getByRole('checkbox', { name: 'Mark "Pick up groceries" complete' })
      ).toHaveAttribute('aria-checked', 'false');
    } finally {
      vi.useRealTimers();
    }
  });

  it('hides the complete checkbox and Add task when canEdit is false', () => {
    mockUseCircle.mockReturnValue({ canEdit: false, members: MEMBERS });
    renderPage();

    expect(
      screen.queryByRole('checkbox', { name: 'Mark "Pick up groceries" complete' })
    ).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Add task' })).not.toBeInTheDocument();
    // Read view still renders the tasks.
    expect(screen.getByText('Pick up groceries')).toBeInTheDocument();
  });

  it('opens AddEventModal in create mode (type=task) from "Add task"', async () => {
    const user = userEvent.setup();
    renderPage();

    await user.click(screen.getByRole('button', { name: 'Add task' }));

    const dialog = screen.getByRole('dialog', { name: 'add-event-modal' });
    expect(dialog).toHaveTextContent('create-mode');
    expect(dialog).toHaveTextContent('task');
  });

  it('opens AddEventModal in edit mode when a task row is clicked', async () => {
    const user = userEvent.setup();
    renderPage();

    await user.click(screen.getByRole('button', { name: 'Edit "Pick up groceries"' }));

    const dialog = screen.getByRole('dialog', { name: 'add-event-modal' });
    expect(dialog).toHaveTextContent('edit-mode');
  });
});
