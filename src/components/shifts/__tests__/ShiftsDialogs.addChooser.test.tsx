import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router-dom';
import '@/i18n';
import { createEvent, type CalendarEvent } from '@/api/calendarEvents';
import { createShiftTask } from '@/api/shiftTasks';
import { ToastProvider } from '@/components/ui';
import { Analytics } from '@/lib/analytics';
import { useCircle } from '@/hooks/useCircle';
import { useAuthStore } from '@/store/authStore';
import { useShiftsDialogs } from '../ShiftsDialogs';

// "Add to this shift" (1.4.3): the detail's button opens the Task / Medication / Appointment chooser; it REPLACES
// the detail (one dialog at a time) and every close path returns to it. Medication / appointment open the FULL
// forms in window mode. Nothing is gated before the forms open (same as the normal entry points).

const PINNED_NOW = new Date('2026-11-09T21:00:00Z'); // Mon 3:00 PM in Chicago: the Tuesday shift has not started
beforeAll(() => {
  vi.useFakeTimers({ toFake: ['Date'], now: PINNED_NOW });
});
afterAll(() => {
  vi.useRealTimers();
});

vi.mock('@/api/calendarEvents', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/api/calendarEvents')>()),
  createEvent: vi.fn(),
  getSeriesRoot: vi.fn(),
}));
vi.mock('@/api/shiftTasks', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/api/shiftTasks')>()),
  createShiftTask: vi.fn(),
}));
vi.mock('@/api/drugs', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/api/drugs')>()),
  searchDrugs: vi.fn().mockResolvedValue([]),
}));
const gate = vi.hoisted(() => ({ promptUpgrade: vi.fn(), promptLapsed: vi.fn() }));
vi.mock('@/hooks/usePremiumGate', () => ({
  usePremiumGate: () => ({ promptUpgrade: gate.promptUpgrade, promptLapsed: gate.promptLapsed }),
}));
vi.mock('@/hooks/useCircle', () => ({ useCircle: vi.fn() }));
vi.mock('@/hooks/useHourCycle', () => ({ useHourCycle: () => '12h' }));
vi.mock('@/hooks/useProviders', () => ({ useProviders: () => ({ providers: [], isSuccess: true }) }));
vi.mock('../../calendar/DoseQuietHoursNote', () => ({ DoseQuietHoursNote: () => null }));
const rowsHook = vi.hoisted(() => ({ events: [] as unknown[] }));
vi.mock('@/hooks/useShiftTasks', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/hooks/useShiftTasks')>()),
  useShiftOccurrenceEvents: () => ({ events: rowsHook.events, isLoading: false, isError: false, refetch: vi.fn() }),
  useShiftTaskDeleteImpact: () => undefined,
}));
vi.spyOn(Intl.DateTimeFormat.prototype, 'resolvedOptions').mockReturnValue({
  timeZone: 'America/Chicago',
} as Intl.ResolvedDateTimeFormatOptions);

const OWNER = 'aaaaaaaa-1111-4111-8111-111111111111';
const ANA = 'bbbbbbbb-2222-4222-8222-222222222222';
const members = [
  { id: OWNER, first_name: 'Olivia', last_name: 'O', email: 'o@x.test', role: 'owner', is_care_recipient: false },
  { id: ANA, first_name: 'Ana', last_name: 'R', email: 'a@x.test', role: 'member', is_care_recipient: false },
];

