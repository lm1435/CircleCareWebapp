import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import i18n from '@/i18n';
import type { CalendarEvent } from '@/api/calendarEvents';
import { Analytics } from '@/lib/analytics';
import { resetLargeTextReports } from '@/lib/largeText';
import { simpleTaskMoreOpen } from '@/utils/simpleEditDisclosure';
import { AddEventModal } from '../AddEventModal';

// THE NEW / EDIT TASK FORM IN THE SIMPLE STYLE (owner 1.4.0, mockup Task.dc.html, mobile parity:
// AddEventScreen). Top to bottom: "New task" / "Edit task", "What needs doing?" (Title), "When?" (Today /
// Tomorrow on the RECIPIENT's calendar + "Other day"; "Any time" / "Pick a time" on the recipient's clock),
// "How often?" (Once / Every day / Every week / Some days), "Who's doing it?" (Anyone / Me / members),
// "More details" (details, duration + end time, Repeat select + end date, reminders), "Add task" /
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
const renderEdit = (event: CalendarEvent, layout?: 'full') =>
  render(<AddEventModal circleId={CIRCLE_ID} event={event} layout={layout} onClose={vi.fn()} />);

const radiogroup = (name: string | RegExp) => screen.getByRole('radiogroup', { name });
const radio = (name: string | RegExp) => screen.getByRole('radio', { name });
const titleBox = () => screen.getByRole('textbox', { name: /^Title/ });
const timeInput = () => screen.getByLabelText(/^Time/, { selector: 'input' }) as HTMLInputElement;
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
  it('"New task", then What needs doing? / When? / How often? / Who\'s doing it? / More details, then "Add task"', () => {
    renderNew();
    expect(screen.getByRole('dialog', { name: 'New task' })).toBeInTheDocument();
    const form = screen.getByTestId('simple-task-form');
    expect(within(form).getAllByRole('heading', { level: 3 }).map((h) => h.textContent)).toEqual([
      'What needs doing?',
      'When?',
      'How often?',
      "Who's doing it?",
    ]);
    // The controls follow their questions in the document order.
    const order = [
      titleBox(),
      radiogroup('When?'),
      screen.getByTestId('task-other-day'),
      radiogroup('Time'),
      screen.getByTestId('task-pick-time'),
      radiogroup('How often?'),
      radiogroup("Who's doing it?"),
      moreToggle(),
    ];
    for (let i = 1; i < order.length; i += 1) {
      expect(order[i - 1].compareDocumentPosition(order[i]) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    }
    expect(moreToggle()).toHaveTextContent('Details, reminders, end date');
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

  it('an edit is "Edit task" with "Save changes", the same sections', () => {
    renderEdit(task());
    expect(screen.getByRole('dialog', { name: 'Edit task' })).toBeInTheDocument();
    expect(screen.getByTestId('simple-task-form')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Save changes' })).toBeInTheDocument();
  });

  it('layout="full" keeps the old full task form (the AI-drafted / follow-up layout on mobile)', () => {
    renderNew({ layout: 'full' });
    expect(screen.queryByTestId('simple-task-form')).toBeNull();
    expect(screen.getByRole('combobox', { name: /^Assigned to/ })).toBeInTheDocument();
    expect(screen.getByTestId('add-event-save')).toHaveTextContent('Create');
  });

  it('a type-less open switched to Task stays on the full form (Calendar "+")', async () => {
    const user = userEvent.setup();
    render(<AddEventModal circleId={CIRCLE_ID} onClose={vi.fn()} />);
    await user.selectOptions(screen.getByLabelText('Type'), 'task');
    expect(screen.queryByTestId('simple-task-form')).toBeNull();
    expect(screen.getByTestId('add-event-save')).toHaveTextContent('Create');
  });

  it('Spanish: the questions, tiles and CTA', async () => {
    await i18n.changeLanguage('es');
    renderNew();
    expect(screen.getByRole('dialog', { name: 'Nueva tarea' })).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: '¿Qué hay que hacer?' })).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: '¿Quién lo hace?' })).toBeInTheDocument();
    expect(screen.getByRole('radio', { name: /^Hoy/ })).toBeChecked();
    expect(screen.getByRole('radio', { name: 'Una vez' })).toBeChecked();
    expect(screen.getByRole('radio', { name: 'Yo' })).toBeInTheDocument();
    expect(screen.getByTestId('add-event-save')).toHaveTextContent('Agregar tarea');
  });
});

