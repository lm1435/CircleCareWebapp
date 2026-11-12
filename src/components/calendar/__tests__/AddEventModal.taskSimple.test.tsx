import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import i18n from '@/i18n';
import type { CalendarEvent } from '@/api/calendarEvents';
import { Analytics } from '@/lib/analytics';
import { resetLargeTextReports } from '@/lib/largeText';
import { AddEventModal } from '../AddEventModal';

// THE NEW / EDIT TASK FORM IN THE SIMPLE STYLE (owner 1.4.0, mockup Task.dc.html, mobile parity:
// AddEventScreen; build 11 order, owner 2026-11-10). Top to bottom: "New task" / "Edit task", "What needs
// doing?" (Title), "When?" (Starts | Repeats until value tiles on the RECIPIENT's calendar, then the How often
// grid: Once / Every day / Every week + "Custom…" with the five rarer rules, like the shift form), "What time?"
// ("Pick a time" | "Any time"; with Pick a time From | To on the recipient's clock, To OPTIONAL: "No end"),
// "Who's doing it?" (Anyone / Me / members), the Reminders row, "More details" (details only), "Add task" /
// "Save changes". The bodies it saves are pinned against the old full form in
// AddEventModal.taskPayloadEquality.test.tsx; this suite pins the layout, the frames, a11y and analytics.

const VIEWER_TZ = 'America/Denver';
const ORIGINAL_TZ = process.env.TZ;
beforeAll(() => {
  process.env.TZ = VIEWER_TZ;
});
afterAll(() => {
  process.env.TZ = ORIGINAL_TZ;
});

const NOW = new Date('2027-02-10T18:40:00Z');
const CIRCLE_ID = 'circle-1';
const ME_ID = 'aaaaaaaa-1111-4111-8111-111111111111';
const ANA_ID = 'bbbbbbbb-2222-4222-8222-222222222222';
const ROSA_ID = 'cccccccc-3333-4333-8333-333333333333';

const mutateCreate = vi.fn();
const mutateUpdate = vi.fn();
vi.mock('../DoseQuietHoursNote', () => ({ DoseQuietHoursNote: () => null }));
vi.mock('@/hooks/useProviders', () => ({ useProviders: () => ({ providers: [], isSuccess: true }) }));
vi.mock('@/hooks/useCalendarEvents', () => ({
  useCreateEvent: () => ({ mutateAsync: mutateCreate, isPending: false }),
  useUpdateEvent: () => ({ mutateAsync: mutateUpdate, isPending: false }),
  useCachedCircleEvents: () => [],
}));
vi.mock('@/hooks/useSeriesRoot', () => ({
  useSeriesRoot: (_c: string, event: unknown) => ({ root: event ?? null }),
}));
let viewer: { id: string } | null = { id: ME_ID };
vi.mock('@/store/authStore', () => ({
  useAuthStore: (select: (s: { user: { id: string } | null }) => unknown) => select({ user: viewer }),
}));
const MEMBERS = [
  { id: ANA_ID, email: 'ana@example.com', first_name: 'Ana', is_care_recipient: false },
  { id: ME_ID, email: 'luis@example.com', first_name: 'Luis', is_care_recipient: false },
  { id: ROSA_ID, email: 'rosa@example.com', first_name: 'Rosa', is_care_recipient: true },
];
const useCircleResult = {
  circle: { recipient_name: 'Rosa', is_self_care: false, owner_id: ME_ID },
  circleSummary: undefined,
  timezone: 'America/New_York',
  members: MEMBERS,
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
vi.mock('@/components/ui', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/components/ui')>();
  return { ...actual, useToast: () => ({ showToast: vi.fn() }) };
});

let tapped: ReturnType<typeof vi.spyOn>;
let stepDone: ReturnType<typeof vi.spyOn>;
let opened: ReturnType<typeof vi.spyOn>;
let largeText: ReturnType<typeof vi.spyOn>;

function setNow(now: Date) {
  vi.useFakeTimers({ toFake: ['Date'], now });
}
beforeEach(() => {
  vi.clearAllMocks();
  resetLargeTextReports();
  setNow(NOW);
  viewer = { id: ME_ID };
  useCircleResult.timezone = 'America/New_York';
  useCircleResult.members = MEMBERS;
  mutateCreate.mockResolvedValue({ id: 'new' });
  mutateUpdate.mockResolvedValue({ id: 'task-1' });
  tapped = vi.spyOn(Analytics, 'entrySaveTapped').mockImplementation(() => {});
  stepDone = vi.spyOn(Analytics, 'entryFormStepCompleted').mockImplementation(() => {});
  opened = vi.spyOn(Analytics, 'entryFormOpened').mockImplementation(() => {});
  largeText = vi.spyOn(Analytics, 'largeTextLayout').mockImplementation(() => {});
  vi.spyOn(Analytics, 'timeChipSelected').mockImplementation(() => {});
});
afterEach(async () => {
  vi.restoreAllMocks();
  vi.useRealTimers();
  if (i18n.language !== 'en') await i18n.changeLanguage('en');
});

const base = {
  circle_id: CIRCLE_ID,
  event_type: 'task' as const,
  created_at: '2027-01-01T00:00:00Z',
  updated_at: '2027-01-01T00:00:00Z',
  notifications_enabled: true,
  reminder_at_due: true,
  reminder_24h: false,
  reminder_1h: false,
  reminder_30m: false,
  reminder_15m: false,
  description: null,
  location: null,
  assigned_to: null,
  duration_minutes: null,
  recurrence_rule: null,
  recurrence_end_date: null,
  completed_at: null,
};
function task(over: Partial<CalendarEvent> = {}): CalendarEvent {
  return { ...base, id: 'task-1', title: 'Pick up prescription', scheduled_date: '2027-02-15', scheduled_time: null, ...over } as CalendarEvent;
}

const renderNew = (props: Partial<Parameters<typeof AddEventModal>[0]> = {}) =>
  render(<AddEventModal circleId={CIRCLE_ID} initialType="task" onClose={vi.fn()} {...props} />);
const renderEdit = (event: CalendarEvent) =>
  render(<AddEventModal circleId={CIRCLE_ID} event={event} onClose={vi.fn()} />);

