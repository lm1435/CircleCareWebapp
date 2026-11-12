import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import '@/i18n';
import type { CalendarEvent } from '@/api/calendarEvents';
import { Analytics } from '@/lib/analytics';
import { resetLargeTextReports } from '@/lib/largeText';
import { AddEventModal } from '../AddEventModal';

// EDITING A MEDICATION / APPOINTMENT USES THE SIMPLE LAYOUT (owner decision, 1.4.0): editing looks
// exactly like adding, prefilled from the saved event. Only the title ("Edit medication") and the
// Save label ("Save changes") differ. Pinned here:
//   - the PATCH body: the exact body saved for an untouched save and for a few edits, pinned as literals;
//   - the prefill of every "How often?" kind and of the time chips, "Other time" included;
//   - the locks an edit keeps (no "When needed" on a scheduled med, no "+ Another dose");
//   - "More details" stays collapsed on an edit even with stored values behind it (build 11, owner 2026-11-10:
//     edit = new, pre-filled); a doctor's address filling the location keeps it open;
//   - the add-form funnel never counts an edit; entry_save_tapped carries `layout`.
// Mobile parity: mobile/src/__tests__/screens/AddEventSimpleEdit.test.tsx.

const ORIGINAL_TZ = process.env.TZ;
beforeAll(() => {
  process.env.TZ = 'America/Denver';
});
afterAll(() => {
  process.env.TZ = ORIGINAL_TZ;
});

const RECIPIENT_TZ = 'America/New_York';
const ANA_ID = '3f1c2a4e-5b6d-4c7e-8f90-a1b2c3d4e5f6';
const PATEL_ID = '11111111-1111-4111-8111-111111111111';
const CIRCLE_ID = 'circle-1';

