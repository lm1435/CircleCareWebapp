import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router-dom';
import '@/i18n';
import { getSeriesRoot, type CalendarEvent } from '@/api/calendarEvents';
import type { CircleMember } from '@/api/circleMembers';
import { createShift, updateShift } from '@/api/shifts';
import { ToastProvider } from '@/components/ui';
import { Analytics } from '@/lib/analytics';
import { useCircle } from '@/hooks/useCircle';
import { useAuthStore } from '@/store/authStore';
import { ShiftComposer } from '../ShiftComposer';
import { ShiftFormModal } from '../ShiftFormModal';

vi.mock('@/api/shifts', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/api/shifts')>()),
  createShift: vi.fn(),
  updateShift: vi.fn(),
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
  },
}));
vi.spyOn(Intl.DateTimeFormat.prototype, 'resolvedOptions').mockReturnValue({
  timeZone: 'America/Chicago',
} as Intl.ResolvedDateTimeFormatOptions);

const mockCreate = vi.mocked(createShift);
const mockUpdate = vi.mocked(updateShift);

const members = [
  { id: 'u-me', first_name: 'Pat', last_name: 'L', email: 'pat@x.test', role: 'owner', is_care_recipient: false },
  { id: 'u-ana', first_name: 'Ana', last_name: 'R', email: 'ana@x.test', role: 'member', is_care_recipient: false },
  { id: 'u-vo', first_name: 'Vee', last_name: 'O', email: 'vee@x.test', role: 'member', is_care_recipient: false, view_only: true },
  { id: 'u-rosa', first_name: 'Rosa', last_name: 'G', email: 'rosa@x.test', role: 'member', is_care_recipient: true },
] as unknown as CircleMember[];

function circle(over: Record<string, unknown> = {}): void {
  vi.mocked(useCircle).mockReturnValue({
    circle: { id: 'c', recipient_name: 'Rosa', owner_id: 'u-me' },
    timezone: 'America/Chicago',
    members,
    canEdit: true,
    canManageMembers: true,
    viewerRole: 'owner',
    ...over,
  } as unknown as ReturnType<typeof useCircle>);
}

function shell(ui: React.ReactElement) {
  return render(
    <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
      <ToastProvider>
        <MemoryRouter>{ui}</MemoryRouter>
      </ToastProvider>
    </QueryClientProvider>
  );
}

function created(over: Partial<CalendarEvent> = {}): CalendarEvent {
  return {
    id: 'new-1',
    circle_id: 'c',
    event_type: 'shift',
    title: 'Morning',
    scheduled_date: '2026-10-20',
    scheduled_time: '08:00:00',
    duration_minutes: 360,
    recurrence_rule: 'daily',
    reminder_lead_minutes: 60,
    assigned_to: null,
    created_at: '',
    updated_at: '',
    ...over,
  };
}

const field = (id: string): HTMLInputElement => {
  const el = document.getElementById(id);
  if (!el) throw new Error(`#${id} is not on screen`);
  return el as HTMLInputElement;
};

const nameField = () => field('shift_name');

const setDate = (value: string) => fireEvent.change(field('shift_date'), { target: { value } });

/** The Starts / Ends tiles reveal their time input in place; open it if it is folded, then type. */
const setTime = (which: 'start' | 'end', value: string) => {
  const id = which === 'start' ? 'shift_start' : 'shift_end';
  if (!document.getElementById(id)) fireEvent.click(screen.getByTestId(`shift-${which}-tile`));
  fireEvent.change(field(id), { target: { value } });
};

const chooseRepeat = async (user: ReturnType<typeof userEvent.setup>, label: string) =>
  user.click(
    within(screen.getByRole('radiogroup', { name: 'How often?' })).getByRole('radio', { name: label })
  );

const openMore = async (user: ReturnType<typeof userEvent.setup>) => {
  const toggle = screen.getByRole('button', { name: /^More details/ });
  if (toggle.getAttribute('aria-expanded') !== 'true') await user.click(toggle);
};

const chooseReminder = async (user: ReturnType<typeof userEvent.setup>, label: string) => {
  await openMore(user);
  await user.click(
    within(screen.getByRole('radiogroup', { name: 'Reminder' })).getByRole('radio', { name: label })
  );
};