/** The "Starts" tile's hidden input (the tile is the date picker; the input carries the value). */
const dateInput = () => screen.getByLabelText(/^Starts/, { selector: 'input' }) as HTMLInputElement;
const repeatEndInput = () => screen.getByLabelText(/^Repeats until/, { selector: 'input' }) as HTMLInputElement;
const radiogroup = (name: string | RegExp) => screen.getByRole('radiogroup', { name });
const radio = (name: string | RegExp) => screen.getByRole('radio', { name });
const titleBox = () => screen.getByRole('textbox', { name: /^Title/ });
/** The From tile's hidden input (recipient clock). */
const timeInput = () => screen.getByLabelText('From', { selector: 'input' }) as HTMLInputElement;
/** The To tile's hidden input (recipient clock; optional on a task: '' = "No end"). */
const endInput = () => screen.getByLabelText('To', { selector: 'input' }) as HTMLInputElement;
/** "Pick a time" (a no-op once From | To show). */
async function pickTime(user: ReturnType<typeof userEvent.setup>) {
  if (!screen.queryByTestId('task-from-tile')) await user.click(radio('Pick a time'));
}
const moreToggle = () => screen.getByRole('button', { name: /^More details/ });

async function saveCreate(user: ReturnType<typeof userEvent.setup>): Promise<Record<string, unknown>> {
  await user.click(screen.getByTestId('add-event-save'));
  await waitFor(() => expect(mutateCreate).toHaveBeenCalledTimes(1));
  return mutateCreate.mock.calls[0][0] as Record<string, unknown>;
}
async function saveEdit(user: ReturnType<typeof userEvent.setup>): Promise<Record<string, unknown>> {
  await user.click(screen.getByRole('button', { name: 'Save changes' }));
  await waitFor(() => expect(mutateUpdate).toHaveBeenCalledTimes(1));
  return (mutateUpdate.mock.calls[0][0] as { data: Record<string, unknown> }).data;
}

describe('layout: the mockup, top to bottom', () => {
  it('"New task", then What needs doing? / When? (Starts | Repeats until, How often) / What time? / Who\'s doing it? / Reminders / More details, then "Add task"', () => {
    renderNew();
    expect(screen.getByRole('dialog', { name: 'New task' })).toBeInTheDocument();
    const form = screen.getByTestId('simple-task-form');
    // When? carries the required asterisk (aria-hidden; its accessible name stays the question).
    expect(within(form).getAllByRole('heading', { level: 3 }).map((h) => h.textContent)).toEqual([
      'What needs doing?',
      'When? *',
      'What time?',
      "Who's doing it?",
    ]);
    expect(screen.getByRole('heading', { name: 'When?' })).toBeInTheDocument();
    // The controls follow their questions in the document order.
    const order = [
      titleBox(),
      screen.getByTestId('starts-tile'),
      screen.getByTestId('repeats-until-tile'),
      radiogroup('How often?'),
      screen.getByTestId('task-repeat-custom'),
      radiogroup('What time?'),
      radiogroup("Who's doing it?"),
      screen.getByTestId('reminders-summary-row'),
      moreToggle(),
    ];
    for (let i = 1; i < order.length; i += 1) {
      expect(order[i - 1].compareDocumentPosition(order[i]) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    }
    // How often? lives inside When?, directly under the date tiles.
    expect(screen.getByRole('heading', { name: 'When?' }).closest('section')).toContainElement(radiogroup('How often?'));
    expect(moreToggle()).toHaveTextContent('Details');
    expect(moreToggle()).not.toHaveTextContent('end date');
    expect(screen.getByTestId('add-event-save')).toHaveTextContent('Add task');
    // No type switch, no Assigned-to select, no Repeat select in sight.
    expect(screen.queryByLabelText('Type')).toBeNull();
    expect(screen.queryByRole('combobox', { name: /^Assigned to/ })).toBeNull();
    expect(screen.queryByRole('combobox', { name: /^Repeat/ })).toBeNull();
  });

  it('the title field is "Title" (required) under the question, with the task placeholder and suggestions', () => {
    renderNew();
    expect(titleBox()).toHaveAttribute('placeholder', 'e.g. Pick up prescription');
    expect(titleBox()).toBeRequired();
    expect(screen.getByRole('radiogroup', { name: 'Title suggestions' })).toBeInTheDocument();
  });

  it('suggestions: at most 3, only on a NEW task with an empty title, never on an edit', async () => {
    const user = userEvent.setup();
    const { unmount } = renderNew();
    const group = screen.getByRole('radiogroup', { name: 'Title suggestions' });
    const count = within(group).getAllByRole('radio').length;
    expect(count).toBeGreaterThan(0);
    expect(count).toBeLessThanOrEqual(3);
    await user.type(titleBox(), 'W');
    expect(screen.queryByRole('radiogroup', { name: 'Title suggestions' })).toBeNull();
    await user.clear(titleBox());
    expect(screen.getByRole('radiogroup', { name: 'Title suggestions' })).toBeInTheDocument();
    unmount();
    renderEdit(task({ title: '' }));
    expect(screen.queryByRole('radiogroup', { name: 'Title suggestions' })).toBeNull();
  });

  it('an edit is "Edit task" with "Save changes", the same sections', () => {
    renderEdit(task());
    expect(screen.getByRole('dialog', { name: 'Edit task' })).toBeInTheDocument();
    expect(screen.getByTestId('simple-task-form')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Save changes' })).toBeInTheDocument();
  });

  it('Spanish: the questions, tiles and CTA', async () => {
    await i18n.changeLanguage('es');
    renderNew();
    expect(screen.getByRole('dialog', { name: 'Nueva tarea' })).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: '¿Qué hay que hacer?' })).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: '¿Quién lo hace?' })).toBeInTheDocument();
    expect(screen.getByLabelText(/^Empieza/, { selector: 'input' })).toHaveValue('2027-02-10');
    expect(screen.getByTestId('repeats-until-tile')).toHaveTextContent('Se repite hasta');
    expect(screen.getByTestId('repeats-until-tile')).toHaveTextContent('No se repite');
    expect(screen.getByRole('heading', { name: '¿A qué hora?' })).toBeInTheDocument();
    expect(screen.getByRole('radio', { name: 'Elegir hora' })).toBeInTheDocument();
    expect(screen.getByRole('radio', { name: 'Cualquier hora' })).toBeChecked();
    expect(screen.getByRole('radio', { name: 'Una vez' })).toBeChecked();
    expect(screen.getByRole('radio', { name: 'Yo' })).toBeInTheDocument();
    expect(screen.getByTestId('add-event-save')).toHaveTextContent('Agregar tarea');
  });
});

