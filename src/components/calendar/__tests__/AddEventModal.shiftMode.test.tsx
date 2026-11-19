import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router-dom';
import '@/i18n';
import type { CalendarEvent } from '@/api/calendarEvents';
import { createShiftTask } from '@/api/shiftTasks';
import { ToastProvider } from '@/components/ui';
import { Analytics } from '@/lib/analytics';
import { shiftContextFromShift, type ShiftTaskContext } from '@/components/shifts/shiftTasks';
import { AddEventModal } from '../AddEventModal';

// SHIFT MODE of the full task editor (docs/plans/shift-task-add-edit-1-4-3.md sections 1-2, 5, 6). The shift is
// Tue Nov 10, 2:00 PM - 8:00 PM (Chicago), repeating weekly; Lucia is on it. Create = ONE POST carrying every
// field (the owner's atomic-create decision replaced the plan's POST + PATCH: P4 / N4 are the single-POST cases).

const RECIPIENT_TZ = 'America/Chicago';
const ORIGINAL_TZ = process.env.TZ;
beforeAll(() => {
  process.env.TZ = RECIPIENT_TZ;
});
afterAll(() => {
  process.env.TZ = ORIGINAL_TZ;
});

const ME = 'aaaaaaaa-1111-4111-8111-111111111111';
const LUCIA = 'bbbbbbbb-2222-4222-8222-222222222222';
// Mon Nov 9, 3:00 PM in Chicago: the shift (Tue 2-8 PM) is TOMORROW, so the default is the shift start.
const NOW = new Date('2026-11-09T21:00:00Z');

const mutateUpdate = vi.fn();
const mutateCreateEvent = vi.fn();
const mutateDelete = vi.fn();
vi.mock('@/api/shiftTasks', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/api/shiftTasks')>()),
  createShiftTask: vi.fn(),
}));
vi.mock('../DoseQuietHoursNote', () => ({ DoseQuietHoursNote: () => null }));
vi.mock('@/hooks/useProviders', () => ({ useProviders: () => ({ providers: [], isSuccess: true }) }));
vi.mock('@/hooks/useCalendarEvents', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/hooks/useCalendarEvents')>()),
  useCreateEvent: () => ({ mutateAsync: mutateCreateEvent, isPending: false }),
  useUpdateEvent: () => ({ mutateAsync: mutateUpdate, isPending: false }),
  useDeleteEvent: () => ({ mutateAsync: mutateDelete, isPending: false }),
  useCachedCircleEvents: () => [],
}));
vi.mock('@/hooks/useSeriesRoot', () => ({
  useSeriesRoot: (_c: string, event: unknown) => ({ root: event ?? null }),
}));
vi.mock('@/store/authStore', () => {
  const useAuthStore = (select: (s: { user: { id: string } }) => unknown) => select({ user: { id: ME } });
  useAuthStore.getState = () => ({ user: { id: ME } });
  return { useAuthStore };
});
const useCircleResult = {
  circle: { recipient_name: 'Rosa', is_self_care: false, owner_id: ME },
  circleSummary: undefined,
  timezone: RECIPIENT_TZ,
  members: [
    { id: ME, email: 'me@example.com', first_name: 'Me', is_care_recipient: false },
    { id: LUCIA, email: 'lucia@example.com', first_name: 'Lucia', is_care_recipient: false },
  ],
  canEdit: true,
  accessLevel: 'full' as const,
  viewOnly: false,
  readOnly: false,
  isLoading: false,
  isError: false,
  refetch: vi.fn(),
};
vi.mock('@/hooks/useCircle', () => ({ useCircle: () => useCircleResult }));
vi.mock('@/hooks/useHourCycle', () => ({ useHourCycle: () => '12h' }));

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
    assigned_to: LUCIA,
    created_at: '',
    updated_at: '',
    ...over,
  }) as CalendarEvent;

const contextFor = (s: CalendarEvent = shift(), source: ShiftTaskContext['source'] = 'shift_detail') =>
  shiftContextFromShift(s, useCircleResult.members, ME, source, !!s.recurrence_rule);

const linkedTask = (over: Partial<CalendarEvent> = {}): CalendarEvent =>
  ({
    id: 'task-1',
    circle_id: 'c',
    event_type: 'task',
    title: 'Help with lunch',
    scheduled_date: '2026-11-10',
    scheduled_time: '15:00:00',
    duration_minutes: 30,
    recurrence_rule: 'weekly',
    assigned_to: null,
    created_at: '',
    updated_at: '',
    shift: {
      root_id: 'root',
      date: '2026-11-10',
      title: 'Afternoons',
      assignee: { id: LUCIA, first_name: 'Lucia' },
      status: 'covered',
      window_start: '2026-11-10T14:00:00',
      window_end: '2026-11-10T20:00:00',
    },
    ...over,
  }) as CalendarEvent;

