import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router-dom';
import '@/i18n';
import { getSeriesRoot, type CalendarEvent, type SeriesRoot } from '@/api/calendarEvents';
import type { CircleMember } from '@/api/circleMembers';
import { createShift, rescheduleShiftSeries, updateShift } from '@/api/shifts';
import { ToastProvider } from '@/components/ui';
import { Analytics } from '@/lib/analytics';
import { useCircle } from '@/hooks/useCircle';
import { useAuthStore } from '@/store/authStore';
import { ShiftFormModal } from '../ShiftFormModal';

// Days on / off, monthly, yearly and every other day on create; the editable date and repeat of a
// series ("All upcoming shifts" posts to the reschedule route, "This shift" keeps the PATCH path).

vi.mock('@/api/shifts', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/api/shifts')>()),
  createShift: vi.fn(),
  updateShift: vi.fn(),
  rescheduleShiftSeries: vi.fn(),
}));
vi.mock('@/api/calendarEvents', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/api/calendarEvents')>()),
  getSeriesRoot: vi.fn(),
}));
vi.mock('@/hooks/useCircle', () => ({ useCircle: vi.fn() }));
vi.mock('@/hooks/useHourCycle', () => ({ useHourCycle: () => '12h' }));
vi.mock('@/lib/analytics', () => ({
  Analytics: {
    shiftCreated: vi.fn(),
    shiftEdited: vi.fn(),
    shiftSeriesRescheduled: vi.fn(),
    shiftAddNextTapped: vi.fn(),
    shiftTakeConflict: vi.fn(),
    errorOccurred: vi.fn(),
  },
}));
vi.spyOn(Intl.DateTimeFormat.prototype, 'resolvedOptions').mockReturnValue({
  timeZone: 'America/Chicago',
} as Intl.ResolvedDateTimeFormatOptions);

const mockCreate = vi.mocked(createShift);
const mockUpdate = vi.mocked(updateShift);
const mockReschedule = vi.mocked(rescheduleShiftSeries);
const mockRoot = vi.mocked(getSeriesRoot);

const members = [
  { id: 'u-me', first_name: 'Pat', last_name: 'L', email: 'pat@x.test', role: 'owner', is_care_recipient: false },
  { id: 'u-rosa', first_name: 'Rosa', last_name: 'G', email: 'rosa@x.test', role: 'member', is_care_recipient: true },
] as unknown as CircleMember[];

function shell(ui: React.ReactElement) {
  return render(
    <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
      <ToastProvider>
        <MemoryRouter>{ui}</MemoryRouter>
      </ToastProvider>
    </QueryClientProvider>
  );
}

function row(over: Partial<CalendarEvent> = {}): CalendarEvent {
  return {
    id: 'root_2026-11-15',
    circle_id: 'c',
    event_type: 'shift',
    title: 'Handoff',
    scheduled_date: '2026-11-15',
    scheduled_time: '18:00:00',
    duration_minutes: 1440,
    recurrence_rule: 'daily',
    parent_event_id: 'root',
    reminder_lead_minutes: 60,
    assigned_to: null,
    created_at: '',
    updated_at: '',
    ...over,
  } as CalendarEvent;
}

const rootOf = (over: Partial<SeriesRoot> = {}): SeriesRoot =>
  ({
    id: 'root',
    scheduled_date: '2026-11-08',
    scheduled_time: '18:00:00',
    duration_minutes: 1440,
    recurrence_rule: 'daily',
    recurrence_days: null,
    recurrence_end_date: null,
    title: 'Handoff',
    ...over,
  }) as SeriesRoot;

const field = (id: string): HTMLInputElement => {
  const el = document.getElementById(id);
  if (!el) throw new Error(`#${id} is not on screen`);
  return el as HTMLInputElement;
};
const setTime = (which: 'start' | 'end', value: string) => {
  const id = `shift_${which}`;
  if (!document.getElementById(id)) fireEvent.click(screen.getByTestId(`shift-${which}-tile`));
  fireEvent.change(field(id), { target: { value } });
};
const tile = (name: string) =>
  within(screen.getByRole('radiogroup', { name: 'How often?' })).getByRole('radio', { name });
const cells = () => screen.getAllByTestId('shift-cycle-cell');
const cell = (iso: string) => {
  const start = new Date('2026-11-08T00:00:00Z').getTime();
  const idx = Math.round((new Date(`${iso}T00:00:00Z`).getTime() - start) / 86400000);
  return cells()[idx];
};
const openCreate = (initialDate = '2026-11-08') =>
  shell(<ShiftFormModal circleId="c" initialDate={initialDate} onClose={vi.fn()} />);
