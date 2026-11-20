import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router-dom';
import '@/i18n';
import { deleteEvent, getSeriesRoot, updateEvent, type CalendarEvent } from '@/api/calendarEvents';
import { createShiftTask } from '@/api/shiftTasks';
import { ToastProvider } from '@/components/ui';
import { Analytics } from '@/lib/analytics';
import { useCircle } from '@/hooks/useCircle';
import { useAuthStore } from '@/store/authStore';
import { useShiftsDialogs } from '../ShiftsDialogs';

// 1.4.3 shift task add / edit from the shift detail (plan sections 1-3, 6): the detail is REPLACED by the editor
// (or the read-only detail), and every close path returns to it; a save returns with the row ringed.

const PINNED_NOW = new Date('2026-11-09T21:00:00Z'); // Mon 3:00 PM in Chicago: the Tuesday shift has not started
beforeAll(() => {
  vi.useFakeTimers({ toFake: ['Date'], now: PINNED_NOW });
});
afterAll(() => {
  vi.useRealTimers();
});

vi.mock('@/api/calendarEvents', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/api/calendarEvents')>()),
  deleteEvent: vi.fn(),
  getSeriesRoot: vi.fn(),
  updateEvent: vi.fn(),
}));
vi.mock('@/api/shiftTasks', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/api/shiftTasks')>()),
  createShiftTask: vi.fn(),
}));
vi.mock('@/hooks/useCircle', () => ({ useCircle: vi.fn() }));
vi.mock('@/hooks/useHourCycle', () => ({ useHourCycle: () => '12h' }));
vi.mock('@/hooks/useProviders', () => ({ useProviders: () => ({ providers: [], isSuccess: true }) }));
vi.mock('@/components/calendar/EventNotesPanel', () => ({
  EventNotesPanel: () => <div data-testid="notes-panel">notes</div>,
}));
const rowsHook = vi.hoisted(() => ({ events: [] as unknown[] }));
vi.mock('@/hooks/useShiftTasks', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/hooks/useShiftTasks')>()),
  useShiftOccurrenceEvents: () => ({ events: rowsHook.events, isLoading: false, isError: false, refetch: vi.fn() }),
  useShiftTaskDeleteImpact: () => undefined,
}));
vi.spyOn(Intl.DateTimeFormat.prototype, 'resolvedOptions').mockReturnValue({
  timeZone: 'America/Chicago',
} as Intl.ResolvedDateTimeFormatOptions);

const members = [
  { id: 'u-owner', first_name: 'Olivia', last_name: 'O', email: 'o@x.test', role: 'owner', is_care_recipient: false },
  { id: 'u-ana', first_name: 'Ana', last_name: 'R', email: 'a@x.test', role: 'member', is_care_recipient: false },
];

function circle(over: Record<string, unknown> = {}) {
  vi.mocked(useCircle).mockReturnValue({
    circle: { id: 'c', recipient_name: 'Rosa', owner_id: 'u-owner', is_self_care: false },
    timezone: 'America/Chicago',
    members,
    canEdit: true,
    canManageMembers: true,
    viewerRole: 'owner',
    isPremiumCircle: true,
    isOwner: true,
    viewOnly: false,
    hasShifts: false,
    ...over,
  } as unknown as ReturnType<typeof useCircle>);
}

const DAY = '2026-11-10';
const shift = (over: Partial<CalendarEvent> = {}): CalendarEvent =>
  ({
    id: 'root_2026-11-10',
    parent_event_id: 'root',
    circle_id: 'c',
    event_type: 'shift',
    title: 'Afternoons',
    scheduled_date: DAY,
    scheduled_time: '14:00:00',
    duration_minutes: 360,
    recurrence_rule: 'weekly',
    assigned_to: 'u-ana',
    created_at: '',
    updated_at: '',
    ...over,
  }) as CalendarEvent;