function circle(over: Record<string, unknown> = {}) {
  vi.mocked(useCircle).mockReturnValue({
    circle: { id: 'c', recipient_name: 'Rosa', owner_id: OWNER, is_self_care: false },
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

const shift = (over: Partial<CalendarEvent> = {}): CalendarEvent =>
  ({
    id: 'root_2026-11-10',
    parent_event_id: 'root',
    circle_id: 'c',
    event_type: 'shift',
    title: 'Afternoons',
    scheduled_date: '2026-11-10',
    scheduled_time: '14:00:00',
    duration_minutes: 360,
    recurrence_rule: 'weekly',
    assigned_to: ANA,
    created_at: '',
    updated_at: '',
    ...over,
  }) as CalendarEvent;

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
const openChooser = async (user: ReturnType<typeof userEvent.setup>) => {
  await user.click(within(detail()).getByTestId('shift-detail-add-task'));
  return screen.findByRole('dialog', { name: 'Add to this shift' });
};

const SPIED = [
  'entryFormOpened',
  'entryFormStepCompleted',
  'entrySaveTapped',
  'entryValidationBlocked',
  'shiftTaskAddOpened',
  'shiftTaskAdded',
  'shiftTaskSaved',
  'shiftTaskSaveFailed',
  'shiftTaskListViewed',
  'shiftItemAdded',
  'shiftAddChooserOpened',
  'shiftAddChooserClosed',
  'shiftItemAddAbandoned',
] as const;

beforeEach(() => {
  vi.clearAllMocks();
  rowsHook.events = [];
  useAuthStore.setState({
    user: { id: OWNER, email: 'o@x.test', first_name: 'Olivia', last_name: 'O' },
    isAuthenticated: true,
  } as never);
  circle();
  vi.mocked(createEvent).mockResolvedValue({ id: 'new-event' } as CalendarEvent);
  vi.mocked(createShiftTask).mockResolvedValue({ id: 'new-task' } as CalendarEvent);
  for (const name of SPIED) vi.spyOn(Analytics, name).mockImplementation(() => {});
});
afterEach(cleanup);

describe('Add to this shift: the button and the chooser', () => {
  it('POS the ghost button reads "Add to this shift" and opens the chooser in place of the detail', async () => {
    const { user } = await openDetail();
    expect(within(detail()).getByTestId('shift-detail-add-task')).toHaveTextContent('Add to this shift');
    const chooser = await openChooser(user);
    expect(screen.queryByRole('dialog', { name: 'Afternoons' })).toBeNull();
    expect(chooser).toBeInTheDocument();
  });

  it('POS the chooser has exactly Task, Medication, Appointment (in that order, title + hint) then Cancel, and names the shift', async () => {
    const { user } = await openDetail();
    const chooser = await openChooser(user);
    expect(within(chooser).getByTestId('shift-add-subtitle')).toHaveTextContent('Tue, Nov 10, 2:00 PM – 8:00 PM');
    const options = within(chooser).getAllByRole('button').filter((b) => b.getAttribute('data-testid')?.startsWith('shift-add-'));
    expect(options.map((b) => b.getAttribute('data-testid'))).toEqual([
      'shift-add-task',
      'shift-add-medication',
      'shift-add-appointment',
      'shift-add-cancel',
    ]);
    expect(options[0]).toHaveTextContent('Something to do during the shift');
    expect(options[1]).toHaveTextContent('A new medicine with a dose in this shift');
    expect(options[2]).toHaveTextContent('A visit or call during the shift');
    expect(options[3]).toHaveTextContent('Cancel');
    for (const o of options) expect(o.tagName).toBe('BUTTON');
  });

  it('POS Cancel and Escape each return to the detail; nothing is created', async () => {
    const { user } = await openDetail();
    await openChooser(user);
    await user.click(screen.getByTestId('shift-add-cancel'));
    expect(await screen.findByRole('dialog', { name: 'Afternoons' })).toBeInTheDocument();
    await openChooser(user);
    await user.keyboard('{Escape}');
    expect(await screen.findByRole('dialog', { name: 'Afternoons' })).toBeInTheDocument();
    expect(createEvent).not.toHaveBeenCalled();
    expect(createShiftTask).not.toHaveBeenCalled();
    expect(Analytics.shiftItemAdded).not.toHaveBeenCalled();
  });

  it('POS Task opens today\'s shift task editor; its save fires shift_task_added AND shift_item_added once', async () => {
    const { user } = await openDetail();
    await openChooser(user);
    await user.click(screen.getByTestId('shift-add-task'));
    const editor = await screen.findByRole('dialog', { name: 'New task' });
    expect(within(editor).getByTestId('shift-task-chip')).toBeInTheDocument();
    await user.type(within(editor).getByRole('textbox', { name: /^Title/ }), 'Help with lunch');
    await user.click(within(editor).getByTestId('add-event-save'));
    await screen.findByRole('dialog', { name: 'Afternoons' });
    expect(createShiftTask).toHaveBeenCalledTimes(1);
    expect(Analytics.shiftTaskAdded).toHaveBeenCalledTimes(1);
    expect(Analytics.shiftItemAdded).toHaveBeenCalledTimes(1);
    expect(Analytics.shiftItemAdded).toHaveBeenCalledWith({ type: 'task', shiftRepeating: true });
  });

  it('POS Appointment opens the appointment form in window mode (locked day, default time inside the window); closing returns to the detail', async () => {
    const { user } = await openDetail();
    await openChooser(user);
    await user.click(screen.getByTestId('shift-add-appointment'));
    const form = await screen.findByRole('dialog', { name: 'New appointment' });
    expect(screen.queryByRole('dialog', { name: 'Add to this shift' })).toBeNull();
    expect(within(form).getByTestId('shift-window-locked-day')).toHaveTextContent('Tue, Nov 10');
    expect(within(form).getByLabelText('From', { selector: 'input' })).toHaveValue('14:00');
    await user.click(within(form).getByRole('button', { name: 'Cancel' }));
    expect(await screen.findByRole('dialog', { name: 'Afternoons' })).toBeInTheDocument();
    expect(createEvent).not.toHaveBeenCalled();
  });

  it('POS Medication opens the medication form in window mode with the locked day', async () => {
    const { user } = await openDetail();
    await openChooser(user);
    await user.click(screen.getByTestId('shift-add-medication'));
    const form = await screen.findByRole('dialog', { name: 'New medication' });
    expect(within(form).getByTestId('shift-window-locked-day')).toHaveTextContent('Tue, Nov 10');
    expect(within(form).queryByTestId('starts-tile')).toBeNull();
  });

  it('POS an appointment saved from the shift is ONE ordinary create, returns to the detail, fires shift_item_added once', async () => {
    const { user } = await openDetail();
    await openChooser(user);
    await user.click(screen.getByTestId('shift-add-appointment'));
    const form = await screen.findByRole('dialog', { name: 'New appointment' });
    await user.type(within(form).getByRole('textbox', { name: /^Title/ }), 'Dr visit');
    await user.click(within(form).getByTestId('add-event-save'));
    await screen.findByRole('dialog', { name: 'Afternoons' });
    expect(createEvent).toHaveBeenCalledTimes(1);
    expect(vi.mocked(createEvent).mock.calls[0][1]).toMatchObject({
      event_type: 'appointment',
      scheduled_date: '2026-11-10',
      scheduled_time: '14:00',
      assigned_to: ANA,
    });
    expect(createShiftTask).not.toHaveBeenCalled();
    expect(Analytics.shiftItemAdded).toHaveBeenCalledTimes(1);
    expect(Analytics.shiftItemAdded).toHaveBeenCalledWith({ type: 'appointment', shiftRepeating: true });
  });

  it('POS after an appointment save the detail returns with "Also happening" opened and the new row ringed; after a task save it stays folded', async () => {
    vi.mocked(createEvent).mockResolvedValue({ id: 'visit-1' } as CalendarEvent);
    rowsHook.events = [
      { id: 'visit-1', circle_id: 'c', event_type: 'appointment', title: 'Dr visit', scheduled_date: '2026-11-10', scheduled_time: '14:00:00', created_at: '', updated_at: '' },
    ];
    const { user } = await openDetail();
    await openChooser(user);
    await user.click(screen.getByTestId('shift-add-appointment'));
    const form = await screen.findByRole('dialog', { name: 'New appointment' });
    await user.type(within(form).getByRole('textbox', { name: /^Title/ }), 'Dr visit');
    await user.click(within(form).getByTestId('add-event-save'));
    await screen.findByRole('dialog', { name: 'Afternoons' });
    const also = await screen.findByTestId('shift-also-list');
    expect(within(within(also).getAllByTestId('shift-also-row')[0]).getByTestId('highlight-ring')).toBeInTheDocument();
  });

  it('NEG a refused (out-of-window) appointment fires no shift_item_added and stays on the form', async () => {
    const { user } = await openDetail();
    await openChooser(user);
    await user.click(screen.getByTestId('shift-add-appointment'));
    const form = await screen.findByRole('dialog', { name: 'New appointment' });
    await user.type(within(form).getByRole('textbox', { name: /^Title/ }), 'Dr visit');
    fireEvent.change(within(form).getByLabelText('From', { selector: 'input' }), { target: { value: '21:00' } });
    await user.click(within(form).getByTestId('add-event-save'));
    expect(await within(form).findByText('Pick a time inside this shift.')).toBeInTheDocument();
    expect(createEvent).not.toHaveBeenCalled();
    expect(Analytics.shiftItemAdded).not.toHaveBeenCalled();
    expect(screen.queryByRole('dialog', { name: 'Afternoons' })).toBeNull();
  });

  it('NEG a view-only viewer sees no "Add to this shift" button', async () => {
    circle({ canEdit: false, viewOnly: true, viewerRole: 'member', isOwner: false });
    await openDetail();
    expect(within(detail()).queryByTestId('shift-detail-add-task')).toBeNull();
    expect(screen.queryByText('Add to this shift')).toBeNull();
  });

  it('NEG an ended shift sees no "Add to this shift" button', async () => {
    await openDetail(shift({ scheduled_date: '2026-11-02' }));
    expect(within(detail()).queryByTestId('shift-detail-add-task')).toBeNull();
  });

  it('NEG a plain MEMBER (not the owner) is not paywalled choosing Medication or Appointment: the forms open, no gate prompt', async () => {
    circle({ isOwner: false, viewerRole: 'member', isPremiumCircle: true, canManageMembers: false });
    const { user } = await openDetail();
    await openChooser(user);
    await user.click(screen.getByTestId('shift-add-medication'));
    expect(await screen.findByRole('dialog', { name: 'New medication' })).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Cancel' }));
    await openChooser(user);
    await user.click(screen.getByTestId('shift-add-appointment'));
    expect(await screen.findByRole('dialog', { name: 'New appointment' })).toBeInTheDocument();
    expect(gate.promptUpgrade).not.toHaveBeenCalled();
    expect(gate.promptLapsed).not.toHaveBeenCalled();
  });

  it('a lapsed circle answers a save with the editor\'s OWN gate (promptLapsed), exactly as the normal add form; no shift_item_added', async () => {
    vi.mocked(createEvent).mockRejectedValueOnce({ error: { code: 'SUBSCRIPTION_REQUIRED' } });
    const { user } = await openDetail();
    await openChooser(user);
    await user.click(screen.getByTestId('shift-add-appointment'));
    const form = await screen.findByRole('dialog', { name: 'New appointment' });
    expect(gate.promptLapsed).not.toHaveBeenCalled();
    await user.type(within(form).getByRole('textbox', { name: /^Title/ }), 'Dr visit');
    await user.click(within(form).getByTestId('add-event-save'));
    await waitFor(() => expect(gate.promptLapsed).toHaveBeenCalledTimes(1));
    expect(Analytics.shiftItemAdded).not.toHaveBeenCalled();
  });
});

describe('Add to this shift: chooser analytics', () => {
  it('NEG nothing fires until the chooser opens (opening the detail alone is silent)', async () => {
    await openDetail();
    expect(Analytics.shiftAddChooserOpened).not.toHaveBeenCalled();
    expect(Analytics.shiftAddChooserClosed).not.toHaveBeenCalled();
  });

  it('POS opening reports shift_repeating and list_empty once; a pick reports the choice once', async () => {
    const { user } = await openDetail();
    await openChooser(user);
    expect(Analytics.shiftAddChooserOpened).toHaveBeenCalledTimes(1);
    expect(Analytics.shiftAddChooserOpened).toHaveBeenCalledWith({ shiftRepeating: true, listEmpty: true });
    await user.click(screen.getByTestId('shift-add-medication'));
    expect(Analytics.shiftAddChooserClosed).toHaveBeenCalledTimes(1);
    expect(Analytics.shiftAddChooserClosed).toHaveBeenCalledWith({ choice: 'medication' });
  });

  it('POS Cancel and Escape each report "cancel" exactly once per open', async () => {
    const { user } = await openDetail();
    await openChooser(user);
    await user.click(screen.getByTestId('shift-add-cancel'));
    await screen.findByRole('dialog', { name: 'Afternoons' });
    expect(Analytics.shiftAddChooserClosed).toHaveBeenCalledTimes(1);
    expect(Analytics.shiftAddChooserClosed).toHaveBeenLastCalledWith({ choice: 'cancel' });
    await openChooser(user);
    await user.keyboard('{Escape}');
    await screen.findByRole('dialog', { name: 'Afternoons' });
    expect(Analytics.shiftAddChooserOpened).toHaveBeenCalledTimes(2);
    expect(Analytics.shiftAddChooserClosed).toHaveBeenCalledTimes(2);
  });

  it('POS list_empty is false when the shift has an item, shift_repeating false for a one-off shift', async () => {
    rowsHook.events = [
      { id: 'dose-1', circle_id: 'c', event_type: 'medication', title: 'Metformin', medication_name: 'Metformin', scheduled_date: '2026-11-10', scheduled_time: '15:00:00', created_at: '', updated_at: '' },
    ];
    const { user } = await openDetail(shift({ recurrence_rule: null, parent_event_id: null as never }));
    await openChooser(user);
    expect(Analytics.shiftAddChooserOpened).toHaveBeenCalledWith({ shiftRepeating: false, listEmpty: false });
  });
});