const openEdit = (shift: CalendarEvent, onClose = vi.fn()) =>
  shell(<ShiftFormModal circleId="c" shift={shift} onClose={onClose} />);

beforeEach(() => {
  vi.clearAllMocks();
  useAuthStore.setState({
    user: { id: 'u-me', email: 'pat@x.test', first_name: 'Pat', last_name: 'L' },
    isAuthenticated: true,
  } as never);
  vi.mocked(useCircle).mockReturnValue({
    circle: { id: 'c', recipient_name: 'Rosa', owner_id: 'u-me' },
    timezone: 'America/Chicago',
    members,
    canEdit: true,
    canManageMembers: true,
    viewerRole: 'owner',
  } as unknown as ReturnType<typeof useCircle>);
  mockCreate.mockResolvedValue(row({ id: 'new', parent_event_id: null, recurrence_rule: 'cycle:14:7' }));
  mockUpdate.mockResolvedValue(row());
  mockReschedule.mockResolvedValue(row({ id: 'newroot', parent_event_id: null }));
  mockRoot.mockResolvedValue(rootOf());
});

describe('create: Days on / off', () => {
  it('shows a panel with Days on / Days off (7 and 7), a summary and the legend', async () => {
    const user = userEvent.setup();
    openCreate();
    expect(screen.queryByTestId('shift-cycle-panel')).not.toBeInTheDocument();
    await user.click(tile('Days on / off'));
    expect(tile('Days on / off')).toBeChecked();
    expect(field('cycle_days_on')).toHaveValue('7');
    expect(field('cycle_days_off')).toHaveValue('7');
    expect(screen.getByTestId('shift-cycle-summary')).toHaveTextContent('7 days on, 7 days off');
    const panel = within(screen.getByTestId('shift-cycle-panel'));
    expect(panel.getByText('On shift')).toBeInTheDocument();
    expect(panel.getByText('Off')).toBeInTheDocument();
  });

  it('14 on / 7 off from Sun Nov 8: Nov 8-21 on, Nov 22-28 off, Nov 29 on; 42 cells; "Dec 1" labelled', async () => {
    const user = userEvent.setup();
    openCreate();
    await user.click(tile('Days on / off'));
    await user.clear(field('cycle_days_on'));
    await user.type(field('cycle_days_on'), '14');
    await user.clear(field('cycle_days_off'));
    await user.type(field('cycle_days_off'), '7');
    expect(screen.getByTestId('shift-cycle-summary')).toHaveTextContent('14 days on, 7 days off');
    expect(cells()).toHaveLength(42);
    const on = (iso: string) => cell(iso).getAttribute('data-on');
    expect(on('2026-11-08')).toBe('true');
    expect(on('2026-11-21')).toBe('true');
    expect(on('2026-11-22')).toBe('false');
    expect(on('2026-11-28')).toBe('false');
    expect(on('2026-11-29')).toBe('true');
    expect(cell('2026-12-01')).toHaveTextContent('Dec 1');
    expect(cell('2026-11-30')).toHaveTextContent('30');
    // The header is the weekday initials, Sunday first.
    const header = screen.getByTestId('shift-cycle-preview').textContent ?? '';
    expect(header.startsWith('SMTWTFS')).toBe(true);
  });

  it('only a 24 hour shift gets the back-to-back hint', async () => {
    const user = userEvent.setup();
    openCreate();
    await user.click(tile('Days on / off'));
    expect(screen.queryByTestId('shift-cycle-hint')).not.toBeInTheDocument();
    setTime('start', '18:00');
    setTime('end', '18:00');
    expect(screen.getByTestId('shift-cycle-hint')).toHaveTextContent(
      'Each day is one 6:00 PM to 6:00 PM shift. They run back to back.'
    );
    setTime('end', '17:00');
    expect(screen.queryByTestId('shift-cycle-hint')).not.toBeInTheDocument();
  });

  it('keeps whole numbers only and refuses empty / zero counts', async () => {
    const user = userEvent.setup();
    openCreate();
    await user.click(tile('Days on / off'));
    await user.clear(field('cycle_days_on'));
    await user.type(field('cycle_days_on'), '1.5e');
    expect(field('cycle_days_on')).toHaveValue('15');
    await user.clear(field('cycle_days_on'));
    await user.type(field('cycle_days_on'), '0');
    await user.type(field('shift_name'), 'Rotation');
    await user.click(screen.getByRole('button', { name: 'Save shift' }));
    expect(
      await screen.findByText('Days on and days off must be whole numbers from 1 to 999.')
    ).toBeInTheDocument();
    expect(mockCreate).not.toHaveBeenCalled();
  });

  it('saves cycle:14:7 and sends only enums and buckets to analytics', async () => {
    const user = userEvent.setup();
    openCreate();
    await user.type(field('shift_name'), 'Rotation');
    setTime('start', '18:00');
    setTime('end', '18:00');
    await user.click(tile('Days on / off'));
    await user.clear(field('cycle_days_on'));
    await user.type(field('cycle_days_on'), '14');
    await user.click(screen.getByRole('button', { name: 'Save shift' }));
    await waitFor(() => expect(mockCreate).toHaveBeenCalled());
    expect(mockCreate.mock.calls[0][1]).toEqual(
      expect.objectContaining({
        scheduled_date: '2026-11-08',
        scheduled_time: '18:00',
        duration_minutes: 1440,
        recurrence_rule: 'cycle:14:7',
      })
    );
    expect(mockCreate.mock.calls[0][1]).not.toHaveProperty('recurrence_days');
    expect(Analytics.shiftCreated).toHaveBeenCalledWith(
      expect.objectContaining({
        repeats: true,
        recurrence: 'cycle',
        cycleOnBucket: '8-14',
        cycleOffBucket: '4-7',
        durationMinutes: 1440,
      })
    );
  });

  it.each([
    ['Every other day', 'every_other_day'],
    ['Monthly', 'monthly'],
    ['Yearly', 'yearly'],
  ])('%s saves the %s rule and names it in analytics', async (label, rule) => {
    const user = userEvent.setup();
    openCreate();
    await user.type(field('shift_name'), 'Check-in');
    await user.click(tile(label));
    await user.click(screen.getByRole('button', { name: 'Save shift' }));
    await waitFor(() => expect(mockCreate).toHaveBeenCalled());
    expect(mockCreate.mock.calls[0][1]).toEqual(expect.objectContaining({ recurrence_rule: rule }));
    expect(Analytics.shiftCreated).toHaveBeenCalledWith(
      expect.objectContaining({ recurrence: rule, repeats: true })
    );
    const call = vi.mocked(Analytics.shiftCreated).mock.calls[0][0];
    expect(call).not.toHaveProperty('cycleOnBucket');
  });

  it('Some days moves the start to the first chosen weekday and says so', async () => {
    const user = userEvent.setup();
    openCreate(); // Sunday Nov 8
    await user.type(field('shift_name'), 'Weekdays');
    await user.click(tile('Some days'));
    await user.click(screen.getByRole('checkbox', { name: 'Sunday' }));
    await user.click(screen.getByRole('checkbox', { name: 'Monday' }));
    expect(screen.getByTestId('shift-form-first-time')).toHaveTextContent('First time: Mon, Nov 9');
    await user.click(screen.getByRole('button', { name: 'Save shift' }));
    await waitFor(() => expect(mockCreate).toHaveBeenCalled());
    expect(mockCreate.mock.calls[0][1]).toEqual(
      expect.objectContaining({ scheduled_date: '2026-11-09', recurrence_rule: 'weekly', recurrence_days: [1] })
    );
  });
});