beforeEach(() => {
  vi.clearAllMocks();
  useAuthStore.setState({
    user: { id: 'u-me', email: 'pat@x.test', first_name: 'Pat', last_name: 'L' },
    isAuthenticated: true,
  } as never);
  circle();
  mockCreate.mockResolvedValue(created());
  mockUpdate.mockResolvedValue(created());
  vi.mocked(getSeriesRoot).mockRejectedValue(new Error('no root'));
});

describe('ShiftFormModal (create)', () => {
  it('shows the heading, the overnight "next day" label and the derived duration', async () => {
    shell(<ShiftFormModal circleId="c" initialDate="2026-10-20" onClose={vi.fn()} />);
    expect(screen.getByRole('radiogroup', { name: "Who's with Rosa?" })).toBeInTheDocument();
    expect(screen.getByText('Sent to whoever is on the shift.')).toBeInTheDocument();
    setTime('start', '20:00');
    setTime('end', '08:00');
    expect(screen.getByTestId('shift-end-tile')).toHaveTextContent('8:00 AM next day');
    expect(screen.getByTestId('shift-form-duration')).toHaveTextContent('12 hours');
    setTime('end', '23:30');
    expect(screen.getByTestId('shift-end-tile')).not.toHaveTextContent('next day');
    expect(screen.getByTestId('shift-form-duration')).toHaveTextContent('3 h 30 min');
  });

  it('validates the name, the times and the 15 min floor', async () => {
    const user = userEvent.setup();
    shell(<ShiftFormModal circleId="c" initialDate="2026-10-20" onClose={vi.fn()} />);
    await user.click(screen.getByRole('button', { name: 'Save shift' }));
    expect(await screen.findByText('Give the shift a name.')).toBeInTheDocument();
    expect(mockCreate).not.toHaveBeenCalled();

    // Defaults are 08:00 - 14:00; clearing them asks again.
    setTime('start', '');
    setTime('end', '');
    await user.click(screen.getByRole('button', { name: 'Save shift' }));
    expect(await screen.findByText('Choose when the shift starts.')).toBeInTheDocument();
    expect(screen.getByText('Choose when the shift ends.')).toBeInTheDocument();

    await user.type(nameField(), 'Short');
    setTime('start', '08:00');
    setTime('end', '08:10');
    await user.click(screen.getByRole('button', { name: 'Save shift' }));
    expect(await screen.findByText('A shift lasts from 15 minutes to 24 hours.')).toBeInTheDocument();
    expect(mockCreate).not.toHaveBeenCalled();
  });

  it('an owner may put someone else on it (view-only members and the care recipient are not offered)', () => {
    shell(<ShiftFormModal circleId="c" initialDate="2026-10-20" onClose={vi.fn()} />);
    const group = screen.getByRole('radiogroup', { name: "Who's with Rosa?" });
    expect(within(group).getAllByRole('radio').map((r) => r.textContent)).toEqual([
      'Leave open',
      'Me',
      'Ana',
    ]);
    expect(within(group).queryByRole('radio', { name: /Rosa/ })).not.toBeInTheDocument();
    expect(within(group).getByRole('radio', { name: 'Leave open' })).toBeChecked();
  });

  it('a plain member only gets "Leave open" or "Me"', () => {
    circle({ canManageMembers: false, viewerRole: 'member' });
    shell(<ShiftFormModal circleId="c" initialDate="2026-10-20" onClose={vi.fn()} />);
    const group = screen.getByRole('radiogroup', { name: "Who's with Rosa?" });
    expect(within(group).getAllByRole('radio').map((r) => r.textContent)).toEqual(['Leave open', 'Me']);
  });

  it('a care-recipient viewer is not offered "Me"; a normal member is', () => {
    useAuthStore.setState({
      user: { id: 'u-rosa', email: 'rosa@x.test', first_name: 'Rosa', last_name: 'G' },
      isAuthenticated: true,
    } as never);
    const { unmount } = shell(<ShiftFormModal circleId="c" initialDate="2026-10-20" onClose={vi.fn()} />);
    const group = screen.getByRole('radiogroup', { name: "Who's covering?" });
    expect(within(group).queryByRole('radio', { name: 'Me' })).not.toBeInTheDocument();
    expect(within(group).getByRole('radio', { name: 'Leave open' })).toBeInTheDocument();
    unmount();
    useAuthStore.setState({
      user: { id: 'u-me', email: 'pat@x.test', first_name: 'Pat', last_name: 'L' },
      isAuthenticated: true,
    } as never);
    shell(<ShiftFormModal circleId="c" initialDate="2026-10-20" onClose={vi.fn()} />);
    expect(within(screen.getByRole('radiogroup', { name: "Who's with Rosa?" })).getByRole('radio', { name: 'Me' })).toBeInTheDocument();
  });

  it('saves a daily open shift with the contract payload and fires shift_created (no circle id)', async () => {
    const user = userEvent.setup();
    shell(<ShiftFormModal circleId="c" initialDate="2026-10-20" source="empty_state" onClose={vi.fn()} />);
    await user.type(nameField(), 'Night');
    setTime('start', '20:00');
    setTime('end', '08:00');
    await chooseRepeat(user, 'Every day');
    await user.click(screen.getByRole('button', { name: 'Save shift' }));
    await waitFor(() => expect(mockCreate).toHaveBeenCalled());
    expect(mockCreate).toHaveBeenCalledWith('c', {
      title: 'Night',
      scheduled_date: '2026-10-20',
      scheduled_time: '20:00',
      duration_minutes: 720,
      reminder_lead_minutes: 60,
      assigned_to: null,
      recurrence_rule: 'daily',
    });
    expect(Analytics.shiftCreated).toHaveBeenCalledWith({
      repeats: true,
      recurrence: 'daily',
      assigned: false,
      assignedSelf: false,
      reminder: '1h',
      overnight: true,
      durationMinutes: 720,
      source: 'empty_state',
      layout: 'simple',
    });
  });

  it('chosen days send weekly + recurrence_days; "Me" is assigned_self', async () => {
    const user = userEvent.setup();
    shell(<ShiftFormModal circleId="c" initialDate="2026-10-20" onClose={vi.fn()} />);
    await user.type(nameField(), 'Weekend');
    setTime('start', '09:00');
    setTime('end', '17:00');
    await chooseRepeat(user, 'Some days');
    await user.click(screen.getByRole('radio', { name: 'Me' }));
    await chooseReminder(user, '1 day');
    await user.click(screen.getByRole('button', { name: 'Save shift' }));
    await waitFor(() => expect(mockCreate).toHaveBeenCalled());
    const body = mockCreate.mock.calls[0][1];
    expect(body.recurrence_rule).toBe('weekly');
    expect(body.recurrence_days).toEqual([2]); // 2026-10-20 is a Tuesday
    expect(body.reminder_lead_minutes).toBe(1440);
    expect(body.assigned_to).toBe('u-me');
    expect(Analytics.shiftCreated).toHaveBeenCalledWith(
      expect.objectContaining({ recurrence: 'days', assigned: true, assignedSelf: true, reminder: '1d' })
    );
  });

  it('all 7 days saves weekly + all 7 days (as mobile), not daily', async () => {
    const user = userEvent.setup();
    shell(<ShiftFormModal circleId="c" initialDate="2026-10-20" onClose={vi.fn()} />);
    await user.type(nameField(), 'Every day');
    setTime('start', '09:00');
    setTime('end', '17:00');
    await chooseRepeat(user, 'Some days');
    for (const box of screen.getAllByRole('checkbox')) {
      if (box.getAttribute('aria-checked') !== 'true') await user.click(box);
    }
    await user.click(screen.getByRole('button', { name: 'Save shift' }));
    await waitFor(() => expect(mockCreate).toHaveBeenCalled());
    const body = mockCreate.mock.calls[0][1];
    expect(body.recurrence_rule).toBe('weekly');
    expect(body.recurrence_days).toEqual([0, 1, 2, 3, 4, 5, 6]);
    expect(Analytics.shiftCreated).toHaveBeenCalledWith(expect.objectContaining({ recurrence: 'days' }));
  });

  it('no day chosen blocks save with the shifts copy', async () => {
    const user = userEvent.setup();
    shell(<ShiftFormModal circleId="c" initialDate="2026-10-20" onClose={vi.fn()} />);
    await user.type(nameField(), 'None');
    await chooseRepeat(user, 'Some days');
    await user.click(screen.getByRole('checkbox', { name: 'Tuesday' }));
    await user.click(screen.getByRole('button', { name: 'Save shift' }));
    expect(await screen.findByText('Choose at least one day.')).toBeInTheDocument();
    expect(mockCreate).not.toHaveBeenCalled();
  });
});

