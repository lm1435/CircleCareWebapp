import { cleanup, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import '@/i18n';
import type { CalendarEvent, ShiftTaskLink } from '@/api/calendarEvents';
import { ToastProvider } from '@/components/ui';
import { Analytics } from '@/lib/analytics';
import { ShiftTaskList } from '../ShiftTaskList';

// docs/plans/shift-tasks.md "Detail list" + "Decided additions": the list rules, the one-accent rule,
// the folded "Also happening", the four states and the analytics, with the owner's edge-case fixture
// (Lucia's overlapping REGULAR task is in her list and her count; Marco's and Anyone's are folded).

const PINNED_NOW = new Date('2026-11-09T21:00:00Z'); // 3:00 PM in Chicago (CST)
beforeAll(() => {
  vi.useFakeTimers({ toFake: ['Date'], now: PINNED_NOW });
});
afterAll(() => {
  vi.useRealTimers();
});

const eventsHook = vi.hoisted(() => ({
  value: {
    events: [] as unknown[],
    isLoading: false,
    isError: false,
    refetch: vi.fn(),
  },
}));
vi.mock('@/hooks/useShiftTasks', () => ({ useShiftOccurrenceEvents: () => eventsHook.value }));

const completion = vi.hoisted(() => ({
  handleComplete: vi.fn(),
  handleUndo: vi.fn(),
  handleHoldUndo: vi.fn(),
  pendingIds: new Set<string>(),
}));
vi.mock('@/hooks/useTaskCompletion', () => ({
  UNDO_DELAY_MS: 5000,
  useTaskCompletion: () => ({ ...completion, flushPending: vi.fn() }),
}));
const meds = vi.hoisted(() => ({ confirm: vi.fn(), pending: {} as Record<string, string> }));
vi.mock('@/components/meds/useMedicationUndo', () => ({
  useMedicationUndo: () => ({ pending: meds.pending, confirm: meds.confirm, undo: vi.fn(), hold: vi.fn() }),
}));
vi.mock('@/hooks/useHourCycle', () => ({ useHourCycle: () => '12h' }));
vi.mock('@/lib/analytics', () => ({
  Analytics: { shiftTaskListViewed: vi.fn(), shiftAlsoHappeningExpanded: vi.fn() },
}));

const LUCIA = 'u-lucia';
const MARCO = 'u-marco';
const DAY = '2026-11-09';
const members = [
  { id: LUCIA, first_name: 'Lucia', last_name: 'R', email: 'l@x.test', role: 'member', is_care_recipient: false },
  { id: MARCO, first_name: 'Marco', last_name: 'R', email: 'm@x.test', role: 'member', is_care_recipient: false },
  { id: 'u-me', first_name: 'Me', last_name: 'X', email: 'me@x.test', role: 'owner', is_care_recipient: false },
];

const shift = {
  id: 'root_2026-11-09',
  circle_id: 'c',
  event_type: 'shift',
  title: 'Afternoons',
  scheduled_date: DAY,
  scheduled_time: '12:00:00',
  duration_minutes: 360,
  parent_event_id: 'root',
  assigned_to: LUCIA,
  created_at: '',
  updated_at: '',
} as CalendarEvent;

const link = (over: Partial<ShiftTaskLink> = {}): ShiftTaskLink => ({
  root_id: 'root',
  date: DAY,
  title: 'Afternoons',
  assignee: { id: LUCIA, first_name: 'Lucia' },
  status: 'covered',
  window_start: `${DAY}T12:00:00`,
  window_end: `${DAY}T18:00:00`,
  ...over,
});
const ev = (id: string, over: Partial<CalendarEvent>): CalendarEvent =>
  ({
    id,
    circle_id: 'c',
    event_type: 'task',
    title: id,
    scheduled_date: DAY,
    scheduled_time: '14:00:00',
    assigned_to: null,
    created_at: '',
    updated_at: '',
    ...over,
  }) as CalendarEvent;
const dose = (id: string, time: string, status?: 'taken' | 'skipped' | 'missed') =>
  ev(id, {
    event_type: 'medication',
    title: id,
    scheduled_time: time,
    confirmation: status ? ({ status, confirmed_at: '', confirmed_by: 'x' } as never) : null,
  });

const FIXTURE = [
  dose('Metformin', '13:00:00', 'taken'),
  ev('Linked repeating', { scheduled_time: '14:00:00', shift: link() }),
  ev('Regular for Lucia', { scheduled_time: '14:30:00', assigned_to: LUCIA }),
  ev('Linked one-off', { scheduled_time: '15:00:00', shift: link() }),
  dose('Lisinopril', '15:30:00', 'skipped'),
  ev('Regular for Marco', { scheduled_time: '16:00:00', assigned_to: MARCO }),
  ev('Regular for Anyone', { scheduled_time: '17:00:00' }),
];

function renderList(over: Partial<React.ComponentProps<typeof ShiftTaskList>> = {}) {
  return render(
    <ToastProvider>
      <ShiftTaskList
        circleId="c"
        shift={shift}
        timezone="America/Chicago"
        members={members as never}
        viewerId="u-me"
        canWrite
        ended={false}
        onAdd={vi.fn()}
        {...over}
      />
    </ToastProvider>
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  eventsHook.value = { events: FIXTURE, isLoading: false, isError: false, refetch: vi.fn() };
  completion.pendingIds = new Set();
  meds.pending = {};
});
afterEach(cleanup);

describe('shift detail list: what is in it', () => {
  it('"Lucia\'s list · 2 of 5 done": linked tasks, doses, and Lucia\'s own overlapping regular task', () => {
    renderList();
    expect(screen.getByTestId('shift-task-list-title')).toHaveTextContent("Lucia's list · 2 of 5 done");
    const rows = screen.getAllByTestId('shift-task-row').map((r) => r.querySelector('p')?.textContent);
    expect(rows).toEqual(['Metformin', 'Linked repeating', 'Regular for Lucia', 'Linked one-off', 'Lisinopril']);
  });

  it('counts a skipped dose as handled and says "Skipped"', () => {
    renderList();
    const row = screen.getAllByTestId('shift-task-row')[4];
    expect(within(row).getByTestId('shift-task-row-status')).toHaveTextContent('Skipped');
    expect(screen.getByTestId('shift-task-list-title')).toHaveTextContent('2 of 5 done');
  });

  it('holds other people\'s and Anyone\'s regular tasks only under the folded "Also happening" group', async () => {
    const user = userEvent.setup();
    renderList();
    const toggle = screen.getByTestId('shift-also-toggle');
    expect(toggle).toHaveTextContent('Also happening during this shift (2)');
    expect(toggle).toHaveAttribute('aria-expanded', 'false');
    expect(screen.queryByText('Regular for Marco')).not.toBeInTheDocument();
    await user.click(toggle);
    expect(toggle).toHaveAttribute('aria-expanded', 'true');
    expect(within(screen.getByTestId('shift-also-list')).getAllByTestId('shift-also-row')).toHaveLength(2);
    expect(screen.getByText('Regular for Marco')).toBeInTheDocument();
    expect(screen.getByText('Regular for Anyone')).toBeInTheDocument();
    // Never in the person's list or its count.
    expect(
      within(screen.getByTestId('shift-task-list')).queryByText('Regular for Marco')
    ).not.toBeInTheDocument();
    expect(Analytics.shiftAlsoHappeningExpanded).toHaveBeenCalledTimes(1);
    await user.click(toggle);
    await user.click(toggle);
    expect(Analytics.shiftAlsoHappeningExpanded).toHaveBeenCalledTimes(2); // each open, never a collapse
  });

  it('hides the group at 0', () => {
    eventsHook.value = { ...eventsHook.value, events: FIXTURE.slice(0, 5) };
    renderList();
    expect(screen.queryByTestId('shift-also-toggle')).not.toBeInTheDocument();
  });

  it('title variants: "Your list" for the viewer, "This shift\'s list" while open', () => {
    renderList({ shift: { ...shift, assigned_to: 'u-me' } as CalendarEvent });
    expect(screen.getByTestId('shift-task-list-title')).toHaveTextContent(/^Your list · \d of \d done$/);
    cleanup();
    renderList({ shift: { ...shift, assigned_to: null } as CalendarEvent });
    expect(screen.getByTestId('shift-task-list-title')).toHaveTextContent(/^This shift's list · \d of \d done$/);
  });
});

describe('shift detail list: one accent', () => {
  it('fills ONLY the first actionable item; every later Done / Taken is an outline', () => {
    renderList();
    const buttons = [...screen.getAllByTestId('shift-task-done'), ...screen.queryAllByTestId('shift-task-taken')];
    expect(buttons).toHaveLength(3);
    const variants = buttons.map((b) => b.getAttribute('data-variant'));
    expect(variants.filter((v) => v === 'primary')).toHaveLength(1);
    expect(screen.getAllByTestId('shift-task-done')[0]).toHaveAttribute('data-variant', 'primary');
    expect(screen.getAllByTestId('shift-task-done')[1]).toHaveAttribute('data-variant', 'outline');
  });

  it('with another primary on screen (an open shift\'s Take), EVERY Done / Taken is an outline', () => {
    renderList({ primaryAllowed: false });
    const buttons = [...screen.getAllByTestId('shift-task-done'), ...screen.queryAllByTestId('shift-task-taken')];
    expect(buttons.length).toBeGreaterThan(0);
    for (const b of buttons) expect(b).toHaveAttribute('data-variant', 'outline');
  });

  it('Done / Taken use the standard sm radius (rounded-md, 12px like mobile), never a nested override', () => {
    renderList();
    const buttons = [...screen.getAllByTestId('shift-task-done'), ...screen.queryAllByTestId('shift-task-taken')];
    for (const b of buttons) {
      expect(b).toHaveClass('rounded-md');
      expect(b.className).not.toMatch(/rounded-sm/);
    }
  });

  it('completing a task and confirming a dose go through the shared hooks', async () => {
    const user = userEvent.setup();
    eventsHook.value = {
      ...eventsHook.value,
      events: [ev('Linked repeating', { shift: link() }), dose('Aspirin', '15:00:00')],
    };
    renderList();
    await user.click(screen.getByRole('button', { name: 'Done, Linked repeating' }));
    expect(completion.handleComplete).toHaveBeenCalledWith(expect.objectContaining({ id: 'Linked repeating' }));
    await user.click(screen.getByRole('button', { name: 'Taken, Aspirin' }));
    expect(meds.confirm).toHaveBeenCalledWith(expect.objectContaining({ id: 'Aspirin' }), 'taken');
  });

  it('a view-only viewer gets no buttons and no add control; an ended shift hides only the add control', () => {
    renderList({ canWrite: false });
    expect(screen.queryByTestId('shift-task-done')).not.toBeInTheDocument();
    expect(screen.queryByTestId('shift-detail-add-task')).not.toBeInTheDocument();
    cleanup();
    renderList({ ended: true });
    expect(screen.queryByTestId('shift-detail-add-task')).not.toBeInTheDocument();
    expect(screen.getAllByTestId('shift-task-done').length).toBeGreaterThan(0);
  });

  it('a dose that is not due yet has no Taken button', () => {
    eventsHook.value = { ...eventsHook.value, events: [dose('Evening pill', '17:50:00')] };
    renderList();
    expect(screen.queryByTestId('shift-task-taken')).not.toBeInTheDocument();
  });
});

describe('shift detail list: a dose nobody answered', () => {
  it('reads "Not marked", is not handled and offers no button', () => {
    eventsHook.value = { ...eventsHook.value, events: [dose('Forgotten pill', '13:00:00', 'missed')] };
    renderList();
    const row = screen.getByTestId('shift-task-row');
    expect(within(row).getByTestId('shift-task-row-status')).toHaveTextContent('Not marked');
    expect(screen.queryByTestId('shift-task-taken')).not.toBeInTheDocument();
    expect(screen.getByTestId('shift-task-list-title')).toHaveTextContent('0 of 1 done');
  });
});

describe('shift detail list: states', () => {
  it('empty: "Nothing on this shift\'s list yet." and the add control', async () => {
    const onAdd = vi.fn();
    eventsHook.value = { ...eventsHook.value, events: [] };
    renderList({ onAdd });
    expect(screen.getByTestId('shift-task-list-empty')).toHaveTextContent("Nothing on this shift's list yet.");
    await userEvent.setup().click(screen.getByRole('button', { name: 'Add a task to this shift' }));
    expect(onAdd).toHaveBeenCalledTimes(1);
  });

  it('loading shows a skeleton and no count claim', () => {
    eventsHook.value = { ...eventsHook.value, isLoading: true };
    renderList();
    expect(screen.getByTestId('shift-task-list-loading')).toBeInTheDocument();
    expect(Analytics.shiftTaskListViewed).not.toHaveBeenCalled();
  });

  it('error: "Couldn\'t load this shift\'s list." with Try again', async () => {
    const refetch = vi.fn();
    eventsHook.value = { events: [], isLoading: false, isError: true, refetch };
    renderList();
    expect(screen.getByRole('alert')).toHaveTextContent("Couldn't load this shift's list.");
    await userEvent.setup().click(screen.getByRole('button', { name: 'Try again' }));
    expect(refetch).toHaveBeenCalledTimes(1);
    expect(Analytics.shiftTaskListViewed).not.toHaveBeenCalled();
  });
});

describe('shift detail list: analytics', () => {
  it('shift_task_list_viewed fires once per opened occurrence with buckets only', () => {
    const { rerender } = renderList();
    expect(Analytics.shiftTaskListViewed).toHaveBeenCalledTimes(1);
    // 3 tasks (2 linked + Lucia's regular), 2 of 5 rows done -> '2-3', 'some'
    expect(Analytics.shiftTaskListViewed).toHaveBeenCalledWith({ tasksBucket: '2-3', doneBucket: 'some' });
    rerender(
      <ToastProvider>
        <ShiftTaskList
          circleId="c"
          shift={shift}
          timezone="America/Chicago"
          members={members as never}
          viewerId="u-me"
          canWrite
          ended={false}
          onAdd={vi.fn()}
        />
      </ToastProvider>
    );
    expect(Analytics.shiftTaskListViewed).toHaveBeenCalledTimes(1);
  });
});
