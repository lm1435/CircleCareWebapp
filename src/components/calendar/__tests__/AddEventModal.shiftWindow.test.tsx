import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router-dom';
import '@/i18n';
import type { CalendarEvent } from '@/api/calendarEvents';
import { ToastProvider } from '@/components/ui';
import { Analytics } from '@/lib/analytics';
import { shiftContextFromShift, type ShiftWindowContext } from '@/components/shifts/shiftTasks';
import { AddEventModal } from '../AddEventModal';

// WINDOW MODE of the full medication and appointment forms ("Add to this shift", 1.4.3). The shift is Tue Nov 10,
// 2:00 PM - 8:00 PM (Chicago); Lucia is on it. The item is an ordinary event created through the normal create path.

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

const mutateCreateEvent = vi.fn();
const draftSpies = vi.hoisted(() => ({ register: vi.fn(() => () => {}), take: vi.fn(() => null) }));
vi.mock('@/lib/sessionDraft', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/sessionDraft')>()),
  registerDraft: draftSpies.register,
  takeDraft: draftSpies.take,
}));
vi.mock('../DoseQuietHoursNote', () => ({ DoseQuietHoursNote: () => null }));
vi.mock('@/api/drugs', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/api/drugs')>()),
  searchDrugs: vi.fn().mockResolvedValue([]),
}));
vi.mock('@/hooks/useProviders', () => ({ useProviders: () => ({ providers: [], isSuccess: true }) }));
vi.mock('@/hooks/useCalendarEvents', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/hooks/useCalendarEvents')>()),
  useCreateEvent: () => ({ mutateAsync: mutateCreateEvent, isPending: false }),
  useUpdateEvent: () => ({ mutateAsync: vi.fn(), isPending: false }),
  useDeleteEvent: () => ({ mutateAsync: vi.fn(), isPending: false }),
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

const windowFor = (s: CalendarEvent = shift()): ShiftWindowContext => ({
  ...shiftContextFromShift(s, useCircleResult.members, ME, 'shift_detail', !!s.recurrence_rule),
  covererId: s.assigned_to ?? null,
});

function setup(type: 'medication' | 'appointment', s: CalendarEvent = shift()) {
  const onClose = vi.fn();
  const onSaved = vi.fn();
  const user = userEvent.setup();
  const qc = new QueryClient({ defaultOptions: { mutations: { retry: false } } });
  const ctx = windowFor(s);
  render(
    <QueryClientProvider client={qc}>
      <ToastProvider>
        <MemoryRouter>
          <AddEventModal
            circleId="c"
            initialType={type}
            entry="shift_detail"
            shiftWindow={ctx}
            onClose={onClose}
            onSaved={onSaved}
          />
        </MemoryRouter>
      </ToastProvider>
    </QueryClientProvider>
  );
  return { user, onClose, onSaved };
}

const fromInput = () => screen.getByLabelText('From', { selector: 'input' }) as HTMLInputElement;
const titleBox = () => screen.getByRole('textbox', { name: /^Title/ });
const medName = () => screen.getByLabelText(/^Medication name/);
const save = () => screen.getByTestId('add-event-save');
const posted = () => mutateCreateEvent.mock.calls[0][0] as Record<string, unknown>;
const otherTimeInput = () => screen.getByLabelText('Other time', { selector: 'input' }) as HTMLInputElement;

const SPIED = ['entryFormOpened', 'entryFormStepCompleted', 'entrySaveTapped', 'entryValidationBlocked', 'shiftItemAdded', 'shiftTaskAdded', 'shiftItemAddAbandoned'] as const;

beforeEach(() => {
  vi.clearAllMocks();
  vi.useFakeTimers({ toFake: ['Date'], now: NOW });
  mutateCreateEvent.mockResolvedValue({ id: 'new-event' });
  for (const name of SPIED) vi.spyOn(Analytics, name).mockImplementation(() => {});
});
afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  vi.useRealTimers();
});