describe('When? the day, on the RECIPIENT\'s calendar', () => {
  it('Today / Tomorrow name the recipient\'s days; Today starts checked', () => {
    renderNew();
    expect(radio('Today, Wed, Feb 10')).toBeChecked();
    expect(radio('Tomorrow, Thu, Feb 11')).not.toBeChecked();
    expect(screen.getByTestId('task-other-day')).toHaveAttribute('aria-expanded', 'false');
  });

  it('Kiritimati (+14): the recipient is already on Thursday while the viewer is on Wednesday', () => {
    useCircleResult.timezone = 'Pacific/Kiritimati';
    renderNew();
    expect(radio('Today, Thu, Feb 11')).toBeChecked();
    expect(radio('Tomorrow, Fri, Feb 12')).toBeInTheDocument();
  });

  it('Midway (-11): the recipient is still on Wednesday morning', () => {
    setNow(new Date('2027-02-11T06:30:00Z')); // Denver Feb 10 23:30, Midway Feb 10 19:30
    useCircleResult.timezone = 'Pacific/Midway';
    renderNew();
    expect(radio('Today, Wed, Feb 10')).toBeChecked();
  });

  it('Tomorrow is the next calendar DAY, never now + 24 hours (the night the clocks spring forward)', () => {
    // New York 2027-03-13 23:30 EST. Now + 24h is 2027-03-15 00:30 EDT; tomorrow is Sunday the 14th.
    setNow(new Date('2027-03-14T04:30:00Z'));
    renderNew();
    expect(radio('Today, Sat, Mar 13')).toBeChecked();
    expect(radio('Tomorrow, Sun, Mar 14')).toBeInTheDocument();
  });

  it('Tomorrow saves the recipient\'s tomorrow; date-only (no time)', async () => {
    useCircleResult.timezone = 'Pacific/Kiritimati';
    const user = userEvent.setup();
    renderNew();
    await user.type(titleBox(), 'Call the pharmacy');
    await user.click(radio(/^Tomorrow/));
    expect(radio(/^Tomorrow/)).toBeChecked();
    expect(radio(/^Today/)).not.toBeChecked();
    const body = await saveCreate(user);
    expect(body.scheduled_date).toBe('2027-02-12');
    expect(body.scheduled_time).toBeUndefined();
  });

  it('"Other day" reveals the date field (focused); a chosen day lights it with that date', async () => {
    const user = userEvent.setup();
    renderNew();
    expect(screen.queryByLabelText(/^Date/)).toBeNull();
    await user.click(screen.getByTestId('task-other-day'));
    const date = screen.getByLabelText(/^Date/, { selector: 'input' });
    expect(screen.getByTestId('task-other-day')).toHaveAttribute('aria-expanded', 'true');
    await waitFor(() => expect(date).toHaveFocus());
    fireEvent.change(date, { target: { value: '2027-03-15' } });
    const other = screen.getByRole('button', { name: 'Other day, Mon, Mar 15' });
    expect(other).toHaveClass('bg-ink');
    expect(radio(/^Today/)).not.toBeChecked();
    expect(radio(/^Tomorrow/)).not.toBeChecked();
    // Typing today's date into the open field keeps it open (it never vanishes under the cursor).
    fireEvent.change(date, { target: { value: '2027-02-10' } });
    expect(radio(/^Today/)).toBeChecked();
    expect(screen.getByLabelText(/^Date/, { selector: 'input' })).toBeInTheDocument();
    // A day tile folds it.
    await user.click(radio(/^Tomorrow/));
    expect(screen.queryByLabelText(/^Date/, { selector: 'input' })).toBeNull();
  });

  it('with a time in a far zone the date field still shows the RECIPIENT\'s day, and says whose', async () => {
    useCircleResult.timezone = 'Pacific/Auckland';
    const user = userEvent.setup();
    renderNew();
    await user.type(titleBox(), 'Book a ride');
    await user.click(screen.getByTestId('task-other-day'));
    fireEvent.change(screen.getByLabelText(/^Date/, { selector: 'input' }), { target: { value: '2027-02-14' } });
    await user.click(screen.getByTestId('task-pick-time'));
    fireEvent.change(timeInput(), { target: { value: '07:15' } });
    // 07:15 Sunday in Auckland is 11:15 Saturday in Denver: the field keeps naming Sunday.
    const date = screen.getByLabelText(/^Date/, { selector: 'input' });
    expect(date).toHaveValue('2027-02-14');
    expect(screen.getByText("Days are in Rosa's time zone (Auckland)")).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Other day, Sun, Feb 14' })).toBeInTheDocument();
    const body = await saveCreate(user);
    expect(body.scheduled_date).toBe('2027-02-14');
    expect(body.scheduled_time).toBe('07:15');
  });

  it('picking the time first, then the day, keeps the recipient\'s time on the new day (and the duration)', async () => {
    useCircleResult.timezone = 'Pacific/Auckland';
    const user = userEvent.setup();
    renderNew();
    await user.type(titleBox(), 'Clean');
    await user.click(screen.getByTestId('task-pick-time'));
    fireEvent.change(timeInput(), { target: { value: '09:00' } });
    await user.click(moreToggle());
    await user.click(screen.getByRole('radio', { name: '1 hr' }));
    await user.click(screen.getByTestId('task-other-day'));
    // After Auckland's clocks go back (Apr 4) and Denver's go forward (Mar 14): the viewer clock moves 2h.
    fireEvent.change(screen.getByLabelText(/^Date/, { selector: 'input' }), { target: { value: '2027-04-10' } });
    expect(timeInput()).toHaveValue('09:00');
    expect(screen.getByLabelText(/^End time/, { selector: 'input' })).toHaveValue('10:00');
    const body = await saveCreate(user);
    expect(body).toMatchObject({ scheduled_date: '2027-04-10', scheduled_time: '09:00', duration_minutes: 60 });
  });
});