describe('When? the day, on the RECIPIENT\'s calendar', () => {
  it('the always-visible Starts tile holds the recipient\'s today; no Today / Tomorrow / Other day tiles', () => {
    renderNew();
    expect(dateInput()).toHaveValue('2027-02-10');
    expect(screen.getByTestId('starts-tile')).toHaveTextContent('Wed, Feb 10');
    // Required: the When? question carries the asterisk (the tile itself is the picker button).
    expect(screen.getByRole('heading', { name: 'When?' })).toHaveTextContent('When? *');
    expect(screen.queryByRole('radio', { name: /^Today/ })).toBeNull();
    expect(screen.queryByRole('radio', { name: /^Tomorrow/ })).toBeNull();
    expect(screen.queryByTestId('task-other-day')).toBeNull();
    expect(screen.queryByRole('radiogroup', { name: 'When?' })).toBeNull();
  });

  it('Kiritimati (+14): the recipient is already on Thursday while the viewer is on Wednesday', () => {
    useCircleResult.timezone = 'Pacific/Kiritimati';
    renderNew();
    expect(dateInput()).toHaveValue('2027-02-11');
  });

  it('Midway (-11): the recipient is still on Wednesday morning', () => {
    setNow(new Date('2027-02-11T06:30:00Z')); // Denver Feb 10 23:30, Midway Feb 10 19:30
    useCircleResult.timezone = 'Pacific/Midway';
    renderNew();
    expect(dateInput()).toHaveValue('2027-02-10');
  });

  it('a typed day saves the recipient\'s day; date-only (no time)', async () => {
    useCircleResult.timezone = 'Pacific/Kiritimati';
    const user = userEvent.setup();
    renderNew();
    await user.type(titleBox(), 'Call the pharmacy');
    fireEvent.change(dateInput(), { target: { value: '2027-02-12' } });
    const body = await saveCreate(user);
    expect(body.scheduled_date).toBe('2027-02-12');
    expect(body.scheduled_time).toBeUndefined();
  });

  it('an untouched new task saves the recipient\'s today', async () => {
    useCircleResult.timezone = 'Pacific/Kiritimati';
    const user = userEvent.setup();
    renderNew();
    await user.type(titleBox(), 'Call the pharmacy');
    expect((await saveCreate(user)).scheduled_date).toBe('2027-02-11');
  });

  it('with a time in a far zone the Starts tile still shows the RECIPIENT\'s day, and the caption says whose', async () => {
    useCircleResult.timezone = 'Pacific/Auckland';
    const user = userEvent.setup();
    renderNew();
    await user.type(titleBox(), 'Book a ride');
    fireEvent.change(dateInput(), { target: { value: '2027-02-14' } });
    await pickTime(user);
    fireEvent.change(timeInput(), { target: { value: '07:15' } });
    // 07:15 Sunday in Auckland is 11:15 Saturday in Denver: the tile keeps naming Sunday.
    expect(dateInput()).toHaveValue('2027-02-14');
    expect(screen.getByTestId('starts-tile')).toHaveTextContent('Sun, Feb 14');
    // The zone caption replaces the old "Days are in …" line under the date: the circle's time first (the range:
    // To starts at the default 30 minutes).
    expect(screen.getByTestId('time-zone-caption')).toHaveTextContent(
      'Auckland time · 11:15 – 11:45 AM your time (Denver)'
    );
    expect(screen.queryByText("Days are in Rosa's time zone (Auckland)")).toBeNull();
    const body = await saveCreate(user);
    expect(body.scheduled_date).toBe('2027-02-14');
    expect(body.scheduled_time).toBe('07:15');
  });

  it('in a far zone, Some days says whose days they are ONCE (under the chips); the date tile carries no zone line', async () => {
    useCircleResult.timezone = 'Pacific/Auckland';
    const user = userEvent.setup();
    renderNew();
    // The older line under the date is gone (build 11): nothing until the day chips show.
    expect(screen.queryByText("Days are in Rosa's time zone (Auckland)")).toBeNull();
    await user.click(screen.getByTestId('task-repeat-custom'));
    await user.click(radio('Some days'));
    const notes = screen.getAllByText("Days are in Rosa's time zone (Auckland)");
    expect(notes).toHaveLength(1);
    expect(notes[0]).toHaveAttribute('id', 'recurrence_days-tznote');
  });

  it('picking the time first, then the day, keeps the recipient\'s time on the new day (and the duration)', async () => {
    useCircleResult.timezone = 'Pacific/Auckland';
    const user = userEvent.setup();
    renderNew();
    await user.type(titleBox(), 'Clean');
    await pickTime(user);
    fireEvent.change(timeInput(), { target: { value: '09:00' } });
    // No length chips (build 11): the length is the To tile.
    expect(screen.queryByRole('radio', { name: '1 hr' })).toBeNull();
    fireEvent.change(endInput(), { target: { value: '10:00' } });
    // After Auckland's clocks go back (Apr 4) and Denver's go forward (Mar 14): the viewer clock moves 2h.
    fireEvent.change(dateInput(), { target: { value: '2027-04-10' } });
    expect(timeInput()).toHaveValue('09:00');
    expect(endInput()).toHaveValue('10:00');
    const body = await saveCreate(user);
    expect(body).toMatchObject({ scheduled_date: '2027-04-10', scheduled_time: '09:00', duration_minutes: 60 });
  });
});