describe('window mode: appointment', () => {
  it('POS opens the full appointment form: locked day + hint, no date picker, default time = shift start, "Between" hint', () => {
    setup('appointment');
    expect(screen.getByRole('dialog', { name: 'New appointment' })).toBeInTheDocument();
    expect(screen.getByTestId('shift-window-locked-day')).toHaveTextContent('Tue, Nov 10 · during Afternoons');
    expect(screen.getByTestId('shift-window-locked-hint')).toHaveTextContent('Locked to shift');
    expect(fromInput().value).toBe('14:00');
    expect(screen.getByTestId('shift-window-time-hint')).toHaveTextContent('Between 2:00 PM and 8:00 PM');
    // The type switcher is not there and the full form's own fields are.
    expect(screen.queryByRole('radio', { name: 'Task' })).toBeNull();
    // One-time only: no repeat controls.
    expect(screen.queryByRole('radio', { name: 'Every week' })).toBeNull();
  });

  it('NEG the day cannot be changed: there is no Starts date control, only the locked tile', () => {
    setup('appointment');
    expect(screen.queryByTestId('starts-tile')).toBeNull();
    expect(screen.queryByLabelText(/^Starts/)).toBeNull();
    expect(document.getElementById('scheduled_date')).toBeNull();
    // And no "Any time": a start inside the window is required.
    expect(screen.queryByRole('radio', { name: 'Any time' })).toBeNull();
  });

  it('POS "Who\'s going" opens on the shift\'s coverer (covered shift)', () => {
    setup('appointment');
    expect(screen.getByRole('radio', { name: /^Lucia/ })).toBeChecked();
  });

  it('POS an OPEN shift leaves the editor default ("Anyone")', () => {
    setup('appointment', shift({ assigned_to: null }));
    expect(screen.getByRole('radio', { name: 'Anyone' })).toBeChecked();
  });

  it('POS in-window save: one normal create on the shift day, shift_item_added once with the enum', async () => {
    const { user, onSaved } = setup('appointment');
    await user.type(titleBox(), 'Dr visit');
    fireEvent.change(fromInput(), { target: { value: '16:00' } });
    await user.click(save());
    await waitFor(() => expect(mutateCreateEvent).toHaveBeenCalledTimes(1));
    expect(posted()).toMatchObject({
      event_type: 'appointment',
      title: 'Dr visit',
      scheduled_date: '2026-11-10',
      scheduled_time: '16:00',
      assigned_to: LUCIA,
    });
    // Not linked to the shift server-side: no shift key in the ordinary create body.
    expect(JSON.stringify(posted())).not.toContain('shift');
    await waitFor(() => expect(onSaved).toHaveBeenCalled());
    expect(Analytics.shiftItemAdded).toHaveBeenCalledTimes(1);
    expect(Analytics.shiftItemAdded).toHaveBeenCalledWith({ type: 'appointment', shiftRepeating: true });
    expect(Analytics.shiftTaskAdded).not.toHaveBeenCalled();
  });

  it('NEG an out-of-window start is refused inline: no create, no shift_item_added', async () => {
    const { user, onSaved } = setup('appointment');
    await user.type(titleBox(), 'Dr visit');
    fireEvent.change(fromInput(), { target: { value: '09:00' } });
    await user.click(save());
    expect(await screen.findByText('Pick a time inside this shift.')).toBeInTheDocument();
    expect(mutateCreateEvent).not.toHaveBeenCalled();
    expect(onSaved).not.toHaveBeenCalled();
    expect(Analytics.shiftItemAdded).not.toHaveBeenCalled();
  });

  it('NEG opening the form fires no shift_item_added', () => {
    setup('appointment');
    expect(Analytics.shiftItemAdded).not.toHaveBeenCalled();
  });

  it('NEG a failed create fires no shift_item_added', async () => {
    mutateCreateEvent.mockRejectedValueOnce(new Error('network'));
    const { user, onSaved } = setup('appointment');
    await user.type(titleBox(), 'Dr visit');
    await user.click(save());
    await waitFor(() => expect(mutateCreateEvent).toHaveBeenCalledTimes(1));
    expect(onSaved).not.toHaveBeenCalled();
    expect(Analytics.shiftItemAdded).not.toHaveBeenCalled();
  });

  it('overnight: a start after midnight is inside the window and is saved on shift date + 1', async () => {
    const night = shift({ scheduled_time: '20:00:00', duration_minutes: 600 });
    const { user } = setup('appointment', night);
    await user.type(titleBox(), 'Early call');
    fireEvent.change(fromInput(), { target: { value: '02:00' } });
    await user.click(save());
    await waitFor(() => expect(mutateCreateEvent).toHaveBeenCalledTimes(1));
    expect(posted()).toMatchObject({ scheduled_date: '2026-11-11', scheduled_time: '02:00' });
  });

  it('overnight NEG: a time between the end and the start (7:00 AM) is refused', async () => {
    const night = shift({ scheduled_time: '20:00:00', duration_minutes: 600 });
    const { user } = setup('appointment', night);
    await user.type(titleBox(), 'Early call');
    fireEvent.change(fromInput(), { target: { value: '08:00' } });
    await user.click(save());
    expect(await screen.findByText('Pick a time inside this shift.')).toBeInTheDocument();
    expect(mutateCreateEvent).not.toHaveBeenCalled();
  });

  it('NEG a normal appointment (no window) keeps its date picker, "Any time" and fires no shift_item_added', async () => {
    const user = userEvent.setup();
    render(
      <QueryClientProvider client={new QueryClient()}>
        <ToastProvider>
          <MemoryRouter>
            <AddEventModal circleId="c" initialType="appointment" onClose={vi.fn()} />
          </MemoryRouter>
        </ToastProvider>
      </QueryClientProvider>
    );
    expect(screen.getByTestId('starts-tile')).toBeInTheDocument();
    expect(screen.queryByTestId('shift-window-locked-day')).toBeNull();
    expect(screen.getByRole('radio', { name: 'Any time' })).toBeInTheDocument();
    await user.type(titleBox(), 'Checkup');
    await user.click(save());
    await waitFor(() => expect(mutateCreateEvent).toHaveBeenCalledTimes(1));
    expect(Analytics.shiftItemAdded).not.toHaveBeenCalled();
  });
});