const mutateUpdate = vi.fn();
vi.mock('../DoseQuietHoursNote', () => ({ DoseQuietHoursNote: () => null }));
vi.mock('@/api/drugs', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/api/drugs')>();
  return { ...actual, searchDrugs: vi.fn().mockResolvedValue([]) };
});
const PATEL = {
  id: PATEL_ID, circle_id: CIRCLE_ID, name: 'Dr. Patel', specialty: 'Cardiology', phone: null,
  country_code: null, phone_extension: null, address: '1200 Heart Center Dr', is_primary: true,
  sort_order: 0, archived_at: null, created_at: 'x', updated_at: 'x',
};
vi.mock('@/hooks/useProviders', () => ({
  useProviders: () => ({ providers: [PATEL], isSuccess: true }),
}));
vi.mock('@/hooks/useCalendarEvents', () => ({
  useCreateEvent: () => ({ mutateAsync: vi.fn(), isPending: false }),
  useUpdateEvent: () => ({ mutateAsync: mutateUpdate, isPending: false }),
  useCachedCircleEvents: () => [],
}));
vi.mock('@/hooks/useSeriesRoot', () => ({
  useSeriesRoot: (_c: string, event: unknown) => ({ root: event ?? null }),
}));
const useCircleResult = {
  circle: undefined,
  circleSummary: undefined,
  timezone: RECIPIENT_TZ,
  members: [{ id: ANA_ID, email: 'ana@example.com', first_name: 'Ana', is_care_recipient: false }],
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

let chipSpy: ReturnType<typeof vi.spyOn>;
let stepDone: ReturnType<typeof vi.spyOn>;
let opened: ReturnType<typeof vi.spyOn>;
let tapped: ReturnType<typeof vi.spyOn>;

beforeEach(() => {
  vi.clearAllMocks();
  resetLargeTextReports();
  mutateUpdate.mockResolvedValue({ id: 'x' });
  chipSpy = vi.spyOn(Analytics, 'timeChipSelected').mockImplementation(() => {});
  stepDone = vi.spyOn(Analytics, 'entryFormStepCompleted').mockImplementation(() => {});
  opened = vi.spyOn(Analytics, 'entryFormOpened').mockImplementation(() => {});
  tapped = vi.spyOn(Analytics, 'entrySaveTapped').mockImplementation(() => {});
});
afterEach(() => {
  vi.restoreAllMocks();
});

const base = {
  circle_id: CIRCLE_ID,
  created_at: '2026-06-01T00:00:00Z',
  updated_at: '2026-06-01T00:00:00Z',
  notifications_enabled: true,
  reminder_at_due: true,
  reminder_24h: false,
  reminder_1h: false,
  reminder_30m: false,
  reminder_15m: false,
};
function med(over: Partial<CalendarEvent> = {}): CalendarEvent {
  return {
    ...base, id: 'med-1', event_type: 'medication', title: 'Metformin', medication_name: 'Metformin',
    medication_dosage: '500 mg', scheduled_date: '2099-01-05', scheduled_time: '08:00:00',
    recurrence_rule: 'daily', ...over,
  } as CalendarEvent;
}
function appt(over: Partial<CalendarEvent> = {}): CalendarEvent {
  return {
    ...base, id: 'appt-1', event_type: 'appointment', title: 'Cardiology', scheduled_date: '2099-01-20',
    scheduled_time: '10:00:00', duration_minutes: 45, location: '1 Main St', description: 'Bring the list',
    assigned_to: null, recurrence_rule: null, ...over,
  } as CalendarEvent;
}
const EVENTS: Record<string, CalendarEvent> = {
  medDaily: med({ description: 'With food', recurrence_end_date: '2099-12-31' }),
  medDays: med({ scheduled_time: '07:30:00', recurrence_rule: 'weekly', recurrence_days: [1, 3, 5] }),
  medMonthly: med({ scheduled_time: '21:00:00', recurrence_rule: 'monthly' }),
  medCycle: med({ scheduled_time: '12:00:00', recurrence_rule: 'cycle:21:7' }),
  medPrn: med({ scheduled_time: null, recurrence_rule: null, as_needed: true, as_needed_reason: 'pain' } as Partial<CalendarEvent>),
  appt: appt(),
  apptWeekly: appt({ location: '', description: '', recurrence_rule: 'weekly', recurrence_days: [1, 4], recurrence_end_date: '2099-03-31', provider_id: PATEL_ID } as Partial<CalendarEvent>),
};

function renderEdit(event: CalendarEvent) {
  return render(<AddEventModal circleId={CIRCLE_ID} event={event} onClose={vi.fn()} />);
}
async function patchBody(
  event: CalendarEvent,
  act?: (user: ReturnType<typeof userEvent.setup>) => Promise<void>
): Promise<unknown> {
  mutateUpdate.mockClear();
  const user = userEvent.setup();
  const view = renderEdit(event);
  if (act) await act(user);
  await user.click(screen.getByRole('button', { name: 'Save changes' }));
  await waitFor(() => expect(mutateUpdate).toHaveBeenCalledTimes(1));
  const body = JSON.parse(JSON.stringify(mutateUpdate.mock.calls[0][0]));
  view.unmount();
  return body;
}
const timeChips = () => screen.getByRole('radiogroup', { name: 'Common dose times' });
const chip = (name: RegExp) => within(timeChips()).getByRole('radio', { name });
const howOften = () => screen.getByRole('radiogroup', { name: 'How often?' });
const moreToggle = () => document.getElementById('more-details') as HTMLElement;
const row = (id: string) => document.getElementById(id) as HTMLElement;

const REMINDERS = {
  notifications_enabled: true,
  reminder_at_due: true,
  reminder_24h: false,
  reminder_1h: false,
  reminder_30m: false,
  reminder_15m: false,
};
const MED_DATA = {
  event_type: 'medication',
  title: 'Metformin',
  scheduled_date: '2099-01-05',
  ...REMINDERS,
  medication_name: 'Metformin',
};
const APPT_DATA = {
  event_type: 'appointment',
  title: 'Cardiology',
  scheduled_date: '2099-01-20',
  scheduled_time: '10:00',
  duration_minutes: 45,
  ...REMINDERS,
  recurrence_rule: null,
  recurrence_end_date: null,
  assigned_to: null,
  provider_id: null,
};
const APPT_WEEKLY_DATA = {
  ...APPT_DATA,
  scheduled_date: '2099-01-22',
  recurrence_rule: 'weekly',
  recurrence_end_date: '2099-03-31',
  recurrence_days: [1, 4],
  provider_id: PATEL_ID,
};
// What an untouched save of each saved event PATCHes.
const UNTOUCHED: Record<string, { eventId: string; data: Record<string, unknown> }> = {
  medDaily: {
    eventId: 'med-1',
    data: { ...MED_DATA, scheduled_time: '08:00', recurrence_rule: 'daily', recurrence_end_date: '2099-12-31' },
  },
  medDays: {
    eventId: 'med-1',
    data: {
      ...MED_DATA,
      scheduled_time: '07:30',
      recurrence_rule: 'weekly',
      recurrence_end_date: null,
      recurrence_days: [1, 3, 5],
    },
  },
  medMonthly: {
    eventId: 'med-1',
    data: { ...MED_DATA, scheduled_time: '21:00', recurrence_rule: 'monthly', recurrence_end_date: null },
  },
  medCycle: {
    eventId: 'med-1',
    data: { ...MED_DATA, scheduled_time: '12:00', recurrence_rule: 'cycle:21:7', recurrence_end_date: null },
  },
  medPrn: {
    eventId: 'med-1',
    data: {
      event_type: 'medication',
      title: 'Metformin',
      scheduled_date: '2026-11-11', // an as-needed med has no schedule: the save stamps "today"
      notifications_enabled: true,
      as_needed_reason: 'pain',
      medication_name: 'Metformin',
    },
  },
  appt: { eventId: 'appt-1', data: APPT_DATA },
  apptWeekly: { eventId: 'appt-1', data: APPT_WEEKLY_DATA },
};

describe('the PATCH body', () => {
  beforeEach(() => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date('2026-11-11T17:00:00Z'));
  });

  it.each(Object.keys(EVENTS))('untouched save of %s', async (key) => {
    const body = await patchBody(EVENTS[key]);
    expect(body).toEqual(UNTOUCHED[key]);
  });

  it.each(['medDaily', 'medDays', 'medPrn'])('a dosage edit of %s', async (key) => {
    const edit = async (user: ReturnType<typeof userEvent.setup>) => {
      const dose = screen.getByLabelText('Dosage');
      await user.clear(dose);
      await user.type(dose, '1000 mg');
    };
    const body = await patchBody(EVENTS[key], edit);
    expect(body).toEqual({
      eventId: 'med-1',
      data: { ...UNTOUCHED[key].data, medication_dosage: '1000 mg' },
    });
  });

  it.each(['appt', 'apptWeekly'])('a title edit of %s', async (key) => {
    const edit = async (user: ReturnType<typeof userEvent.setup>) => {
      const field = screen.getByLabelText(/^Title( \*)?( \(required\))?$/);
      await user.clear(field);
      await user.type(field, 'Follow-up');
    };
    const body = await patchBody(EVENTS[key], edit);
    expect(body).toEqual({
      eventId: 'appt-1',
      data: { ...UNTOUCHED[key].data, title: 'Follow-up' },
    });
  });

  it('the Evening chip saves 18:00 (6:00 PM New York on a Denver viewer)', async () => {
    const body = await patchBody(EVENTS.medDaily, async (user) => {
      await user.click(chip(/Evening/));
    });
    expect(body).toEqual({
      eventId: 'med-1',
      data: { ...UNTOUCHED.medDaily.data, scheduled_time: '18:00' },
    });
  });
});