describe('edit a series: This shift / All upcoming shifts', () => {
  it('"This shift" moves the occurrence through the existing PATCH (date sent), no reschedule', async () => {
    const user = userEvent.setup();
    openEdit(row());
    expect(screen.queryByRole('radiogroup', { name: 'How often?' })).not.toBeInTheDocument();
    fireEvent.change(field('shift_date'), { target: { value: '2026-11-16' } });
    await user.click(screen.getByRole('button', { name: 'Save changes' }));
    await waitFor(() => expect(mockUpdate).toHaveBeenCalled());
    expect(mockUpdate.mock.calls[0][1]).toBe('root_2026-11-15');
    expect(mockUpdate.mock.calls[0][2]).toEqual(expect.objectContaining({ scheduled_date: '2026-11-16' }));
    expect(mockReschedule).not.toHaveBeenCalled();
  });

  it('"All upcoming" unlocks Starting (default = this date) and the repeat; a new repeat posts to the reschedule route', async () => {
    const user = userEvent.setup();
    const onClose = vi.fn();
    openEdit(row({ assigned_to: null }), onClose);
    await user.click(screen.getByRole('radio', { name: 'All upcoming shifts' }));
    expect(screen.getByText('Starting')).toBeInTheDocument();
    expect(field('shift_date')).toHaveValue('2026-11-15');
    await waitFor(() => expect(tile('Every day')).toBeChecked());
    await user.click(tile('Days on / off'));
    expect(screen.getByTestId('shift-cycle-was')).toHaveTextContent('was Daily');
    await user.click(screen.getByRole('button', { name: 'Save changes' }));
    await waitFor(() => expect(mockReschedule).toHaveBeenCalled());
    expect(mockReschedule).toHaveBeenCalledWith('c', 'root', {
      from_date: '2026-11-15',
      start_date: '2026-11-15',
      recurrence_rule: 'cycle:7:7',
      title: 'Handoff',
      scheduled_time: '18:00',
      duration_minutes: 1440,
      reminder_lead_minutes: 60,
    });
    expect(mockUpdate).not.toHaveBeenCalled();
    expect(Analytics.shiftSeriesRescheduled).toHaveBeenCalledWith({
      changed: 'repeat',
      fromRecurrence: 'daily',
      toRecurrence: 'cycle',
    });
    expect(onClose).toHaveBeenCalled();
  });

  it('only the start date changed: reschedule with the same rule, changed = date', async () => {
    const user = userEvent.setup();
    openEdit(row());
    await user.click(screen.getByRole('radio', { name: 'All upcoming shifts' }));
    await waitFor(() => expect(tile('Every day')).toBeChecked());
    fireEvent.change(field('shift_date'), { target: { value: '2026-11-22' } });
    await user.click(screen.getByRole('button', { name: 'Save changes' }));
    await waitFor(() => expect(mockReschedule).toHaveBeenCalled());
    expect(mockReschedule.mock.calls[0][2]).toEqual(
      expect.objectContaining({ from_date: '2026-11-15', start_date: '2026-11-22', recurrence_rule: 'daily' })
    );
    expect(Analytics.shiftSeriesRescheduled).toHaveBeenCalledWith({
      changed: 'date',
      fromRecurrence: 'daily',
      toRecurrence: 'daily',
    });
  });

  it('nothing about the schedule changed: the existing PATCH of the root, no reschedule', async () => {
    const user = userEvent.setup();
    openEdit(row());
    await user.click(screen.getByRole('radio', { name: 'All upcoming shifts' }));
    await waitFor(() => expect(tile('Every day')).toBeChecked());
    await user.click(screen.getByRole('button', { name: 'Save changes' }));
    await waitFor(() => expect(mockUpdate).toHaveBeenCalled());
    expect(mockUpdate.mock.calls[0][1]).toBe('root');
    expect(mockUpdate.mock.calls[0][2]).not.toHaveProperty('scheduled_date');
    expect(mockReschedule).not.toHaveBeenCalled();
    expect(Analytics.shiftSeriesRescheduled).not.toHaveBeenCalled();
  });

  it('a rotation reopens with its counts and says what it was when they change', async () => {
    const user = userEvent.setup();
    mockRoot.mockResolvedValue(rootOf({ recurrence_rule: 'cycle:14:7' }));
    openEdit(row({ recurrence_rule: 'cycle:14:7' }));
    await user.click(screen.getByRole('radio', { name: 'All upcoming shifts' }));
    await waitFor(() => expect(tile('Days on / off')).toBeChecked());
    expect(field('cycle_days_on')).toHaveValue('14');
    expect(field('cycle_days_off')).toHaveValue('7');
    expect(screen.queryByTestId('shift-cycle-was')).not.toBeInTheDocument();
    await user.clear(field('cycle_days_on'));
    await user.type(field('cycle_days_on'), '7');
    expect(screen.getByTestId('shift-cycle-was')).toHaveTextContent('was 14 days on, 7 days off');
    // The preview counts from the Starting date.
    expect(cells()[0].getAttribute('data-on')).toBe('true');
    await user.click(screen.getByRole('button', { name: 'Save changes' }));
    await waitFor(() => expect(mockReschedule).toHaveBeenCalled());
    expect(mockReschedule.mock.calls[0][2]).toEqual(
      expect.objectContaining({ recurrence_rule: 'cycle:7:7' })
    );
    expect(Analytics.shiftSeriesRescheduled).toHaveBeenCalledWith({
      changed: 'repeat',
      fromRecurrence: 'cycle',
      toRecurrence: 'cycle',
    });
  });

  it('days of the week come from the ROOT (a virtual occurrence does not carry them)', async () => {
    const user = userEvent.setup();
    mockRoot.mockResolvedValue(rootOf({ recurrence_rule: 'weekly', recurrence_days: [1, 3] }));
    openEdit(row({ recurrence_rule: 'weekly', recurrence_days: null }));
    await user.click(screen.getByRole('radio', { name: 'All upcoming shifts' }));
    await waitFor(() => expect(tile('Some days')).toBeChecked());
    expect(screen.getByRole('checkbox', { name: 'Monday' })).toHaveAttribute('aria-checked', 'true');
    expect(screen.getByRole('checkbox', { name: 'Wednesday' })).toHaveAttribute('aria-checked', 'true');
    expect(screen.getByRole('checkbox', { name: 'Tuesday' })).toHaveAttribute('aria-checked', 'false');
  });

  it('Starting cannot be earlier than the tapped shift', async () => {
    const user = userEvent.setup();
    openEdit(row());
    await user.click(screen.getByRole('radio', { name: 'All upcoming shifts' }));
    await waitFor(() => expect(tile('Every day')).toBeChecked());
    fireEvent.change(field('shift_date'), { target: { value: '2026-11-10' } });
    await user.click(screen.getByRole('button', { name: 'Save changes' }));
    expect(await screen.findByText("Starting can't be earlier than Nov 15, 2026.")).toBeInTheDocument();
    expect(mockReschedule).not.toHaveBeenCalled();
    expect(mockUpdate).not.toHaveBeenCalled();
  });

  it('INVALID_START from the server shows inline on the date and keeps the form open', async () => {
    const user = userEvent.setup();
    const onClose = vi.fn();
    mockReschedule.mockRejectedValue({ error: { code: 'INVALID_START', message: 'no' } });
    openEdit(row(), onClose);
    await user.click(screen.getByRole('radio', { name: 'All upcoming shifts' }));
    await waitFor(() => expect(tile('Every day')).toBeChecked());
    await user.click(tile('Every week'));
    await user.click(screen.getByRole('button', { name: 'Save changes' }));
    expect(
      await screen.findByText("That date doesn't fit the new schedule. Choose another start date.")
    ).toBeInTheDocument();
    expect(onClose).not.toHaveBeenCalled();
    expect(field('shift_date')).toHaveAttribute('aria-invalid', 'true');
  });

  it('RESCHEDULE_REQUIRED from the server is explained inline', async () => {
    const user = userEvent.setup();
    mockReschedule.mockRejectedValue({ error: { code: 'RESCHEDULE_REQUIRED', message: 'no' } });
    openEdit(row());
    await user.click(screen.getByRole('radio', { name: 'All upcoming shifts' }));
    await waitFor(() => expect(tile('Every day')).toBeChecked());
    await user.click(tile('Monthly'));
    await user.click(screen.getByRole('button', { name: 'Save changes' }));
    expect(
      await screen.findByText('This schedule was changed elsewhere. Close this and open the shift again.')
    ).toBeInTheDocument();
  });

  it('switching scope puts the date back on the tapped shift', async () => {
    const user = userEvent.setup();
    openEdit(row());
    fireEvent.change(field('shift_date'), { target: { value: '2026-11-20' } });
    await user.click(screen.getByRole('radio', { name: 'All upcoming shifts' }));
    expect(field('shift_date')).toHaveValue('2026-11-15');
  });
});

describe('edit: an unknown stored rule keeps its rule', () => {
  it('selects no tile and a date-only reschedule sends the stored rule and end date', async () => {
    const user = userEvent.setup();
    mockRoot.mockResolvedValue(rootOf({ recurrence_rule: 'custom:3', recurrence_end_date: '2027-01-31' }));
    openEdit(row({ recurrence_rule: 'custom:3' }));
    await user.click(screen.getByRole('radio', { name: 'All upcoming shifts' }));
    for (const r of within(screen.getByRole('radiogroup', { name: 'How often?' })).getAllByRole('radio')) {
      expect(r).not.toBeChecked();
    }
    await waitFor(() => expect(mockRoot).toHaveBeenCalled());
    fireEvent.change(field('shift_date'), { target: { value: '2026-11-18' } });
    await user.click(screen.getByRole('button', { name: 'Save changes' }));
    await waitFor(() => expect(mockReschedule).toHaveBeenCalled());
    expect(mockReschedule.mock.calls[0][2]).toEqual(
      expect.objectContaining({ recurrence_rule: 'custom:3', recurrence_end_date: '2027-01-31', start_date: '2026-11-18' })
    );
  });
});