describe('window mode: medication', () => {
  it('POS opens the full medication form: locked start day + hint, first dose prefilled at the shift start, no "When needed"', () => {
    setup('medication');
    expect(screen.getByRole('dialog', { name: 'New medication' })).toBeInTheDocument();
    expect(screen.getByTestId('shift-window-locked-day')).toHaveTextContent('Tue, Nov 10 · during Afternoons');
    expect(screen.getByTestId('shift-window-locked-hint')).toHaveTextContent('Locked to shift');
    expect(screen.getByTestId('shift-window-time-hint')).toHaveTextContent('Between 2:00 PM and 8:00 PM');
    expect(screen.getByTestId('time-chip-custom')).toHaveAccessibleName(/^2:00 PM\s*Other$/);
    expect(screen.queryByRole('radio', { name: 'When needed' })).toBeNull();
    // One-time only: no how-often controls and no "Repeats until" tile.
    expect(screen.queryByRole('radio', { name: 'Every day' })).toBeNull();
    expect(screen.queryByTestId('repeats-until-tile')).toBeNull();
  });

  it('NEG the start day cannot be changed: no Starts date control', () => {
    setup('medication');
    expect(screen.queryByTestId('starts-tile')).toBeNull();
    expect(screen.queryByLabelText(/^Starts/)).toBeNull();
    expect(document.getElementById('scheduled_date')).toBeNull();
  });

  it('POS in-window save: one normal create at the first dose on the shift day, shift_item_added once', async () => {
    const { user } = setup('medication');
    await user.type(medName(), 'Metformin');
    await user.click(save());
    await waitFor(() => expect(mutateCreateEvent).toHaveBeenCalledTimes(1));
    expect(posted()).toMatchObject({
      event_type: 'medication',
      title: 'Metformin',
      scheduled_date: '2026-11-10',
      scheduled_time: '14:00',
    });
    await waitFor(() => expect(Analytics.shiftItemAdded).toHaveBeenCalledTimes(1));
    expect(Analytics.shiftItemAdded).toHaveBeenCalledWith({ type: 'medication', shiftRepeating: true });
  });

  it('NEG a first dose outside the window (the 8:00 AM Morning chip) is refused inline: no create, no analytics', async () => {
    const { user } = setup('medication');
    await user.type(medName(), 'Metformin');
    // Replace the prefilled first dose with a chip outside the shift.
    await user.click(screen.getByRole('button', { name: 'Remove 2:00 PM dose' }));
    await user.click(screen.getByRole('checkbox', { name: /^8:00 AM\s*Morning$/ }));
    await user.click(save());
    expect(await screen.findByText('Pick a time inside this shift.')).toBeInTheDocument();
    expect(mutateCreateEvent).not.toHaveBeenCalled();
    expect(Analytics.shiftItemAdded).not.toHaveBeenCalled();
  });

  it('overnight: a first dose after midnight starts on shift date + 1', async () => {
    const night = shift({ scheduled_time: '20:00:00', duration_minutes: 600 });
    const { user } = setup('medication', night);
    await user.type(medName(), 'Metformin');
    // Un-pick the prefilled first dose, then name the after-midnight time.
    await user.click(screen.getByRole('button', { name: 'Remove 8:00 PM dose' }));
    fireEvent.change(otherTimeInput(), { target: { value: '02:00' } });
    await user.click(save());
    await waitFor(() => expect(mutateCreateEvent).toHaveBeenCalledTimes(1));
    expect(posted()).toMatchObject({ scheduled_date: '2026-11-11', scheduled_time: '02:00' });
  });

  it('NEG a normal medication form keeps its date picker and "When needed" and fires no shift_item_added', async () => {
    render(
      <QueryClientProvider client={new QueryClient()}>
        <ToastProvider>
          <MemoryRouter>
            <AddEventModal circleId="c" initialType="medication" onClose={vi.fn()} />
          </MemoryRouter>
        </ToastProvider>
      </QueryClientProvider>
    );
    expect(screen.getByTestId('starts-tile')).toBeInTheDocument();
    expect(screen.getByRole('radio', { name: 'When needed' })).toBeInTheDocument();
    expect(Analytics.shiftItemAdded).not.toHaveBeenCalled();
  });
});

