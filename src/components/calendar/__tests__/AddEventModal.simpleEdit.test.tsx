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
//   - the PATCH body: the same event and the same edits through the simple layout and the full one
//     (`layout="full"`, the layout every edit used before) must be identical;
//   - the prefill of every "How often?" kind and of the time chips, "Other time" included;
//   - the locks an edit keeps (no "When needed" on a scheduled med, no "+ Another dose");
//   - a stored value behind a disclosure opens it; the Place row a doctor filled opens and folds;
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

function renderEdit(event: CalendarEvent, layout?: 'full') {
  return render(<AddEventModal circleId={CIRCLE_ID} event={event} layout={layout} onClose={vi.fn()} />);
}
async function patchBody(
  event: CalendarEvent,
  layout: 'full' | undefined,
  act?: (user: ReturnType<typeof userEvent.setup>) => Promise<void>
): Promise<unknown> {
  mutateUpdate.mockClear();
  const user = userEvent.setup();
  const view = renderEdit(event, layout);
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

describe('the PATCH is the one the full edit layout sends', () => {
  it.each(Object.keys(EVENTS))('untouched save of %s', async (key) => {
    const simple = await patchBody(EVENTS[key], undefined);
    const full = await patchBody(EVENTS[key], 'full');
    expect(simple).toEqual(full);
    expect(simple).toMatchObject({ eventId: EVENTS[key].id });
  });

  it.each(['medDaily', 'medDays', 'medPrn'])('a dosage edit of %s', async (key) => {
    const edit = async (user: ReturnType<typeof userEvent.setup>) => {
      const dose = screen.getByLabelText('Dosage');
      await user.clear(dose);
      await user.type(dose, '1000 mg');
    };
    const simple = await patchBody(EVENTS[key], undefined, edit);
    const full = await patchBody(EVENTS[key], 'full', edit);
    expect(simple).toEqual(full);
    expect(simple).toMatchObject({ data: { medication_dosage: '1000 mg' } });
  });

  it.each(['appt', 'apptWeekly'])('a title edit of %s', async (key) => {
    const edit = async (user: ReturnType<typeof userEvent.setup>) => {
      const field = screen.getByLabelText(/^Title( \* \(required\))?$/);
      await user.clear(field);
      await user.type(field, 'Follow-up');
    };
    const simple = await patchBody(EVENTS[key], undefined, edit);
    const full = await patchBody(EVENTS[key], 'full', edit);
    expect(simple).toEqual(full);
  });

  it('a time chip == typing that time in the full form', async () => {
    const simple = await patchBody(EVENTS.medDaily, undefined, async (user) => {
      await user.click(chip(/Evening/));
    });
    const full = await patchBody(EVENTS.medDaily, 'full', async (user) => {
      const time = screen.getByLabelText(/^Time/);
      await user.clear(time);
      await user.type(time, '16:00'); // 6:00 PM New York on a Denver viewer
    });
    expect(simple).toEqual(full);
    expect(simple).toMatchObject({ data: { scheduled_time: '18:00' } });
  });
});

describe('it looks like the add form', () => {
  it('medication: "Edit medication", the add form questions, Save changes', () => {
    renderEdit(EVENTS.medDays);
    expect(screen.getByRole('dialog', { name: 'Edit medication' })).toBeInTheDocument();
    expect(screen.getByTestId('simple-medication-form')).toBeInTheDocument();
    for (const h of ['What is it?', 'When?', 'How often?']) {
      expect(screen.getByRole('heading', { name: h })).toBeInTheDocument();
    }
    expect(screen.getByTestId('add-event-save')).toHaveTextContent('Save changes');
    // No "+ Another dose" on an edit (each extra dose is a NEW medication), even with a time set.
    expect(screen.queryByTestId('add-another-dose')).toBeNull();
    expect(screen.queryByLabelText('Type')).toBeNull();
  });

  it('appointment: "Edit appointment" and the add form rows', () => {
    renderEdit(EVENTS.appt);
    expect(screen.getByRole('dialog', { name: 'Edit appointment' })).toBeInTheDocument();
    expect(screen.getByTestId('simple-appointment-form')).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: "Who's going?" })).toBeInTheDocument();
    for (const id of ['row-doctor', 'row-place', 'row-notes', 'row-repeat']) expect(row(id)).toBeInTheDocument();
  });

  it('a task edit keeps the full form', () => {
    renderEdit({ ...appt(), id: 't-1', event_type: 'task', title: 'Pick up' } as CalendarEvent);
    expect(screen.queryByTestId('simple-medication-form')).toBeNull();
    expect(screen.queryByTestId('simple-appointment-form')).toBeNull();
    expect(screen.getByRole('dialog', { name: 'Edit event' })).toBeInTheDocument();
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

  it('a time that is no chip lights "Other time", which names it; the time field shows it', async () => {
    renderEdit(EVENTS.medDays); // 7:30 New York = 5:30 Denver
    for (const radio of within(timeChips()).getAllByRole('radio')) expect(radio).not.toBeChecked();
    // ONE clock on the control (owner 1.4.0): the cell names the RECIPIENT's 7:30, like the chips' times;
    // the viewer's 5:30 is in the field and the conversion line only.
    expect(screen.getByTestId('time-chip-other-time')).toHaveTextContent(/^7:30 AM$/);
    expect(screen.getByRole('button', { name: 'Other time, 7:30 AM' })).toBeInTheDocument();
    expect(screen.getByTestId('time-chip-other')).toHaveAttribute('aria-expanded', 'true');
    expect(screen.getByLabelText(/^Time/)).toHaveValue('05:30');
    // Typing a chip's time keeps the field (it must not vanish under the cursor), and lights the chip.
    const user = userEvent.setup();
    const field = screen.getByLabelText(/^Time/);
    await user.clear(field);
    await user.type(field, '06:00');
    expect(chip(/Morning/)).toBeChecked();
    expect(screen.getByLabelText(/^Time/)).toBeInTheDocument();
  });
});