const link = {
  root_id: 'root',
  date: DAY,
  title: 'Afternoons',
  assignee: { id: 'u-ana', first_name: 'Ana' },
  status: 'covered' as const,
  window_start: `${DAY}T14:00:00`,
  window_end: `${DAY}T20:00:00`,
};
const task = (over: Partial<CalendarEvent>): CalendarEvent =>
  ({
    id: 'x',
    circle_id: 'c',
    event_type: 'task',
    title: 'x',
    scheduled_date: DAY,
    scheduled_time: '15:00:00',
    assigned_to: null,
    created_at: '',
    updated_at: '',
    ...over,
  }) as CalendarEvent;

const LINKED_OPEN = task({
  id: 'task-root_2026-11-10',
  parent_event_id: 'task-root',
  recurrence_rule: 'weekly',
  title: 'Help with lunch',
  shift: link,
});
const LINKED_DONE = task({
  id: 'done-1',
  title: 'Gave the pills',
  scheduled_time: '14:30:00',
  completed_at: '2026-11-10T20:40:00Z',
  shift: link,
});
const REGULAR = task({ id: 'reg-1', title: 'Own errand', scheduled_time: '16:00:00', assigned_to: 'u-ana' });
const DOSE = task({ id: 'dose-1', event_type: 'medication', title: 'Metformin', medication_name: 'Metformin', scheduled_time: '17:00:00' });

function Harness({ s }: { s: CalendarEvent }) {
  const dialogs = useShiftsDialogs('c');
  return (
    <>
      <button type="button" onClick={() => dialogs.openDetail(s)}>
        open-detail
      </button>
      {dialogs.element}
    </>
  );
}

async function openDetail(s: CalendarEvent = shift()) {
  const user = userEvent.setup();
  render(
    <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } })}>
      <ToastProvider>
        <MemoryRouter>
          <Harness s={s} />
        </MemoryRouter>
      </ToastProvider>
    </QueryClientProvider>
  );
  await user.click(screen.getByRole('button', { name: 'open-detail' }));
  await screen.findByRole('dialog', { name: s.title });
  return { user };
}
const detail = () => screen.getByRole('dialog', { name: 'Afternoons' });
const rowButton = (re: RegExp) => within(detail()).getByRole('button', { name: re });

const SPIED = [
  'entryFormOpened',
  'entryFormStepCompleted',
  'entrySaveTapped',
  'shiftTaskAddOpened',
  'shiftTaskAdded',
  'shiftTaskSaved',
  'shiftTaskEditOpened',
  'shiftTaskSaveFailed',
  'shiftTaskDeleted',
  'shiftTaskListViewed',
] as const;

beforeEach(() => {
  vi.clearAllMocks();
  rowsHook.events = [LINKED_OPEN, LINKED_DONE, REGULAR, DOSE];
  useAuthStore.setState({
    user: { id: 'u-owner', email: 'o@x.test', first_name: 'Olivia', last_name: 'O' },
    isAuthenticated: true,
  } as never);
  circle();
  vi.mocked(getSeriesRoot).mockImplementation(async (_c: string, id: string) => {
    const hit = [LINKED_OPEN, LINKED_DONE, REGULAR].find((e) => (e.parent_event_id || e.id) === id);
    return (hit ?? LINKED_OPEN) as never;
  });
  vi.mocked(updateEvent).mockResolvedValue({ id: 'task-root' } as CalendarEvent);
  vi.mocked(createShiftTask).mockResolvedValue({ id: 'task-root' } as CalendarEvent);
  vi.mocked(deleteEvent).mockResolvedValue({ historyKept: false } as never);
  for (const name of SPIED) vi.spyOn(Analytics, name).mockImplementation(() => {});
});
afterEach(cleanup);