function setup(props: Partial<React.ComponentProps<typeof AddEventModal>> = {}) {
  const onClose = vi.fn();
  const onShiftTaskSaved = vi.fn();
  const onDeleted = vi.fn();
  const user = userEvent.setup();
  const qc = new QueryClient({ defaultOptions: { mutations: { retry: false } } });
  const tree = (extra: Partial<React.ComponentProps<typeof AddEventModal>> = {}) => (
    <QueryClientProvider client={qc}>
      <ToastProvider>
        <MemoryRouter>
          <AddEventModal
            circleId="c"
            initialType="task"
            shiftContext={contextFor()}
            onClose={onClose}
            onShiftTaskSaved={onShiftTaskSaved}
            onDeleted={onDeleted}
            {...props}
            {...extra}
          />
        </MemoryRouter>
      </ToastProvider>
    </QueryClientProvider>
  );
  const utils = render(tree());
  /** A parent re-render: same props, but a FRESH shiftContext object (what an inline builder does). */
  const rerenderFreshContext = () =>
    utils.rerender(tree({ shiftContext: props.shiftContext === undefined ? undefined : contextFor() }));
  return { user, onClose, onShiftTaskSaved, onDeleted, rerenderFreshContext, ...utils };
}

const fromInput = () => screen.getByLabelText('From', { selector: 'input' }) as HTMLInputElement;
const toInput = () => screen.getByLabelText('To', { selector: 'input' }) as HTMLInputElement;
const titleBox = () => screen.getByRole('textbox', { name: /^Title/ });
const save = () => screen.getByTestId('add-event-save');
const lastPost = () => vi.mocked(createShiftTask).mock.calls[0][2];

const SPIED = [
  'entryFormOpened',
  'entryFormStepCompleted',
  'entrySaveTapped',
  'entryValidationBlocked',
  'shiftTaskAddOpened',
  'shiftTaskAdded',
  'shiftTaskSaved',
  'shiftTaskEditOpened',
  'shiftTaskSaveFailed',
  'shiftTaskDeleted',
] as const;

beforeEach(() => {
  vi.clearAllMocks();
  vi.useFakeTimers({ toFake: ['Date'], now: NOW });
  vi.mocked(createShiftTask).mockResolvedValue({ id: 'new-task' } as CalendarEvent);
  mutateUpdate.mockResolvedValue({ id: 'task-1' });
  mutateDelete.mockResolvedValue(undefined);
  for (const name of SPIED) vi.spyOn(Analytics, name).mockImplementation(() => {});
});
afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  vi.useRealTimers();
});