describe('What time? Pick a time (From | To, the recipient\'s clock) vs Any time', () => {
  it('Any time starts checked; tasks save without a time (no end, no reminders offered)', async () => {
    const user = userEvent.setup();
    renderNew();
    expect(radio('Any time')).toBeChecked();
    expect(radio('Pick a time')).not.toBeChecked();
    // No From | To (and no hidden time inputs) until Pick a time.
    expect(screen.queryByTestId('task-from-tile')).toBeNull();
    expect(screen.queryByTestId('task-to-tile')).toBeNull();
    expect(document.getElementById('scheduled_time')).toBeNull();
    await user.type(titleBox(), 'Water the plants');
    await user.click(moreToggle());
    expect(screen.queryByLabelText(/^End time/)).toBeNull();
    expect(screen.queryByRole('switch', { name: 'Enable notifications' })).toBeNull();
    const body = await saveCreate(user);
    expect(body.scheduled_time).toBeUndefined();
    expect(body.duration_minutes).toBeUndefined();
  });

  it('Pick a time shows From (focused) | To, on the recipient\'s clock; the tiles name it; the caption converts', async () => {
    useCircleResult.timezone = 'Pacific/Auckland';
    const user = userEvent.setup();
    renderNew();
    await user.click(radio('Pick a time'));
    const tile = screen.getByTestId('task-from-tile');
    await waitFor(() => expect(tile).toHaveFocus());
    expect(tile).toHaveTextContent('From');
    expect(tile).toHaveTextContent('Choose a time');
    // To: shown, not offered, until there is a From; it reads "No end" (optional on a task).
    expect(screen.getByTestId('task-to-tile')).toBeDisabled();
    expect(screen.getByTestId('task-to-tile')).toHaveTextContent(/To\s*No end/);
    // The tile IS the time picker (a popover), not a field it unfolds.
    expect(tile).toHaveAttribute('aria-haspopup', 'dialog');
    expect(tile).toHaveAttribute('aria-expanded', 'false');
    const field = timeInput();
    fireEvent.change(field, { target: { value: '07:15' } });
    expect(field).toHaveValue('07:15');
    expect(tile).toHaveTextContent('7:15 AM');
    // To starts at the default length (From + 30, as today's form).
    expect(screen.getByTestId('task-to-tile')).toBeEnabled();
    expect(screen.getByTestId('task-to-tile')).toHaveTextContent(/To\s*7:45 AM/);
    expect(radio('Pick a time')).toBeChecked();
    expect(radio('Any time')).not.toBeChecked();
    // Circle time first, then the viewer's: 7:15 AM Auckland is 11:15 AM (the day before) in Denver.
    expect(screen.getByTestId('time-zone-caption')).toHaveTextContent(
      'Auckland time · 11:15 – 11:45 AM your time (Denver)'
    );
    expect(tile).toHaveAttribute('aria-describedby', 'time-zone-caption');
  });

  it('no zone caption when the viewer is in the recipient\'s zone', async () => {
    useCircleResult.timezone = VIEWER_TZ;
    const user = userEvent.setup();
    renderNew();
    await pickTime(user);
    fireEvent.change(timeInput(), { target: { value: '07:15' } });
    expect(screen.getByTestId('task-from-tile')).toHaveTextContent('7:15 AM');
    expect(screen.queryByTestId('time-zone-caption')).toBeNull();
    expect(screen.queryByText(/your time/)).toBeNull();
  });

  it('a time brings the default 30-minute end (as today) and the reminders; the To "×" clears it and saves no length', async () => {
    useCircleResult.timezone = 'Pacific/Kiritimati';
    const user = userEvent.setup();
    renderNew();
    await user.type(titleBox(), 'Book a ride');
    await pickTime(user);
    fireEvent.change(timeInput(), { target: { value: '23:30' } });
    expect(endInput()).toHaveValue('00:00');
    expect(screen.getByTestId('task-to-tile')).toHaveTextContent(/To\s*12:00 AM/);
    // Fix13: the To tile's own "×" (44px, named) empties it; the end is optional on a task. The picker has no
    // separate "No end" button.
    await user.click(screen.getByTestId('task-to-tile'));
    await screen.findByRole('listbox', { name: 'Minute' });
    expect(screen.queryByRole('button', { name: 'No end' })).toBeNull();
    await user.click(screen.getByTestId('task-to-tile'));
    const clear = screen.getByRole('button', { name: 'Clear end time' });
    expect(clear).toHaveClass('h-11', 'w-11');
    expect(screen.getByTestId('task-to-tile-box')).toContainElement(clear);
    await user.click(clear);
    expect(endInput()).toHaveValue('');
    expect(screen.getByTestId('task-to-tile')).toHaveTextContent(/To\s*No end/);
    expect(screen.queryByRole('button', { name: 'Clear end time' })).toBeNull();
    await waitFor(() => expect(screen.getByTestId('task-to-tile')).toHaveFocus());
    // More details stays "Details": no end row there any more (the end is the To tile).
    expect(moreToggle()).toHaveTextContent('Details');
    expect(moreToggle()).not.toHaveTextContent('end time');
    await user.click(moreToggle());
    expect(screen.queryByLabelText(/^End time/)).toBeNull();
    expect(screen.queryByRole('radio', { name: '30 min' })).toBeNull();
    expect(screen.getByTestId('reminders-summary-row')).toHaveAttribute('data-variant', 'summary');
    const body = await saveCreate(user);
    expect(body.scheduled_time).toBe('23:30');
    expect(JSON.parse(JSON.stringify(body))).not.toHaveProperty('duration_minutes');
  });

  it('To = From + 30 (the old default, now chosen on the To tile) saves 30, past the recipient midnight; Any time clears both', async () => {
    useCircleResult.timezone = 'Pacific/Kiritimati';
    const user = userEvent.setup();
    renderNew();
    await user.type(titleBox(), 'Book a ride');
    await pickTime(user);
    fireEvent.change(timeInput(), { target: { value: '23:30' } });
    fireEvent.change(endInput(), { target: { value: '00:00' } });
    expect(screen.getByTestId('task-to-tile')).toHaveTextContent(/12:00 AM/);
    expect(endInput()).toHaveValue('00:00');
    // The reminders arrive with the time: the summary row (its accordion holds the card).
    expect(screen.getByTestId('reminders-summary-row')).toHaveAttribute('data-variant', 'summary');
    expect(screen.getByTestId('reminders-fieldset')).toBeInTheDocument();
    await user.click(radio('Any time'));
    expect(radio('Any time')).toBeChecked();
    expect(screen.queryByLabelText('From', { selector: 'input' })).toBeNull();
    expect(screen.queryByLabelText('To', { selector: 'input' })).toBeNull();
    expect(screen.queryByTestId('task-from-tile')).toBeNull();
    const body = await saveCreate(user);
    expect(body.scheduled_time).toBeUndefined();
    expect(body.duration_minutes).toBeUndefined();
    expect(body.scheduled_date).toBe('2027-02-11');
  });

  it('an end typed on the recipient\'s clock saves the span between the two typed times', async () => {
    useCircleResult.timezone = 'Pacific/Auckland';
    const user = userEvent.setup();
    renderNew();
    await user.type(titleBox(), 'Clean');
    await pickTime(user);
    fireEvent.change(timeInput(), { target: { value: '10:00' } });
    const end = endInput();
    // On the recipient's clock, like From: the caption says whose clock that is.
    expect(screen.getByTestId('time-zone-caption')).toHaveTextContent(/^Auckland time · /);
    fireEvent.change(end, { target: { value: '11:45' } });
    expect(end).toHaveValue('11:45');
    expect(screen.getByTestId('task-to-tile')).toHaveTextContent('11:45 AM');
    const body = await saveCreate(user);
    expect(body).toMatchObject({ scheduled_time: '10:00', duration_minutes: 105 });
  });
});