describe('it looks like the add form', () => {
  it('medication: "Edit medication", the add form questions, Save changes', () => {
    renderEdit(EVENTS.medDays);
    expect(screen.getByRole('dialog', { name: 'Edit medication' })).toBeInTheDocument();
    expect(screen.getByTestId('simple-medication-form')).toBeInTheDocument();
    // The add form's order (build 11): What is it? / When? (Starts | Repeats until, How often?) / What time?.
    expect(
      within(screen.getByTestId('simple-medication-form')).getAllByRole('heading', { level: 3 }).map((h) => h.textContent)
    ).toEqual(['What is it?', 'When? *', 'What time?']);
    expect(screen.getByRole('heading', { name: 'When?' }).closest('section')).toContainElement(howOften());
    expect(screen.getByTestId('starts-tile')).toBeInTheDocument();
    expect(screen.getByTestId('repeats-until-tile')).toBeInTheDocument();
    expect(screen.getByTestId('add-event-save')).toHaveTextContent('Save changes');
    // An edit holds ONE dose: the chips are a radiogroup (one answer), never the add form's checkboxes.
    expect(within(timeChips()).queryAllByRole('checkbox')).toHaveLength(0);
    // No "+ Another dose" on an edit (each extra dose is a NEW medication), even with a time set.
    expect(screen.queryByTestId('add-another-dose')).toBeNull();
    expect(screen.queryByLabelText('Type')).toBeNull();
  });

  it('appointment: "Edit appointment", the add form questions, one More details', () => {
    renderEdit(EVENTS.appt);
    expect(screen.getByRole('dialog', { name: 'Edit appointment' })).toBeInTheDocument();
    expect(screen.getByTestId('simple-appointment-form')).toBeInTheDocument();
    expect(
      within(screen.getByTestId('simple-appointment-form')).getAllByRole('heading', { level: 3 }).map((h) => h.textContent)
    ).toEqual(['What is it?', 'When? *', 'What time?', "Who's going?"]);
    expect(screen.getByRole('radio', { name: 'Pick a time' })).toBeChecked();
    expect(screen.getByTestId('appt-from-tile')).toBeInTheDocument();
    expect(screen.getByTestId('appt-to-tile')).toBeInTheDocument();
    for (const id of ['row-doctor', 'row-place', 'row-notes', 'row-repeat']) expect(row(id)).toBeNull();
    expect(moreToggle()).toBeInTheDocument();
    // Suggestions are for a NEW appointment only.
    expect(screen.queryByRole('radiogroup', { name: 'Title suggestions' })).toBeNull();
  });

  it('a task edit gets the simple task form too (owner 1.4.0)', () => {
    renderEdit({ ...appt(), id: 't-1', event_type: 'task', title: 'Pick up' } as CalendarEvent);
    expect(screen.queryByTestId('simple-medication-form')).toBeNull();
    expect(screen.queryByTestId('simple-appointment-form')).toBeNull();
    expect(screen.getByTestId('simple-task-form')).toBeInTheDocument();
    expect(screen.getByRole('dialog', { name: 'Edit task' })).toBeInTheDocument();
  });
});