describe('shift detail: task rows open the editor (modal swap)', () => {
  it('P6 a tap on an open linked row opens the editor in edit mode in shift mode, replacing the detail', async () => {
    const { user } = await openDetail();
    await user.click(rowButton(/^Edit Help with lunch/));
    const editor = await screen.findByRole('dialog', { name: 'Edit task' });
    expect(screen.queryByRole('dialog', { name: 'Afternoons' })).toBeNull();
    expect(within(editor).getByTestId('shift-task-chip')).toHaveTextContent('On Afternoons');
    expect(within(editor).getByTestId('shift-task-owner-now')).toHaveTextContent('Right now: Ana');
    expect(Analytics.shiftTaskEditOpened).toHaveBeenCalledWith({
      source: 'shift_detail',
      linked: true,
      state: 'open',
      recurring: true,
    });
  });

  it('every close path returns to the detail: Cancel, the close x and a delete', async () => {
    const { user } = await openDetail();
    await user.click(rowButton(/^Edit Help with lunch/));
    await user.click(await screen.findByRole('button', { name: 'Cancel' }));
    expect(await screen.findByRole('dialog', { name: 'Afternoons' })).toBeInTheDocument();

    await user.click(rowButton(/^Edit Help with lunch/));
    await user.click(await screen.findByRole('button', { name: 'Close event form' }));
    expect(await screen.findByRole('dialog', { name: 'Afternoons' })).toBeInTheDocument();

    await user.click(rowButton(/^Edit Help with lunch/));
    await user.click(await screen.findByTestId('add-event-delete'));
    const confirm = await screen.findByRole('dialog', { name: 'Delete task' });
    await user.click(within(confirm).getByRole('button', { name: 'Delete' }));
    expect(await screen.findByRole('dialog', { name: 'Afternoons' })).toBeInTheDocument();
    expect(deleteEvent).toHaveBeenCalledTimes(1);
  });

  it('P5 a save returns to the detail with the moss ring on the edited row (a repeating task\'s virtual row matches the root id)', async () => {
    const { user } = await openDetail();
    await user.click(rowButton(/^Edit Help with lunch/));
    const editor = await screen.findByRole('dialog', { name: 'Edit task' });
    await user.click(within(editor).getByTestId('add-event-save'));
    await screen.findByRole('dialog', { name: 'Afternoons' });
    expect(vi.mocked(updateEvent).mock.calls[0][1]).toBe('task-root');
    const rows = screen.getAllByTestId('shift-task-row');
    const lunch = rows.find((r) => within(r).queryByTestId('shift-task-row-name')?.textContent === 'Help with lunch')!;
    expect(within(lunch).getByTestId('highlight-ring')).toBeInTheDocument();
    // Only that row.
    expect(screen.getAllByTestId('highlight-ring')).toHaveLength(1);
  });

  it('P-add Add a task opens the full editor; a save returns with the new row ringed and one POST was sent', async () => {
    const { user } = await openDetail();
    await user.click(within(detail()).getAllByTestId('shift-detail-add-task')[0]);
    await user.click(await screen.findByTestId('shift-add-task'));
    const editor = await screen.findByRole('dialog', { name: 'New task' });
    expect(within(editor).getByTestId('shift-task-chip')).toBeInTheDocument();
    await user.type(within(editor).getByRole('textbox', { name: /^Title/ }), 'Help with lunch');
    await user.click(within(editor).getByTestId('add-event-save'));
    await screen.findByRole('dialog', { name: 'Afternoons' });
    expect(createShiftTask).toHaveBeenCalledTimes(1);
    expect(vi.mocked(createShiftTask).mock.calls[0][1]).toBe('root_2026-11-10');
    expect(updateEvent).not.toHaveBeenCalled();
    expect(screen.getAllByTestId('highlight-ring')).toHaveLength(1);
  });

  it('closing the Add editor without saving returns to the detail with no ring', async () => {
    const { user } = await openDetail();
    await user.click(within(detail()).getAllByTestId('shift-detail-add-task')[0]);
    await user.click(await screen.findByTestId('shift-add-task'));
    await user.click(await screen.findByRole('button', { name: 'Cancel' }));
    expect(await screen.findByRole('dialog', { name: 'Afternoons' })).toBeInTheDocument();
    expect(screen.queryByTestId('highlight-ring')).toBeNull();
    expect(createShiftTask).not.toHaveBeenCalled();
  });

  it('N11 a regular (unlinked) task row opens the NORMAL editor: the assignee picker is there and nothing is locked', async () => {
    const { user } = await openDetail();
    await user.click(rowButton(/^Edit Own errand/));
    const editor = await screen.findByRole('dialog', { name: 'Edit task' });
    expect(within(editor).queryByTestId('shift-task-chip')).toBeNull();
    expect(within(editor).getByRole('radio', { name: 'Anyone' })).toBeInTheDocument();
    expect(Analytics.shiftTaskEditOpened).toHaveBeenCalledWith(expect.objectContaining({ linked: false, state: 'open' }));
  });

  it('P7 a completed row opens the read-only detail (notes, Delete, no Edit for a one-off); Delete asks and returns to the list', async () => {
    const { user } = await openDetail();
    await user.click(rowButton(/^View Gave the pills/));
    const view = await screen.findByRole('dialog', { name: /Gave the pills/ });
    expect(screen.queryByRole('dialog', { name: 'Afternoons' })).toBeNull();
    expect(within(view).getByTestId('notes-panel')).toBeInTheDocument();
    expect(within(view).getByRole('button', { name: /Delete/ })).toBeInTheDocument();
    // N7: a completed one-off has no Edit anywhere.
    expect(within(view).queryByRole('button', { name: /^Edit/ })).toBeNull();
    expect(screen.queryByRole('dialog', { name: 'Edit task' })).toBeNull();
    expect(Analytics.shiftTaskEditOpened).toHaveBeenCalledWith({
      source: 'shift_detail',
      linked: true,
      state: 'completed',
      recurring: false,
    });
    await user.click(within(view).getByRole('button', { name: /Delete/ }));
    const confirm = await screen.findByRole('dialog', { name: 'Delete task' });
    await user.click(within(confirm).getByRole('button', { name: 'Delete' }));
    expect(await screen.findByRole('dialog', { name: 'Afternoons' })).toBeInTheDocument();
    expect(deleteEvent).toHaveBeenCalledWith('c', 'done-1', {});
    expect(Analytics.shiftTaskDeleted).toHaveBeenCalledWith({ scope: 'all', surface: 'shift_detail' });
  });

  it('closing the read-only detail returns to the shift detail', async () => {
    const { user } = await openDetail();
    await user.click(rowButton(/^View Gave the pills/));
    const view = await screen.findByRole('dialog', { name: /Gave the pills/ });
    await user.click(within(view).getByRole('button', { name: 'Close event details' }));
    expect(await screen.findByRole('dialog', { name: 'Afternoons' })).toBeInTheDocument();
  });

  it('N8 a medication row has no open button and keeps its own Taken-less static text', async () => {
    await openDetail();
    const dose = screen.getAllByTestId('shift-task-row').find((r) => r.getAttribute('data-kind') === 'med')!;
    expect(within(dose).queryByTestId('shift-task-open')).toBeNull();
    expect(within(dose).getByText('Metformin')).toBeInTheDocument();
  });

  it('N10 a view-only member: no Add, an open task is not a button, a completed row still opens read-only', async () => {
    circle({ canEdit: false, viewOnly: true, viewerRole: 'member', canManageMembers: false });
    const { user } = await openDetail();
    expect(within(detail()).queryByTestId('shift-detail-add-task')).toBeNull();
    expect(within(detail()).queryByRole('button', { name: /^Edit Help with lunch/ })).toBeNull();
    await user.click(rowButton(/^View Gave the pills/));
    const view = await screen.findByRole('dialog', { name: /Gave the pills/ });
    expect(within(view).queryByRole('button', { name: /Delete/ })).toBeNull();
    expect(screen.queryByRole('dialog', { name: 'Edit task' })).toBeNull();
  });

  it('N-fail a refused save (outside the window) keeps the editor open and the detail closed', async () => {
    const { user } = await openDetail();
    await user.click(rowButton(/^Edit Help with lunch/));
    const editor = await screen.findByRole('dialog', { name: 'Edit task' });
    fireEvent.change(within(editor).getByLabelText('From', { selector: 'input' }), { target: { value: '22:00' } });
    await user.click(within(editor).getByTestId('add-event-save'));
    expect(await within(editor).findByText('Pick a time inside this shift.')).toBeInTheDocument();
    expect(screen.queryByRole('dialog', { name: 'Afternoons' })).toBeNull();
    expect(updateEvent).not.toHaveBeenCalled();
    await waitFor(() => expect(screen.queryByTestId('highlight-ring')).toBeNull());
  });
});