const RECURRENCE_KEYS = ['recurrence_rule', 'recurrence_days', 'recurrence_end_date', 'recurrence_cycle'];
const noRecurrence = (body: Record<string, unknown>) => {
  for (const key of RECURRENCE_KEYS) expect(body[key] ?? null, key).toBeNull();
};
const errorOutside = 'Pick a time inside this shift.';
const errorPast = "Pick a time that hasn't passed yet.";
// Tue Nov 10, 4:00 PM in Chicago: the shift (2-8 PM) is under way.
const MID_SHIFT = new Date('2026-11-10T22:00:00Z');

describe('window mode: one-time only (owner decision 2026-11-19)', () => {
  it('POS the appointment saves as ONE-TIME: no recurrence keys, and no repeat controls are rendered', async () => {
    const { user } = setup('appointment');
    expect(screen.queryByRole('radio', { name: 'Every day' })).toBeNull();
    expect(screen.queryByRole('radio', { name: 'Once' })).toBeNull();
    expect(screen.queryByTestId('repeats-until-tile')).toBeNull();
    await user.type(titleBox(), 'Dr visit');
    await user.click(save());
    await waitFor(() => expect(mutateCreateEvent).toHaveBeenCalledTimes(1));
    noRecurrence(posted());
  });

  it('POS a medication with two doses saves as one-time rows on the shift day: no recurrence, no occurrence the day after', async () => {
    const { user } = setup('medication');
    await user.type(medName(), 'Metformin');
    // A second dose inside the window (6:00 PM Evening chip).
    await user.click(screen.getByRole('checkbox', { name: /^6:00 PM/ }));
    await user.click(save());
    await waitFor(() => expect(mutateCreateEvent).toHaveBeenCalledTimes(2));
    for (const [body] of mutateCreateEvent.mock.calls as Array<[Record<string, unknown>]>) {
      noRecurrence(body);
      expect(body.scheduled_date).toBe('2026-11-10');
    }
    expect((mutateCreateEvent.mock.calls.map((c) => (c[0] as { scheduled_time: string }).scheduled_time)).sort()).toEqual(['14:00', '18:00']);
  });

  it('overnight: a dose after midnight is dated the NEXT day, the one before it the shift day, and nothing repeats', async () => {
    const night = shift({ scheduled_time: '20:00:00', duration_minutes: 600 });
    const { user } = setup('medication', night);
    await user.type(medName(), 'Metformin');
    // The prefilled 8:00 PM first dose stays; add a 2:00 AM dose through Other.
    fireEvent.change(otherTimeInput(), { target: { value: '02:00' } });
    await user.click(save());
    await waitFor(() => expect(mutateCreateEvent).toHaveBeenCalledTimes(2));
    const rows = (mutateCreateEvent.mock.calls as Array<[Record<string, unknown>]>).map(([b]) => b);
    expect(rows.map((b) => `${b.scheduled_date}T${b.scheduled_time}`).sort()).toEqual(['2026-11-10T20:00', '2026-11-11T02:00']);
    for (const b of rows) noRecurrence(b);
  });
});