describe('When? Any time vs Pick a time (the recipient\'s clock)', () => {
  it('Any time starts checked; tasks save without a time (no end, no reminders offered)', async () => {
    const user = userEvent.setup();
    renderNew();
    expect(radio('Any time')).toBeChecked();
    expect(screen.getByTestId('task-pick-time')).toHaveAttribute('aria-expanded', 'false');
    await user.type(titleBox(), 'Water the plants');
    await user.click(moreToggle());
    expect(screen.queryByLabelText(/^End time/)).toBeNull();
    expect(screen.queryByRole('switch', { name: 'Send reminders' })).toBeNull();
    const body = await saveCreate(user);
    expect(body.scheduled_time).toBeUndefined();
    expect(body.duration_minutes).toBeUndefined();
  });

  it('Pick a time reveals "Time in <city>" typed on the recipient\'s clock; the tile names it; the line converts', async () => {
    useCircleResult.timezone = 'Pacific/Auckland';
    const user = userEvent.setup();
    renderNew();
    await user.click(screen.getByTestId('task-pick-time'));
    const field = screen.getByLabelText(/^Time in Auckland/, { selector: 'input' });
    await waitFor(() => expect(field).toHaveFocus());
    expect(screen.getByTestId('task-pick-time')).toHaveAttribute('aria-expanded', 'true');
    fireEvent.change(field, { target: { value: '07:15' } });
    expect(field).toHaveValue('07:15');
    expect(screen.getByRole('button', { name: 'Pick a time, 7:15 AM' })).toHaveClass('bg-ink');
    expect(radio('Any time')).not.toBeChecked();
    expect(screen.getByText(/^7:15 AM in Auckland is 11:15 AM the day before for you/)).toBeInTheDocument();
  });

  it('plain "Time" when the viewer is in the recipient\'s zone', async () => {
    useCircleResult.timezone = VIEWER_TZ;
    const user = userEvent.setup();
    renderNew();
    await user.click(screen.getByTestId('task-pick-time'));
    expect(screen.queryByLabelText(/^Time in/, { selector: 'input' })).toBeNull();
    expect(timeInput()).toBeInTheDocument();
  });

  it('a time brings the default 30-minute end (recipient clock) and the reminders; Any time clears both', async () => {
    useCircleResult.timezone = 'Pacific/Kiritimati';
    const user = userEvent.setup();
    renderNew();
    await user.type(titleBox(), 'Book a ride');
    await user.click(screen.getByTestId('task-pick-time'));
    fireEvent.change(timeInput(), { target: { value: '23:30' } });
    await user.click(moreToggle());
    const end = screen.getByLabelText(/^End time/, { selector: 'input' });
    expect(end).toHaveValue('00:00');
    expect(screen.getByRole('radio', { name: '30 min' })).toBeChecked();
    expect(screen.getByRole('switch', { name: 'Send reminders' })).toBeInTheDocument();
    await user.click(radio('Any time'));
    expect(radio('Any time')).toBeChecked();
    expect(screen.queryByLabelText(/^End time/)).toBeNull();
    expect(screen.queryByLabelText(/^Time/, { selector: 'input' })).toBeNull();
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
    await user.click(screen.getByTestId('task-pick-time'));
    fireEvent.change(timeInput(), { target: { value: '10:00' } });
    await user.click(moreToggle());
    const end = screen.getByLabelText(/^End time/, { selector: 'input' });
    // Named in the recipient's zone, like the start.
    expect(screen.getAllByText('Time in Auckland').length).toBeGreaterThan(0);
    fireEvent.change(end, { target: { value: '11:45' } });
    expect(end).toHaveValue('11:45');
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

  it('Once starts checked; Some days reveals the day picker inline, preselecting the start\'s weekday', async () => {
    const user = userEvent.setup();
    renderNew();
    expect(radio('Once')).toBeChecked();
    await user.type(titleBox(), 'Walk');
    await user.click(radio('Some days'));
    const picker = screen.getByRole('group', { name: /^Repeat on/ });
    // The picker sits in the How often? section, not behind More details.
    expect(screen.getByRole('radiogroup', { name: 'How often?' }).closest('section')).toContainElement(picker);
    expect(within(picker).getByRole('checkbox', { name: 'Wednesday' })).toHaveAttribute('aria-checked', 'true');
    await user.click(within(picker).getByRole('checkbox', { name: 'Friday' }));
    const body = await saveCreate(user);
    expect(body).toMatchObject({ recurrence_rule: 'weekly', recurrence_days: [3, 5] });
  });

  it.each([
    ['every_other_day', 'Every other day'],
    ['monthly', 'Monthly'],
    ['yearly', 'Yearly'],
    ['cycle:21:7', 'Cycle (days on / off)'],
  ])('a stored %s checks no tile, is named under them, opens More details and saves untouched', async (rule, name) => {
    const user = userEvent.setup();
    renderEdit(task({ recurrence_rule: rule }));
    for (const label of ['Once', 'Every day', 'Every week', 'Some days']) expect(radio(label)).not.toBeChecked();
    expect(screen.getByTestId('how-often-summary')).toHaveTextContent(name);
    expect(moreToggle()).toHaveAttribute('aria-expanded', 'true');
    expect(screen.getByRole('combobox', { name: /^Repeat/ })).toHaveValue(rule.startsWith('cycle') ? 'cycle' : rule);
    const body = await saveEdit(user);
    expect(body.recurrence_rule).toBe(rule);
  });

  it('an unnamed rule can be replaced by a tile', async () => {
    const user = userEvent.setup();
    renderEdit(task({ recurrence_rule: 'monthly' }));
    await user.click(radio('Every week'));
    expect(screen.queryByTestId('how-often-summary')).toBeNull();
    expect((await saveEdit(user)).recurrence_rule).toBe('weekly');
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
    ['2027-02-10', 'Today'],
    ['2027-02-11', 'Tomorrow'],
  ])('a task on %s lights %s', (day, label) => {
    renderEdit(task({ scheduled_date: day }));
    expect(radio(new RegExp(`^${label}`))).toBeChecked();
    expect(screen.getByTestId('task-other-day')).not.toHaveClass('bg-ink');
  });

  it('a task on another day lights Other day with its date and shows the field', () => {
    renderEdit(task({ scheduled_date: '2027-01-20' }));
    expect(screen.getByRole('button', { name: 'Other day, Wed, Jan 20' })).toHaveAttribute('aria-expanded', 'true');
    expect(screen.getByLabelText(/^Date/, { selector: 'input' })).toHaveValue('2027-01-20');
  });

  it('a timed task in a far zone: Pick a time names the stored time, the field holds it, the day is the stored day', () => {
    useCircleResult.timezone = 'Pacific/Kiritimati';
    renderEdit(task({ scheduled_date: '2027-02-12', scheduled_time: '23:30:00', duration_minutes: 30 }));
    expect(screen.getByRole('button', { name: 'Pick a time, 11:30 PM' })).toHaveAttribute('aria-expanded', 'true');
    expect(screen.getByLabelText(/^Time in Kiritimati/, { selector: 'input' })).toHaveValue('23:30');
    expect(radio(/^Tomorrow/)).toBeChecked();
    expect(radio('Any time')).not.toBeChecked();
  });

  it.each([
    [null, null, 'Once'],
    ['daily', null, 'Every day'],
    ['weekly', null, 'Every week'],
    ['weekly', [1, 3], 'Some days'],
  ] as const)('rule %s days %s lights %s', (rule, days, label) => {
    renderEdit(task({ recurrence_rule: rule, recurrence_days: days } as Partial<CalendarEvent>));
    expect(radio(label)).toBeChecked();
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

  it('details, the end time, the repeat end and the reminders are prefilled behind More details', () => {
    renderEdit(task({
      description: 'Ask about refills', scheduled_time: '10:00:00', duration_minutes: 45,
      recurrence_rule: 'daily', recurrence_end_date: '2027-03-31', reminder_1h: true,
    }));
    expect(moreToggle()).toHaveAttribute('aria-expanded', 'true');
    expect(screen.getByLabelText(/^Details/)).toHaveValue('Ask about refills');
    expect(screen.getByLabelText(/^End time/, { selector: 'input' })).toHaveValue('10:45');
    expect(screen.getByLabelText(/^End date/, { selector: 'input' })).toHaveValue('2027-03-31');
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
    expect(screen.getByRole('combobox', { name: /^Repeat/ })).toBeInTheDocument();
    // Appointment-only fields are not here.
    expect(screen.queryByLabelText(/^Location/)).toBeNull();
    expect(screen.queryByText('Doctor')).toBeNull();
  });

  it.each([
    ['details', { description: 'Bring the card' }, true],
    ['a custom duration', { scheduled_time: '10:00:00', duration_minutes: 45 }, true],
    ['a repeat end', { recurrence_rule: 'daily', recurrence_end_date: '2027-03-31' }, true],
    ['an unnamed rule', { recurrence_rule: 'every_other_day' }, true],
    ['the default duration', { scheduled_time: '10:00:00', duration_minutes: 30 }, false],
    ['no duration (PK21)', { scheduled_time: '10:00:00', duration_minutes: null }, false],
    ['a plain weekly rule', { recurrence_rule: 'weekly' }, false],
    ['nothing behind it', {}, false],
  ] as const)('an edit with %s: open = %s', (_label, over, open) => {
    renderEdit(task(over as Partial<CalendarEvent>));
    expect(moreToggle()).toHaveAttribute('aria-expanded', String(open));
    expect(simpleTaskMoreOpen(task(over as Partial<CalendarEvent>), 30)).toBe(open);
  });

  it('the repeat end date is on the RECIPIENT\'s calendar too (far zone, the day the save sends)', async () => {
    useCircleResult.timezone = 'Pacific/Kiritimati';
    const user = userEvent.setup();
    renderNew();
    await user.type(titleBox(), 'Walk');
    await user.click(screen.getByTestId('task-pick-time'));
    fireEvent.change(timeInput(), { target: { value: '06:00' } });
    await user.click(radio('Every day'));
    await user.click(moreToggle());
    fireEvent.change(screen.getByLabelText(/^End date/, { selector: 'input' }), { target: { value: '2027-03-26' } });
    expect(screen.getByLabelText(/^End date/, { selector: 'input' })).toHaveValue('2027-03-26');
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

  it('a cleared end time opens More details to show its error', async () => {
    const user = userEvent.setup();
    renderNew();
    await user.type(titleBox(), 'Clean');
    await user.click(screen.getByTestId('task-pick-time'));
    fireEvent.change(timeInput(), { target: { value: '10:00' } });
    await user.click(moreToggle());
    fireEvent.change(screen.getByLabelText(/^End time/, { selector: 'input' }), { target: { value: '' } });
    await user.click(moreToggle());
    expect(moreToggle()).toHaveAttribute('aria-expanded', 'false');
    await user.click(screen.getByTestId('add-event-save'));
    expect(mutateCreate).not.toHaveBeenCalled();
    await waitFor(() => expect(moreToggle()).toHaveAttribute('aria-expanded', 'true'));
    expect(screen.getByLabelText(/^End time/, { selector: 'input' })).toHaveAttribute('aria-invalid', 'true');
  });

  it('a cleared day: Save opens the date field and focuses it', async () => {
    const user = userEvent.setup();
    renderNew();
    await user.type(titleBox(), 'Clean');
    await user.click(screen.getByTestId('task-other-day'));
    fireEvent.change(screen.getByLabelText(/^Date/, { selector: 'input' }), { target: { value: '' } });
    await user.click(screen.getByTestId('add-event-save'));
    expect(mutateCreate).not.toHaveBeenCalled();
    await waitFor(() => expect(screen.getByLabelText(/^Date/, { selector: 'input' })).toHaveFocus());
  });
});

describe('the series and the completed-task rules stay as they were', () => {
  it('a recurring task edit (also from a completed occurrence) keeps the series note and saves to the root', async () => {
    const user = userEvent.setup();
    const root = task({ id: 'root-1', recurrence_rule: 'daily', scheduled_date: '2027-01-04' });
    renderEdit({ ...root, id: 'child-1', parent_event_id: 'root-1', completed_at: '2027-02-01T15:00:00Z' } as CalendarEvent);
    expect(screen.getByTestId('series-edit-note')).toHaveTextContent('Changes apply to upcoming tasks.');
    await user.click(screen.getByRole('button', { name: 'Save changes' }));
    await waitFor(() => expect(mutateUpdate).toHaveBeenCalledTimes(1));
    expect((mutateUpdate.mock.calls[0][0] as { eventId: string }).eventId).toBe('root-1');
  });
});

describe('accessibility', () => {
  it('every tile row is a named radiogroup of radios with checked state; the openers are buttons with aria-expanded', () => {
    renderNew();
    for (const name of ['When?', 'Time', 'How often?', "Who's doing it?"]) {
      const group = radiogroup(name);
      const radios = within(group).getAllByRole('radio');
      expect(radios.length).toBeGreaterThan(0);
      expect(radios.filter((r) => r.getAttribute('aria-checked') === 'true')).toHaveLength(1);
    }
    for (const id of ['task-other-day', 'task-pick-time']) {
      expect(screen.getByTestId(id).tagName).toBe('BUTTON');
      expect(screen.getByTestId(id)).toHaveAttribute('aria-expanded');
    }
    expect(moreToggle()).toHaveAttribute('aria-expanded', 'false');
  });

  it('every tile is the shared 56px-tall, 44px-wide choice tile and wraps its text (no truncation)', () => {
    renderNew();
    const tiles = [
      ...within(screen.getByTestId('simple-task-form')).getAllByRole('radio').filter((r) => r.closest('[role="radiogroup"]')?.id !== 'title-suggestions'),
      screen.getByTestId('task-other-day'),
      screen.getByTestId('task-pick-time'),
    ];
    for (const tile of tiles) {
      expect(tile).toHaveClass('min-h-[56px]', 'min-w-[44px]', 'max-w-full');
      expect(tile.className).not.toMatch(/truncate|whitespace-nowrap/);
    }
    // The day and time rows wrap; their trailing button shares the row outside the radiogroup.
    for (const [row, group, button] of [
      ['task-day-row', 'When?', 'task-other-day'],
      ['task-time-row', 'Time', 'task-pick-time'],
    ]) {
      expect(screen.getByTestId(row)).toHaveClass('flex', 'flex-wrap');
      expect(radiogroup(group)).toHaveClass('contents');
      expect(radiogroup(group)).not.toContainElement(screen.getByTestId(button));
      expect(screen.getByTestId(row)).toContainElement(screen.getByTestId(button));
    }
  });

  it('the More details hint wraps rather than truncating', () => {
    renderNew();
    const hint = within(moreToggle()).getByText('Details, reminders, end date');
    expect(hint).not.toHaveClass('truncate');
  });
});

describe('analytics', () => {
  it('a new task: entry_form_opened(task), the four funnel steps once each, entry_save_tapped layout simple', async () => {
    const user = userEvent.setup();
    renderNew({ entry: 'add_menu' });
    expect(opened).toHaveBeenCalledWith({ type: 'task', entry: 'add_menu' });
    await user.type(titleBox(), 'Groceries');
    await user.click(radio(/^Tomorrow/));
    await user.click(radio('Every day'));
    await user.click(radio('Me'));
    await user.click(radio(/^Today/));
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
    await user.click(screen.getByTestId('task-pick-time'));
    fireEvent.change(timeInput(), { target: { value: '10:00' } });
    expect(stepDone).toHaveBeenCalledWith({ type: 'task', step: 'when' });
  });

  it('an edit never counts funnel steps and reports layout simple', async () => {
    const user = userEvent.setup();
    renderEdit(task());
    await user.click(radio(/^Tomorrow/));
    await user.click(radio('Every day'));
    await user.click(radio('Me'));
    await saveEdit(user);
    expect(stepDone).not.toHaveBeenCalled();
    expect(opened).not.toHaveBeenCalled();
    expect(tapped).toHaveBeenCalledWith(CIRCLE_ID, 'task', 'form', true, 'simple');
  });

  it('the full task form (AI-drafted / follow-up on mobile; layout="full" here) reports layout full and counts no steps', async () => {
    const user = userEvent.setup();
    renderNew({ layout: 'full' });
    await user.type(titleBox(), 'Groceries');
    await user.tab();
    await saveCreate(user);
    expect(tapped).toHaveBeenCalledWith(CIRCLE_ID, 'task', 'form', false, 'full');
    expect(stepDone).not.toHaveBeenCalled();
  });
});
