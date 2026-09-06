import { act, fireEvent, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import '@/i18n';
import { ToastProvider } from '@/components/ui';
import TasksPage from '../TasksPage';
import type { CalendarEvent } from '@/api/calendarEvents';
import type { CircleMember } from '@/api/circleMembers';

// Wave 3, Task 16 — TasksPage page slice, rewritten onto PageMasthead /
// CareTabs / the MoreMenu filter pills / careCard TaskRow. Mocks useTasks /
// useCompleteEvent / useMedicationStatus / useCircle / AddEventModal so the
// test stays focused on page behavior:
//   - status + sort filter pills re-query (useTasks called with the right
//     params)
//   - empty state
//   - the Done action gated on canEdit, fires useCompleteEvent after the 5s
//     undo grace period
//   - a completed row opens the calendar's EventDetailModal (mobile parity —
//     one read-only record per event, not a task-specific twin)
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
const mockUseMedicationStatus = vi.fn((_circleId: string) => ({
  mutateAsync: vi.fn(),
  isPending: false,
}));
const mockUseCircle = vi.fn();

vi.mock('@/hooks/useTasks', () => ({
  useTasks: (circleId: string, opts: unknown) => mockUseTasks(circleId, opts),
}));

vi.mock('@/hooks/useCalendarEvents', () => ({
  useCompleteEvent: (circleId: string) => mockUseCompleteEvent(circleId),
  // EventDetailActions (mounted for real by the completed-task detail below)
  // calls this unconditionally, even though a task never reaches its
  // medication-only branches.
  useMedicationStatus: (circleId: string) => mockUseMedicationStatus(circleId),
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

// The completed-task detail (the calendar's EventDetailModal + EventDetailActions)
// renders for REAL here — the point of these tests is that the row reaches it
// and that it carries no edit affordance — but its heavyweight leaf is
// stubbed: EventNotesPanel owns its own React Query hooks and the auth store,
// and has its own spec.
vi.mock('@/components/calendar/EventNotesPanel', () => ({
  EventNotesPanel: ({ eventId }: { eventId: string }) => (
    <div data-testid="event-notes-panel">{`notes:${eventId}`}</div>
  ),
}));

vi.mock('@/components/calendar/DeleteEventDialog', () => ({
  DeleteEventDialog: ({ event, onClose }: { event: CalendarEvent; onClose: () => void }) => (
    <div role="dialog" aria-label="delete-event-dialog">
      <span>{`deleting:${event.id}`}</span>
      <button type="button" onClick={onClose}>
        close-delete
      </button>
    </div>
  ),
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

// Pin the "device" timezone. A rendered time is labelled with the care
// recipient's zone only when the VIEWER is elsewhere, so without this the
// assertions below would depend on the machine running the suite (the dev
// machine is America/Denver; CI is not). Only getDeviceTimezone reads
// resolvedOptions — format/formatToParts are unaffected.
vi.spyOn(Intl.DateTimeFormat.prototype, 'resolvedOptions').mockReturnValue({
  timeZone: 'America/Denver',
} as Intl.ResolvedDateTimeFormatOptions);


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

/**
 * The OPEN row's accessible name.
 *
 * It carries the DUE LABEL and the status marker as well as the title:
 * `aria-label` on a <button> REPLACES its contents, and the title is the
 * whole of this button's subtree, so without them nothing in the row would
 * be announced (WCAG 1.3.1). The assignee is deliberately absent — the meta
 * row (assignee, due date, overdue pill) is a plain SIBLING of this button,
 * never inside it, so it is already announced on its own.
 */
const OPEN_ROW_NAME = 'Edit "Pick up groceries", Mar 15, 2026 · All day, (not done)';

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
    <ToastProvider>
      <MemoryRouter initialEntries={['/circles/circle-1/tasks']}>
        <Routes>
          <Route path="/circles/:circleId/tasks" element={<TasksPage />} />
        </Routes>
      </MemoryRouter>
    </ToastProvider>
  );
}

/**
 * TaskRow renders each action (Done / Undo) TWICE — once inline at normal
 * card widths and once in the stacked fallback a container query reveals
 * below 360px (careCardActionsInline / careCardActionsRow, TaskRow's own
 * module comment). jsdom evaluates no container queries, so BOTH copies sit
 * in the tree while exactly one is ever visible in a real browser. Positive
 * lookups therefore take the first (inline) copy; ABSENCE assertions still
 * use `queryByRole`, which correctly finds none regardless. (Same convention
 * OpenTasksCard.test.tsx uses for the identical reason.)
 */
const action = (name: string | RegExp): HTMLElement =>
  screen.getAllByRole('button', { name })[0]!;

beforeEach(() => {
  mockUseTasks.mockReset();
  mockMutate.mockReset();
  mockUseCompleteEvent.mockClear();
  mockUseMedicationStatus.mockClear();
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

  it('re-queries when the status filter pill changes', async () => {
    const user = userEvent.setup();
    renderPage();

    await user.click(screen.getByRole('button', { name: /Status: Open/ }));
    await user.click(screen.getByRole('menuitem', { name: 'Completed' }));

    expect(mockUseTasks).toHaveBeenLastCalledWith('circle-1', {
      status: 'completed',
      sort: 'due_date',
    });
  });

  it('re-queries when the sort filter pill changes', async () => {
    const user = userEvent.setup();
    renderPage();

    await user.click(screen.getByRole('button', { name: /Sort: Due date/ }));
    await user.click(screen.getByRole('menuitem', { name: 'Assignee' }));

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
    // masthead's right action also renders "Add task" — twice, mobile-round +
    // xl-labelled — hence getAllByRole).
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

      fireEvent.click(action('Mark "Pick up groceries" complete'));

      // Nothing committed yet — we're inside the 5s grace window.
      expect(mockMutate).not.toHaveBeenCalled();
      // The row has swapped into its pending state: the undo affordance is up
      // and the Done button is gone, so the same task cannot be completed twice
      // inside the window.
      expect(action(/Undo.*Pick up groceries/)).toBeInTheDocument();
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

      fireEvent.click(action('Mark "Pick up groceries" complete'));
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

      fireEvent.click(action('Mark "Pick up groceries" complete'));
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

      fireEvent.click(action('Mark "Pick up groceries" complete'));
      fireEvent.click(action(/Undo.*Pick up groceries/));

      // Past the window — still nothing committed because undo cleared the timer.
      act(() => {
        vi.advanceTimersByTime(6000);
      });

      expect(mockMutate).not.toHaveBeenCalled();
      // Back to the un-checked / editable state.
      expect(action('Mark "Pick up groceries" complete')).toBeInTheDocument();
      expect(
        screen.queryByRole('button', { name: /Undo.*Pick up groceries/ })
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
      fireEvent.click(action('Mark "Pick up groceries" complete'));
      const undoA = action(/Undo.*Pick up groceries/);
      const rowA = undoA.closest('li');
      expect(rowA).not.toBeNull();
      // The draining countdown bar inside row A's (inline) UndoBadge
      // (decorative, aria-hidden).
      const barA = rowA!.querySelector('.origin-left');
      expect(barA).not.toBeNull();

      // t=2s: mark B ("Call pharmacy") complete.
      act(() => {
        vi.advanceTimersByTime(2000);
      });
      fireEvent.click(action('Mark "Call pharmacy" complete'));

      // (1) Nothing committed early.
      expect(mockMutate).not.toHaveBeenCalled();
      // (3) A's countdown element is the SAME node — not remounted, so its
      // CSS animation did not restart.
      expect(rowA!.querySelector('.origin-left')).toBe(barA);

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

      fireEvent.click(action('Mark "Pick up groceries" complete'));
      expect(action(/Undo.*Pick up groceries/)).toBeInTheDocument();

      act(() => {
        window.dispatchEvent(new Event('pagehide'));
      });

      expect(mockMutate).toHaveBeenCalledTimes(1);
      // The dead Undo affordance must not linger past the flush.
      expect(
        screen.queryByRole('button', { name: /Undo.*Pick up groceries/ })
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

    const openRow = screen.getByRole('button', { name: OPEN_ROW_NAME });
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
      screen.getByRole('button', { name: OPEN_ROW_NAME })
    ).toBeInTheDocument();

    // Completed task: still rendered (title visible) but with NO edit button
    // and no Done CTA.
    expect(screen.getByText(/Call pharmacy/)).toBeInTheDocument();
    // Match by PREFIX — the name now carries the due label and status too,
    // and an exact-string query would pass even if the button were there.
    expect(screen.queryByRole('button', { name: /^Edit "Call pharmacy"/ })).toBeNull();
    expect(
      screen.queryByRole('button', { name: 'Mark "Call pharmacy" complete' })
    ).toBeNull();
  });

  /**
   * THE READ-ONLY GATE. Every affordance here is a BUTTON.
   */
  it('hides the complete and edit controls, and Add task, when canEdit is false', () => {
    mockUseCircle.mockReturnValue({ canEdit: false, members: MEMBERS });
    renderPage();

    expect(
      screen.queryByRole('button', { name: 'Mark "Pick up groceries" complete' })
    ).not.toBeInTheDocument();
    // Matched by PREFIX: the edit button's accessible name carries the due
    // label and status too (see OPEN_ROW_NAME), so an exact string would miss
    // the button even when it is present.
    expect(screen.queryByRole('button', { name: /^Edit "Pick up groceries"/ })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Add task' })).not.toBeInTheDocument();
    // Read view still renders the tasks.
    expect(screen.getByText('Pick up groceries')).toBeInTheDocument();
  });

  /**
   * The positive control for the gate above. Without it, deleting the edit
   * branch outright would satisfy both `queryBy*` assertions there.
   */
  it('shows the complete and edit controls when canEdit is true', () => {
    renderPage();

    expect(action('Mark "Pick up groceries" complete')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /^Edit "Pick up groceries"/ })).toBeInTheDocument();
  });

  it('opens AddEventModal in create mode (type=task) from "Add task"', async () => {
    const user = userEvent.setup();
    renderPage();

    // The masthead's right action renders twice (mobile round + xl labelled) —
    // either activates the identical onClick.
    await user.click(screen.getAllByRole('button', { name: 'Add task' })[0]!);

    const dialog = screen.getByRole('dialog', { name: 'add-event-modal' });
    expect(dialog).toHaveTextContent('create-mode');
    expect(dialog).toHaveTextContent('task');
  });

  it('opens AddEventModal in edit mode when a task row is clicked', async () => {
    const user = userEvent.setup();
    renderPage();

    await user.click(screen.getByRole('button', { name: OPEN_ROW_NAME }));

    const dialog = screen.getByRole('dialog', { name: 'add-event-modal' });
    expect(dialog).toHaveTextContent('edit-mode');
  });

  // ── W1: a completed task is a FROZEN RECORD, not a hidden one ─────────────
  // It used to be inert text — the Tasks tab offered a completed task NO
  // actions at all while the calendar's detail sheet offered {view, notes,
  // delete}. The row is now pressable, and it presses into the SAME
  // read-only calendar detail (EventDetailModal) a completed CALENDAR event
  // opens into — mobile parity is one record per event, not a task-specific
  // twin of it. It must never press into the editor.

  function withCompletedTask(): void {
    mockUseTasks.mockReturnValue(
      tasksResult([
        makeTask({ id: 'task-1', title: 'Pick up groceries', completed_at: null }),
        makeTask({
          id: 'task-2',
          title: 'Call pharmacy',
          assigned_to: 'u-assignee',
          // 8:05 PM on Mar 15 in America/Chicago — deliberately an instant
          // whose UTC date (Mar 16) differs from its local one.
          completed_at: '2026-03-16T01:05:00Z',
          completed_by: 'u-assignee',
          completed_by_user: {
            id: 'u-assignee',
            email: 'rose@example.com',
            first_name: 'Rose',
            last_name: 'Meza',
          },
        }),
      ])
    );
  }

  /**
   * The completed row's accessible name.
   *
   * It carries the DUE LABEL and the "(done)" marker as well as the title,
   * because `aria-label` on a <button> REPLACES its contents as the accessible
   * name.
   */
  const COMPLETED_ROW_NAME = 'View details for "Call pharmacy", Mar 15, 2026 · All day, (done)';

  it('opens the read-only calendar detail when a completed row is clicked', async () => {
    withCompletedTask();
    const user = userEvent.setup();
    renderPage();

    const row = screen.getByRole('button', { name: COMPLETED_ROW_NAME });
    await user.click(row);

    const dialog = screen.getByRole('dialog');
    expect(dialog).toHaveTextContent('Call pharmacy');
    // Who finished it and when, in the care recipient's timezone — resolved
    // from the tasks response's `completed_by_user` embed via the `members`
    // prop TasksPage threads through to EventDetailModal (mirrors CalendarPage).
    expect(dialog).toHaveTextContent('Rose Meza · Mar 15, 2026, 8:05 PM (Chicago)');
    // Notes are reachable from here — they were never gated on completion.
    expect(screen.getByTestId('event-notes-panel')).toHaveTextContent('notes:task-2');
    // And it is NOT the editor.
    expect(screen.queryByRole('dialog', { name: 'add-event-modal' })).toBeNull();
  });

  // The test above can't actually prove TasksPage threads `members` through to
  // EventDetailModal: `completed_by_user` is EMBEDDED there, so
  // EventDetailModal resolves the name from the embed alone and would render
  // identically with no `members` prop at all. This fixture omits the embed
  // (the shape the CALENDAR GET actually returns — only the tasks endpoint
  // embeds it) so the name can only come from EventDetailModal's roster
  // fallback: `(members ?? []).find((m) => m.id === event.completed_by)`.
  // Remove `members={members}` from TasksPage's `<EventDetailModal>` and that
  // fallback has nothing to search — `completedByName` goes null, the row
  // falls back to the unattributed "Completed on" label, and "Rose Meza"
  // never renders. That is what this test would catch.
  it('resolves "Completed by" from the circle roster when completed_by_user is not embedded', async () => {
    mockUseTasks.mockReturnValue(
      tasksResult([
        makeTask({
          id: 'task-3',
          title: 'Water the plants',
          assigned_to: null,
          // Same instant as withCompletedTask's fixture — 8:05 PM Mar 15 in
          // America/Chicago — but NO `completed_by_user` embed.
          completed_at: '2026-03-16T01:05:00Z',
          completed_by: 'u-assignee',
        }),
      ])
    );
    const user = userEvent.setup();
    renderPage();

    const row = screen.getByRole('button', {
      name: 'View details for "Water the plants", Mar 15, 2026 · All day, (done)',
    });
    await user.click(row);

    const dialog = screen.getByRole('dialog');
    expect(dialog).toHaveTextContent('Rose Meza · Mar 15, 2026, 8:05 PM (Chicago)');
  });

  // Keyboard operability: the row is a real <button>, so it is tabbable and
  // Enter/Space activate it — no click-only div.
  it('opens the completed detail from the keyboard', async () => {
    withCompletedTask();
    const user = userEvent.setup();
    renderPage();

    screen.getByRole('button', { name: COMPLETED_ROW_NAME }).focus();
    await user.keyboard('{Enter}');

    expect(screen.getByRole('dialog')).toHaveTextContent('Call pharmacy');
  });

  // THE LOCK STAYS. Opening the detail must not reintroduce an edit path.
  it('the completed detail exposes no edit affordance', async () => {
    withCompletedTask();
    const user = userEvent.setup();
    renderPage();

    await user.click(screen.getByRole('button', { name: COMPLETED_ROW_NAME }));

    // Scoped to the dialog: the OPEN task's row behind it legitimately still
    // carries an Edit affordance — that is the behavior this must not disturb.
    const dialog = screen.getByRole('dialog');
    expect(within(dialog).queryByRole('button', { name: /edit/i })).toBeNull();
    expect(screen.queryByRole('dialog', { name: 'add-event-modal' })).toBeNull();
  });

  it('Delete in the completed detail raises the delete dialog and replaces the detail', async () => {
    withCompletedTask();
    const user = userEvent.setup();
    renderPage();

    await user.click(screen.getByRole('button', { name: COMPLETED_ROW_NAME }));
    await user.click(screen.getByRole('button', { name: 'Delete' }));

    // The destructive confirm REPLACES the detail — never stacks on it.
    const dialog = screen.getByRole('dialog', { name: 'delete-event-dialog' });
    expect(dialog).toHaveTextContent('deleting:task-2');
    expect(screen.queryByTestId('event-notes-panel')).toBeNull();
  });

  // A view-only member gets the record (it writes nothing) but no Delete.
  it('a read-only member can open the completed detail but gets no Delete', async () => {
    withCompletedTask();
    mockUseCircle.mockReturnValue({ canEdit: false, members: MEMBERS });
    const user = userEvent.setup();
    renderPage();

    await user.click(screen.getByRole('button', { name: COMPLETED_ROW_NAME }));

    expect(screen.getByRole('dialog')).toHaveTextContent('Call pharmacy');
    expect(screen.queryByRole('button', { name: 'Delete' })).toBeNull();
  });

  // The row markup must not nest one interactive element inside another: the
  // pressable title is a SIBLING of the status glyph, the meta row and the
  // action slots, never their parent.
  it('never nests a button inside the pressable row title', () => {
    withCompletedTask();
    renderPage();

    const row = screen.getByRole('button', { name: COMPLETED_ROW_NAME });
    expect(row.querySelectorAll('button, a[href], input, select, textarea')).toHaveLength(0);

    const openRow = screen.getByRole('button', { name: OPEN_ROW_NAME });
    expect(openRow.querySelectorAll('button, a[href], input, select, textarea')).toHaveLength(0);
  });

  // Code review fix — a PERSISTED completion renders NOTHING in the action
  // slot (mobile parity: mobile/src/components/tasks/TaskRow.tsx's action is
  // `isPendingComplete ? <UndoBadge/> : !isCompleted ? <Done/> : null`). It
  // used to render the assignee's Avatar there ("who finished it"), which
  // drew a bare "?" placeholder disc for an UNASSIGNED completed task — a
  // made-up glyph mobile never shows; mobile's own meta row is name-only,
  // no avatar. The row's NAME (or "Unassigned") in the meta row is the only
  // "who" this surface states.
  it('renders no avatar in the action slot for a completed task, assigned or not', () => {
    withCompletedTask();
    mockUseTasks.mockReturnValue(
      tasksResult([
        makeTask({
          id: 'task-4',
          title: 'Unassigned finished task',
          assigned_to: null,
          completed_at: '2026-03-15T18:00:00Z',
        }),
        makeTask({
          id: 'task-5',
          title: 'Assigned finished task',
          assigned_to: 'u-assignee',
          completed_at: '2026-03-15T18:00:00Z',
        }),
      ])
    );
    renderPage();

    for (const name of [
      'View details for "Unassigned finished task", Mar 15, 2026 · All day, (done)',
      'View details for "Assigned finished task", Mar 15, 2026 · All day, (done)',
    ]) {
      const row = screen.getByRole('button', { name }).closest('li')!;
      // Neither action slot renders anything for a persisted completion.
      expect(row.querySelector('.ml-auto')).toHaveTextContent('');
      expect(row.querySelector('.mt-2')).toHaveTextContent('');
      // No stray "?" placeholder disc anywhere in the row.
      expect(within(row).queryByText('?')).not.toBeInTheDocument();
    }
  });

  // Both action slots (careCardActionsInline + careCardActionsRow) render, so
  // the container query in a real browser always has one to pick.
  it('renders the Done action in both the inline and stacked slots', () => {
    renderPage();

    expect(
      screen.getAllByRole('button', { name: 'Mark "Pick up groceries" complete' })
    ).toHaveLength(2);
  });

  // The meta row (assignee, due date, overdue pill) is a SIBLING of the
  // title button, so its text is never folded into (and cannot change) the
  // button's accessible NAME — OpenTasksCard's pinned aria-label constant
  // must stay byte-identical. `aria-describedby` is how a keyboard/screen-
  // reader user still hears it, as the button's DESCRIPTION.
  it('describes the title button via aria-describedby, without changing its name', () => {
    mockUseTasks.mockReturnValue(
      tasksResult([
        // Overdue: scheduled before "today" (2026-03-15), open, not pending.
        makeTask({
          id: 'task-1',
          title: 'Pick up groceries',
          assigned_to: 'u-assignee',
          scheduled_date: '2026-03-10',
        }),
      ])
    );
    renderPage();

    const openRow = screen.getByRole(
      'button',
      { name: 'Edit "Pick up groceries", Mar 10, 2026 · All day, (not done)' }
    );
    const describedById = openRow.getAttribute('aria-describedby');
    expect(describedById).toBeTruthy();

    const description = document.getElementById(describedById!);
    expect(description).not.toBeNull();
    // The name is untouched — the assignee is NOT part of it — but the
    // description carries both the assignee and the overdue label.
    expect(openRow).toHaveAccessibleName(
      'Edit "Pick up groceries", Mar 10, 2026 · All day, (not done)'
    );
    expect(description).toHaveTextContent('Rose Meza');
    expect(description).toHaveTextContent('Overdue');
  });

  it('describes the completed row via aria-describedby too', () => {
    withCompletedTask();
    renderPage();

    const completedRow = screen.getByRole('button', { name: COMPLETED_ROW_NAME });
    const describedById = completedRow.getAttribute('aria-describedby');
    expect(describedById).toBeTruthy();

    const description = document.getElementById(describedById!);
    expect(description).not.toBeNull();
    expect(description).toHaveTextContent('Rose Meza');
  });
});