describe('How often?', () => {
  it.each([
    ['Once', undefined, undefined],
    ['Every day', 'daily', undefined],
    ['Every week', 'weekly', undefined],
  ] as const)('%s saves %s', async (label, rule, days) => {
    const user = userEvent.setup();
    renderNew();
    await user.type(titleBox(), 'Walk');
    await user.click(radio(label));
    expect(radio(label)).toBeChecked();
    const body = await saveCreate(user);
    expect(body.recurrence_rule).toBe(rule);
    expect(body.recurrence_days).toBe(days);
  });

  it('Once / Every day / Every week and "Custom…" are one 2-col grid; Custom starts closed', () => {
    renderNew();
    const custom = screen.getByTestId('task-repeat-custom');
    const grid = custom.parentElement as HTMLElement;
    expect(grid).toHaveClass('grid', 'grid-cols-2');
    expect(grid).toContainElement(radiogroup('How often?'));
    expect(within(radiogroup('How often?')).getAllByRole('radio').map((r) => r.textContent)).toEqual([
      'Once',
      'Every day',
      'Every week',
    ]);
    expect(custom).toHaveTextContent('Custom…');
    expect(custom).toHaveAttribute('aria-expanded', 'false');
    expect(radio('Once')).toBeChecked();
    expect(screen.queryByTestId('task-repeat-custom-panel')).toBeNull();
  });

  it('Custom… opens a panel with the five rarer rules, in the shift form\'s order; a main tile closes it', async () => {
    const user = userEvent.setup();
    renderNew();
    await user.click(screen.getByTestId('task-repeat-custom'));
    const panel = screen.getByTestId('task-repeat-custom-panel');
    expect(screen.getByTestId('task-repeat-custom')).toHaveAttribute('aria-expanded', 'true');
    expect(within(panel).getByText('Custom')).toBeInTheDocument();
    const group = within(panel).getByRole('radiogroup', { name: 'Custom' });
    expect(within(group).getAllByRole('radio').map((r) => r.textContent)).toEqual([
      'Every other day',
      'Days on / off',
      'Some days',
      'Monthly',
      'Yearly',
    ]);
    // Opened by hand, nothing chosen yet: Once is still the answer.
    expect(radio('Once')).toBeChecked();
    await user.click(radio('Every day'));
    expect(screen.queryByTestId('task-repeat-custom-panel')).toBeNull();
    // The toggle closes an empty panel too.
    await user.click(screen.getByTestId('task-repeat-custom'));
    await user.click(screen.getByTestId('task-repeat-custom'));
    expect(screen.queryByTestId('task-repeat-custom-panel')).toBeNull();
  });

  it('Some days (in Custom) reveals the day picker inline under How often?, preselecting the start\'s weekday', async () => {
    const user = userEvent.setup();
    renderNew();
    await user.type(titleBox(), 'Walk');
    await user.click(screen.getByTestId('task-repeat-custom'));
    await user.click(radio('Some days'));
    expect(screen.getByTestId('task-repeat-custom')).toHaveClass('bg-ink');
    const picker = screen.getByRole('group', { name: /^Repeat on/ });
    // The picker sits in the How often? section, not behind More details.
    expect(radiogroup('How often?').closest('section')).toContainElement(picker);
    expect(within(picker).getByRole('checkbox', { name: 'Wednesday' })).toHaveAttribute('aria-checked', 'true');
    await user.click(within(picker).getByRole('checkbox', { name: 'Friday' }));
    const body = await saveCreate(user);
    expect(body).toMatchObject({ recurrence_rule: 'weekly', recurrence_days: [3, 5] });
  });

  it('Days on / off puts its two inputs under How often? (not behind More details) and saves the cycle', async () => {
    const user = userEvent.setup();
    renderNew();
    await user.type(titleBox(), 'Rotate');
    await user.click(screen.getByTestId('task-repeat-custom'));
    await user.click(radio('Days on / off'));
    const on = screen.getByLabelText(/^Days on/, { selector: 'input' });
    expect(radiogroup('How often?').closest('section')).toContainElement(on);
    fireEvent.change(on, { target: { value: '5' } });
    fireEvent.change(screen.getByLabelText(/^Days off/, { selector: 'input' }), { target: { value: '2' } });
    expect((await saveCreate(user)).recurrence_rule).toBe('cycle:5:2');
  });

  it.each([
    ['Every other day', 'every_other_day'],
    ['Monthly', 'monthly'],
    ['Yearly', 'yearly'],
  ])('Custom > %s saves %s', async (label, rule) => {
    const user = userEvent.setup();
    renderNew();
    await user.type(titleBox(), 'Walk');
    await user.click(screen.getByTestId('task-repeat-custom'));
    await user.click(radio(label));
    expect(radio(label)).toBeChecked();
    expect((await saveCreate(user)).recurrence_rule).toBe(rule);
  });

  it.each([
    ['every_other_day', 'Every other day'],
    ['monthly', 'Monthly'],
    ['yearly', 'Yearly'],
    ['cycle:5:2', 'Days on / off'],
  ])('an edit of %s opens Custom with %s lit, no main tile checked, and saves it untouched', async (rule, name) => {
    const user = userEvent.setup();
    renderEdit(task({ recurrence_rule: rule }));
    expect(screen.getByTestId('task-repeat-custom')).toHaveAttribute('aria-expanded', 'true');
    expect(screen.getByTestId('task-repeat-custom')).toHaveClass('bg-ink');
    expect(screen.getByTestId('task-repeat-custom-panel')).toBeInTheDocument();
    for (const label of ['Once', 'Every day', 'Every week']) expect(radio(label)).not.toBeChecked();
    expect(radio(name)).toBeChecked();
    expect(screen.queryByTestId('how-often-summary')).toBeNull();
    // Nothing about the rule sends the user to More details.
    expect(moreToggle()).toHaveAttribute('aria-expanded', 'false');
    const body = await saveEdit(user);
    expect(body.recurrence_rule).toBe(rule);
  });

  it('a cycle edit shows its on / off inputs under How often? with the stored numbers', () => {
    renderEdit(task({ recurrence_rule: 'cycle:5:2' }));
    expect(screen.getByLabelText(/^Days on/, { selector: 'input' })).toHaveValue(5);
    expect(screen.getByLabelText(/^Days off/, { selector: 'input' })).toHaveValue(2);
  });

  it('a custom rule can be replaced by a main tile (the panel closes)', async () => {
    const user = userEvent.setup();
    renderEdit(task({ recurrence_rule: 'monthly' }));
    await user.click(radio('Every week'));
    expect(screen.queryByTestId('how-often-summary')).toBeNull();
    expect(screen.queryByTestId('task-repeat-custom-panel')).toBeNull();
    expect((await saveEdit(user)).recurrence_rule).toBe('weekly');
  });

  it('no custom-open analytics event exists for tasks (nothing but the funnel step fires)', async () => {
    const user = userEvent.setup();
    const spy = vi.spyOn(Analytics, 'shiftRepeatCustomOpened').mockImplementation(() => {});
    renderNew();
    await user.click(screen.getByTestId('task-repeat-custom'));
    expect(spy).not.toHaveBeenCalled();
  });
});