describe('the time chips light from the stored time', () => {
  it.each([
    ['08:00:00', /Morning/],
    ['12:00:00', /Midday/],
    ['18:00:00', /Evening/],
    ['21:00:00', /Bedtime/],
  ])('%s lights its chip', (time, name) => {
    renderEdit(med({ scheduled_time: time }));
    expect(chip(name)).toBeChecked();
    expect(within(timeChips()).getAllByRole('radio').filter((r) => r.getAttribute('aria-checked') === 'true')).toHaveLength(1);
    expect(screen.queryByTestId('time-chip-other-time')).toBeNull();
  });

  it('an edit holds one time: no "Tap every time it\'s taken." hint and no dose summary (owner 1.4.1 (15))', () => {
    renderEdit(med());
    expect(screen.queryByTestId('dose-times-hint')).toBeNull();
    expect(timeChips()).not.toHaveAccessibleDescription(/Tap every time/);
    expect(screen.queryByTestId('dose-summary')).toBeNull();
    // Design B: no add / added marks on an edit's one-answer chips.
    expect(screen.queryAllByTestId('time-chip-mark')).toHaveLength(0);
  });

  it('a time that is no chip is its own lit chip ("7:30 AM / Other"); the Other… picker holds it', async () => {
    renderEdit(EVENTS.medDays); // 7:30 New York = 5:30 Denver
    for (const name of [/Morning/, /Midday/, /Evening/, /Bedtime/]) expect(chip(name)).not.toBeChecked();
    // ONE clock on the control: the chip names the RECIPIENT's 7:30, time first, like the presets; the viewer's
    // 5:30 is in the zone caption only.
    // Fix13: a lit box outside the presets' radiogroup, its own picker on the stored 7:30, and a "×".
    const custom = screen.getByTestId('time-chip-custom');
    expect(timeChips()).not.toContainElement(custom);
    expect(screen.getByTestId('time-chip-custom-box')).toHaveClass('bg-ink', 'text-cream');
    expect(custom).toHaveTextContent(/^7:30 AM\s*Other$/);
    expect(screen.getByLabelText('Change 7:30 AM dose time', { selector: 'input' })).toHaveValue('07:30');
    expect(screen.getByRole('button', { name: 'Remove 7:30 AM dose' })).toBeInTheDocument();
    expect(screen.getByTestId('time-zone-caption')).toHaveTextContent('New York time · 5:30 AM your time (Denver)');
    // "Other…" opens on the stored time (its hidden input carries it, on the recipient's clock).
    const other = screen.getByLabelText('Other time', { selector: 'input' });
    expect(other).toHaveValue('07:30');
    // Choosing a chip's time there lights that chip; the custom chip goes.
    const user = userEvent.setup();
    await user.click(screen.getByTestId('time-chip-other'));
    fireEvent.change(other, { target: { value: '08:00' } });
    expect(chip(/Morning/)).toBeChecked();
    expect(screen.queryByTestId('time-chip-custom')).toBeNull();
  });
});

