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

// The first-run "Add your first task" door is tracked; nothing else in this
// card's tree touches Analytics, so a bare object is enough.
const homeEmptyCtaTapped = vi.fn();
vi.mock('@/lib/analytics', () => ({
  Analytics: { homeEmptyCtaTapped: (...args: unknown[]) => homeEmptyCtaTapped(...args) },
}));

// The viewer's 12h/24h clock — pin it so this test needs no QueryClientProvider
// and due-date labels never depend on the runner's navigator.language.
const mockUseHourCycle = vi.fn();
vi.mock('@/hooks/useHourCycle', () => ({
  useHourCycle: () => mockUseHourCycle(),
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

type QueryStatus = 'pending' | 'error' | 'success';
type FetchStatus = 'fetching' | 'paused' | 'idle';

/**
 * A `useQuery` result whose booleans are DERIVED from `status` + `fetchStatus`
 * exactly as React Query v5 derives them, so a test cannot describe a state
 * the library never produces (e.g. "loading" with data, or "not loading and
 * not errored" with no data — which is precisely what a PAUSED offline query
 * is, and what the old `isLoading` gate mistook for a settled empty answer).
 */
function queryResult<T>(status: QueryStatus, fetchStatus: FetchStatus, data: T | undefined, refetch: () => void) {
  const isPending = status === 'pending';
  const isFetching = fetchStatus === 'fetching';
  return {
    status,
    fetchStatus,
    data: isPending ? undefined : data,
    isPending,
    isSuccess: status === 'success',
    isError: status === 'error',
    isLoading: isPending && isFetching,
    isFetching,
    isPaused: fetchStatus === 'paused',
    isRefetching: isFetching && !isPending,
    refetch,
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
  /** Only the open-tasks list is in flight (no data yet). Overrides `isLoading`. */
  openLoading?: boolean;
  /** Only the ever-had-a-task probe is in flight (no data yet). Overrides `isLoading`. */
  everLoading?: boolean;
  /** The open-tasks list FAILED (settled, no data). */
  openError?: boolean;
  /** The ever-had-a-task probe FAILED (settled, no data). */
  everError?: boolean;
  /** BOTH reads paused offline (pending, no fetch in flight, no data). */
  paused?: boolean;
  /** Only the open-tasks list is paused offline. Overrides `paused`. */
  openPaused?: boolean;
  /** Only the ever-had-a-task probe is paused offline. Overrides `paused`. */
  everPaused?: boolean;
}): void {
  const ever = opts.ever ?? opts.open;
  mockUseTasks.mockImplementation((_circleId: string, taskOpts: { status?: string }) => {
    const isProbe = taskOpts?.status === 'all';
    const failed = (isProbe ? opts.everError : opts.openError) ?? false;
    const paused = (isProbe ? opts.everPaused : opts.openPaused) ?? opts.paused ?? false;
    const loading = (isProbe ? opts.everLoading : opts.openLoading) ?? opts.isLoading ?? false;
    const [status, fetchStatus]: [QueryStatus, FetchStatus] = failed
      ? ['error', 'idle']
      : paused
        ? ['pending', 'paused']
        : loading
          ? ['pending', 'fetching']
          : ['success', 'idle'];
    // Pending (loading OR paused) has no data by construction; a first-load
    // failure has none either.
    return queryResult(
      status,
      fetchStatus,
      failed ? undefined : { tasks: isProbe ? ever : opts.open, today: '2026-03-15', timezone: TZ },
      isProbe ? everRefetch : openRefetch
    );
  });
}

const openRefetch = vi.fn();
const everRefetch = vi.fn();
const FIRST_RUN_COPY =
  'Coordinate the to-dos that keep care on track — errands, refills, follow-ups — and share them with everyone helping.';

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
  homeEmptyCtaTapped.mockReset();
  mockUseHourCycle.mockReturnValue('12h');
  openRefetch.mockReset();
  everRefetch.mockReset();

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

  // EITHER, pinned one at a time. Setting both loading at once left each half
  // of `tasksQuery.isLoading || everTasksQuery.isLoading` untested: dropping
  // either operand still showed the skeleton, because the other one held it.
  it('shows the loading skeleton while ONLY the open-tasks list is in flight', () => {
    setTasks({ open: [], ever: [makeTask({ id: 't-done' })], openLoading: true, everLoading: false });
    renderCard();
    expect(screen.getByRole('status')).toHaveTextContent('Loading...');
    expect(screen.queryByText("You're all caught up — no open tasks.")).not.toBeInTheDocument();
  });

  it('shows the loading skeleton while ONLY the ever-had-a-task probe is in flight', () => {
    // The open list has answered "none"; the probe has not answered yet. Without
    // the wait, the card would flash first-run copy at a circle that may well
    // have finished tasks before.
    setTasks({ open: [], openLoading: false, everLoading: true });
    renderCard();
    expect(screen.getByRole('status')).toHaveTextContent('Loading...');
    expect(
      screen.queryByText(
        'Coordinate the to-dos that keep care on track — errands, refills, follow-ups — and share them with everyone helping.'
      )
    ).not.toBeInTheDocument();
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

    // The door opens the task form right here (create mode, pre-typed to
    // task), not a route — and is tracked.
    expect(screen.queryByRole('dialog', { name: 'add-event-modal' })).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Add your first task' }));
    const dialog = screen.getByRole('dialog', { name: 'add-event-modal' });
    expect(dialog).toHaveTextContent('create-mode');
    expect(dialog).toHaveTextContent('task');
    expect(homeEmptyCtaTapped).toHaveBeenCalledTimes(1);
    expect(homeEmptyCtaTapped).toHaveBeenCalledWith('tasks');
    fireEvent.click(screen.getByRole('button', { name: 'close-modal' }));
    expect(screen.queryByRole('dialog', { name: 'add-event-modal' })).toBeNull();
  });

  it('on first run, a viewer who cannot edit sees the copy but no door', () => {
    mockUseCircle.mockReturnValue({ canEdit: false, members: MEMBERS });
    setTasks({ open: [], ever: [] });
    renderCard();
    expect(
      screen.getByText(
        'Coordinate the to-dos that keep care on track — errands, refills, follow-ups — and share them with everyone helping.'
      )
    ).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Add your first task' })).toBeNull();
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
    // A genuine all-done state gets no first-task door.
    expect(screen.queryByRole('button', { name: 'Add your first task' })).toBeNull();
  });

  // ==========================================================================
  // A FAILED READ IS NOT A FIRST RUN.
  //
  // `hasEverHadTask` is false whenever the probe has no data — including when
  // it FAILED. With no error branch, a circle that has tasks was invited to
  // "Add your first task" (e2e/unhappy/writes/first-run-cta-failed-read.spec.ts).
  // ==========================================================================
  describe('failed reads', () => {
    it('ever-had-a-task probe fails: neutral copy, no first-run door, and Retry refetches the probe', () => {
      setTasks({ open: [], everError: true });
      renderCard();

      expect(screen.getByText("Couldn't load open tasks")).toBeInTheDocument();
      expect(screen.queryByRole('button', { name: 'Add your first task' })).toBeNull();
      expect(screen.queryByText(FIRST_RUN_COPY)).toBeNull();
      expect(screen.queryByText("You're all caught up — no open tasks.")).toBeNull();

      fireEvent.click(screen.getByRole('button', { name: 'Retry' }));
      expect(everRefetch).toHaveBeenCalledTimes(1);
      // The open list did not fail — it is not re-asked.
      expect(openRefetch).not.toHaveBeenCalled();
    });

    it('open-tasks list fails: neutral copy, no first-run door, and Retry refetches the list', () => {
      // The probe answered "never had one" — the CTA would be legitimate if the
      // list had loaded, but it did not, so nothing about emptiness is known.
      setTasks({ open: [], ever: [], openError: true });
      renderCard();

      expect(screen.getByText("Couldn't load open tasks")).toBeInTheDocument();
      expect(screen.queryByRole('button', { name: 'Add your first task' })).toBeNull();
      expect(screen.queryByText(FIRST_RUN_COPY)).toBeNull();

      fireEvent.click(screen.getByRole('button', { name: 'Retry' }));
      expect(openRefetch).toHaveBeenCalledTimes(1);
      expect(everRefetch).not.toHaveBeenCalled();
    });

    it('both fail: Retry refetches both', () => {
      setTasks({ open: [], openError: true, everError: true });
      renderCard();
      expect(screen.queryByRole('button', { name: 'Add your first task' })).toBeNull();
      fireEvent.click(screen.getByRole('button', { name: 'Retry' }));
      expect(openRefetch).toHaveBeenCalledTimes(1);
      expect(everRefetch).toHaveBeenCalledTimes(1);
    });

    it('a failed probe does not hide open tasks that DID load', () => {
      // The probe only decides the EMPTY copy; with rows on screen it is moot.
      setTasks({ open: [makeTask({ id: 't1', title: 'Refill prescription' })], everError: true });
      renderCard();
      expect(
        screen.getByRole('button', { name: openRowName('Refill prescription') })
      ).toBeInTheDocument();
      expect(screen.queryByText("Couldn't load open tasks")).toBeNull();
      expect(screen.queryByRole('button', { name: 'Retry' })).toBeNull();
    });

    it('loading: skeleton, no first-run door, no error copy', () => {
      setTasks({ open: [], ever: [], isLoading: true });
      renderCard();
      expect(screen.getByRole('status')).toHaveTextContent('Loading...');
      expect(screen.queryByRole('button', { name: 'Add your first task' })).toBeNull();
      expect(screen.queryByText("Couldn't load open tasks")).toBeNull();
    });

    it('success with data: the list, no first-run door, no error copy', () => {
      renderCard();
      expect(
        screen.getByRole('button', { name: openRowName('Pick up groceries') })
      ).toBeInTheDocument();
      expect(screen.queryByRole('button', { name: 'Add your first task' })).toBeNull();
      expect(screen.queryByText("Couldn't load open tasks")).toBeNull();
    });

    it('success and truly empty: the first-run door, no error copy', () => {
      setTasks({ open: [], ever: [] });
      renderCard();
      expect(screen.getByRole('button', { name: 'Add your first task' })).toBeInTheDocument();
      expect(screen.queryByText("Couldn't load open tasks")).toBeNull();
    });

    // PAUSED IS NOT SETTLED. Offline, React Query (networkMode 'online') parks
    // both reads at status 'pending' / fetchStatus 'paused' — `isLoading` is
    // false and `isError` is false, so an `isLoading` gate fell through to the
    // first-run door with no read ever having answered.
    it('both reads paused offline: skeleton, no first-run door, no error copy', () => {
      setTasks({ open: [], ever: [], paused: true });
      renderCard();
      expect(screen.getByRole('status')).toHaveTextContent('Loading...');
      expect(screen.queryByRole('button', { name: 'Add your first task' })).toBeNull();
      expect(screen.queryByText(FIRST_RUN_COPY)).toBeNull();
      expect(screen.queryByText("Couldn't load open tasks")).toBeNull();
    });

    it('open list answered empty but the probe is paused offline: no first-run door', () => {
      setTasks({ open: [], ever: [], everPaused: true });
      renderCard();
      expect(screen.getByRole('status')).toHaveTextContent('Loading...');
      expect(screen.queryByRole('button', { name: 'Add your first task' })).toBeNull();
      expect(screen.queryByText("You're all caught up — no open tasks.")).toBeNull();
    });

    it('probe answered "never had one" but the open list is paused offline: no first-run door', () => {
      setTasks({ open: [], ever: [], openPaused: true });
      renderCard();
      expect(screen.getByRole('status')).toHaveTextContent('Loading...');
      expect(screen.queryByRole('button', { name: 'Add your first task' })).toBeNull();
    });

    it('a paused probe does not hide open tasks that DID load', () => {
      setTasks({ open: [makeTask({ id: 't1', title: 'Refill prescription' })], everPaused: true });
      renderCard();
      expect(
        screen.getByRole('button', { name: openRowName('Refill prescription') })
      ).toBeInTheDocument();
      expect(screen.queryByRole('status')).toBeNull();
      expect(screen.queryByRole('button', { name: 'Add your first task' })).toBeNull();
    });
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
      expect(mockMutate.mock.calls[0][0]).toEqual({ eventId: 'task-1' });
    } finally {
      vi.useRealTimers();
    }
  });

  // NO `scheduledDate` FROM THIS SURFACE, and that is a decision rather than an
  // oversight. GET /circles/:id/tasks reads PHYSICAL calendar_events rows and
  // never expands a recurrence (backend/src/routes/tasks.ts), so a recurring
  // task's row here — the series root, or a materialized child — already IS its
  // own occurrence: its id addresses exactly the row to stamp, and the request
  // stays body-less. Only the calendar hands out virtual occurrences, and that
  // path resolves root + date in EventDetailActions. If this list ever started
  // serving virtual rows, this test is the one that has to change.
  it('completes a recurring task row by its OWN id, with no occurrence date', () => {
    vi.useFakeTimers();
    try {
      setTasks({
        open: [
          makeTask({
            id: 'child-0806',
            title: 'Water the plants',
            // A materialized child: a real row, under a series root.
            parent_event_id: 'parent-1',
          }),
        ],
      });
      renderCard();

      fireEvent.click(action('Mark "Water the plants" complete'));
      act(() => {
        vi.advanceTimersByTime(5000);
      });

      // `toEqual` on the whole object: a `scheduledDate` sneaking in here would
      // fail this, which is the point.
      expect(mockMutate.mock.calls[0][0]).toEqual({ eventId: 'child-0806' });
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