describe('ShiftFormModal (defaults, order, hydration)', () => {
  it('a new shift starts at 08:00 - 14:00, and the reminder says who gets it', () => {
    shell(<ShiftFormModal circleId="c" initialDate="2026-10-20" onClose={vi.fn()} />);
    // The tiles name the times; their inputs are folded until a tile is pressed.
    expect(screen.getByTestId('shift-start-tile')).toHaveTextContent('8:00 AM');
    expect(screen.getByTestId('shift-end-tile')).toHaveTextContent('2:00 PM');
    expect(document.getElementById('shift_start')).toBeNull();
    fireEvent.click(screen.getByTestId('shift-start-tile'));
    expect(field('shift_start')).toHaveValue('08:00');
    expect(screen.getByText('Sent to whoever is on the shift.')).toBeInTheDocument();
  });

  it('sections follow the agreed order: name, when, how often, who, then More details', async () => {
    shell(<ShiftFormModal circleId="c" initialDate="2026-10-20" onClose={vi.fn()} />);
    const headings = screen.getAllByRole('heading', { level: 3 }).map((h) => h.textContent);
    expect(headings).toEqual([
      "What's the shift called?",
      'When?',
      'How often?',
      "Who's with Rosa?",
    ]);
    const pos = (el: HTMLElement) => Array.from(document.querySelectorAll('*')).indexOf(el);
    const order = [
      nameField(),
      field('shift_date'),
      screen.getByTestId('shift-start-tile'),
      screen.getByTestId('shift-end-tile'),
      screen.getByTestId('shift-form-duration'),
      screen.getByRole('radiogroup', { name: 'How often?' }),
      screen.getByRole('radiogroup', { name: "Who's with Rosa?" }),
      screen.getByRole('button', { name: /^More details/ }),
    ].map(pos);
    expect([...order].sort((a, b) => a - b)).toEqual(order);
  });

  it('opened before the circle has loaded: nothing renders until zone + members arrive, then the date is the recipient\'s today', () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date('2026-10-20T03:30:00Z')); // Oct 19 22:30 in Chicago
    try {
      vi.mocked(useCircle).mockReturnValue({
        circle: undefined,
        timezone: null,
        members: [],
        canEdit: false,
        canManageMembers: false,
        viewerRole: 'member',
        isError: false,
      } as unknown as ReturnType<typeof useCircle>);
      const view = shell(<ShiftFormModal circleId="c" onClose={vi.fn()} />);
      expect(screen.getByTestId('shift-form-loading')).toBeInTheDocument();
      expect(screen.queryByLabelText(/^What's the shift called/)).not.toBeInTheDocument();
      expect(screen.queryByRole('button', { name: 'Save shift' })).not.toBeInTheDocument();

      circle();
      view.rerender(
        <QueryClientProvider client={new QueryClient()}>
          <ToastProvider>
            <MemoryRouter>
              <ShiftFormModal circleId="c" onClose={vi.fn()} />
            </MemoryRouter>
          </ToastProvider>
        </QueryClientProvider>
      );
      expect(screen.queryByTestId('shift-form-loading')).not.toBeInTheDocument();
      // Never '' and never New York's day: the recipient's (Chicago) today.
      expect(field('shift_date')).toHaveValue('2026-10-19');
    } finally {
      vi.useRealTimers();
    }
  });

  it('Premium lapsed while the form is open: it closes itself and says why (toast), never offers a save that would 402', async () => {
    circle({ isPremiumCircle: false, hasShifts: true, isOwner: true });
    const onClose = vi.fn();
    shell(<ShiftFormModal circleId="c" onClose={onClose} />);
    expect(screen.queryByLabelText(/^What's the shift called/)).not.toBeInTheDocument();
    await waitFor(() => expect(onClose).toHaveBeenCalledTimes(1));
    expect(await screen.findByText('Premium has ended. Your shifts are read-only.')).toBeInTheDocument();
    expect(mockCreate).not.toHaveBeenCalled();
  });

  it('...a non-owner gets the plain wording', async () => {
    circle({ isPremiumCircle: false, hasShifts: true, isOwner: false, viewerRole: 'member' });
    const onClose = vi.fn();
    shell(<ShiftFormModal circleId="c" onClose={onClose} />);
    await waitFor(() => expect(onClose).toHaveBeenCalledTimes(1));
    expect(await screen.findByText('Shifts are read-only right now.')).toBeInTheDocument();
  });

  it('a failed circle read says so instead of becoming a blank form', () => {
    vi.mocked(useCircle).mockReturnValue({
      circle: undefined,
      timezone: null,
      members: [],
      canEdit: false,
      canManageMembers: false,
      viewerRole: 'member',
      isError: true,
    } as unknown as ReturnType<typeof useCircle>);
    shell(<ShiftFormModal circleId="c" onClose={vi.fn()} />);
    expect(screen.getByText("We couldn't load the shifts.")).toBeInTheDocument();
    expect(screen.queryByLabelText(/^What's the shift called/)).not.toBeInTheDocument();
  });

  it('assignee list: Leave open, Me, then roster order; the current holder is marked, even when the editor could not pick them', () => {
    circle({ canManageMembers: false, viewerRole: 'member' });
    shell(
      <ShiftFormModal
        circleId="c"
        shift={created({ id: 'one', recurrence_rule: null, parent_event_id: null, assigned_to: 'u-ana' })}
        onClose={vi.fn()}
      />
    );
    const group = screen.getByRole('radiogroup', { name: "Who's with Rosa?" });
    expect(within(group).getAllByRole('radio').map((r) => r.textContent)).toEqual([
      'Leave open',
      'Me',
      'Anaon it now',
    ]);
    // A holder this editor could not pick is shown, not pickable.
    expect(within(group).getByRole('radio', { name: 'Ana, on it now' })).toBeDisabled();
    expect(within(group).getByRole('radio', { name: 'Ana, on it now' })).toBeChecked();
  });

  it('marks "Me" when the editor holds it', () => {
    shell(
      <ShiftFormModal
        circleId="c"
        shift={created({ id: 'one', recurrence_rule: null, parent_event_id: null, assigned_to: 'u-me' })}
        onClose={vi.fn()}
      />
    );
    const group = screen.getByRole('radiogroup', { name: "Who's with Rosa?" });
    expect(within(group).getAllByRole('radio').map((r) => r.textContent)).toEqual([
      'Leave open',
      'Meon it now',
      'Ana',
    ]);
    expect(within(group).getByRole('radio', { name: 'Me, on it now' })).toBeEnabled();
  });

  it('names the zone when the viewer\'s clock differs at THE SHIFT\'S date, not today\'s', () => {
    // Viewer = Chicago (mocked). Recipient = Mexico City (no DST): same clock in winter, 1 h apart in summer.
    circle({ timezone: 'America/Mexico_City' });
    shell(<ShiftFormModal circleId="c" initialDate="2026-01-15" onClose={vi.fn()} />);
    expect(screen.queryByText(/Times are for/)).not.toBeInTheDocument();
    setDate('2026-07-15');
    expect(screen.getByTestId('shift-form-duration')).toHaveTextContent(/Times are for/);
  });
});

describe('ShiftComposer: saved sheet and "Add the next shift"', () => {
  it('after save shows the summary, and Add next re-opens the form pre-filled (start = previous end, same date, repeat + reminder; name and end empty)', async () => {
    const user = userEvent.setup();
    shell(<ShiftComposer circleId="c" initialDate="2026-10-20" source="shifts_view" onClose={vi.fn()} />);
    await user.type(nameField(), 'Morning');
    setTime('start', '08:00');
    setTime('end', '14:00');
    await chooseRepeat(user, 'Every day');
    await chooseReminder(user, '2 hours');
    await user.click(screen.getByRole('button', { name: 'Save shift' }));

    expect(await screen.findByRole('heading', { name: '"Morning" saved' })).toBeInTheDocument();
    expect(
      screen.getByText('8:00 AM – 2:00 PM, every day. Open for anyone to take.')
    ).toBeInTheDocument();
    const addNext = screen.getByRole('button', { name: /Add the next shift/ });
    expect(addNext).toHaveTextContent('Starts at 2:00 PM · every day');

    await user.click(addNext);
    expect(Analytics.shiftAddNextTapped).toHaveBeenCalled();
    expect(await screen.findByTestId('shift-start-tile')).toHaveTextContent('2:00 PM');
    expect(nameField()).toHaveValue('');
    expect(screen.getByTestId('shift-end-tile')).toHaveTextContent('Choose a time');
    expect(field('shift_date')).toHaveValue('2026-10-20');
    expect(screen.getByRole('radio', { name: 'Every day' })).toBeChecked();
    await openMore(user);
    expect(screen.getByRole('radio', { name: '2 hours' })).toBeChecked();

    // The second save is attributed to add_next.
    await user.type(nameField(), 'Afternoon');
    setTime('end', '20:00');
    await user.click(screen.getByRole('button', { name: 'Save shift' }));
    await waitFor(() => expect(Analytics.shiftCreated).toHaveBeenCalledTimes(2));
    expect(vi.mocked(Analytics.shiftCreated).mock.calls[1][0]).toEqual(
      expect.objectContaining({ source: 'add_next' })
    );
  });

  it('a shift you took reads "You\'re on it." (never "You is on it"), and the zone is never guessed', async () => {
    const user = userEvent.setup();
    mockCreate.mockResolvedValue(created({ recurrence_rule: null, assigned_to: 'u-me' }));
    shell(<ShiftComposer circleId="c" initialDate="2026-10-20" source="add_menu" onClose={vi.fn()} />);
    await user.type(nameField(), 'Morning');
    await user.click(screen.getByRole('button', { name: 'Save shift' }));
    expect(await screen.findByText("8:00 AM – 2:00 PM · You're on it.")).toBeInTheDocument();
  });

  it('Done closes', async () => {
    const user = userEvent.setup();
    const onClose = vi.fn();
    mockCreate.mockResolvedValue(created({ recurrence_rule: null }));
    shell(<ShiftComposer circleId="c" initialDate="2026-10-20" source="add_menu" onClose={onClose} />);
    await user.type(nameField(), 'Morning');
    setTime('start', '08:00');
    setTime('end', '14:00');
    await user.click(screen.getByRole('button', { name: 'Save shift' }));
    expect(await screen.findByText('8:00 AM – 2:00 PM · Open for anyone to take.')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Done' }));
    expect(onClose).toHaveBeenCalled();
  });
});

describe('ShiftFormModal (edit)', () => {
  const occurrence = created({
    id: 'root_2026-10-21',
    parent_event_id: 'root',
    scheduled_date: '2026-10-21',
    title: 'Night',
    scheduled_time: '20:00:00',
    duration_minutes: 720,
    assigned_to: 'u-ana',
  });

  it('a repeating shift asks "This shift / All upcoming shifts"; this shift PATCHes the occurrence id', async () => {
    const user = userEvent.setup();
    shell(<ShiftFormModal circleId="c" shift={occurrence} onClose={vi.fn()} />);
    expect(screen.getByRole('radio', { name: 'This shift' })).toBeChecked();
    // "This shift": the date is a field (it moves this occurrence), the repeat is not offered.
    expect(field('shift_date')).toHaveValue('2026-10-21');
    expect(screen.queryByRole('radiogroup', { name: 'How often?' })).not.toBeInTheDocument();
    setTime('start', '21:00');
    await user.click(screen.getByRole('button', { name: 'Save changes' }));
    await waitFor(() => expect(mockUpdate).toHaveBeenCalled());
    expect(mockUpdate.mock.calls[0][1]).toBe('root_2026-10-21');
    expect(mockUpdate.mock.calls[0][2]).toEqual(
      expect.objectContaining({ scheduled_time: '21:00', duration_minutes: 660 })
    );
    expect(mockUpdate.mock.calls[0][2]).not.toHaveProperty('assigned_to');
    expect(mockUpdate.mock.calls[0][2]).not.toHaveProperty('scheduled_date');
    expect(Analytics.shiftEdited).toHaveBeenCalledWith({ timeChanged: true, scope: 'occurrence', layout: 'simple' });
  });

  it('this and future PATCHes the series root', async () => {
    const user = userEvent.setup();
    shell(<ShiftFormModal circleId="c" shift={occurrence} onClose={vi.fn()} />);
    await user.click(screen.getByRole('radio', { name: 'All upcoming shifts' }));
    await user.click(screen.getByRole('button', { name: 'Save changes' }));
    await waitFor(() => expect(mockUpdate).toHaveBeenCalled());
    expect(mockUpdate.mock.calls[0][1]).toBe('root');
    expect(Analytics.shiftEdited).toHaveBeenCalledWith({ timeChanged: false, scope: 'future', layout: 'simple' });
  });

  it('a one-off has no scope question and keeps its date editable', async () => {
    shell(
      <ShiftFormModal
        circleId="c"
        shift={created({ id: 'one', recurrence_rule: null, parent_event_id: null })}
        onClose={vi.fn()}
      />
    );
    expect(screen.queryByRole('radio', { name: 'This shift' })).not.toBeInTheDocument();
    expect(field('shift_date')).toHaveValue('2026-10-20');
  });
});