describe('window mode: every dose inside the window', () => {
  it('NEG a SECOND dose outside the window (the 8:00 AM Morning chip) is refused inline: nothing created', async () => {
    const { user } = setup('medication');
    await user.type(medName(), 'Metformin');
    await user.click(screen.getByRole('checkbox', { name: /^8:00 AM\s*Morning$/ }));
    await user.click(save());
    expect(await screen.findByText(errorOutside)).toBeInTheDocument();
    expect(mutateCreateEvent).not.toHaveBeenCalled();
    expect(Analytics.shiftItemAdded).not.toHaveBeenCalled();
  });
});

describe('window mode: no past times (owner decision 2026-11-19)', () => {
  beforeEach(() => {
    vi.setSystemTime(MID_SHIFT);
  });

  it('POS the default time is still ahead (next half hour) and saves', async () => {
    const { user } = setup('appointment');
    expect(fromInput().value).toBe('16:30');
    await user.type(titleBox(), 'Dr visit');
    await user.click(save());
    await waitFor(() => expect(mutateCreateEvent).toHaveBeenCalledTimes(1));
    expect(posted()).toMatchObject({ scheduled_date: '2026-11-10', scheduled_time: '16:30' });
  });

  it('NEG an in-window appointment time that already passed is refused inline with the past message: nothing created', async () => {
    const { user } = setup('appointment');
    await user.type(titleBox(), 'Dr visit');
    fireEvent.change(fromInput(), { target: { value: '15:00' } });
    await user.click(save());
    expect(await screen.findByText(errorPast)).toBeInTheDocument();
    expect(screen.queryByText(errorOutside)).toBeNull();
    expect(mutateCreateEvent).not.toHaveBeenCalled();
    expect(Analytics.shiftItemAdded).not.toHaveBeenCalled();
  });

  it('NEG a medication dose that already passed (extra dose at 3:00 PM) is refused inline: nothing created', async () => {
    const { user } = setup('medication');
    await user.type(medName(), 'Metformin');
    fireEvent.change(otherTimeInput(), { target: { value: '15:00' } });
    await user.click(save());
    expect(await screen.findByText(errorPast)).toBeInTheDocument();
    expect(mutateCreateEvent).not.toHaveBeenCalled();
  });

  it('NEG outside the window takes precedence over past: 9:00 AM says "inside this shift", not "passed"', async () => {
    const { user } = setup('appointment');
    await user.type(titleBox(), 'Dr visit');
    fireEvent.change(fromInput(), { target: { value: '09:00' } });
    await user.click(save());
    expect(await screen.findByText(errorOutside)).toBeInTheDocument();
    expect(screen.queryByText(errorPast)).toBeNull();
    expect(mutateCreateEvent).not.toHaveBeenCalled();
  });
});