describe("Who's doing it?", () => {
  it('Anyone, Me, then the other members in the circle\'s order; the care recipient carries the caption', () => {
    renderNew();
    const group = radiogroup("Who's doing it?");
    expect(within(group).getAllByRole('radio').map((r) => r.getAttribute('aria-label') ?? r.textContent)).toEqual([
      'Anyone',
      'Me',
      'Ana',
      'Rosa, Care recipient',
    ]);
    expect(radio('Anyone')).toBeChecked();
  });

  it('no "Me" when the viewer is not a member', () => {
    viewer = { id: 'someone-else' };
    renderNew();
    expect(screen.queryByRole('radio', { name: 'Me' })).toBeNull();
    expect(radio('Luis')).toBeInTheDocument();
  });

  it.each([
    ['Me', ME_ID],
    ['Ana', ANA_ID],
    [/^Rosa/, ROSA_ID],
  ] as const)('%s assigns %s', async (name, id) => {
    const user = userEvent.setup();
    renderNew();
    await user.type(titleBox(), 'Groceries');
    await user.click(radio(name));
    expect((await saveCreate(user)).assigned_to).toBe(id);
  });

  it('Anyone on an edit sends an explicit null (unassigns)', async () => {
    const user = userEvent.setup();
    renderEdit(task({ assigned_to: ANA_ID }));
    expect(radio('Ana')).toBeChecked();
    await user.click(radio('Anyone'));
    expect((await saveEdit(user)).assigned_to).toBeNull();
  });
});

describe('edit prefill: every option kind', () => {
  it.each([
    ['2027-02-10', 'Wed, Feb 10'],
    ['2027-02-11', 'Thu, Feb 11'],
    ['2027-01-20', 'Wed, Jan 20'],
  ])('a task on %s fills the Starts tile with that day', (day, text) => {
    renderEdit(task({ scheduled_date: day }));
    expect(dateInput()).toHaveValue(day);
    expect(screen.getByTestId('starts-tile')).toHaveTextContent(text);
  });

  it('a timed task in a far zone: From | To name the stored times, their inputs hold them, the day is the stored day', () => {
    useCircleResult.timezone = 'Pacific/Kiritimati';
    renderEdit(task({ scheduled_date: '2027-02-12', scheduled_time: '23:30:00', duration_minutes: 30 }));
    expect(screen.getByTestId('task-from-tile')).toHaveTextContent('11:30 PM');
    expect(timeInput()).toHaveValue('23:30');
    // The stored length shows as To (past the recipient's midnight: the next day).
    expect(endInput()).toHaveValue('00:00');
    expect(screen.getByTestId('task-to-tile')).toHaveTextContent(/12:00 AM/);
    expect(dateInput()).toHaveValue('2027-02-12');
    expect(radio('Pick a time')).toBeChecked();
    expect(radio('Any time')).not.toBeChecked();
  });

  it.each([
    [null, null, 'Once', false],
    ['daily', null, 'Every day', false],
    ['weekly', null, 'Every week', false],
    ['weekly', [1, 3], 'Some days', true],
  ] as const)('rule %s days %s lights %s', (rule, days, label, inCustom) => {
    renderEdit(task({ recurrence_rule: rule, recurrence_days: days } as Partial<CalendarEvent>));
    expect(radio(label)).toBeChecked();
    expect(screen.queryByTestId('task-repeat-custom-panel') !== null).toBe(inCustom);
    expect(screen.queryByTestId('how-often-summary')).toBeNull();
  });

  it.each([
    [null, 'Anyone'],
    [ME_ID, 'Me'],
    [ANA_ID, 'Ana'],
    [ROSA_ID, /^Rosa/],
  ] as const)('assignee %s lights %s', (id, name) => {
    renderEdit(task({ assigned_to: id }));
    expect(radio(name)).toBeChecked();
  });

  it('the repeat end prefills the Repeats until tile, the end the To tile; details are prefilled behind a COLLAPSED More details', () => {
    renderEdit(task({
      description: 'Ask about refills', scheduled_time: '10:00:00', duration_minutes: 45,
      recurrence_rule: 'daily', recurrence_end_date: '2027-03-31', reminder_1h: true,
    }));
    expect(repeatEndInput()).toHaveValue('2027-03-31');
    expect(screen.getByTestId('repeats-until-tile')).toHaveTextContent('Wed, Mar 31');
    // Edit = new, pre-filled (build 11): More details stays collapsed even with values behind it.
    expect(moreToggle()).toHaveAttribute('aria-expanded', 'false');
    fireEvent.click(moreToggle());
    expect(screen.getByLabelText(/^Details/)).toHaveValue('Ask about refills');
    // The end lives on the To tile (build 11), not in More details.
    expect(screen.queryByLabelText(/^End time/)).toBeNull();
    expect(endInput()).toHaveValue('10:45');
    expect(screen.getByTestId('task-to-tile')).toHaveTextContent('10:45 AM');
    // The reminders are prefilled in the summary row's accordion (outside More details).
    expect(screen.getByTestId('reminders-summary-value')).toHaveTextContent('1 hour before, at the scheduled time');
    fireEvent.click(screen.getByTestId('reminders-summary-row'));
    expect(screen.getByRole('checkbox', { name: '1 hour before' })).toHaveAttribute('aria-checked', 'true');
  });
});

