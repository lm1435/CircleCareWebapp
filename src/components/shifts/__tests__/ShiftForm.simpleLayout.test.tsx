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

// The simple shift form (owner 1.4.0, mobile parity): sections "What's the shift called?" / "When?" /
// "How often?" / "Who's with <name>?", tiles for the choices, a folded "More details" (reminder, repeat end),
// one primary button. The request bodies are pinned by ShiftForm.payloadEquality.test.tsx.

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

function shift(over: Partial<CalendarEvent> = {}): CalendarEvent {
  return {
    id: 'one',
    circle_id: 'c',
    event_type: 'shift',
    title: 'Night',
    scheduled_date: '2027-03-09',
    scheduled_time: '22:00:00',
    duration_minutes: 480,
    recurrence_rule: null,
    parent_event_id: null,
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
const startTile = () => screen.getByTestId('shift-start-tile');
const endTile = () => screen.getByTestId('shift-end-tile');
const setTime = (which: 'start' | 'end', value: string) => {
  const id = `shift_${which}`;
  if (!document.getElementById(id)) fireEvent.click(screen.getByTestId(`shift-${which}-tile`));
  fireEvent.change(field(id), { target: { value } });
};
const group = (name: string) => screen.getByRole('radiogroup', { name });
const radio = (groupName: string, name: string | RegExp) =>
  within(group(groupName)).getByRole('radio', { name });
const moreToggle = () => screen.getByRole('button', { name: /^More details/ });
const summary = () => screen.getByTestId('shift-form-more-summary').textContent;
const open = (props: Partial<React.ComponentProps<typeof ShiftFormModal>> = {}) =>
  shell(<ShiftFormModal circleId="c" initialDate="2027-03-09" onClose={vi.fn()} {...props} />);

beforeEach(() => {
  vi.clearAllMocks();
  useAuthStore.setState({
    user: { id: 'u-me', email: 'pat@x.test', first_name: 'Pat', last_name: 'L' },
    isAuthenticated: true,
  } as never);
  circle();
  mockCreate.mockResolvedValue(shift({ id: 'new-1', recurrence_rule: 'daily' }));
  mockUpdate.mockResolvedValue(shift());
  // A row that is not itself the root hydrates its repeat from the root; by default there is none to read.
  vi.mocked(getSeriesRoot).mockRejectedValue(new Error('no root'));
});

describe('simple shift form: header, sections, button', () => {
  it('titles the dialog "New shift" with no eyebrow, and the primary button "Save shift"', () => {
    open();
    expect(screen.getByRole('dialog', { name: 'New shift' })).toBeInTheDocument();
    expect(screen.queryByText(/^[•·]?\s*NEW$/i)).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Save shift' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Save changes' })).not.toBeInTheDocument();
  });

  it('an edit is titled "Edit shift" and saves with "Save changes"', () => {
    open({ shift: shift() });
    expect(screen.getByRole('dialog', { name: 'Edit shift' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Save changes' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Save shift' })).not.toBeInTheDocument();
  });

  it('has four headed sections in order, each named by its heading', () => {
    open();
    const headings = screen.getAllByRole('heading', { level: 3 });
    expect(headings.map((h) => h.textContent)).toEqual([
      "What's the shift called?",
      'When?',
      'How often?',
      "Who's with Rosa?",
    ]);
    for (const h of headings) {
      expect(h.closest('section')).toHaveAccessibleName(h.textContent as string);
    }
    // The old flat labels are gone.
    expect(screen.queryByLabelText('Repeats')).not.toBeInTheDocument();
    expect(screen.queryByLabelText('Name')).not.toBeInTheDocument();
  });

  it('the name field is the answer to the question (id and error kept)', async () => {
    const user = userEvent.setup();
    open();
    const input = screen.getByRole('textbox', { name: /^What's the shift called\?/ });
    expect(input).toBe(field('shift_name'));
    await user.click(screen.getByRole('button', { name: 'Save shift' }));
    expect(await screen.findByText('Give the shift a name.')).toBeInTheDocument();
    expect(input).toHaveAttribute('aria-invalid', 'true');
    await waitFor(() => expect(input).toHaveFocus());
    await user.type(input, 'x'.repeat(61));
    await user.click(screen.getByRole('button', { name: 'Save shift' }));
    expect(await screen.findByText('Keep the name to 60 characters or fewer.')).toBeInTheDocument();
    expect(mockCreate).not.toHaveBeenCalled();
  });
});

describe('simple shift form: When?', () => {
  it('has the date field, then Starts / Ends tiles that name their times, collapsed', () => {
    open();
    expect(field('shift_date')).toHaveValue('2027-03-09');
    expect(startTile()).toHaveAccessibleName('Starts, 8:00 AM');
    expect(endTile()).toHaveAccessibleName('Ends, 2:00 PM');
    for (const tile of [startTile(), endTile()]) {
      expect(tile.tagName).toBe('BUTTON');
      expect(tile).toHaveAttribute('aria-expanded', 'false');
    }
    expect(document.getElementById('shift_start')).toBeNull();
    expect(document.getElementById('shift_end')).toBeNull();
  });

  it('a tile reveals and focuses its time input, and folds it again', async () => {
    const user = userEvent.setup();
    open();
    await user.click(endTile());
    expect(endTile()).toHaveAttribute('aria-expanded', 'true');
    expect(field('shift_end')).toHaveValue('14:00');
    await waitFor(() => expect(field('shift_end')).toHaveFocus());
    expect(document.getElementById('shift_start')).toBeNull();
    await user.click(startTile());
    expect(field('shift_start')).toHaveValue('08:00');
    await user.click(endTile());
    expect(endTile()).toHaveAttribute('aria-expanded', 'false');
    expect(document.getElementById('shift_end')).toBeNull();
  });

  it('Ends says "next day" when it crosses midnight, and the tile follows the input', () => {
    open();
    setTime('start', '22:00');
    setTime('end', '06:00');
    expect(endTile()).toHaveAccessibleName('Ends, 6:00 AM next day');
    expect(startTile()).toHaveAccessibleName('Starts, 10:00 PM');
    setTime('end', '23:00');
    expect(endTile()).toHaveAccessibleName('Ends, 11:00 PM');
  });

  it('without an end the tile says "Choose a time"; saving flags it, shows the error, opens and focuses the input', async () => {
    const user = userEvent.setup();
    open();
    setTime('end', '');
    fireEvent.click(endTile()); // fold it again
    expect(endTile()).toHaveAccessibleName('Ends, Choose a time');
    await user.type(field('shift_name'), 'Night');
    await user.click(screen.getByRole('button', { name: 'Save shift' }));
    expect(await screen.findByText('Choose when the shift ends.')).toBeInTheDocument();
    expect(endTile()).toHaveAttribute('aria-invalid', 'true');
    expect(endTile()).toHaveAttribute('aria-expanded', 'true');
    await waitFor(() => expect(field('shift_end')).toHaveFocus());
    expect(mockCreate).not.toHaveBeenCalled();
    // Choosing a time clears the error and the flag.
    setTime('end', '12:00');
    expect(screen.queryByText('Choose when the shift ends.')).not.toBeInTheDocument();
    expect(endTile()).not.toHaveAttribute('aria-invalid');
  });

  it('a start that is missing is flagged on the Starts tile', async () => {
    const user = userEvent.setup();
    open();
    setTime('start', '');
    await user.type(field('shift_name'), 'Night');
    await user.click(screen.getByRole('button', { name: 'Save shift' }));
    expect(await screen.findByText('Choose when the shift starts.')).toBeInTheDocument();
    expect(startTile()).toHaveAttribute('aria-invalid', 'true');
  });

  it('under 15 minutes is refused on the Ends tile', async () => {
    const user = userEvent.setup();
    open();
    await user.type(field('shift_name'), 'Short');
    setTime('start', '08:00');
    setTime('end', '08:10');
    expect(screen.getByTestId('shift-form-duration')).toHaveTextContent('');
    await user.click(screen.getByRole('button', { name: 'Save shift' }));
    expect(await screen.findByText('A shift lasts from 15 minutes to 24 hours.')).toBeInTheDocument();
    expect(endTile()).toHaveAttribute('aria-invalid', 'true');
  });

  it('the caption is the duration only while valid; the zone only when the clocks differ; joined with " · "', () => {
    // Viewer = Chicago (mocked). Recipient = Mexico City: same clock in January, one hour apart in July.
    circle({ timezone: 'America/Mexico_City' });
    open({ initialDate: '2027-01-15' });
    const caption = screen.getByTestId('shift-form-duration');
    expect(caption).toHaveTextContent(/^6 hours$/);
    setTime('start', '08:00');
    setTime('end', '08:05'); // invalid: no duration
    fireEvent.change(field('shift_date'), { target: { value: '2027-07-15' } });
    expect(caption.textContent).toBe('Times are for Mexico City.');
    setTime('end', '14:00');
    expect(caption.textContent).toBe('6 hours · Times are for Mexico City.');
    fireEvent.change(field('shift_date'), { target: { value: '2027-01-15' } });
    expect(caption.textContent).toBe('6 hours');
  });

  it('the caption is announced politely and describes the tiles', () => {
    open();
    const caption = screen.getByTestId('shift-form-duration');
    expect(caption).toHaveAttribute('aria-live', 'polite');
    expect(startTile()).toHaveAccessibleDescription('6 hours');
    expect(endTile()).toHaveAccessibleDescription('6 hours');
  });

  it('a repeating shift edit keeps its date editable ("This shift" moves that occurrence)', () => {
    open({
      shift: shift({ id: 'root_2027-03-10', parent_event_id: 'root', recurrence_rule: 'daily', scheduled_date: '2027-03-10' }),
    });
    expect(field('shift_date')).toHaveValue('2027-03-10');
    expect(screen.getByText('Date')).toBeInTheDocument();
    expect(screen.queryByTestId('shift-form-date-locked')).not.toBeInTheDocument();
  });

  it('a one-off edit keeps an editable date', () => {
    open({ shift: shift() });
    expect(field('shift_date')).toHaveValue('2027-03-09');
    expect(screen.queryByTestId('shift-form-date-locked')).not.toBeInTheDocument();
  });
});

describe('simple shift form: How often?', () => {
  it('offers the medication options in order as tiles, Once checked', () => {
    open();
    const radios = within(group('How often?')).getAllByRole('radio');
    expect(radios.map((r) => r.textContent)).toEqual([
      'Once',
      'Every day',
      'Every other day',
      'Every week',
      'Monthly',
      'Yearly',
      'Days on / off',
      'Some days',
    ]);
    expect(radio('How often?', 'Once')).toBeChecked();
    for (const r of radios) expect(r).toBeEnabled();
  });

  it('Some days shows the days picker inline, with the date\'s weekday ticked', async () => {
    const user = userEvent.setup();
    open();
    expect(screen.queryByRole('checkbox', { name: 'Tuesday' })).not.toBeInTheDocument();
    await user.click(radio('How often?', 'Some days'));
    expect(radio('How often?', 'Some days')).toBeChecked();
    expect(screen.getByRole('checkbox', { name: 'Tuesday' })).toHaveAttribute('aria-checked', 'true');
    expect(screen.getByRole('checkbox', { name: 'Monday' })).toHaveAttribute('aria-checked', 'false');
    await user.click(radio('How often?', 'Every week'));
    expect(screen.queryByRole('checkbox', { name: 'Tuesday' })).not.toBeInTheDocument();
  });

  it('no day left ticked is refused, naming the days picker', async () => {
    const user = userEvent.setup();
    open();
    await user.type(field('shift_name'), 'None');
    await user.click(radio('How often?', 'Some days'));
    await user.click(screen.getByRole('checkbox', { name: 'Tuesday' }));
    await user.click(screen.getByRole('button', { name: 'Save shift' }));
    expect(await screen.findByText('Choose at least one day.')).toBeInTheDocument();
    expect(mockCreate).not.toHaveBeenCalled();
  });

  it('a one-off edit shows Once, locked', () => {
    open({ shift: shift() });
    expect(radio('How often?', 'Once')).toBeChecked();
    for (const r of within(group('How often?')).getAllByRole('radio')) expect(r).toBeDisabled();
  });

  it.each([
    ['a daily series', { recurrence_rule: 'daily' }, 'Every day'],
    ['an every-other-day series', { recurrence_rule: 'every_other_day' }, 'Every other day'],
    ['a weekly series', { recurrence_rule: 'weekly' }, 'Every week'],
    ['a monthly series', { recurrence_rule: 'monthly' }, 'Monthly'],
    ['a yearly series', { recurrence_rule: 'yearly' }, 'Yearly'],
    ['a rotation', { recurrence_rule: 'cycle:14:7' }, 'Days on / off'],
    ['a days-of-week series', { recurrence_rule: 'weekly', recurrence_days: [1, 4] }, 'Some days'],
  ] as const)('an edit of %s: the tiles are hidden for "This shift", enabled and preselected for "All upcoming shifts"', async (_label, over, checked) => {
    const user = userEvent.setup();
    open({ shift: shift(over as Partial<CalendarEvent>) });
    expect(screen.queryByRole('radiogroup', { name: 'How often?' })).not.toBeInTheDocument();
    await user.click(screen.getByRole('radio', { name: 'All upcoming shifts' }));
    expect(radio('How often?', checked)).toBeChecked();
    for (const r of within(group('How often?')).getAllByRole('radio')) expect(r).toBeEnabled();
  });

  it('the old "can\'t be changed here" note is gone; "All upcoming shifts" says what stays', async () => {
    const user = userEvent.setup();
    open({ shift: shift({ recurrence_rule: 'daily' }) });
    expect(screen.queryByTestId('shift-form-series-note')).not.toBeInTheDocument();
    expect(screen.queryByText(/can't be changed here/)).not.toBeInTheDocument();
    await user.click(screen.getByRole('radio', { name: 'All upcoming shifts' }));
    expect(screen.getByTestId('shift-form-from-note')).toHaveTextContent(
      'Shifts before Mar 9, 2027 stay as they are, including who covered them. The new schedule starts on Mar 9, 2027.'
    );
  });

  it('an occurrence whose rule this row does not hold selects nothing until the root says', async () => {
    const user = userEvent.setup();
    open({ shift: shift({ id: 'root_2027-03-10', parent_event_id: 'root', recurrence_rule: null }) });
    await user.click(screen.getByRole('radio', { name: 'All upcoming shifts' }));
    for (const r of within(group('How often?')).getAllByRole('radio')) expect(r).not.toBeChecked();
  });
});

describe("simple shift form: Who's with Rosa?", () => {
  it('lists Leave open, Me, then the members; the care recipient and view-only members are never offered', () => {
    open();
    expect(within(group("Who's with Rosa?")).getAllByRole('radio').map((r) => r.textContent)).toEqual([
      'Leave open',
      'Me',
      'Ana',
    ]);
    expect(radio("Who's with Rosa?", 'Leave open')).toBeChecked();
    expect(screen.getByText('Open shifts can be taken by anyone in the circle.')).toBeInTheDocument();
  });

  it('the care recipient viewer is not offered "Me"', () => {
    useAuthStore.setState({
      user: { id: 'u-rosa', email: 'rosa@x.test', first_name: 'Rosa', last_name: 'G' },
      isAuthenticated: true,
    } as never);
    open();
    expect(within(group("Who's with Rosa?")).queryByRole('radio', { name: 'Me' })).not.toBeInTheDocument();
  });

  it('a care-recipient holder (should never happen) is shown as someone, disabled', () => {
    open({ shift: shift({ assigned_to: 'u-rosa' }) });
    const r = within(group("Who's with Rosa?")).getByRole('radio', { name: 'Someone, on it now' });
    expect(r).toBeDisabled();
    expect(r).toBeChecked();
  });

  it('a holder a plain member could not pick is shown disabled with "on it now"; Me and Leave open stay pickable', async () => {
    const user = userEvent.setup();
    circle({ canManageMembers: false, viewerRole: 'member' });
    open({ shift: shift({ assigned_to: 'u-ana' }) });
    const ana = radio("Who's with Rosa?", 'Ana, on it now');
    expect(ana).toBeDisabled();
    expect(ana).toBeChecked();
    await user.click(radio("Who's with Rosa?", 'Leave open'));
    expect(radio("Who's with Rosa?", 'Leave open')).toBeChecked();
    expect(ana).not.toBeChecked();
  });

  it('a manager can pick the holder (enabled); a pick of a disabled tile does nothing', async () => {
    const user = userEvent.setup();
    open({ shift: shift({ assigned_to: 'u-ana' }) });
    expect(radio("Who's with Rosa?", 'Ana, on it now')).toBeEnabled();
    expect(radio("Who's with Rosa?", 'Ana, on it now')).toBeChecked();
    await user.click(radio("Who's with Rosa?", 'Me'));
    expect(radio("Who's with Rosa?", 'Me')).toBeChecked();
  });

  it('edit prefill: open, me, another member', () => {
    for (const [assigned, checked] of [
      [null, 'Leave open'],
      ['u-me', 'Me, on it now'],
      ['u-ana', 'Ana, on it now'],
    ] as const) {
      const { unmount } = open({ shift: shift({ assigned_to: assigned }) });
      expect(radio("Who's with Rosa?", checked)).toBeChecked();
      unmount();
    }
  });
});

describe('simple shift form: More details', () => {
  it('is collapsed by default and says so', () => {
    open();
    expect(moreToggle()).toHaveAttribute('aria-expanded', 'false');
    expect(screen.getByTestId('shift-form-more-summary')).toBeInTheDocument();
    expect(screen.queryByRole('radiogroup', { name: 'Reminder' })).not.toBeInTheDocument(); // folded away
  });

  it('summarises the reminder, and adds the repeat end only when it repeats', async () => {
    const user = userEvent.setup();
    open();
    expect(summary()).toBe('Reminder: 1 hour before');
    await user.click(radio('How often?', 'Every day'));
    expect(summary()).toBe('Reminder: 1 hour before · Repeat ends: never');
    await user.click(radio('How often?', 'Once'));
    expect(summary()).toBe('Reminder: 1 hour before');
  });

  it('follows the reminder (off, 2 hours, 4 hours, 1 day) and the repeat end date', async () => {
    const user = userEvent.setup();
    open();
    await user.click(radio('How often?', 'Every week'));
    await user.click(moreToggle());
    expect(moreToggle()).toHaveAttribute('aria-expanded', 'true');
    await user.click(radio('Reminder', 'Off'));
    await user.click(moreToggle());
    expect(summary()).toBe('Reminder: off · Repeat ends: never');
    await user.click(moreToggle());
    await user.click(radio('Reminder', '4 hours'));
    fireEvent.change(field('shift_repeat_end'), { target: { value: '2027-06-30' } });
    await user.click(moreToggle());
    expect(summary()).toBe('Reminder: 4 hours before · Repeat ends: Jun 30, 2027');
    await user.click(moreToggle());
    await user.click(radio('Reminder', '1 day'));
    await user.click(radio('Reminder', '2 hours'));
    await user.click(moreToggle());
    expect(summary()).toContain('Reminder: 2 hours before');
  });

  it('inside: the reminder tiles (Off ... 1 day), the hint, and the repeat end with a clear button', async () => {
    const user = userEvent.setup();
    open();
    await user.click(moreToggle());
    expect(within(group('Reminder')).getAllByRole('radio').map((r) => r.textContent)).toEqual([
      'Off',
      '1 hour',
      '2 hours',
      '4 hours',
      '1 day',
    ]);
    expect(radio('Reminder', '1 hour')).toBeChecked();
    expect(screen.getByText('Sent to whoever is on the shift.')).toBeInTheDocument();
    // Once: no repeat end to give.
    expect(document.getElementById('shift_repeat_end')).toBeNull();
    await user.click(radio('How often?', 'Every day'));
    expect(field('shift_repeat_end')).toHaveValue('');
    expect(screen.queryByTestId('shift-form-clear-end')).not.toBeInTheDocument();
    fireEvent.change(field('shift_repeat_end'), { target: { value: '2027-04-01' } });
    await user.click(screen.getByTestId('shift-form-clear-end'));
    expect(field('shift_repeat_end')).toHaveValue('');
    expect(screen.queryByTestId('shift-form-clear-end')).not.toBeInTheDocument();
  });

  it('a repeat end before the first date is refused and opens More details', async () => {
    const user = userEvent.setup();
    open();
    await user.type(field('shift_name'), 'Daily');
    await user.click(radio('How often?', 'Every day'));
    await user.click(moreToggle());
    fireEvent.change(field('shift_repeat_end'), { target: { value: '2027-03-01' } });
    await user.click(moreToggle()); // fold it again
    expect(moreToggle()).toHaveAttribute('aria-expanded', 'false');
    await user.click(screen.getByRole('button', { name: 'Save shift' }));
    expect(await screen.findByText('The end date must be on or after the first date.')).toBeInTheDocument();
    expect(moreToggle()).toHaveAttribute('aria-expanded', 'true');
    await waitFor(() => expect(field('shift_repeat_end')).toHaveFocus());
    expect(mockCreate).not.toHaveBeenCalled();
  });

  it.each([
    [null, 'off'],
    [60, '1 hour'],
    [120, '2 hours'],
    [240, '4 hours'],
    [1440, '1 day'],
  ] as const)('edit prefill: reminder %s checks "%s"', async (lead, label) => {
    const user = userEvent.setup();
    open({ shift: shift({ reminder_lead_minutes: lead }) });
    await user.click(moreToggle());
    expect(radio('Reminder', new RegExp(`^${label}$`, 'i'))).toBeChecked();
  });

  it('an edit of a repeating shift names its stored end (or "never"), read-only; a one-off names none', async () => {
    const user = userEvent.setup();
    const ended = open({ shift: shift({ recurrence_rule: 'daily', recurrence_end_date: '2027-06-30' }) });
    expect(summary()).toBe('Reminder: 1 hour before · Repeat ends: Jun 30, 2027');
    await user.click(moreToggle());
    expect(document.getElementById('shift_repeat_end')).toBeNull();
    ended.unmount();
    const never = open({ shift: shift({ recurrence_rule: 'daily', recurrence_end_date: null }) });
    expect(summary()).toBe('Reminder: 1 hour before · Repeat ends: never');
    never.unmount();
    open({ shift: shift({ reminder_lead_minutes: null }) });
    expect(summary()).toBe('Reminder: off');
  });
});

describe('simple shift form: add the next shift', () => {
  it('re-opens with start = previous end, same date / repeat / reminder; name and end empty; the second save is add_next and simple', async () => {
    const user = userEvent.setup();
    mockCreate.mockResolvedValue(shift({ id: 'n', title: 'Morning', recurrence_rule: 'daily', scheduled_date: '2027-03-09', scheduled_time: '08:00:00', duration_minutes: 360 }));
    shell(<ShiftComposer circleId="c" initialDate="2027-03-09" source="shifts_view" onClose={vi.fn()} />);
    await user.type(field('shift_name'), 'Morning');
    await user.click(radio('How often?', 'Every day'));
    await user.click(moreToggle());
    await user.click(radio('Reminder', '2 hours'));
    await user.click(screen.getByRole('button', { name: 'Save shift' }));
    expect(await screen.findByRole('heading', { name: '"Morning" saved' })).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: /Add the next shift/ }));

    await waitFor(() => expect(startTile()).toHaveAccessibleName('Starts, 2:00 PM'));
    expect(field('shift_name')).toHaveValue('');
    expect(endTile()).toHaveAccessibleName('Ends, Choose a time');
    expect(field('shift_date')).toHaveValue('2027-03-09');
    expect(radio('How often?', 'Every day')).toBeChecked();
    expect(summary()).toBe('Reminder: 2 hours before · Repeat ends: never');

    // Saving without an end flags the Ends tile.
    await user.type(field('shift_name'), 'Afternoon');
    await user.click(screen.getByRole('button', { name: 'Save shift' }));
    expect(await screen.findByText('Choose when the shift ends.')).toBeInTheDocument();
    expect(endTile()).toHaveAttribute('aria-invalid', 'true');
    setTime('end', '20:00');
    await user.click(screen.getByRole('button', { name: 'Save shift' }));
    await waitFor(() => expect(Analytics.shiftCreated).toHaveBeenCalledTimes(2));
    expect(vi.mocked(Analytics.shiftCreated).mock.calls[1][0]).toEqual(
      expect.objectContaining({ source: 'add_next', layout: 'simple' })
    );
  });
});