describe('window mode: the locked day follows the time (Fable S3) and keeps no draft (Fable S4)', () => {
  it('overnight Tue 10:00 PM - 6:00 AM: a 1:00 AM start makes the tile read Wednesday and the save is on Wednesday', async () => {
    const night = shift({ scheduled_time: '22:00:00', duration_minutes: 480 });
    const { user } = setup('appointment', night);
    expect(screen.getByTestId('shift-window-locked-day')).toHaveTextContent('Tue, Nov 10');
    await user.type(titleBox(), 'Early call');
    fireEvent.change(fromInput(), { target: { value: '01:00' } });
    expect(screen.getByTestId('shift-window-locked-day')).toHaveTextContent('Wed, Nov 11');
    await user.click(save());
    await waitFor(() => expect(mutateCreateEvent).toHaveBeenCalledTimes(1));
    expect(posted()).toMatchObject({ scheduled_date: '2026-11-11', scheduled_time: '01:00' });
  });

  it('NEG a same-day time keeps the tile on the shift day', () => {
    setup('appointment');
    fireEvent.change(fromInput(), { target: { value: '16:00' } });
    expect(screen.getByTestId('shift-window-locked-day')).toHaveTextContent('Tue, Nov 10');
  });

  it('NEG window mode never registers or restores a session draft; a plain form still does', () => {
    setup('appointment');
    expect(draftSpies.register).not.toHaveBeenCalled();
    expect(draftSpies.take).not.toHaveBeenCalled();
    cleanup();
    render(
      <QueryClientProvider client={new QueryClient()}>
        <ToastProvider>
          <MemoryRouter>
            <AddEventModal circleId="c" initialType="appointment" onClose={vi.fn()} />
          </MemoryRouter>
        </ToastProvider>
      </QueryClientProvider>
    );
    expect(draftSpies.register).toHaveBeenCalledWith('calendar:addEvent:c:appointment', expect.any(Function));
  });
});

describe('window mode: shift_item_add_abandoned', () => {
  it('POS closing the appointment editor unsaved reports type, shift_repeating and reason "cancel", once', async () => {
    const { user, onClose } = setup('appointment');
    await user.click(screen.getByRole('button', { name: 'Cancel' }));
    expect(onClose).toHaveBeenCalledTimes(1);
    expect(Analytics.shiftItemAddAbandoned).toHaveBeenCalledTimes(1);
    expect(Analytics.shiftItemAddAbandoned).toHaveBeenCalledWith({ type: 'appointment', shiftRepeating: true, reason: 'cancel' });
  });

  it('POS a medication closed with a refused (outside) time still on screen reports "refused_time"; a one-off shift reports shift_repeating false', async () => {
    const { user } = setup('medication', shift({ recurrence_rule: null, parent_event_id: null as never }));
    await user.type(medName(), 'Metformin');
    await user.click(screen.getByRole('button', { name: 'Remove 2:00 PM dose' }));
    await user.click(screen.getByRole('checkbox', { name: /^8:00 AM\s*Morning$/ }));
    await user.click(save());
    expect(await screen.findByText('Pick a time inside this shift.')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Cancel' }));
    expect(Analytics.shiftItemAddAbandoned).toHaveBeenCalledTimes(1);
    expect(Analytics.shiftItemAddAbandoned).toHaveBeenCalledWith({ type: 'medication', shiftRepeating: false, reason: 'refused_time' });
  });

  it('NEG a refusal that was then fixed is not a refused_time close', async () => {
    const { user } = setup('appointment');
    await user.type(titleBox(), 'Dr visit');
    fireEvent.change(fromInput(), { target: { value: '09:00' } });
    await user.click(save());
    expect(await screen.findByText('Pick a time inside this shift.')).toBeInTheDocument();
    fireEvent.change(fromInput(), { target: { value: '16:00' } });
    await user.click(screen.getByRole('button', { name: 'Cancel' }));
    expect(Analytics.shiftItemAddAbandoned).toHaveBeenCalledWith(expect.objectContaining({ reason: 'cancel' }));
  });

  it('NEG never after a successful save', async () => {
    const { user } = setup('appointment');
    await user.type(titleBox(), 'Dr visit');
    await user.click(save());
    await waitFor(() => expect(Analytics.shiftItemAdded).toHaveBeenCalledTimes(1));
    expect(Analytics.shiftItemAddAbandoned).not.toHaveBeenCalled();
  });

  it('NEG a plain (non-window) form closed unsaved reports no shift abandon', async () => {
    const user = userEvent.setup();
    render(
      <QueryClientProvider client={new QueryClient()}>
        <ToastProvider>
          <MemoryRouter>
            <AddEventModal circleId="c" initialType="appointment" onClose={vi.fn()} />
          </MemoryRouter>
        </ToastProvider>
      </QueryClientProvider>
    );
    await user.click(screen.getByRole('button', { name: 'Cancel' }));
    expect(Analytics.shiftItemAddAbandoned).not.toHaveBeenCalled();
  });
});