describe('More details', () => {
  it('collapsed on a new task, with aria-expanded and the hint; opens in place', async () => {
    const user = userEvent.setup();
    renderNew();
    expect(moreToggle()).toHaveAttribute('aria-expanded', 'false');
    // The panel stays mounted (hidden) so ids and error focus work; nothing in it is exposed.
    expect(screen.queryByRole('textbox', { name: /^Details/ })).toBeNull();
    await user.click(moreToggle());
    expect(moreToggle()).toHaveAttribute('aria-expanded', 'true');
    expect(screen.getByRole('textbox', { name: /^Details/ })).toBeInTheDocument();
    // The Repeat select is gone (How often? offers every rule) and the repeat end is the Repeats until tile in
    // When?, outside More details (build 11).
    expect(screen.queryByRole('combobox', { name: /^Repeat/ })).toBeNull();
    expect(document.getElementById('more-details-panel')).not.toContainElement(repeatEndInput());
    expect(screen.queryByLabelText(/^End date/)).toBeNull();
    // Appointment-only fields are not here.
    expect(screen.queryByLabelText(/^Location/)).toBeNull();
    expect(screen.queryByText('Doctor')).toBeNull();
  });

  // Build 11 (owner 2026-11-10): "More details (collapsed by default, also on edit)". A stored value behind it no
  // longer opens it; the edit looks exactly like the new form, pre-filled.
  it.each([
    ['details', { description: 'Bring the card' }],
    ['a custom duration', { scheduled_time: '10:00:00', duration_minutes: 45 }],
    ['a repeat end', { recurrence_rule: 'daily', recurrence_end_date: '2027-03-31' }],
    ['an untiled rule (every other day)', { recurrence_rule: 'every_other_day' }],
    ['a cycle', { recurrence_rule: 'cycle:5:2' }],
    ['the default duration', { scheduled_time: '10:00:00', duration_minutes: 30 }],
    ['no duration (PK21)', { scheduled_time: '10:00:00', duration_minutes: null }],
    ['a plain weekly rule', { recurrence_rule: 'weekly' }],
    ['nothing behind it', {}],
  ] as const)('an edit with %s: More details stays collapsed', (_label, over) => {
    renderEdit(task(over as Partial<CalendarEvent>));
    expect(moreToggle()).toHaveAttribute('aria-expanded', 'false');
  });

  it('the repeat end date is on the RECIPIENT\'s calendar too (far zone, the day the save sends)', async () => {
    useCircleResult.timezone = 'Pacific/Kiritimati';
    const user = userEvent.setup();
    renderNew();
    await user.type(titleBox(), 'Walk');
    await pickTime(user);
    fireEvent.change(timeInput(), { target: { value: '06:00' } });
    await user.click(radio('Every day'));
    expect(screen.getByTestId('repeats-until-tile')).toHaveTextContent('Never');
    fireEvent.change(repeatEndInput(), { target: { value: '2027-03-26' } });
    expect(repeatEndInput()).toHaveValue('2027-03-26');
    expect(screen.getByTestId('repeats-until-tile')).toHaveTextContent('Fri, Mar 26');
    const body = await saveCreate(user);
    expect(body).toMatchObject({ scheduled_date: '2027-02-11', scheduled_time: '06:00', recurrence_end_date: '2027-03-26' });
  });
});

describe('validation', () => {
  it('no title: Save does not save, the title shows its error and gets focus', async () => {
    const user = userEvent.setup();
    renderNew();
    await user.click(screen.getByTestId('add-event-save'));
    expect(mutateCreate).not.toHaveBeenCalled();
    expect(titleBox()).toHaveFocus();
    expect(titleBox()).toHaveAttribute('aria-invalid', 'true');
  });

  it('the end is optional (build 11): a cleared To ("No end") is no error, More details stays shut, no length is saved', async () => {
    const user = userEvent.setup();
    renderNew();
    await user.type(titleBox(), 'Clean');
    await pickTime(user);
    fireEvent.change(timeInput(), { target: { value: '10:00' } });
    fireEvent.change(endInput(), { target: { value: '10:45' } });
    fireEvent.change(endInput(), { target: { value: '' } });
    expect(screen.getByTestId('task-to-tile')).toHaveTextContent(/To\s*No end/);
    await user.click(screen.getByTestId('add-event-save'));
    await waitFor(() => expect(mutateCreate).toHaveBeenCalledTimes(1));
    expect(moreToggle()).toHaveAttribute('aria-expanded', 'false');
    expect(document.getElementById('endTime-error')).toBeNull();
    const body = JSON.parse(JSON.stringify(mutateCreate.mock.calls[0][0])) as Record<string, unknown>;
    expect(body.scheduled_time).toBe('10:00');
    expect(body).not.toHaveProperty('duration_minutes');
  });

  it('a cleared day: Save does not save, the Starts tile shows the error and takes focus', async () => {
    const user = userEvent.setup();
    renderNew();
    await user.type(titleBox(), 'Clean');
    fireEvent.change(dateInput(), { target: { value: '' } });
    await user.click(screen.getByTestId('add-event-save'));
    expect(mutateCreate).not.toHaveBeenCalled();
    const tile = screen.getByTestId('starts-tile');
    await waitFor(() => expect(tile).toHaveFocus());
    expect(tile).toHaveAttribute('aria-invalid', 'true');
    expect(tile).toHaveAttribute('aria-describedby', 'scheduled_date-error');
    expect(document.getElementById('scheduled_date-error')).toHaveTextContent('Please choose a date.');
  });

  it('a repeat end before the start is said at the Repeats until tile, live, and Save refuses it', async () => {
    const user = userEvent.setup();
    renderNew();
    await user.type(titleBox(), 'Walk');
    await user.click(radio('Every day'));
    fireEvent.change(repeatEndInput(), { target: { value: '2027-02-05' } });
    const tile = screen.getByTestId('repeats-until-tile');
    expect(tile).toHaveAttribute('aria-invalid', 'true');
    expect(document.getElementById('recurrence_end_date-error')).toHaveTextContent(
      'The end date must be on or after the first date.'
    );
    await user.click(screen.getByTestId('add-event-save'));
    expect(mutateCreate).not.toHaveBeenCalled();
    await waitFor(() => expect(tile).toHaveFocus());
  });

  it('Once keeps Repeats until in place, disabled, "Doesn\'t repeat"; a repeat makes it pickable, "Never" when blank', async () => {
    const user = userEvent.setup();
    renderNew();
    const tile = screen.getByTestId('repeats-until-tile');
    expect(radio('Once')).toBeChecked();
    expect(tile).toBeDisabled();
    expect(tile).toHaveTextContent("Doesn't repeat");
    await user.click(radio('Every week'));
    expect(tile).toBeEnabled();
    expect(tile).toHaveTextContent('Never');
  });
});