describe('shift mode: add', () => {
  it('P1 opens the full editor: chip, locked day, repeat choice, time + end, who, reminders, details', async () => {
    const { user } = setup();
    expect(screen.getByRole('dialog', { name: 'New task' })).toBeInTheDocument();
    expect(screen.getByTestId('shift-task-chip')).toHaveTextContent('On Afternoons · 2:00 – 8:00 PM');
    expect(screen.getByTestId('shift-task-locked-day')).toHaveTextContent('Tue, Nov 10 · during Afternoons');
    // A locked day is not a picker.
    expect(screen.queryByLabelText(/^Starts/)).toBeNull();
    expect(screen.getByRole('radio', { name: 'Every time this shift happens' })).toBeChecked();
    expect(screen.getByRole('radio', { name: 'Only Tue, Nov 10' })).not.toBeChecked();
    expect(fromInput().value).toBe('14:00');
    expect(screen.getByTestId('task-to-tile')).toHaveTextContent(/To\s*No end/);
    expect(screen.getByTestId('shift-task-time-hint')).toHaveTextContent('Between 2:00 PM and 8:00 PM');
    expect(screen.getByTestId('shift-task-owner')).toHaveTextContent('Whoever is on this shift');
    expect(screen.getByTestId('shift-task-owner-now')).toHaveTextContent('Right now: Lucia');
    expect(screen.getByRole('button', { name: /^Reminders/ })).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: /^More details/ }));
    expect(screen.getByLabelText(/^Details/)).toBeInTheDocument();
  });

  it('P1b a one-off shift has no repeat choice, only the explanation; an open shift says nobody is on it', () => {
    const one = shift({ id: 'one', recurrence_rule: null, parent_event_id: null, assigned_to: null });
    setup({ shiftContext: contextFor(one) });
    expect(screen.queryByRole('radio', { name: 'Every time this shift happens' })).toBeNull();
    expect(screen.getByTestId('shift-task-form-explain')).toHaveTextContent('It goes to whoever is on this shift.');
    expect(screen.getByTestId('shift-task-owner-now')).toHaveTextContent('No one is on this shift yet');
  });

  it('P2 default time: the shift start while the shift is not running; the next half hour once it is (clamped to the end)', () => {
    // Tue 3:10 PM in Chicago, inside 2-8 PM: next half hour = 3:30 PM.
    vi.setSystemTime(new Date('2026-11-10T21:10:00Z'));
    setup();
    expect(fromInput().value).toBe('15:30');
    expect(Analytics.shiftTaskAddOpened).toHaveBeenCalledWith({
      source: 'shift_detail',
      shiftRepeats: true,
      coverer: 'other',
      timeDefault: 'next_half_hour',
    });
    cleanup();
    // 7:50 PM: the next half hour (8:00 PM) is the window end, inclusive.
    vi.setSystemTime(new Date('2026-11-11T01:50:00Z'));
    setup();
    expect(fromInput().value).toBe('20:00');
    cleanup();
    // After the end (8:40 PM) and the day before: the shift start.
    vi.setSystemTime(new Date('2026-11-11T02:40:00Z'));
    setup();
    expect(fromInput().value).toBe('14:00');
  });

  it('P3 name + time only = ONE POST with exactly the old body, and no update call', async () => {
    const { user, onShiftTaskSaved } = setup();
    await user.type(titleBox(), '  Give lunch ');
    await user.click(save());
    await waitFor(() => expect(onShiftTaskSaved).toHaveBeenCalledTimes(1));
    expect(createShiftTask).toHaveBeenCalledTimes(1);
    expect(createShiftTask).toHaveBeenCalledWith('c', 'root_2026-11-10', {
      scheduledDate: '2026-11-10',
      title: 'Give lunch',
      scheduled_time: '14:00',
    });
    expect(JSON.stringify(lastPost())).toBe(
      '{"scheduledDate":"2026-11-10","title":"Give lunch","scheduled_time":"14:00"}'
    );
    expect(mutateUpdate).not.toHaveBeenCalled();
    expect(mutateCreateEvent).not.toHaveBeenCalled();
    expect(onShiftTaskSaved).toHaveBeenCalledWith({ mode: 'add', taskId: 'new-task' });
  });

  it('P4 (replaces plan P4) details + end time + a reminder change + Only this day = still ONE POST carrying them, no PATCH', async () => {
    const { user } = setup();
    await user.type(titleBox(), 'Walk');
    fireEvent.change(fromInput(), { target: { value: '15:00' } });
    fireEvent.change(toInput(), { target: { value: '15:45' } });
    await user.click(screen.getByRole('radio', { name: 'Only Tue, Nov 10' }));
    await user.click(screen.getByRole('button', { name: /^More details/ }));
    await user.type(screen.getByLabelText(/^Details/), 'Slow pace');
    await user.click(screen.getByRole('button', { name: /^Reminders/ }));
    await user.click(screen.getByRole('checkbox', { name: /15 minutes before/i }));
    await user.click(save());
    await waitFor(() => expect(createShiftTask).toHaveBeenCalledTimes(1));
    expect(lastPost()).toMatchObject({
      scheduledDate: '2026-11-10',
      title: 'Walk',
      scheduled_time: '15:00',
      only_this_day: true,
      description: 'Slow pace',
      duration_minutes: 45,
      notifications_enabled: true,
      reminder_at_due: true,
      reminder_15m: true,
      reminder_30m: false,
      reminder_1h: false,
      reminder_24h: false,
    });
    expect(mutateUpdate).not.toHaveBeenCalled();
    expect(Analytics.shiftTaskSaved).toHaveBeenCalledWith(
      expect.objectContaining({ mode: 'add', fieldsUsed: 4, oneOff: true, nextDay: false, detailsSaved: true })
    );
  });

  it('P-ZONE a viewer in another zone still sends the shift\'s own clock (the window is the recipient\'s)', async () => {
    useCircleResult.timezone = 'America/New_York';
    try {
      const ny = shift({ scheduled_time: '09:00:00', duration_minutes: 240 });
      const { user } = setup({ shiftContext: contextFor(ny) });
      expect(fromInput().value).toBe('09:00');
      await user.type(titleBox(), 'Zone check');
      await user.click(save());
      await waitFor(() => expect(createShiftTask).toHaveBeenCalledTimes(1));
      expect(lastPost()).toMatchObject({ scheduledDate: '2026-11-10', scheduled_time: '09:00' });
    } finally {
      useCircleResult.timezone = RECIPIENT_TZ;
    }
  });

  it('P9 analytics: add opened + saved + added fire with enums / booleans / counts only', async () => {
    const { user } = setup({ entry: 'shift_detail' });
    expect(Analytics.entryFormOpened).toHaveBeenCalledWith({ type: 'task', entry: 'shift_detail' });
    expect(Analytics.shiftTaskAddOpened).toHaveBeenCalledWith({
      source: 'shift_detail',
      shiftRepeats: true,
      coverer: 'other',
      timeDefault: 'shift_start',
    });
    await user.type(titleBox(), 'Lunch');
    await user.click(save());
    await waitFor(() => expect(Analytics.shiftTaskSaved).toHaveBeenCalledTimes(1));
    expect(Analytics.shiftTaskSaved).toHaveBeenCalledWith({
      mode: 'add',
      source: 'shift_detail',
      fieldsUsed: 0,
      oneOff: false,
      nextDay: false,
      timeChanged: false,
      nameChanged: false,
      detailsSaved: true,
    });
    expect(Analytics.shiftTaskAdded).toHaveBeenCalledWith({
      source: 'shift_detail',
      oneOff: false,
      shiftRepeats: true,
      nextDay: false,
    });
  });

  it('N12 no shift analytics payload carries a circle id, a title or details text', async () => {
    const { user } = setup();
    await user.type(titleBox(), 'Secret title');
    await user.click(screen.getByRole('button', { name: /^More details/ }));
    await user.type(screen.getByLabelText(/^Details/), 'Private detail');
    await user.click(save());
    await waitFor(() => expect(Analytics.shiftTaskSaved).toHaveBeenCalled());
    const json = JSON.stringify(
      [Analytics.shiftTaskAddOpened, Analytics.shiftTaskSaved, Analytics.shiftTaskAdded].map((f) =>
        vi.mocked(f).mock.calls
      )
    );
    for (const leak of ['Secret', 'Private', '"c"', 'circle_id', 'root_2026']) expect(json).not.toContain(leak);
  });
});

