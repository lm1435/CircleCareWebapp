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

// The viewer's 12h/24h clock. The real hook reads the shared currentUser React
// Query — pin it so this page test needs no QueryClientProvider and due-date
// labels never depend on the runner's navigator.language.
const mockUseHourCycle = vi.fn();
vi.mock('@/hooks/useHourCycle', () => ({
  useHourCycle: () => mockUseHourCycle(),
}));

// Stub AddEventModal — assert open/close via a sentinel, not the real form.
vi.mock('@/components/calendar/AddEventModal', () => ({
  AddEventModal: ({
    event,
    initialType,
    initialTitle,
    onClose,
  }: {
    event?: CalendarEvent | null;
    initialType?: string;
    initialTitle?: string;
    onClose: () => void;
  }) => (
    <div role="dialog" aria-label="add-event-modal">
      <span>{event ? 'edit-mode' : 'create-mode'}</span>
      <span>{initialType ?? 'no-initial-type'}</span>
      <span>{initialTitle ?? 'no-initial-title'}</span>
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
  mockUseHourCycle.mockReturnValue('12h');

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

  // Starter chips were removed (cluttered the empty state; the AddEvent title
  // suggestions carry the quick-start value). Guard against regression.
  it('renders a clean empty state: no starter-chip group, plain Add task opens the modal untitled', async () => {
    mockUseTasks.mockReturnValue(tasksResult([]));
    const user = userEvent.setup();
    renderPage();

    expect(
      screen.queryByRole('group', { name: 'Start with a common task' })
    ).not.toBeInTheDocument();

    await user.click(screen.getAllByRole('button', { name: 'Add task' })[0]);
    const dialog = screen.getByRole('dialog', { name: 'add-event-modal' });
    expect(dialog).toHaveTextContent('create-mode');
    expect(dialog).toHaveTextContent('no-initial-title');
  });

  // The undo-window tests use fake timers, so they drive the UI with the
  // synchronous fireEvent (userEvent's internal async waits hang under fake
  // timers). beforeEach/afterEach below install + restore the fake clock.
  it('does not commit immediately — Done starts a pending undo window (canEdit)', () => {
    vi.useFakeTimers();
    try {
      renderPage();

      fireEvent.click(
        screen.getByRole('button', { name: 'Mark "Pick up groceries" complete' })
      );

      // Nothing committed yet — we're inside the 5s grace window.
      expect(mockMutate).not.toHaveBeenCalled();
      // The row has swapped into its pending state: the undo affordance is up
      // and the Done button is gone, so the same task cannot be completed twice
      // inside the window. (`aria-checked` no longer applies — completing is a
      // labelled button now, not a checkbox.)
      expect(
        screen.getByRole('button', { name: 'Undo completing "Pick up groceries"' })
      ).toBeInTheDocument();
      expect(
        screen.queryByRole('button', { name: 'Mark "Pick up groceries" complete' })
      ).toBeNull();
    } finally {
      vi.useRealTimers();
    }
  });

  // REGRESSION — the completion used to be flushed on unmount ONLY. Closing the
  // tab or backgrounding it does not reliably run React cleanup on web, so a
  // task marked done inside the grace window was simply lost: struck through in
  // the UI, still open on the server. `pagehide` is the event that fires in the
  // tab-close / bfcache path.
  it('commits a pending completion when the page goes away', () => {
    vi.useFakeTimers();
    try {
      renderPage();

      fireEvent.click(
        screen.getByRole('button', { name: 'Mark "Pick up groceries" complete' })
      );
      expect(mockMutate).not.toHaveBeenCalled();

      act(() => {
        window.dispatchEvent(new Event('pagehide'));
      });

      expect(mockMutate).toHaveBeenCalledTimes(1);
      expect(mockMutate.mock.calls[0][0]).toBe('task-1');

      // The timer must not then fire a SECOND request for the same task.
      act(() => {
        vi.advanceTimersByTime(6000);
      });
      expect(mockMutate).toHaveBeenCalledTimes(1);
    } finally {
      vi.useRealTimers();
    }
  });

  it('commits via useCompleteEvent after the undo window elapses', () => {
    vi.useFakeTimers();
    try {
      renderPage();

      fireEvent.click(
        screen.getByRole('button', { name: 'Mark "Pick up groceries" complete' })
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
        screen.getByRole('button', { name: 'Mark "Pick up groceries" complete' })
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
      // Back to actionable: Done is offered again and the undo affordance is
      // gone. (`aria-checked` no longer applies — see the note above.)
      expect(
        screen.getByRole('button', { name: 'Mark "Pick up groceries" complete' })
      ).toBeInTheDocument();
      expect(
        screen.queryByRole('button', { name: 'Undo completing "Pick up groceries"' })
      ).toBeNull();
    } finally {
      vi.useRealTimers();
    }
  });

  // REGRESSION (founder report 2026-08-10, "undo windows must be independent"):
  // starting B's undo window inside A's must not (1) flush A early, (2) re-arm
  // A's 5s window, or (3) remount A's row countdown — a remount restarts the
  // CSS cc-countdown animation, which reads as every countdown "restarting
  // together". Each pending row keeps its own timer in timersRef and its own
  // DOM node across pendingIds updates.
  it("marking B complete mid-window leaves A's window and countdown untouched", () => {
    vi.useFakeTimers();
    try {
      renderPage();

      // t=0: mark A ("Pick up groceries") complete.
      fireEvent.click(
        screen.getByRole('button', { name: 'Mark "Pick up groceries" complete' })
      );
      const undoA = screen.getByRole('button', {
        name: 'Undo completing "Pick up groceries"',
      });
      const rowA = undoA.closest('li');
      expect(rowA).not.toBeNull();
      // The draining countdown bar inside row A (decorative, aria-hidden).
      const barA = rowA!.querySelector('[aria-hidden="true"] > .origin-left');
      expect(barA).not.toBeNull();

      // t=2s: mark B ("Call pharmacy") complete.
      act(() => {
        vi.advanceTimersByTime(2000);
      });
      fireEvent.click(
        screen.getByRole('button', { name: 'Mark "Call pharmacy" complete' })
      );

      // (1) Nothing committed early.
      expect(mockMutate).not.toHaveBeenCalled();
      // (3) A's countdown element is the SAME node — not remounted, so its
      // CSS animation did not restart.
      expect(rowA!.querySelector('[aria-hidden="true"] > .origin-left')).toBe(barA);

      // (2) t=5s: A commits alone, on its original anchor...
      act(() => {
        vi.advanceTimersByTime(3000);
      });
      expect(mockMutate).toHaveBeenCalledTimes(1);
      expect(mockMutate.mock.calls[0][0]).toBe('task-1');

      // ...and B commits at ITS OWN t+5s (t=7s overall).
      act(() => {
        vi.advanceTimersByTime(2000);
      });
      expect(mockMutate).toHaveBeenCalledTimes(2);
      expect(mockMutate.mock.calls[1][0]).toBe('task-2');
    } finally {
      vi.useRealTimers();
    }
  });

  // WB2 REGRESSION — flushPending (pagehide/visibilitychange) committed the
  // mutation but never cleared `pendingIds`, so the "Completing… Undo"
  // affordance stuck around forever for a task that had already been sent to
  // the server — a dead Undo button. Old code: this assertion fails because
  // the Undo button is still present after the flush.
  it('clears the pending Undo affordance once a page-hide flush commits (WB2)', () => {
    vi.useFakeTimers();
    try {
      renderPage();

      fireEvent.click(
        screen.getByRole('button', { name: 'Mark "Pick up groceries" complete' })
      );
      expect(
        screen.getByRole('button', { name: 'Undo completing "Pick up groceries"' })
      ).toBeInTheDocument();

      act(() => {
        window.dispatchEvent(new Event('pagehide'));
      });

      expect(mockMutate).toHaveBeenCalledTimes(1);
      // The dead Undo affordance must not linger past the flush.
      expect(
        screen.queryByRole('button', { name: 'Undo completing "Pick up groceries"' })
      ).toBeNull();
    } finally {
      vi.useRealTimers();
    }
  });

  // WB3 REGRESSION — completion was conveyed ONLY by strikethrough styling,
  // invisible to screen readers. Both the open (pending) and completed rows
  // must carry an sr-only status string alongside the title. (The completed
  // row is no longer a button — completed tasks are locked — so its status is
  // asserted on the static row body.)
  it('exposes completion status to screen readers, not just strikethrough (WB3)', () => {
    mockUseTasks.mockReturnValue(
      tasksResult([
        makeTask({ id: 'task-1', title: 'Pick up groceries', completed_at: null }),
        makeTask({
          id: 'task-2',
          title: 'Call pharmacy',
          completed_at: '2026-03-15T10:00:00Z',
        }),
      ])
    );
    renderPage();

    const openRow = screen.getByRole('button', { name: 'Edit "Pick up groceries"' });
    expect(openRow).toHaveTextContent('Pick up groceries (not done)');

    const doneRow = screen.getByText(/Call pharmacy/);
    expect(doneRow).toHaveTextContent('Call pharmacy (done)');
  });

  // FOUNDER DIRECTIVE — once a task is completed it is no longer editable.
  // The row body swaps its edit button for static text (same shape as the
  // !canEdit branch); an open task keeps the edit affordance.
  it('offers no edit affordance for a completed task while an open task keeps it', () => {
    mockUseTasks.mockReturnValue(
      tasksResult([
        makeTask({ id: 'task-1', title: 'Pick up groceries', completed_at: null }),
        makeTask({
          id: 'task-2',
          title: 'Call pharmacy',
          completed_at: '2026-03-15T10:00:00Z',
        }),
      ])
    );
    renderPage();

    // Open task: edit affordance present.
    expect(
      screen.getByRole('button', { name: 'Edit "Pick up groceries"' })
    ).toBeInTheDocument();

    // Completed task: still rendered (title visible) but with NO edit button
    // and no Done CTA.
    expect(screen.getByText(/Call pharmacy/)).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Edit "Call pharmacy"' })).toBeNull();
    expect(
      screen.queryByRole('button', { name: 'Mark "Call pharmacy" complete' })
    ).toBeNull();
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