describe('the series and the completed-task rules stay as they were', () => {
  it('a recurring task edit (also from a completed occurrence) keeps the series note in the footer and saves to the root', async () => {
    const user = userEvent.setup();
    const root = task({ id: 'root-1', recurrence_rule: 'daily', scheduled_date: '2027-01-04' });
    renderEdit({ ...root, id: 'child-1', parent_event_id: 'root-1', completed_at: '2027-02-01T15:00:00Z' } as CalendarEvent);
    const note = screen.getByTestId('series-edit-note');
    expect(note).toHaveTextContent('Applies to upcoming tasks only.');
    // In the footer beside Save, not on top of the form; the old notice card is gone.
    expect(note.closest('[data-modal-footer]')).toContainElement(screen.getByTestId('add-event-save'));
    expect(document.getElementById('add-event-form')).toHaveAttribute('aria-describedby', 'series-edit-note');
    expect(screen.queryByText(/This event repeats/)).toBeNull();
    expect(screen.queryByRole('note')).toBeNull();
    await user.click(screen.getByRole('button', { name: 'Save changes' }));
    await waitFor(() => expect(mutateUpdate).toHaveBeenCalledTimes(1));
    expect((mutateUpdate.mock.calls[0][0] as { eventId: string }).eventId).toBe('root-1');
  });

  it('no series note on a new task or on an edit of a one-off task', () => {
    const { unmount } = renderNew();
    expect(screen.queryByTestId('series-edit-note')).toBeNull();
    unmount();
    renderEdit(task());
    expect(screen.queryByTestId('series-edit-note')).toBeNull();
    expect(document.getElementById('add-event-form')).not.toHaveAttribute('aria-describedby');
  });
});

describe('accessibility', () => {
  it('every tile row is a named radiogroup of radios with checked state; the openers are buttons with aria-expanded', () => {
    renderNew();
    for (const name of ['What time?', 'How often?', "Who's doing it?"]) {
      const group = radiogroup(name);
      const radios = within(group).getAllByRole('radio');
      expect(radios.length).toBeGreaterThan(0);
      expect(radios.filter((r) => r.getAttribute('aria-checked') === 'true')).toHaveLength(1);
    }
    expect(screen.getByTestId('task-repeat-custom').tagName).toBe('BUTTON');
    expect(screen.getByTestId('task-repeat-custom')).toHaveAttribute('aria-expanded', 'false');
    // The value tiles are buttons that open a picker dialog.
    for (const id of ['starts-tile', 'repeats-until-tile']) {
      expect(screen.getByTestId(id).tagName).toBe('BUTTON');
      expect(screen.getByTestId(id)).toHaveAttribute('aria-haspopup', 'dialog');
      expect(screen.getByTestId(id)).toHaveAttribute('aria-expanded', 'false');
    }
    // Their hidden inputs are out of the tab order and hidden from assistive tech (the tile is the control).
    for (const input of [dateInput(), repeatEndInput()]) {
      expect(input).toHaveAttribute('tabindex', '-1');
      expect(input).toHaveAttribute('aria-hidden', 'true');
    }
    expect(moreToggle()).toHaveAttribute('aria-expanded', 'false');
  });

  it('every tile is the shared 56px-tall, 44px-wide choice tile and wraps its text (no truncation)', () => {
    renderNew();
    const tiles = [
      ...within(screen.getByTestId('simple-task-form'))
        .getAllByRole('radio')
        .filter((r) => !['title-suggestions', 'task-time'].includes(r.closest('[role="radiogroup"]')?.id ?? '')),
      screen.getByTestId('starts-tile'),
      screen.getByTestId('repeats-until-tile'),
      screen.getByTestId('task-repeat-custom'),
    ];
    for (const tile of tiles) {
      expect(tile).toHaveClass('min-h-[48px]', 'min-w-[44px]', 'max-w-full');
      expect(tile.className).not.toMatch(/truncate|whitespace-nowrap/);
    }
    // Starts | Repeats until share one 2-column row.
    expect(screen.getByTestId('when-date-tiles')).toHaveClass('grid', 'grid-cols-2');
    expect(screen.getByTestId('when-date-tiles')).toContainElement(screen.getByTestId('starts-tile'));
    // "Pick a time | Any time" is the small choice (pills that wrap), not a tile row.
    for (const r of within(radiogroup('What time?')).getAllByRole('radio')) {
      expect(r).toHaveClass('rounded-full', 'min-h-[44px]');
      expect(r.className).not.toMatch(/truncate|whitespace-nowrap/);
    }
  });

  it('the More details hint wraps rather than truncating', () => {
    renderNew();
    const hint = within(moreToggle()).getByText('Details');
    expect(hint).not.toHaveClass('truncate');
  });
});

describe('analytics', () => {
  it('a new task: entry_form_opened(task), the four funnel steps once each, entry_save_tapped layout simple', async () => {
    const user = userEvent.setup();
    renderNew({ entry: 'add_menu' });
    expect(opened).toHaveBeenCalledWith({ type: 'task', entry: 'add_menu' });
    await user.type(titleBox(), 'Groceries');
    fireEvent.change(dateInput(), { target: { value: '2027-02-11' } });
    await user.click(radio('Every day'));
    await user.click(radio('Me'));
    await user.click(screen.getByTestId('task-repeat-custom'));
    await user.click(radio('Monthly'));
    await user.click(radio('Every week'));
    await saveCreate(user);
    const steps = stepDone.mock.calls.map((c: unknown[]) => (c[0] as { step: string }).step);
    expect(steps.sort()).toEqual(['how_often', 'what', 'when', 'who']);
    for (const call of stepDone.mock.calls as unknown[][]) expect((call[0] as { type: string }).type).toBe('task');
    expect(tapped).toHaveBeenCalledWith(CIRCLE_ID, 'task', 'form', false, 'simple');
    // No large_text_layout screen for the task form (the enum is shared with mobile).
    expect(largeText).not.toHaveBeenCalled();
  });

  it('Any time and Pick a time count as the When step too', async () => {
    const user = userEvent.setup();
    renderNew();
    await pickTime(user);
    fireEvent.change(timeInput(), { target: { value: '10:00' } });
    expect(stepDone).toHaveBeenCalledWith({ type: 'task', step: 'when' });
  });

  it('an edit never counts funnel steps and reports layout simple', async () => {
    const user = userEvent.setup();
    renderEdit(task());
    fireEvent.change(dateInput(), { target: { value: '2027-02-11' } });
    await user.click(radio('Every day'));
    await user.click(radio('Me'));
    await saveEdit(user);
    expect(stepDone).not.toHaveBeenCalled();
    expect(opened).not.toHaveBeenCalled();
    expect(tapped).toHaveBeenCalledWith(CIRCLE_ID, 'task', 'form', true, 'simple');
  });
});