describe('"How often?" reflects the stored repeat', () => {
  it('daily -> Every day; "When needed" is not offered on a scheduled medication', () => {
    renderEdit(EVENTS.medDaily);
    expect(within(howOften()).getByRole('radio', { name: 'Every day' })).toBeChecked();
    expect(within(howOften()).queryByRole('radio', { name: 'When needed' })).toBeNull();
  });

  it('weekly on days -> Custom… lit and open on Some days, the day picker open', () => {
    renderEdit(EVENTS.medDays);
    for (const r of within(howOften()).getAllByRole('radio')) expect(r).not.toBeChecked();
    expect(screen.getByTestId('repeat-custom')).toHaveAttribute('aria-expanded', 'true');
    const panel = within(screen.getByTestId('repeat-custom-panel'));
    expect(panel.getByRole('radio', { name: 'Some days' })).toBeChecked();
    expect(screen.getByRole('group', { name: 'Repeat on' })).toBeInTheDocument();
  });

  it('as needed -> When needed, locked (disabled) with the helper; no dates and no What time?', () => {
    renderEdit(EVENTS.medPrn);
    const needed = within(howOften()).getByRole('radio', { name: 'When needed' });
    expect(needed).toBeChecked();
    for (const r of within(howOften()).getAllByRole('radio')) expect(r).toBeDisabled();
    expect(screen.getByTestId('as-needed-locked-how-often')).toHaveTextContent(/can't be changed/);
    // When? holds only How often? (the server pins an as-needed schedule): no Starts | Repeats until tiles.
    expect(screen.queryByTestId('starts-tile')).toBeNull();
    expect(screen.queryByTestId('repeats-until-tile')).toBeNull();
    expect(screen.queryByRole('heading', { name: 'What time?' })).toBeNull();
    expect(screen.queryByRole('radiogroup', { name: 'Common dose times' })).toBeNull();
  });

  it.each([
    ['medMonthly', 'Monthly'],
    ['medCycle', 'Days on / off'],
  ])('%s: its Custom… tile lit and open; More details stays closed (the rule is not behind it)', (key, label) => {
    renderEdit(EVENTS[key]);
    for (const r of within(howOften()).getAllByRole('radio')) expect(r).not.toBeChecked();
    const panel = within(screen.getByTestId('repeat-custom-panel'));
    expect(panel.getByRole('radio', { name: label })).toBeChecked();
    expect(moreToggle()).toHaveAttribute('aria-expanded', 'false');
    expect(screen.queryByRole('combobox', { name: 'Repeat', hidden: true })).toBeNull();
  });

  it('a one-off medication -> Once under Custom…', () => {
    renderEdit(med({ recurrence_rule: null }));
    const panel = within(screen.getByTestId('repeat-custom-panel'));
    expect(panel.getByRole('radio', { name: 'Once' })).toBeChecked();
  });

  it('appointment rules light the task grid: weekly on days -> Custom… / Some days', () => {
    renderEdit(EVENTS.apptWeekly);
    expect(within(screen.getByTestId('repeat-custom-panel')).getByRole('radio', { name: 'Some days' })).toBeChecked();
  });
});

// Build 11 (owner 2026-11-10): "More details (collapsed by default, also on edit)". The stored values are there,
// pre-filled, behind the collapsed row; the repeat end is the "Repeats until" tile in When?.
describe('More details stays collapsed on an edit; saved values are pre-filled', () => {
  it('medication: instructions sit pre-filled behind a COLLAPSED More details; the repeat end is the Repeats until tile', () => {
    const { unmount } = renderEdit(med());
    expect(moreToggle()).toHaveAttribute('aria-expanded', 'false');
    expect(screen.getByTestId('repeats-until-tile')).toHaveTextContent('Never');
    unmount();
    renderEdit(EVENTS.medDaily);
    expect(moreToggle()).toHaveAttribute('aria-expanded', 'false');
    expect(screen.getByLabelText(/^Repeats until/, { selector: 'input' })).toHaveValue('2099-12-31');
    expect(screen.getByTestId('repeats-until-tile')).toHaveTextContent('Thu, Dec 31');
    fireEvent.click(moreToggle());
    expect(screen.getByLabelText('Instructions')).toHaveValue('With food');
  });

  it.each([
    ['location + notes', { location: '1 Main St', description: 'Bring the list' }],
    ['location', { location: '1 Main St', description: '' }],
    ['notes', { location: '', description: 'Bring the list' }],
    ['a doctor', { location: '', description: '', provider_id: PATEL_ID }],
    ['a repeat end date', { location: '', description: '', duration_minutes: 30, recurrence_rule: 'weekly', recurrence_end_date: '2099-03-31' }],
  ])('appointment: %s keeps More details collapsed', (_name, over) => {
    renderEdit(appt(over as Partial<CalendarEvent>));
    expect(moreToggle()).toHaveAttribute('aria-expanded', 'false');
  });

  it('appointment: a stored repeat end shows on the Repeats until tile (outside More details)', () => {
    renderEdit(appt({ recurrence_rule: 'weekly', recurrence_end_date: '2099-03-31' } as Partial<CalendarEvent>));
    expect(screen.getByLabelText(/^Repeats until/, { selector: 'input' })).toHaveValue('2099-03-31');
    expect(screen.getByTestId('repeats-until-tile')).toHaveTextContent('Tue, Mar 31');
    expect(document.getElementById('more-details-panel')).not.toContainElement(screen.getByTestId('repeats-until-tile'));
  });

  it('appointment: nothing stored behind it keeps More details closed', () => {
    renderEdit(appt({ location: '', description: '', duration_minutes: 30 }));
    expect(moreToggle()).toHaveAttribute('aria-expanded', 'false');
  });

  it('appointment edit: From | To are seeded from the event, on the CIRCLE clock, under What time?', () => {
    // 10:00 New York (the circle) = 8:00 AM Denver (the viewer), 45 minutes long.
    renderEdit(appt({}));
    expect(screen.getByTestId('appt-from-tile')).toHaveTextContent('10:00 AM');
    expect(screen.getByTestId('appt-to-tile')).toHaveTextContent('10:45 AM');
    expect(screen.getByLabelText('From', { selector: 'input' })).toHaveValue('10:00');
    expect(screen.getByLabelText('To', { selector: 'input' })).toHaveValue('10:45');
    // Circle time first, the viewer's range in the caption (replaces "Times are for Denver.").
    expect(screen.getByTestId('time-zone-caption')).toHaveTextContent('New York time · 8:00 – 8:45 AM your time (Denver)');
    expect(screen.queryByText(/Times are for/)).toBeNull();
    // No length chips (build 11).
    for (const name of ['30 min', '1 hr', '2 hrs']) expect(screen.queryByRole('radio', { name })).toBeNull();
  });

  it('appointment: a length other than 30 min keeps More details closed (To sits under What time?)', () => {
    renderEdit(appt({ location: '', description: '', duration_minutes: 45 }));
    expect(moreToggle()).toHaveAttribute('aria-expanded', 'false');
    expect(screen.getByTestId('appt-to-tile')).toBeVisible();
  });

  it('appointment: the stored doctor and location show inside More details once opened', () => {
    const { unmount } = renderEdit(EVENTS.apptWeekly);
    fireEvent.click(moreToggle());
    expect(screen.getByRole('combobox', { name: 'Doctor' })).toHaveValue(PATEL_ID);
    unmount();
    renderEdit(EVENTS.appt);
    fireEvent.click(moreToggle());
    expect(screen.getByLabelText(/^Location/)).toHaveValue('1 Main St');
  });

  it("a doctor's address fills the empty location, under the same More details", async () => {
    const user = userEvent.setup();
    renderEdit(appt({ location: '', description: '' }));
    await user.click(moreToggle());
    expect(moreToggle()).toHaveAttribute('aria-expanded', 'true');
    await user.selectOptions(screen.getByRole('combobox', { name: 'Doctor' }), PATEL_ID);
    expect(screen.getByLabelText(/^Location/)).toHaveValue('1200 Heart Center Dr');
    expect(moreToggle()).toHaveAttribute('aria-expanded', 'true');
  });
});

describe('analytics', () => {
  it('an edit never feeds the add-form funnel', async () => {
    const user = userEvent.setup();
    renderEdit(EVENTS.medDays);
    await user.click(chip(/Evening/));
    await user.click(within(howOften()).getByRole('radio', { name: 'Every day' }));
    expect(chipSpy).not.toHaveBeenCalled();
    expect(stepDone).not.toHaveBeenCalled();
    expect(opened).not.toHaveBeenCalled();
  });

  it.each([
    ['medDaily', 'medication'],
    ['appt', 'appointment'],
  ])('entry_save_tapped on an edit of %s says is_editing and layout simple', async (key, type) => {
    await patchBody(EVENTS[key]);
    expect(tapped).toHaveBeenCalledWith(CIRCLE_ID, type, 'form', true, 'simple');
  });
});