describe('"How often?" reflects the stored repeat', () => {
  it('daily -> Every day; "When needed" is not offered on a scheduled medication', () => {
    renderEdit(EVENTS.medDaily);
    expect(within(howOften()).getByRole('radio', { name: 'Every day' })).toBeChecked();
    expect(within(howOften()).queryByRole('radio', { name: 'When needed' })).toBeNull();
  });

  it('weekly on days -> Some days, the day picker open', () => {
    renderEdit(EVENTS.medDays);
    expect(within(howOften()).getByRole('radio', { name: 'Some days' })).toBeChecked();
    expect(screen.getByRole('group', { name: 'Repeat on' })).toBeInTheDocument();
  });

  it('as needed -> When needed, locked (disabled) with the helper; no When? question', () => {
    renderEdit(EVENTS.medPrn);
    const needed = within(howOften()).getByRole('radio', { name: 'When needed' });
    expect(needed).toBeChecked();
    for (const r of within(howOften()).getAllByRole('radio')) expect(r).toBeDisabled();
    expect(screen.getByTestId('as-needed-locked-how-often')).toHaveTextContent(/can't be changed/);
    expect(screen.queryByRole('heading', { name: 'When?' })).toBeNull();
  });

  it.each([
    ['medMonthly', 'Monthly', 'monthly'],
    ['medCycle', 'Cycle', 'cycle'],
  ])('%s: no simple choice lit, the rule named under it, More details open on it', (key, label, value) => {
    renderEdit(EVENTS[key]);
    for (const r of within(howOften()).getAllByRole('radio')) expect(r).not.toBeChecked();
    expect(screen.getByTestId('how-often-summary')).toHaveTextContent(new RegExp(label, 'i'));
    expect(moreToggle()).toHaveAttribute('aria-expanded', 'true');
    expect(screen.getByLabelText('Repeat')).toHaveValue(value);
  });
});

describe('a saved value behind a disclosure opens it', () => {
  it('medication: instructions or a repeat end date open More details; a plain one stays closed', () => {
    const { unmount } = renderEdit(med());
    expect(moreToggle()).toHaveAttribute('aria-expanded', 'false');
    unmount();
    renderEdit(EVENTS.medDaily);
    expect(moreToggle()).toHaveAttribute('aria-expanded', 'true');
    expect(screen.getByLabelText('Instructions')).toHaveValue('With food');
  });

  it('appointment: place and notes open their rows (notes reads "Added" folded); doctor and repeat too', () => {
    const { unmount } = renderEdit(EVENTS.appt);
    expect(row('row-place')).toHaveAttribute('aria-expanded', 'true');
    expect(screen.getByLabelText(/^Location/)).toHaveValue('1 Main St');
    expect(row('row-notes')).toHaveAttribute('aria-expanded', 'true');
    expect(row('row-doctor')).toHaveAttribute('aria-expanded', 'false');
    expect(row('row-repeat')).toHaveAttribute('aria-expanded', 'false');
    fireEvent.click(row('row-notes'));
    expect(row('row-notes')).toHaveTextContent('Added');
    unmount();
    renderEdit(EVENTS.apptWeekly);
    expect(row('row-doctor')).toHaveAttribute('aria-expanded', 'true');
    expect(screen.getByRole('combobox', { name: 'Doctor' })).toHaveValue(PATEL_ID);
    expect(row('row-repeat')).toHaveAttribute('aria-expanded', 'true');
    expect(row('row-place')).toHaveAttribute('aria-expanded', 'false');
  });

  it('the Place row a doctor filled opens, and its toggle folds (address in the row) and reopens it', async () => {
    const user = userEvent.setup();
    renderEdit(appt({ location: '', description: '' }));
    fireEvent.click(row('row-doctor'));
    await user.selectOptions(screen.getByRole('combobox', { name: 'Doctor' }), PATEL_ID);
    expect(row('row-place')).toHaveAttribute('aria-expanded', 'true');
    expect(screen.getByLabelText(/^Location/)).toHaveValue('1200 Heart Center Dr');
    fireEvent.click(row('row-place'));
    expect(row('row-place')).toHaveAttribute('aria-expanded', 'false');
    expect(row('row-place')).toHaveTextContent('1200 Heart Center Dr');
    fireEvent.click(row('row-place'));
    expect(row('row-place')).toHaveAttribute('aria-expanded', 'true');
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
    await patchBody(EVENTS[key], undefined);
    expect(tapped).toHaveBeenCalledWith(CIRCLE_ID, type, 'form', true, 'simple');
  });

  it('the full layout says layout full', async () => {
    await patchBody(EVENTS.medDaily, 'full');
    expect(tapped).toHaveBeenCalledWith(CIRCLE_ID, 'medication', 'form', true, 'full');
  });
});
