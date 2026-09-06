import { act, fireEvent, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import '@/i18n';
import { OpenTasksCard } from '../OpenTasksCard';
import type { CalendarEvent } from '@/api/calendarEvents';
import type { CircleMember } from '@/api/circleMembers';

// The Overview "Open tasks" card. It used to be bare, non-interactive <li> text
// on OverviewPage; it now renders the SAME TaskRow as the Tasks page, driven by
// the SAME useTaskCompletion undo window — the parity mobile already had between
// its Tasks tab and its home-screen OpenTasks card.
//
// The open-tasks list/empty-copy assertions here were previously in
// OverviewPage.test.tsx; they moved with the behavior.

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

// The viewer's 12h/24h clock — pin it so this test needs no QueryClientProvider
// and due-date labels never depend on the runner's navigator.language.
const mockUseHourCycle = vi.fn();
vi.mock('@/hooks/useHourCycle', () => ({
  useHourCycle: () => mockUseHourCycle(),
}));

// Stub AddEventModal — assert open/close via a sentinel, not the real form.
vi.mock('@/components/calendar/AddEventModal', () => ({
  AddEventModal: ({ event, onClose }: { event?: CalendarEvent | null; onClose: () => void }) => (
    <div role="dialog" aria-label="add-event-modal">
      <span>{event ? 'edit-mode' : 'create-mode'}</span>
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

/**
 * An open row's accessible name.
 *
 * It carries the DUE LABEL and the status marker as well as the title:
 * `aria-label` on a <button> REPLACES its contents as the accessible name, so
 * without them nothing inside the row body is announced at all (WCAG 1.3.1).
 * The assignee is deliberately NOT in here — it lives in an sr-only sibling
 * OUTSIDE the button and is already read on its own.
 *
 * Every fixture here is due 2026-03-15 with no time, hence the one due label.
 */
const openRowName = (title: string): string =>
  `Edit "${title}", Mar 15, 2026 · All day, (not done)`;

/**
 * The card issues TWO useTasks calls: the open-tasks list and a `status: 'all'`
 * presence probe that decides between first-run and all-caught-up copy. Answer
 * each on its own terms.
 */
function setTasks(opts: {
  open: CalendarEvent[];
  ever?: CalendarEvent[];
  isLoading?: boolean;
}): void {
  const ever = opts.ever ?? opts.open;
  mockUseTasks.mockImplementation((_circleId: string, taskOpts: { status?: string }) =>
    tasksResult(taskOpts?.status === 'all' ? ever : opts.open, {
      isLoading: opts.isLoading ?? false,
    })
  );
}

function renderCard(limit = 3) {
  return render(
    <MemoryRouter>
      <OpenTasksCard circleId="circle-1" limit={limit} />
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
  setTasks({ open: [makeTask({ id: 'task-1', title: 'Pick up groceries' })] });
});

describe('OpenTasksCard', () => {
  it('queries open tasks and the ever-had-a-task presence probe', () => {
    renderCard();
    expect(mockUseTasks).toHaveBeenCalledWith('circle-1', { status: 'open' });
    expect(mockUseTasks).toHaveBeenCalledWith('circle-1', { status: 'all', limit: 1 });
  });

  it('shows the loading skeleton while either query is in flight', () => {
    setTasks({ open: [], isLoading: true });
    renderCard();
    expect(screen.getByRole('status')).toHaveTextContent('Loading...');
    expect(screen.queryByText("You're all caught up — no open tasks.")).not.toBeInTheDocument();
  });

  it('lists up to `limit` open tasks with a "Show all N" row into the Tasks page', () => {
    setTasks({
      open: [
        makeTask({ id: 't1', title: 'Refill prescription' }),
        makeTask({ id: 't2', title: 'Call doctor' }),
        makeTask({ id: 't3', title: 'Buy groceries' }),
        makeTask({ id: 't4', title: 'Schedule ride' }),
      ],
    });
    renderCard();
    expect(
      screen.getByRole('button', { name: openRowName('Refill prescription') })
    ).toBeInTheDocument();
    expect(screen.getByRole('button', { name: openRowName('Buy groceries') })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: openRowName('Schedule ride') })).toBeNull();
    // Mobile's `showAllRow` states the TOTAL, not the remainder, and is a
    // 44-tall destination rather than an inert caption (spec §6.3.6).
    expect(screen.getByRole('link', { name: 'Show all 4' })).toHaveAttribute(
      'href',
      '/circles/circle-1/tasks'
    );
  });

  it('shows first-run task copy when the circle has never had a task', () => {
    setTasks({ open: [], ever: [] });
    renderCard();
    expect(
      screen.getByText(
        'Coordinate the to-dos that keep care on track — errands, refills, follow-ups — and share them with everyone helping.'
      )
    ).toBeInTheDocument();
    expect(screen.queryByText("You're all caught up — no open tasks.")).not.toBeInTheDocument();
  });

  it('shows "all caught up" when past tasks exist but none are open, and links to the tasks page', () => {
    // Nothing open, but the circle has completed a task before — this is a
    // genuine all-done state, not a first run.
    setTasks({ open: [], ever: [makeTask({ id: 't-done', title: 'Pick up refill' })] });
    renderCard();
    expect(screen.getByText("You're all caught up — no open tasks.")).toBeInTheDocument();
    expect(
      screen.queryByText(
        'Coordinate the to-dos that keep care on track — errands, refills, follow-ups — and share them with everyone helping.'
      )
    ).not.toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'View all tasks' })).toHaveAttribute(
      'href',
      '/circles/circle-1/tasks'
    );
  });

  // PARITY — the card used to render bare text with no way to finish a task.
  /**
   * TaskRow renders each action TWICE — once inline at normal card widths and
   * once in the stacked fallback a container query reveals below 360px (spec
   * §4.6, TaskRow's own module comment). jsdom evaluates no container queries,
   * so BOTH copies sit in the tree while exactly one is ever visible in a
   * browser. Positive lookups therefore take the first (inline) copy;
   * ABSENCE assertions still use `queryByRole`, which correctly finds none.
   */
  const action = (name: string | RegExp): HTMLElement =>
    screen.getAllByRole('button', { name })[0]!;

  // It now carries the same labelled Done button as the Tasks page.
  it('offers the labelled Done action and does not commit inside the undo window', () => {
    vi.useFakeTimers();
    try {
      renderCard();

      fireEvent.click(action('Mark "Pick up groceries" complete'));

      expect(mockMutate).not.toHaveBeenCalled();
      // Matched loosely: TaskRow composes this control's accessible name from
      // `row.undo` + the task title (`UndoBadge`'s `itemLabel`), so the exact
      // wording belongs to TaskRow, not to this surface. What Overview owes is
      // that an Undo naming THIS task is reachable inside the window.
      expect(action(/Undo.*Pick up groceries/)).toBeInTheDocument();

      act(() => {
        vi.advanceTimersByTime(5000);
      });

      expect(mockMutate).toHaveBeenCalledTimes(1);
      expect(mockMutate.mock.calls[0][0]).toBe('task-1');
    } finally {
      vi.useRealTimers();
    }
  });

  it('undo inside the grace period cancels the completion', () => {
    vi.useFakeTimers();
    try {
      renderCard();

      fireEvent.click(action('Mark "Pick up groceries" complete'));
      fireEvent.click(action(/Undo.*Pick up groceries/));

      act(() => {
        vi.advanceTimersByTime(6000);
      });

      expect(mockMutate).not.toHaveBeenCalled();
      expect(action('Mark "Pick up groceries" complete')).toBeInTheDocument();
    } finally {
      vi.useRealTimers();
    }
  });

  // The page-away flush is the hook's, so it must work from this surface too.
  it('commits a pending completion when the page goes away', () => {
    vi.useFakeTimers();
    try {
      renderCard();

      fireEvent.click(action('Mark "Pick up groceries" complete'));
      act(() => {
        window.dispatchEvent(new Event('pagehide'));
      });

      expect(mockMutate).toHaveBeenCalledTimes(1);
      // ...and the dead Undo affordance does not linger past the flush (WB2).
      expect(screen.queryByRole('button', { name: /Undo.*Pick up groceries/ })).toBeNull();
    } finally {
      vi.useRealTimers();
    }
  });

  // Mobile's overview row opens the edit flow on tap; so does this one.
  it('opens AddEventModal in edit mode when a task row is clicked', async () => {
    const user = userEvent.setup();
    renderCard();

    await user.click(screen.getByRole('button', { name: openRowName('Pick up groceries') }));

    const dialog = screen.getByRole('dialog', { name: 'add-event-modal' });
    expect(dialog).toHaveTextContent('edit-mode');
  });

  it('hides the Done and edit affordances when canEdit is false', () => {
    mockUseCircle.mockReturnValue({ canEdit: false, members: MEMBERS });
    renderCard();

    expect(screen.queryByRole('button', { name: 'Mark "Pick up groceries" complete' })).toBeNull();
    expect(screen.queryByRole('button', { name: openRowName('Pick up groceries') })).toBeNull();
    // Read view still renders the task.
    expect(screen.getByText(/Pick up groceries/)).toBeInTheDocument();
  });
});
