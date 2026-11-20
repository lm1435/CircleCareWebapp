import { act, cleanup, render, screen, within } from '@testing-library/react';
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
    const rows = screen.getAllByTestId('shift-task-row').map((r) => within(r).getByTestId('shift-task-row-name').textContent);
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

  it('Done / Taken use the standard sm radius (rounded-lg, 16px like mobile), never a nested override', () => {
    renderList();
    const buttons = [...screen.getAllByTestId('shift-task-done'), ...screen.queryAllByTestId('shift-task-taken')];
    for (const b of buttons) {
      expect(b).toHaveClass('rounded-lg');
      expect(b.className).not.toMatch(/rounded-sm|rounded-md/);
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
  it('empty: ONE card with "Nothing on this shift\'s list yet." and the Add to this shift button OUTSIDE it, below', async () => {
    const onAdd = vi.fn();
    eventsHook.value = { ...eventsHook.value, events: [] };
    renderList({ onAdd });
    const card = screen.getByTestId('shift-task-list-empty-card');
    expect(within(card).getByTestId('shift-task-list-empty')).toHaveTextContent("Nothing on this shift's list yet.");
    // The Add button sits OUTSIDE the card, directly below it
    expect(within(card).queryByTestId('shift-detail-add-task')).toBeNull();
    const add = screen.getByRole('button', { name: 'Add to this shift' });
    expect(card.compareDocumentPosition(add) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(add).toHaveAttribute('data-variant', 'ghost');
    expect(add.className).toMatch(/text-moss/);
    expect(add.className).not.toMatch(/border-\[1\.5px\]/);
    expect(add.className).toMatch(/min-h-\[44px\]/);
    await userEvent.setup().click(add);
    expect(onAdd).toHaveBeenCalledTimes(1);
    // ONE Add control
    expect(screen.getAllByTestId('shift-detail-add-task')).toHaveLength(1);
    // POS the quieter hint line is there for someone who can add
    expect(within(card).getByTestId('shift-task-list-empty-hint')).toHaveTextContent(
      'Add a task, a medication or an appointment for whoever takes this shift.'
    );
  });

  it('P: empty titles drop the counter ("Lucia\'s list" / "Your list" / "This shift\'s list")', () => {
    eventsHook.value = { ...eventsHook.value, events: [] };
    renderList();
    expect(screen.getByTestId('shift-task-list-title')).toHaveTextContent(/^Lucia's list$/);
    cleanup();
    renderList({ shift: { ...shift, assigned_to: 'u-me' } as CalendarEvent });
    expect(screen.getByTestId('shift-task-list-title')).toHaveTextContent(/^Your list$/);
    cleanup();
    renderList({ shift: { ...shift, assigned_to: null } as CalendarEvent });
    expect(screen.getByTestId('shift-task-list-title')).toHaveTextContent(/^This shift's list$/);
  });

  it('N: with rows the counter stays and the Add button sits under the list (no empty card)', () => {
    renderList();
    expect(screen.getByTestId('shift-task-list-title')).toHaveTextContent(/ · \d of \d done$/);
    expect(screen.queryByTestId('shift-task-list-empty-card')).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Add to this shift' })).toHaveAttribute('data-variant', 'ghost');
  });

  it('N: an empty list never says "0 of 0 done"', () => {
    eventsHook.value = { ...eventsHook.value, events: [] };
    renderList();
    expect(screen.getByTestId('shift-task-section').textContent).not.toMatch(/0 of 0/);
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


describe('shift detail list: late items (1.4.3)', () => {
  // PINNED_NOW is 3:00 PM Chicago. 2:00 PM is 60 min past due; 2:46 PM is 14 min; 2:45 PM is exactly 15.
  const LATE = 'shift-task-row-late';

  it('P-LATE-1 an open task 15+ min past due reads "2:00 PM · Late" in the danger token', () => {
    eventsHook.value = { ...eventsHook.value, events: [ev('t1', { scheduled_time: '14:00:00', shift: link() })] };
    renderList();
    const late = screen.getByTestId(LATE);
    expect(late.textContent).toMatch(/^2:00 PM.* · Late$/); // the zone suffix may sit between
    expect(late.className).toMatch(/text-terracotta-deep/);
  });

  it('P-LATE-2 exactly 15 minutes counts, and an open dose is late the same way', () => {
    eventsHook.value = {
      ...eventsHook.value,
      events: [ev('t1', { scheduled_time: '14:45:00', shift: link() }), dose('d1', '14:00:00')],
    };
    renderList();
    expect(screen.getAllByTestId(LATE)).toHaveLength(2);
  });

  it('N-LATE-1 14 minutes past due and future items are not late', () => {
    eventsHook.value = {
      ...eventsHook.value,
      events: [ev('t1', { scheduled_time: '14:46:00', shift: link() }), ev('t2', { scheduled_time: '16:00:00', shift: link() })],
    };
    renderList();
    expect(screen.queryByTestId(LATE)).not.toBeInTheDocument();
    expect(screen.getByTestId('shift-task-section').textContent).not.toMatch(/Late/);
  });

  it('N-LATE-2 done, taken, skipped and missed items keep the plain time', () => {
    eventsHook.value = {
      ...eventsHook.value,
      events: [
        ev('done', { scheduled_time: '12:30:00', shift: link(), completed_at: '2026-11-09T19:00:00Z' }),
        dose('taken', '12:00:00', 'taken'),
        dose('skip', '12:15:00', 'skipped'),
        dose('miss', '12:45:00', 'missed'),
      ],
    };
    renderList();
    expect(screen.queryByTestId(LATE)).not.toBeInTheDocument();
  });

  it('N-LATE-3 an item answered right now (pending undo) is no longer late', () => {
    completion.pendingIds = new Set(['t1']);
    eventsHook.value = { ...eventsHook.value, events: [ev('t1', { scheduled_time: '14:00:00', shift: link() })] };
    renderList();
    expect(screen.queryByTestId(LATE)).not.toBeInTheDocument();
  });

  // The shift is 12:00-18:00 Chicago (CST) = 18:00Z-00:00Z.
  const setNow = (iso: string) => vi.setSystemTime(new Date(iso));
  afterEach(() => vi.setSystemTime(PINNED_NOW));

  it('P-LATE-4 N5 control: one minute before the shift ends an old open item is still Late', () => {
    setNow('2026-11-09T23:59:00Z');
    eventsHook.value = { ...eventsHook.value, events: [ev('t1', { scheduled_time: '14:00:00', shift: link() })] };
    renderList();
    expect(screen.getByTestId(LATE).textContent).toMatch(/· Late$/);
  });

  it('N-LATE-4 N5: once the shift has ended (now >= end) nothing is Late, though hours past due', () => {
    setNow('2026-11-10T00:00:00Z');
    eventsHook.value = {
      ...eventsHook.value,
      events: [ev('t1', { scheduled_time: '14:00:00', shift: link() }), dose('d1', '13:00:00')],
    };
    renderList({ ended: true });
    expect(screen.queryByTestId(LATE)).not.toBeInTheDocument();
    expect(screen.getByTestId('shift-task-section').textContent).not.toMatch(/Late/);
  });

  it('N-LATE-5 the recipient zone decides, not the browser: the same instant is not Late in Denver', () => {
    // 14:00 Denver (MST) = 21:00Z; PINNED_NOW is 21:00Z, so 0 minutes past due there. In Chicago it is 60.
    eventsHook.value = { ...eventsHook.value, events: [ev('t1', { scheduled_time: '14:00:00', shift: link() })] };
    renderList({ timezone: 'America/Denver', shift: { ...shift, scheduled_time: '12:00:00' } as CalendarEvent });
    expect(screen.queryByTestId(LATE)).not.toBeInTheDocument();
  });

  it('P-LATE-5 it becomes Late while the page is open (the minute tick), and stops when the shift ends', () => {
    vi.useFakeTimers({ toFake: ['Date', 'setInterval', 'clearInterval'], now: new Date('2026-11-09T20:59:00Z') });
    try {
      // Due 14:45 Chicago = 20:45Z: 14 minutes past at 20:59Z.
      eventsHook.value = { ...eventsHook.value, events: [ev('t1', { scheduled_time: '14:45:00', shift: link() })] };
      renderList();
      expect(screen.queryByTestId(LATE)).not.toBeInTheDocument();
      act(() => {
        vi.setSystemTime(new Date('2026-11-09T21:01:00Z'));
        vi.advanceTimersByTime(60_000);
      });
      expect(screen.getByTestId(LATE).textContent).toMatch(/· Late$/);
      act(() => {
        vi.setSystemTime(new Date('2026-11-10T00:00:30Z')); // the shift (ends 00:00Z) is over
        vi.advanceTimersByTime(60_000);
      });
      expect(screen.queryByTestId(LATE)).not.toBeInTheDocument();
    } finally {
      vi.useFakeTimers({ toFake: ['Date'], now: PINNED_NOW });
    }
  });
});

// 1.4.3: a task row's text block opens the editor / the read-only detail. Only the text block is a button, a
// SIBLING of Done / Taken (project_pressable_row_a11y_swallow); medication rows stay static.
describe('shift detail list: opening a task (1.4.3)', () => {
  const rowOf = (name: string) =>
    screen.getAllByTestId('shift-task-row').find((r) => within(r).getByTestId('shift-task-row-name').textContent === name)!;

  it('P-open an open task row is a button named "Edit <title> <time>"; tapping it reports the row', async () => {
    const onOpenTask = vi.fn();
    const user = userEvent.setup();
    renderList({ onOpenTask });
    const button = within(rowOf('Linked repeating')).getByRole('button', { name: /^Edit Linked repeating\s+2:00 PM/ });
    expect(button).toHaveAttribute('data-testid', 'shift-task-open');
    expect(button.className).toContain('min-h-[44px]');
    await user.click(button);
    expect(onOpenTask).toHaveBeenCalledTimes(1);
    expect(onOpenTask.mock.calls[0][0]).toMatchObject({ kind: 'task', key: 'Linked repeating', done: false, linked: true });
  });

  it('P-open the button carries the hint "Opens the task" and a decorative chevron', () => {
    renderList({ onOpenTask: vi.fn() });
    const button = within(rowOf('Linked repeating')).getByTestId('shift-task-open');
    const hint = document.getElementById(button.getAttribute('aria-describedby')!);
    expect(hint).toHaveTextContent('Opens the task');
    expect(button.querySelector('svg')?.closest('[aria-hidden="true"]')).not.toBeNull();
  });

  it('P-open a completed task row is "View ..." (the read-only detail)', async () => {
    eventsHook.value = {
      ...eventsHook.value,
      events: [ev('Gave pills', { scheduled_time: '14:00:00', shift: link(), completed_at: '2026-11-09T20:00:00Z' })],
    };
    const onOpenTask = vi.fn();
    const user = userEvent.setup();
    renderList({ onOpenTask });
    await user.click(screen.getByRole('button', { name: /^View Gave pills/ }));
    expect(onOpenTask.mock.calls[0][0]).toMatchObject({ done: true });
  });

  it('N9 Done is a SIBLING of the row button, never inside it, and keeps its own label', () => {
    renderList({ onOpenTask: vi.fn() });
    const row = rowOf('Linked repeating');
    const open = within(row).getByTestId('shift-task-open');
    const done = within(row).getByRole('button', { name: 'Done, Linked repeating' });
    expect(open.contains(done)).toBe(false);
    expect(done.contains(open)).toBe(false);
    expect(within(row).getAllByRole('button')).toHaveLength(2);
  });

  it('N8 a medication row has no button around its text; Taken keeps its own label', () => {
    eventsHook.value = { ...eventsHook.value, events: [dose('Lisinopril', '15:00:00')] };
    renderList({ onOpenTask: vi.fn() });
    const row = screen.getByTestId('shift-task-row');
    expect(within(row).queryByTestId('shift-task-open')).toBeNull();
    expect(within(row).getAllByRole('button')).toHaveLength(1);
    expect(within(row).getByRole('button', { name: 'Taken, Lisinopril' })).toBeInTheDocument();
  });

  it('N10 a view-only viewer: an open task is static text; a completed one still opens', () => {
    eventsHook.value = {
      ...eventsHook.value,
      events: [
        ev('Open one', { scheduled_time: '14:00:00', shift: link() }),
        ev('Done one', { scheduled_time: '15:00:00', shift: link(), completed_at: '2026-11-09T20:00:00Z' }),
      ],
    };
    renderList({ onOpenTask: vi.fn(), canWrite: false });
    expect(within(rowOf('Open one')).queryByTestId('shift-task-open')).toBeNull();
    expect(within(rowOf('Done one')).getByRole('button', { name: /^View Done one/ })).toBeInTheDocument();
  });

  it('N-pending a task whose Done is pending undo is not openable', () => {
    completion.pendingIds = new Set(['Linked repeating']);
    renderList({ onOpenTask: vi.fn() });
    expect(within(rowOf('Linked repeating')).queryByTestId('shift-task-open')).toBeNull();
  });

  it('without onOpenTask the rows are static (as before): no buttons around the text, no hint', () => {
    renderList();
    expect(screen.queryByTestId('shift-task-open')).toBeNull();
    expect(screen.queryByText('Opens the task')).toBeNull();
  });

  it('P5 highlight: the row of the saved task is ringed, and a virtual <root>_<date> row matches the root id', () => {
    eventsHook.value = {
      ...eventsHook.value,
      events: [
        ev('task-root_2026-11-09', { title: 'Repeating', scheduled_time: '14:00:00', shift: link(), parent_event_id: 'task-root' }),
        ev('other', { title: 'Other', scheduled_time: '15:00:00', shift: link() }),
      ],
    };
    renderList({ onOpenTask: vi.fn(), highlightTaskId: 'task-root' });
    expect(within(rowOf('Repeating')).getByTestId('highlight-ring')).toBeInTheDocument();
    expect(within(rowOf('Other')).queryByTestId('highlight-ring')).toBeNull();
    expect(screen.getAllByTestId('highlight-ring')).toHaveLength(1);
  });

  it('N-highlight no highlight id, or an id nothing matches, rings nothing', () => {
    renderList({ onOpenTask: vi.fn() });
    expect(screen.queryByTestId('highlight-ring')).toBeNull();
    cleanup();
    renderList({ onOpenTask: vi.fn(), highlightTaskId: 'nope' });
    expect(screen.queryByTestId('highlight-ring')).toBeNull();
  });
});

describe('Add to this shift: empty hint and the highlight of a just-added item', () => {
  it('NEG the empty hint is absent when the list has items, for a view-only viewer and on an ended shift', () => {
    renderList();
    expect(screen.queryByTestId('shift-task-list-empty-hint')).toBeNull();
    cleanup();
    eventsHook.value = { ...eventsHook.value, events: [] };
    renderList({ canWrite: false });
    expect(screen.getByTestId('shift-task-list-empty')).toBeInTheDocument();
    expect(screen.queryByTestId('shift-task-list-empty-hint')).toBeNull();
    cleanup();
    renderList({ ended: true });
    expect(screen.queryByTestId('shift-task-list-empty-hint')).toBeNull();
  });

  it('POS a just-added appointment opens "Also happening" on its own and rings its row', async () => {
    const visit = ev('visit-root_2026-11-09', { event_type: 'appointment', title: 'Dr visit', scheduled_time: '16:30:00', parent_event_id: 'visit-root' });
    eventsHook.value = { ...eventsHook.value, events: [...FIXTURE, visit] };
    renderList({ highlightTaskId: 'visit-root' });
    const also = await screen.findByTestId('shift-also-list');
    expect(within(also).getByText('Dr visit')).toBeInTheDocument();
    const rows = within(also).getAllByTestId('shift-also-row');
    const row = rows.find((r) => r.textContent?.includes('Dr visit'))!;
    expect(within(row).getByTestId('highlight-ring')).toBeInTheDocument();
    expect(screen.getAllByTestId('highlight-ring')).toHaveLength(1);
  });

  it('NEG a just-added plain task rings in the list and "Also happening" stays folded', () => {
    renderList({ highlightTaskId: 'Linked one-off' });
    expect(screen.queryByTestId('shift-also-list')).toBeNull();
    expect(screen.getByTestId('shift-also-toggle')).toHaveAttribute('aria-expanded', 'false');
    expect(screen.getAllByTestId('highlight-ring')).toHaveLength(1);
  });

  it('NEG no highlight: "Also happening" stays folded', () => {
    renderList();
    expect(screen.queryByTestId('shift-also-list')).toBeNull();
  });
});

describe('Add to this shift: one button, one place', () => {
  it('POS with items the button renders exactly once, outside the list, below it', () => {
    renderList();
    expect(screen.getAllByTestId('shift-detail-add-task')).toHaveLength(1);
    const add = screen.getByTestId('shift-detail-add-task');
    const list = screen.getByTestId('shift-task-list');
    expect(list.contains(add)).toBe(false);
    expect(add).toHaveAttribute('data-variant', 'ghost');
    expect(add.className).toMatch(/text-moss/);
    expect(add.className).toMatch(/bg-transparent/);
    expect(add.className).not.toMatch(/(^|\s)(border|bg-moss|bg-primary)|dashed/);
    expect(list.compareDocumentPosition(add) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });
});