describe('shift mode: refusals and failures (negative)', () => {
  it('N1 there is no assignee picker, and no body carries assigned_to or recurrence_*', async () => {
    const { user } = setup();
    expect(screen.queryByLabelText(/^Assigned to/)).toBeNull();
    expect(screen.queryByRole('radio', { name: 'Anyone' })).toBeNull();
    expect(screen.queryByRole('radio', { name: 'Lucia' })).toBeNull();
    await user.type(titleBox(), 'Lunch');
    await user.click(save());
    await waitFor(() => expect(createShiftTask).toHaveBeenCalled());
    const body = JSON.stringify(lastPost());
    for (const key of ['assigned_to', 'recurrence', 'event_type']) expect(body).not.toContain(key);
  });

  it('N2 a time outside the window is refused inline and nothing is sent', async () => {
    const { user, onShiftTaskSaved } = setup();
    await user.type(titleBox(), 'Lunch');
    fireEvent.change(fromInput(), { target: { value: '09:00' } });
    await user.click(save());
    expect(await screen.findByText('Pick a time inside this shift.')).toBeInTheDocument();
    expect(createShiftTask).not.toHaveBeenCalled();
    expect(mutateUpdate).not.toHaveBeenCalled();
    expect(onShiftTaskSaved).not.toHaveBeenCalled();
    expect(Analytics.shiftTaskSaveFailed).toHaveBeenCalledWith({ mode: 'add', reason: 'outside_window' });
    // Moving it back inside the window sends.
    fireEvent.change(fromInput(), { target: { value: '16:00' } });
    await user.click(save());
    await waitFor(() => expect(createShiftTask).toHaveBeenCalledTimes(1));
  });

  it('N3 "Any time" is not offered, and the body always has a time', async () => {
    const { user } = setup();
    expect(screen.queryByRole('radio', { name: 'Any time' })).toBeNull();
    expect(screen.queryByRole('radio', { name: 'Pick a time' })).toBeNull();
    await user.type(titleBox(), 'Lunch');
    await user.click(save());
    await waitFor(() => expect(createShiftTask).toHaveBeenCalled());
    expect(lastPost().scheduled_time).toMatch(/^\d\d:\d\d$/);
  });

  it('N4 (replaces plan N4) a failed save sends no second request by itself and keeps the form and its input', async () => {
    vi.mocked(createShiftTask).mockRejectedValueOnce(new Error('network'));
    const { user, onClose, onShiftTaskSaved } = setup();
    await user.type(titleBox(), 'Lunch');
    await user.click(save());
    expect(await screen.findByTestId('shift-inline-error')).toHaveTextContent("Couldn't add the task. Please try again.");
    expect(createShiftTask).toHaveBeenCalledTimes(1);
    expect(mutateUpdate).not.toHaveBeenCalled();
    expect(onClose).not.toHaveBeenCalled();
    expect(onShiftTaskSaved).not.toHaveBeenCalled();
    expect(titleBox()).toHaveValue('Lunch');
    expect(Analytics.shiftTaskSaveFailed).toHaveBeenCalledWith({ mode: 'add', reason: 'other' });
  });

  it('N5 a double-tap on Save is one POST (guarded submit)', async () => {
    let resolve: (e: CalendarEvent) => void = () => {};
    vi.mocked(createShiftTask).mockReturnValue(new Promise((r) => (resolve = r)));
    const { user } = setup();
    await user.type(titleBox(), 'Lunch');
    const form = document.getElementById('add-event-form') as HTMLFormElement;
    fireEvent.submit(form);
    fireEvent.submit(form);
    await user.click(save());
    resolve({ id: 'new-task' } as CalendarEvent);
    await waitFor(() => expect(Analytics.shiftTaskSaved).toHaveBeenCalledTimes(1));
    expect(createShiftTask).toHaveBeenCalledTimes(1);
  });

  it.each([
    ['SHIFT_TASK_OUTSIDE_SHIFT', 'Pick a time inside this shift.', 'outside_window'],
    ['SHIFT_TASK_TIME_UNSUPPORTED', /can't repeat a task after midnight/, 'unsupported'],
  ])('%s stays on the form with its own inline words', async (code, words, reason) => {
    vi.mocked(createShiftTask).mockRejectedValueOnce({ error: { code } });
    const { user, onClose, onShiftTaskSaved } = setup();
    await user.type(titleBox(), 'Lunch');
    await user.click(save());
    expect(await screen.findByText(words)).toBeInTheDocument();
    expect(onClose).not.toHaveBeenCalled();
    expect(onShiftTaskSaved).not.toHaveBeenCalled();
    expect(Analytics.shiftTaskAdded).not.toHaveBeenCalled();
    expect(Analytics.shiftTaskSaveFailed).toHaveBeenCalledWith({ mode: 'add', reason });
  });

  it.each([
    ['SHIFT_ENDED', "This shift has ended, so tasks can't be added to it.", 'shift_ended'],
    ['SHIFT_NOT_FOUND', 'This shift is no longer here.', 'shift_gone'],
    ['SHIFT_INVALID_DATE', 'That day is not part of this shift.', 'invalid_date'],
  ])('%s shows its own words inline', async (code, words, reason) => {
    vi.mocked(createShiftTask).mockRejectedValueOnce({ error: { code } });
    const { user, onClose } = setup();
    await user.type(titleBox(), 'Lunch');
    await user.click(save());
    expect(await screen.findByTestId('shift-inline-error')).toHaveTextContent(words);
    expect(onClose).not.toHaveBeenCalled();
    expect(Analytics.shiftTaskSaveFailed).toHaveBeenCalledWith({ mode: 'add', reason });
  });

  it.each(['SUBSCRIPTION_REQUIRED', 'FORBIDDEN'])('%s (lapsed / view-only) closes the form', async (code) => {
    vi.mocked(createShiftTask).mockRejectedValueOnce({ error: { code } });
    const { user, onClose } = setup();
    await user.type(titleBox(), 'Lunch');
    await user.click(save());
    await waitFor(() => expect(onClose).toHaveBeenCalledTimes(1));
    expect(Analytics.shiftTaskAdded).not.toHaveBeenCalled();
  });

  it('a missing name is refused with no request: Save points at the field; Enter (a submit) reports name_missing', async () => {
    const { user } = setup();
    await user.click(save());
    expect(await screen.findByText('Please enter a title.')).toBeInTheDocument();
    expect(createShiftTask).not.toHaveBeenCalled();
    fireEvent.submit(document.getElementById('add-event-form') as HTMLFormElement);
    await waitFor(() =>
      expect(Analytics.shiftTaskSaveFailed).toHaveBeenCalledWith({ mode: 'add', reason: 'name_missing' })
    );
    expect(createShiftTask).not.toHaveBeenCalled();
  });
});

describe('shift mode: edit (a linked task)', () => {
  it('P10 a linked task edited from Tasks / Calendar (event.shift covered) opens in shift mode with no picker', () => {
    setup({ shiftContext: undefined, initialType: undefined, event: linkedTask() });
    expect(screen.getByRole('dialog', { name: 'Edit task' })).toBeInTheDocument();
    expect(screen.getByTestId('shift-task-chip')).toBeInTheDocument();
    expect(screen.getByTestId('shift-task-owner')).toHaveTextContent('Whoever is on this shift');
    expect(screen.queryByLabelText(/^Assigned to/)).toBeNull();
    expect(screen.queryByRole('radio', { name: 'Anyone' })).toBeNull();
    expect(screen.getByTestId('shift-task-repeat-locked')).toHaveTextContent('Repeats with Afternoons');
    expect(Analytics.shiftTaskEditOpened).toHaveBeenCalledWith({
      source: 'tasks',
      linked: true,
      state: 'open',
      recurring: true,
    });
  });

  it('P10b an open shift ("open" status) reads "No one is on this shift yet"; Calendar reports source calendar', () => {
    const open = linkedTask();
    open.shift = { ...open.shift!, status: 'open', assignee: null };
    setup({ shiftContext: undefined, initialType: undefined, event: open, shiftEditSource: 'calendar' });
    expect(screen.getByTestId('shift-task-owner-now')).toHaveTextContent('No one is on this shift yet');
    expect(Analytics.shiftTaskEditOpened).toHaveBeenCalledWith(expect.objectContaining({ source: 'calendar' }));
  });

  it('P6 edit saves ONE PATCH on the series root with the changed title and time; never assigned_to / scheduled_date / recurrence_*', async () => {
    const { user, onShiftTaskSaved } = setup({ event: linkedTask(), initialType: undefined, shiftContext: contextFor() });
    await user.clear(titleBox());
    await user.type(titleBox(), 'Lunch in the garden');
    fireEvent.change(fromInput(), { target: { value: '16:00' } });
    await user.click(save());
    await waitFor(() => expect(mutateUpdate).toHaveBeenCalledTimes(1));
    const { eventId, data } = mutateUpdate.mock.calls[0][0] as { eventId: string; data: Record<string, unknown> };
    expect(eventId).toBe('task-1');
    expect(data).toMatchObject({ title: 'Lunch in the garden', scheduled_time: '16:00' });
    // N6: nothing that would move or unlink the task.
    for (const key of ['assigned_to', 'scheduled_date', 'recurrence_rule', 'recurrence_days', 'recurrence_end_date']) {
      expect(data).not.toHaveProperty(key);
    }
    expect(createShiftTask).not.toHaveBeenCalled();
    expect(onShiftTaskSaved).toHaveBeenCalledWith({ mode: 'edit', taskId: 'task-1' });
    expect(Analytics.shiftTaskSaved).toHaveBeenCalledWith(
      expect.objectContaining({ mode: 'edit', timeChanged: true, nameChanged: true })
    );
  });

  it('N6 an untouched edit keeps the same time and still carries none of the locked keys', async () => {
    const { user } = setup({ event: linkedTask(), initialType: undefined, shiftContext: contextFor() });
    await user.click(save());
    await waitFor(() => expect(mutateUpdate).toHaveBeenCalledTimes(1));
    const data = mutateUpdate.mock.calls[0][0].data as Record<string, unknown>;
    expect(data.scheduled_time).toBe('15:00');
    expect(data).not.toHaveProperty('assigned_to');
    expect(data).not.toHaveProperty('scheduled_date');
    expect(Analytics.shiftTaskSaved).toHaveBeenCalledWith(expect.objectContaining({ mode: 'edit', timeChanged: false }));
  });

  it('N2b an EDIT to a time outside the window is refused by the client (PATCH would accept it)', async () => {
    const { user } = setup({ event: linkedTask(), initialType: undefined, shiftContext: contextFor() });
    fireEvent.change(fromInput(), { target: { value: '21:00' } });
    await user.click(save());
    expect(await screen.findByText('Pick a time inside this shift.')).toBeInTheDocument();
    expect(mutateUpdate).not.toHaveBeenCalled();
    expect(Analytics.shiftTaskSaveFailed).toHaveBeenCalledWith({ mode: 'edit', reason: 'outside_window' });
  });

  it('N13 overnight edit: a time on the other side of midnight is refused with the delete-and-add-again words', async () => {
    const night = shift({ scheduled_time: '20:00:00', duration_minutes: 600 });
    const task = linkedTask({ scheduled_time: '22:00:00' });
    task.shift = { ...task.shift!, window_start: '2026-11-10T20:00:00', window_end: '2026-11-11T06:00:00' };
    const { user } = setup({ event: task, initialType: undefined, shiftContext: contextFor(night) });
    fireEvent.change(fromInput(), { target: { value: '02:00' } });
    await user.click(save());
    expect(await screen.findByText(/same side of midnight/)).toBeInTheDocument();
    expect(mutateUpdate).not.toHaveBeenCalled();
    // The same side stays allowed.
    fireEvent.change(fromInput(), { target: { value: '23:00' } });
    await user.click(save());
    await waitFor(() => expect(mutateUpdate).toHaveBeenCalledTimes(1));
  });

  it('N14 no link, an "outside" link or an old backend with no shift field: the normal editor, nothing locked', () => {
    for (const shiftField of [null, undefined, { ...linkedTask().shift!, status: 'outside' as const }]) {
      const task = linkedTask();
      if (shiftField === undefined) delete (task as { shift?: unknown }).shift;
      else task.shift = shiftField;
      const { unmount } = setup({ event: task, initialType: undefined, shiftContext: undefined });
      expect(screen.queryByTestId('shift-task-chip')).toBeNull();
      expect(screen.getByRole('radio', { name: 'Anyone' })).toBeInTheDocument();
      expect(screen.getByRole('radio', { name: /^Lucia/ })).toBeInTheDocument();
      unmount();
    }
  });

  it('a normal task (no shift) keeps the picker and "Pick a time | Any time"', () => {
    setup({ shiftContext: null, initialType: 'task' });
    expect(screen.getByRole('radio', { name: 'Any time' })).toBeInTheDocument();
    expect(screen.getByRole('radio', { name: 'Anyone' })).toBeInTheDocument();
  });
});

describe('delete from the editor', () => {
  it('P8 a one-off task: Delete asks to confirm, deletes by id and returns', async () => {
    const one = linkedTask({ recurrence_rule: null });
    const { user, onDeleted } = setup({ event: one, initialType: undefined, shiftContext: contextFor() });
    await user.click(screen.getByTestId('add-event-delete'));
    const dialog = await screen.findByRole('dialog', { name: 'Delete task' });
    await user.click(within(dialog).getByRole('button', { name: 'Delete' }));
    await waitFor(() => expect(mutateDelete).toHaveBeenCalledTimes(1));
    expect(mutateDelete).toHaveBeenCalledWith({ eventId: 'task-1' });
    expect(onDeleted).toHaveBeenCalledTimes(1);
    expect(Analytics.shiftTaskDeleted).toHaveBeenCalledWith({ scope: 'all', surface: 'editor' });
  });

  it('P8b a repeating task: the scope picker defaults to "This task only" and sends the scope and the date', async () => {
    const { user } = setup({ event: linkedTask(), initialType: undefined, shiftContext: contextFor() });
    await user.click(screen.getByTestId('add-event-delete'));
    const dialog = await screen.findByRole('dialog', { name: 'Delete task' });
    await user.click(within(dialog).getByRole('radio', { name: 'This and all future tasks' }));
    expect(within(dialog).getByRole('radio', { name: 'This task only' })).not.toBeChecked();
    await user.click(within(dialog).getByRole('button', { name: 'Delete' }));
    await waitFor(() => expect(mutateDelete).toHaveBeenCalledTimes(1));
    expect(mutateDelete).toHaveBeenCalledWith({
      eventId: 'task-1',
      deleteScope: 'future',
      scheduledDate: '2026-11-10',
    });
    expect(Analytics.shiftTaskDeleted).toHaveBeenCalledWith({ scope: 'future', surface: 'editor' });
  });

  it('delete is for task EDITS everywhere: a normal (unlinked) task edit has it too; a new task and an appointment do not', () => {
    const plain = linkedTask();
    delete (plain as { shift?: unknown }).shift;
    setup({ event: plain, initialType: undefined, shiftContext: undefined });
    expect(screen.getByTestId('add-event-delete')).toBeInTheDocument();
    cleanup();
    setup({ shiftContext: null, initialType: 'task' });
    expect(screen.queryByTestId('add-event-delete')).toBeNull();
    cleanup();
    setup({ shiftContext: null, initialType: 'appointment' });
    expect(screen.queryByTestId('add-event-delete')).toBeNull();
  });

  it('N-delete-cancel: Cancel on the confirm deletes nothing and keeps the editor', async () => {
    const { user, onDeleted } = setup({ event: linkedTask({ recurrence_rule: null }), initialType: undefined, shiftContext: contextFor() });
    await user.click(screen.getByTestId('add-event-delete'));
    const dialog = await screen.findByRole('dialog', { name: 'Delete task' });
    await user.click(within(dialog).getByRole('button', { name: 'Cancel' }));
    expect(mutateDelete).not.toHaveBeenCalled();
    expect(onDeleted).not.toHaveBeenCalled();
    expect(screen.getByTestId('add-event-save')).toBeInTheDocument();
  });
});

describe('1.4.3 review fixes (web)', () => {
  it('W-1 positive: an end time picked, then a parent re-render with a fresh shiftContext object, keeps the picked end', async () => {
    const { rerenderFreshContext } = setup({ event: linkedTask(), initialType: undefined });
    fireEvent.change(toInput(), { target: { value: '15:45' } });
    expect(toInput().value).toBe('15:45');
    rerenderFreshContext();
    expect(toInput().value).toBe('15:45');
    expect(fromInput().value).toBe('15:00');
  });

  it('W-1 negative: an untouched edit re-rendered with a fresh context keeps its hydrated start and end (no reset to blank)', () => {
    const { rerenderFreshContext } = setup({ event: linkedTask(), initialType: undefined });
    expect(toInput().value).toBe('15:30');
    rerenderFreshContext();
    expect(fromInput().value).toBe('15:00');
    expect(toInput().value).toBe('15:30');
  });

  it('M-2 positive: the viewer on the shift reads "Right now: You"; someone else reads their first name', () => {
    setup({ shiftContext: contextFor(shift({ assigned_to: ME })) });
    expect(screen.getByTestId('shift-task-owner-now')).toHaveTextContent('Right now: You');
    cleanup();
    setup({ shiftContext: contextFor() });
    expect(screen.getByTestId('shift-task-owner-now')).toHaveTextContent('Right now: Lucia');
  });

  it('M-2 negative: another person with no known name reads "Someone", never "You"', () => {
    const stranger = 'dddddddd-4444-4444-8444-444444444444';
    setup({ shiftContext: contextFor(shift({ assigned_to: stranger })) });
    const line = screen.getByTestId('shift-task-owner-now');
    expect(line).toHaveTextContent('Right now: Someone');
    expect(line).not.toHaveTextContent('You');
  });

  it('A-1 positive: Save with an empty title fires name_missing once (add), and an edit reports mode edit', async () => {
    const { user } = setup();
    await user.click(save());
    expect(Analytics.shiftTaskSaveFailed).toHaveBeenCalledTimes(1);
    expect(Analytics.shiftTaskSaveFailed).toHaveBeenCalledWith({ mode: 'add', reason: 'name_missing' });
    cleanup();
    vi.mocked(Analytics.shiftTaskSaveFailed).mockClear();
    const { user: u2 } = setup({ event: linkedTask({ title: '' }), initialType: undefined });
    await u2.click(save());
    expect(Analytics.shiftTaskSaveFailed).toHaveBeenCalledWith({ mode: 'edit', reason: 'name_missing' });
  });

  it('A-1 negative: Save with a title does not fire name_missing', async () => {
    const { user } = setup();
    await user.type(titleBox(), 'Lunch');
    await user.click(save());
    await waitFor(() => expect(createShiftTask).toHaveBeenCalled());
    expect(Analytics.shiftTaskSaveFailed).not.toHaveBeenCalledWith(expect.objectContaining({ reason: 'name_missing' }));
  });

  it('A-1 positive: an edit sends the real oneOff (recurring task = false, one-off task = true), and no rename on an add', async () => {
    const { user } = setup({ event: linkedTask(), initialType: undefined });
    await user.click(save());
    await waitFor(() => expect(Analytics.shiftTaskSaved).toHaveBeenCalledTimes(1));
    expect(Analytics.shiftTaskSaved).toHaveBeenCalledWith(expect.objectContaining({ mode: 'edit', oneOff: false }));
    cleanup();
    vi.mocked(Analytics.shiftTaskSaved).mockClear();
    const one = linkedTask({ recurrence_rule: null, parent_event_id: null });
    one.shift = { ...one.shift! };
    const { user: u2 } = setup({ event: one, initialType: undefined, shiftContext: contextFor(shift({ recurrence_rule: null, parent_event_id: null })) });
    await u2.click(save());
    await waitFor(() => expect(Analytics.shiftTaskSaved).toHaveBeenCalledTimes(1));
    expect(Analytics.shiftTaskSaved).toHaveBeenCalledWith(expect.objectContaining({ mode: 'edit', oneOff: true }));
  });

  it('A-1 positive: an add whose time lands after midnight carries nextDay on shift_task_added', async () => {
    const night = shift({ scheduled_time: '20:00:00', duration_minutes: 600 });
    const { user } = setup({ shiftContext: contextFor(night) });
    await user.type(titleBox(), 'Night check');
    fireEvent.change(fromInput(), { target: { value: '02:00' } });
    await user.click(save());
    await waitFor(() => expect(Analytics.shiftTaskAdded).toHaveBeenCalledTimes(1));
    expect(Analytics.shiftTaskAdded).toHaveBeenCalledWith(expect.objectContaining({ nextDay: true }));
  });
});