describe('simple shift form: analytics', () => {
  it('shift_created and shift_edited carry layout: simple', async () => {
    const user = userEvent.setup();
    const created = open();
    await user.type(field('shift_name'), 'Day');
    await user.click(screen.getByRole('button', { name: 'Save shift' }));
    await waitFor(() => expect(Analytics.shiftCreated).toHaveBeenCalled());
    expect(vi.mocked(Analytics.shiftCreated).mock.calls[0][0]).toEqual(
      expect.objectContaining({ layout: 'simple', source: 'shifts_view' })
    );
    created.unmount();

    open({ shift: shift() });
    await user.click(screen.getByRole('button', { name: 'Save changes' }));
    await waitFor(() => expect(mockUpdate).toHaveBeenCalled());
    expect(Analytics.shiftEdited).toHaveBeenCalledWith({
      timeChanged: false,
      scope: 'occurrence',
      layout: 'simple',
    });
  });
});

describe('simple shift form: a repeating edit keeps the scope question', () => {
  it('asks which shifts first, then the sections', () => {
    open({
      shift: shift({ id: 'root_2027-03-10', parent_event_id: 'root', recurrence_rule: 'daily', scheduled_date: '2027-03-10' }),
    });
    expect(screen.getByRole('radio', { name: 'This shift' })).toBeChecked();
    expect(screen.getByRole('radio', { name: 'All upcoming shifts' })).toBeInTheDocument();
    const pos = (el: HTMLElement) => Array.from(document.querySelectorAll('*')).indexOf(el);
    expect(pos(screen.getByRole('radio', { name: 'This shift' }))).toBeLessThan(
      pos(field('shift_name'))
    );
  });
});
