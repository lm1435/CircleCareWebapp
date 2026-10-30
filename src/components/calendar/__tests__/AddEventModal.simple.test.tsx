import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import '@/i18n';
import { Analytics } from '@/lib/analytics';
import { resetLargeTextReports } from '@/lib/largeText';
import { AddEventModal } from '../AddEventModal';

// The simple "New medication" / "New appointment" forms (docs/plans/simple-ui-1-3-1.md).
// Same state and same payload builder as the full form, arranged as
// What is it? / When? / How often? (or Who's going?). The payload tests below
// run the SAME answers through both layouts and require identical API bodies.

const ORIGINAL_TZ = process.env.TZ;
beforeAll(() => {
  process.env.TZ = 'America/Denver';
});
afterAll(() => {
  process.env.TZ = ORIGINAL_TZ;
});

const RECIPIENT_TZ = 'America/New_York';
// Real UUIDs: the shared Zod schema rejects other assignee ids.
const ANA_ID = '3f1c2a4e-5b6d-4c7e-8f90-a1b2c3d4e5f6';
const LUIS_ID = '9a8b7c6d-5e4f-4a3b-9c2d-1e0f9a8b7c6d';
const CIRCLE_ID = 'circle-1';

const mutateCreate = vi.fn();
vi.mock('../DoseQuietHoursNote', () => ({ DoseQuietHoursNote: () => null }));
vi.mock('@/api/drugs', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/api/drugs')>();
  return { ...actual, searchDrugs: vi.fn().mockResolvedValue([]) };
});
vi.mock('@/hooks/useProviders', () => ({
  useProviders: () => ({ providers: [], isSuccess: true }),
}));
vi.mock('@/hooks/useCalendarEvents', () => ({
  useCreateEvent: () => ({ mutateAsync: mutateCreate, isPending: false }),
  useUpdateEvent: () => ({ mutateAsync: vi.fn(), isPending: false }),
  useCachedCircleEvents: () => [],
}));
vi.mock('@/hooks/useSeriesRoot', () => ({
  useSeriesRoot: (_c: string, event: unknown) => ({ root: event ?? null }),
}));
const useCircleResult = {
  circle: undefined as { recipient_name?: string; is_self_care?: boolean } | undefined,
  circleSummary: undefined,
  timezone: RECIPIENT_TZ,
  members: [
    { id: ANA_ID, email: 'ana@example.com', first_name: 'Ana', is_care_recipient: false },
    { id: LUIS_ID, email: 'luis@example.com', first_name: 'Luis', is_care_recipient: false },
  ] as Array<{
    id: string;
    email: string;
    first_name: string | null;
    is_care_recipient: boolean;
  }>,
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
const showToast = vi.fn();
vi.mock('@/components/ui', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/components/ui')>();
  return { ...actual, useToast: () => ({ showToast }) };
});

let opened: ReturnType<typeof vi.spyOn>;
let stepDone: ReturnType<typeof vi.spyOn>;
let chipSpy: ReturnType<typeof vi.spyOn>;
let medAbandoned: ReturnType<typeof vi.spyOn>;
let apptAbandoned: ReturnType<typeof vi.spyOn>;
let largeText: ReturnType<typeof vi.spyOn>;

beforeEach(() => {
  vi.clearAllMocks();
  resetLargeTextReports();
  document.documentElement.style.fontSize = '';
  mutateCreate.mockResolvedValue({ id: 'new' });
  opened = vi.spyOn(Analytics, 'entryFormOpened').mockImplementation(() => {});
  stepDone = vi.spyOn(Analytics, 'entryFormStepCompleted').mockImplementation(() => {});
  chipSpy = vi.spyOn(Analytics, 'timeChipSelected').mockImplementation(() => {});
  medAbandoned = vi.spyOn(Analytics, 'medicationFormAbandoned').mockImplementation(() => {});
  apptAbandoned = vi.spyOn(Analytics, 'appointmentFormAbandoned').mockImplementation(() => {});
  largeText = vi.spyOn(Analytics, 'largeTextLayout').mockImplementation(() => {});
  vi.spyOn(Analytics, 'entrySaveTapped').mockImplementation(() => {});
  vi.spyOn(Analytics, 'medicationCreated').mockImplementation(() => {});
});
afterEach(() => {
  vi.restoreAllMocks();
  vi.useRealTimers();
});

function renderMed(props: Partial<React.ComponentProps<typeof AddEventModal>> = {}) {
  return render(
    <AddEventModal circleId={CIRCLE_ID} initialType="medication" onClose={vi.fn()} {...props} />
  );
}
function renderAppt(props: Partial<React.ComponentProps<typeof AddEventModal>> = {}) {
  return render(
    <AddEventModal circleId={CIRCLE_ID} initialType="appointment" onClose={vi.fn()} {...props} />
  );
}

const timeChips = () => screen.getByRole('radiogroup', { name: 'Common dose times' });
const title = () => screen.getByLabelText(/^Title( \* \(required\))?$/);
const chip = (name: RegExp) => within(timeChips()).getByRole('radio', { name });

describe('new medication: structure', () => {
  it('shows What is it? / When? / How often?, a collapsed More details and "Add medication"', () => {
    renderMed();
    expect(screen.getByRole('dialog', { name: 'New medication' })).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'What is it?' })).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'When?' })).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'How often?' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /More details/ })).toHaveAttribute(
      'aria-expanded',
      'false'
    );
    expect(screen.getByTestId('add-event-save')).toHaveTextContent('Add medication');
    expect(screen.queryByRole('button', { name: 'Create' })).toBeNull();
  });

  it('has the four time chips with their times, plus Other time; + Another dose only once a time is set', async () => {
    renderMed();
    expect(within(timeChips()).getAllByRole('radio')).toHaveLength(4);
    expect(chip(/^Morning\s*8:00 AM$/)).toBeInTheDocument();
    expect(chip(/^Midday\s*12:00 PM$/)).toBeInTheDocument();
    expect(chip(/^Evening\s*6:00 PM$/)).toBeInTheDocument();
    expect(chip(/^Bedtime\s*9:00 PM$/)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Other time' })).toBeInTheDocument();
    expect(screen.queryByTestId('add-another-dose')).toBeNull();
    await userEvent.setup().click(chip(/Morning/));
    expect(screen.getByRole('button', { name: '+ Another dose' })).toBeInTheDocument();
  });

  it('How often? defaults to Every day and offers Some days / When needed', () => {
    renderMed();
    const group = screen.getByRole('radiogroup', { name: 'How often?' });
    expect(within(group).getByRole('radio', { name: 'Every day' })).toBeChecked();
    expect(within(group).getByRole('radio', { name: 'Some days' })).not.toBeChecked();
    expect(within(group).getByRole('radio', { name: 'When needed' })).not.toBeChecked();
  });

  it('has NO Medication / Appointment / Task type switch', () => {
    renderMed();
    expect(screen.queryByLabelText('Type')).toBeNull();
  });

  it('More details holds the rest (start date, instructions, repeat, reminders) and expands', async () => {
    const user = userEvent.setup();
    renderMed();
    const toggle = screen.getByRole('button', { name: /More details/ });
    await user.click(toggle);
    expect(toggle).toHaveAttribute('aria-expanded', 'true');
    expect(screen.getByLabelText(/^Start date/)).toBeVisible();
    expect(screen.getByLabelText('Instructions')).toBeVisible();
    expect(screen.getByLabelText('Repeat')).toBeVisible();
    expect(screen.getByRole('switch', { name: 'Send reminders' })).toBeVisible();
  });

  it('Other time reveals the regular time field; a non-chip time selects no chip', async () => {
    const user = userEvent.setup();
    renderMed();
    expect(screen.queryByLabelText(/^Time/)).toBeNull();
    await user.click(screen.getByRole('button', { name: 'Other time' }));
    const time = await screen.findByLabelText(/^Time/);
    await user.clear(time);
    await user.type(time, '07:15');
    for (const radio of within(timeChips()).getAllByRole('radio')) {
      expect(radio).not.toBeChecked();
    }
    // ...and typing a chip's exact time selects that chip.
    await user.clear(time);
    await user.type(time, '12:00');
    expect(chip(/Midday/)).toBeChecked();
  });

  it('tapping the selected chip again clears the time', async () => {
    const user = userEvent.setup();
    renderMed();
    await user.click(chip(/Morning/));
    expect(chip(/Morning/)).toBeChecked();
    await user.click(chip(/Morning/));
    expect(chip(/Morning/)).not.toBeChecked();
  });

  it('keeps the 1.3.1 inline past-time note under the time', async () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date('2026-06-15T18:00:00Z')); // 12:00 Denver / 14:00 New York
    const user = userEvent.setup();
    renderMed();
    expect(screen.queryByTestId('dose-past-time-note')).toBeNull();
    await user.click(chip(/Morning/)); // 8:00 Denver = 10:00 New York: already passed today
    expect(screen.getByTestId('dose-past-time-note')).toHaveTextContent(
      'Starts with the next dose. This time has already passed today.'
    );
    await user.click(chip(/Evening/)); // 18:00 Denver = 20:00 New York: still ahead
    expect(screen.queryByTestId('dose-past-time-note')).toBeNull();
  });

  it('Save with no time: shows the time message, focuses the first chip, saves nothing', async () => {
    const user = userEvent.setup();
    renderMed();
    await user.type(screen.getByRole('combobox', { name: /Medication name/ }), 'Metformin');
    await user.click(screen.getByTestId('add-event-save'));
    expect(await screen.findByText('Medications need a scheduled time.')).toBeInTheDocument();
    expect(mutateCreate).not.toHaveBeenCalled();
    expect(document.activeElement).toBe(chip(/Morning/));
  });
});

describe('new medication: a problem in a collapsed field opens it', () => {
  it('a cleared start date inside More details reopens it with the message and focus', async () => {
    const user = userEvent.setup();
    renderMed();
    await user.type(screen.getByRole('combobox', { name: /Medication name/ }), 'Metformin');
    await user.click(chip(/Morning/));
    const toggle = screen.getByRole('button', { name: /More details/ });
    await user.click(toggle);
    await user.clear(screen.getByLabelText(/^Start date/));
    await user.click(toggle); // collapse it again
    expect(toggle).toHaveAttribute('aria-expanded', 'false');
    await user.click(screen.getByTestId('add-event-save'));
    await waitFor(() => expect(toggle).toHaveAttribute('aria-expanded', 'true'));
    expect(await screen.findByText('Please choose a date.')).toBeInTheDocument();
    expect(mutateCreate).not.toHaveBeenCalled();
  });
});

describe('new medication: API payload is IDENTICAL to the full form for the same answers', () => {
  async function savedPayload(
    run: (user: ReturnType<typeof userEvent.setup>) => Promise<void>,
    props: { layout?: 'full'; saveLabel: string }
  ): Promise<Record<string, unknown>> {
    mutateCreate.mockClear();
    const user = userEvent.setup();
    const view = renderMed(props.layout ? { layout: props.layout } : {});
    await run(user);
    await user.click(screen.getByRole('button', { name: props.saveLabel }));
    await waitFor(() => expect(mutateCreate).toHaveBeenCalledTimes(1));
    const payload = mutateCreate.mock.calls[0][0] as Record<string, unknown>;
    view.unmount();
    return payload;
  }

  const nameAndDose = async (user: ReturnType<typeof userEvent.setup>) => {
    await user.type(screen.getByRole('combobox', { name: /Medication name/ }), 'Metformin');
    await user.type(screen.getByLabelText('Dosage'), '500 mg');
  };

  it('Evening chip + Every day == Time 18:00 + Repeat Daily', async () => {
    const simple = await savedPayload(
      async (user) => {
        await nameAndDose(user);
        await user.click(chip(/Evening/));
      },
      { saveLabel: 'Add medication' }
    );
    const full = await savedPayload(
      async (user) => {
        await nameAndDose(user);
        const time = screen.getByLabelText(/^Time/);
        await user.clear(time);
        await user.type(time, '18:00');
        await user.selectOptions(screen.getByLabelText('Repeat'), 'daily');
      },
      { layout: 'full', saveLabel: 'Create' }
    );
    expect(simple).toEqual(full);
    // Spot-check the load-bearing fields (guards against two equally wrong bodies).
    expect(simple).toMatchObject({
      event_type: 'medication',
      title: 'Metformin',
      medication_name: 'Metformin',
      medication_dosage: '500 mg',
      scheduled_time: '20:00', // 6:00 PM Denver is 8:00 PM in the recipient's New York
      recurrence_rule: 'daily',
      notifications_enabled: true,
      reminder_at_due: true,
    });
  });

  it('Some days (Mon/Wed picked) == Repeat "Days of the week" with the same days', async () => {
    const pickDays = async (user: ReturnType<typeof userEvent.setup>) => {
      const group = await screen.findByRole('group', { name: 'Repeat on' });
      const first = within(group).getAllByRole('checkbox');
      // Select a deterministic set: Wed (3) on top of the pre-selected start day.
      const wed = first.find((c) => /Wed/i.test(c.getAttribute('aria-label') ?? c.textContent ?? ''));
      if (wed && wed.getAttribute('aria-checked') !== 'true' && !(wed as HTMLInputElement).checked) {
        await user.click(wed);
      }
    };
    const simple = await savedPayload(
      async (user) => {
        await nameAndDose(user);
        await user.click(chip(/Morning/));
        await user.click(screen.getByRole('radio', { name: 'Some days' }));
        await pickDays(user);
      },
      { saveLabel: 'Add medication' }
    );
    const full = await savedPayload(
      async (user) => {
        await nameAndDose(user);
        const time = screen.getByLabelText(/^Time/);
        await user.clear(time);
        await user.type(time, '08:00');
        await user.selectOptions(screen.getByLabelText('Repeat'), 'days_of_week');
        await pickDays(user);
      },
      { layout: 'full', saveLabel: 'Create' }
    );
    expect(simple).toEqual(full);
    expect(simple).toMatchObject({ recurrence_rule: expect.stringMatching(/^(weekly|daily)$/) });
  });

  it('When needed == Repeat "As needed": no time, no repeat, as_needed true', async () => {
    const simple = await savedPayload(
      async (user) => {
        await nameAndDose(user);
        await user.click(screen.getByRole('radio', { name: 'When needed' }));
      },
      { saveLabel: 'Add medication' }
    );
    const full = await savedPayload(
      async (user) => {
        await nameAndDose(user);
        await user.selectOptions(screen.getByLabelText('Repeat'), 'as_needed');
      },
      { layout: 'full', saveLabel: 'Create' }
    );
    expect(simple).toEqual(full);
    expect(simple).toMatchObject({ as_needed: true });
    expect(simple).not.toHaveProperty('scheduled_time');
    expect(simple).not.toHaveProperty('recurrence_rule');
  });

  it('a field changed in More details (instructions, reminders off) reaches the payload', async () => {
    const user = userEvent.setup();
    renderMed();
    await user.type(screen.getByRole('combobox', { name: /Medication name/ }), 'Metformin');
    await user.click(chip(/Bedtime/));
    await user.click(screen.getByRole('button', { name: /More details/ }));
    await user.type(screen.getByLabelText('Instructions'), 'With food');
    await user.click(screen.getByRole('switch', { name: 'Send reminders' }));
    await user.click(screen.getByRole('button', { name: 'Add medication' }));
    await waitFor(() => expect(mutateCreate).toHaveBeenCalledTimes(1));
    expect(mutateCreate.mock.calls[0][0]).toMatchObject({
      description: 'With food',
      notifications_enabled: false,
      scheduled_time: '23:00',
    });
  });
});

describe('new medication: + Another dose (mobile AddEventScreen / first-run wizard parity)', () => {
  const fillName = async (user: ReturnType<typeof userEvent.setup>) => {
    await user.type(screen.getByRole('combobox', { name: /Medication name/ }), 'Metformin');
    await user.type(screen.getByLabelText('Dosage'), '500 mg');
  };

  it('saves the primary first, then ONE sibling row per extra time with refill_group_id = primary id', async () => {
    mutateCreate.mockResolvedValueOnce({ id: 'primary-1' }).mockResolvedValue({ id: 'sibling' });
    const user = userEvent.setup();
    renderMed();
    await fillName(user);
    await user.click(chip(/Morning/)); // 8:00 Denver = 10:00 New York
    await user.click(screen.getByTestId('add-another-dose')); // starts on the first unused chip: Midday
    await user.click(screen.getByRole('button', { name: '+ Another dose' }));
    await user.click(screen.getByTestId('add-event-save'));
    await waitFor(() => expect(mutateCreate).toHaveBeenCalledTimes(3));

    const [primary, second, third] = mutateCreate.mock.calls.map((c) => c[0]);
    expect(primary).toMatchObject({
      event_type: 'medication',
      medication_name: 'Metformin',
      scheduled_time: '10:00',
      recurrence_rule: 'daily',
    });
    expect(primary.refill_group_id).toBeUndefined();
    // Mobile's siblingDosePayload(data, {...}): the primary's body with its own clock/date,
    // no bottle of its own, and a pointer at the primary.
    const expectSibling = (row: Record<string, unknown>, time: string) =>
      expect(row).toEqual({
        ...primary,
        track_refills: false,
        quantity_in_bottle: undefined,
        quantity_remaining: undefined,
        pills_per_day: undefined,
        alert_days_before: undefined,
        scheduled_time: time,
        scheduled_date: primary.scheduled_date,
        recurrence_end_date: primary.recurrence_end_date,
        refill_group_id: 'primary-1',
      });
    expectSibling(second, '14:00'); // Midday 12:00 Denver
    expectSibling(third, '20:00'); // next unused chip: Evening 6:00 PM Denver
  });

  it('the request sequence equals the first-run wizard / mobile helper for the same answers', async () => {
    const { buildSiblingDoseRequests } = await import('@/utils/firstRunMedication');
    mutateCreate.mockResolvedValueOnce({ id: 'p' }).mockResolvedValue({ id: 's' });
    const user = userEvent.setup();
    renderMed();
    await fillName(user);
    await user.click(chip(/Morning/));
    await user.click(screen.getByTestId('add-another-dose'));
    await user.click(screen.getByTestId('add-event-save'));
    await waitFor(() => expect(mutateCreate).toHaveBeenCalledTimes(2));
    const [primary, sibling] = mutateCreate.mock.calls.map((c) => c[0]);
    const todayStr = (primary.scheduled_date as string) ?? '';
    const expected = buildSiblingDoseRequests({
      primary,
      additionalTimes: ['12:00'],
      timezone: RECIPIENT_TZ,
      todayStr,
      refillGroupId: 'p',
    })[0];
    expect(sibling.scheduled_time).toBe(expected.scheduled_time);
    expect(sibling.refill_group_id).toBe('p');
    expect(sibling.track_refills).toBe(false);
  });

  it('a row can be removed, 3 extras is the limit, and untapping the time clears the extras', async () => {
    const user = userEvent.setup();
    renderMed();
    await user.click(chip(/Morning/));
    for (let i = 0; i < 3; i += 1) await user.click(screen.getByTestId('add-another-dose'));
    expect(screen.getByTestId('extra-dose-3')).toBeInTheDocument();
    expect(screen.queryByTestId('add-another-dose')).toBeNull();
    await user.click(screen.getByRole('button', { name: 'Remove dose 3' }));
    expect(screen.queryByTestId('extra-dose-3')).toBeNull();
    expect(screen.getByTestId('add-another-dose')).toBeInTheDocument();
    await user.click(chip(/Morning/)); // untap: time cleared, extras gone
    expect(screen.queryByTestId('extra-dose-1')).toBeNull();
    expect(screen.queryByTestId('add-another-dose')).toBeNull();
  });

  it('each extra dose gets its own inline past-time note', async () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date('2026-06-15T18:00:00Z')); // 12:00 Denver / 14:00 New York
    const user = userEvent.setup();
    renderMed();
    await user.click(chip(/Bedtime/)); // 9 PM Denver: still ahead
    await user.click(screen.getByTestId('add-another-dose'));
    // The new row starts on the first unused chip: Morning 8:00 Denver, already passed today.
    expect(screen.getByTestId('dose-past-time-note-1')).toHaveTextContent(
      'Starts with the next dose. This time has already passed today.'
    );
    // The primary (9 PM) is still ahead, so ITS note stays hidden.
    expect(screen.queryByTestId('dose-past-time-note')).toBeNull();
    const second = within(screen.getByTestId('extra-dose-1')).getByLabelText('Dose 2');
    fireEvent.change(second, { target: { value: '19:00' } });
    expect(screen.queryByTestId('dose-past-time-note-1')).toBeNull();
  });

  it('When needed removes the extra doses (no schedule to attach them to)', async () => {
    const user = userEvent.setup();
    renderMed();
    await user.click(chip(/Morning/));
    await user.click(screen.getByTestId('add-another-dose'));
    await user.click(screen.getByRole('radio', { name: 'When needed' }));
    await fillName(user);
    await user.click(screen.getByTestId('add-event-save'));
    await waitFor(() => expect(mutateCreate).toHaveBeenCalledTimes(1));
  });

  it('a failed extra dose is reported as a partial save, not a success', async () => {
    const failed = vi.spyOn(Analytics, 'entrySaveFailed').mockImplementation(() => {});
    mutateCreate.mockResolvedValueOnce({ id: 'p' }).mockRejectedValueOnce(new Error('boom'));
    const user = userEvent.setup();
    renderMed();
    await fillName(user);
    await user.click(chip(/Morning/));
    await user.click(screen.getByTestId('add-another-dose'));
    await user.click(screen.getByTestId('add-event-save'));
    await waitFor(() => expect(failed).toHaveBeenCalledWith('circle-1', 'medication', 'additional_dose_create_failed'));
    expect(showToast).toHaveBeenCalledWith(expect.stringContaining('14:00'), 'error');
  });
});

describe('new medication: analytics', () => {
  it('entry_form_opened fires once with the type and how it was opened', () => {
    const { rerender } = renderMed({ entry: 'add_menu' });
    rerender(
      <AddEventModal
        circleId={CIRCLE_ID}
        initialType="medication"
        entry="add_menu"
        onClose={vi.fn()}
      />
    );
    expect(opened).toHaveBeenCalledTimes(1);
    expect(opened).toHaveBeenCalledWith({ type: 'medication', entry: 'add_menu' });
  });

  it.each(['add_menu', 'next_step', 'quick_access', 'empty_state'] as const)(
    'entry_form_opened carries entry=%s through to the event',
    (entry) => {
      renderMed({ entry });
      expect(opened).toHaveBeenCalledWith({ type: 'medication', entry });
    }
  );

  it('the appointment form reports the same entry on open and on abandon', async () => {
    const user = userEvent.setup();
    const apptSpy = vi.spyOn(Analytics, 'appointmentFormAbandoned');
    const view = renderAppt({ entry: 'add_menu' });
    expect(opened).toHaveBeenCalledWith({ type: 'appointment', entry: 'add_menu' });
    await user.click(screen.getByRole('button', { name: /^Close/ }));
    expect(apptSpy).toHaveBeenCalledWith(expect.objectContaining({ entrySource: 'add_menu' }));
    view.unmount();
  });

  it('entry defaults to "other"', () => {
    renderMed();
    expect(opened).toHaveBeenCalledWith({ type: 'medication', entry: 'other' });
  });

  it('each chip fires time_chip_selected with ITS id; Other time fires "other"; untap does not', async () => {
    const user = userEvent.setup();
    renderMed();
    await user.click(chip(/Morning/));
    await user.click(chip(/Midday/));
    await user.click(chip(/Evening/));
    await user.click(chip(/Bedtime/));
    await user.click(screen.getByRole('button', { name: 'Other time' }));
    expect((chipSpy.mock.calls as Array<[{ chip: string }]>).map((c) => c[0].chip)).toEqual([
      'morning',
      'midday',
      'evening',
      'bedtime',
      'other',
    ]);
    chipSpy.mockClear();
    await user.click(chip(/Bedtime/)); // selected -> untap
    expect(chipSpy).not.toHaveBeenCalled();
  });

  it('what / when / how_often complete once each, in the order the user does them', async () => {
    const user = userEvent.setup();
    renderMed();
    expect(stepDone).not.toHaveBeenCalled();
    await user.type(screen.getByRole('combobox', { name: /Medication name/ }), 'Metformin');
    await user.tab(); // leave the field: "What is it?" is answered
    expect(stepDone).toHaveBeenCalledWith({ type: 'medication', step: 'what' });
    await user.click(chip(/Morning/));
    await user.click(chip(/Midday/));
    await user.click(screen.getByRole('radio', { name: 'Some days' }));
    await user.click(screen.getByRole('radio', { name: 'Every day' }));
    expect((stepDone.mock.calls as Array<[{ step: string }]>).map((c) => c[0].step)).toEqual(['what', 'when', 'how_often']);
    expect((stepDone.mock.calls as Array<[{ type: string }]>).every((c) => c[0].type === 'medication')).toBe(true);
  });

  it('closing unsaved fires medication_form_abandoned with the entry; saving does not', async () => {
    const user = userEvent.setup();
    const onClose = vi.fn();
    const { unmount } = renderMed({ entry: 'next_step', onClose });
    await user.type(screen.getByRole('combobox', { name: /Medication name/ }), 'Metformin');
    await user.click(screen.getByRole('button', { name: 'Cancel' }));
    expect(medAbandoned).toHaveBeenCalledTimes(1);
    expect(medAbandoned.mock.calls[0][0]).toMatchObject({
      entrySource: 'next_step',
      hasName: true,
      hasSchedule: false,
    });
    unmount();

    medAbandoned.mockClear();
    renderMed({ entry: 'next_step', onClose });
    await user.type(screen.getByRole('combobox', { name: /Medication name/ }), 'Metformin');
    await user.click(chip(/Morning/));
    await user.click(screen.getByRole('button', { name: 'Add medication' }));
    await waitFor(() => expect(mutateCreate).toHaveBeenCalled());
    expect(medAbandoned).not.toHaveBeenCalled();
  });

  it('large_text_layout: active=false at normal size, true at a large root font, once', () => {
    const { unmount } = renderMed();
    expect(largeText).toHaveBeenCalledTimes(1);
    expect(largeText).toHaveBeenCalledWith('med_form', false);
    unmount();

    resetLargeTextReports();
    largeText.mockClear();
    document.documentElement.style.fontSize = '32px';
    renderMed();
    expect(largeText).toHaveBeenCalledWith('med_form', true);
  });

  it('large text puts the time chips in ONE column', () => {
    document.documentElement.style.fontSize = '32px';
    renderMed();
    expect(timeChips()).toHaveAttribute('data-columns', '1');
    expect(screen.getByTestId('simple-medication-form')).toHaveAttribute('data-large-text', 'true');
  });
});

describe('new appointment', () => {
  it('shows What is it? first, When? (date, then time), Who is going?, optional rows, "Add appointment"', () => {
    renderAppt();
    expect(screen.getByRole('dialog', { name: 'New appointment' })).toBeInTheDocument();
    const headings = screen.getAllByRole('heading', { level: 3 }).map((h) => h.textContent);
    expect(headings).toEqual(['What is it?', 'When?', "Who's going?"]);
    const date = screen.getByLabelText(/^Date/);
    const time = screen.getByLabelText(/^Time/);
    expect(
      date.compareDocumentPosition(time) & Node.DOCUMENT_POSITION_FOLLOWING
    ).toBeTruthy();
    for (const row of ['Doctor', 'Place', 'Notes and reminders']) {
      expect(screen.getByRole('button', { name: new RegExp(row) })).toHaveAttribute(
        'aria-expanded',
        'false'
      );
    }
    expect(screen.getByTestId('add-event-save')).toHaveTextContent('Add appointment');
    expect(screen.queryByLabelText('Type')).toBeNull();
  });

  it("Who's going? offers Anyone first, then every member", () => {
    renderAppt();
    const group = screen.getByRole('radiogroup', { name: "Who's going?" });
    expect(within(group).getAllByRole('radio').map((r) => r.textContent)).toEqual([
      'Anyone',
      'Ana',
      'Luis',
    ]);
    expect(within(group).getByRole('radio', { name: 'Anyone' })).toBeChecked();
  });

  it('quick title chips fill the title', async () => {
    const user = userEvent.setup();
    renderAppt();
    await user.click(screen.getByRole('radio', { name: 'Doctor visit' }));
    expect(title()).toHaveValue('Doctor visit');
  });

  it('saves the same body as the full form: title, date, time, end, assignee, place', async () => {
    const run = async (full: boolean) => {
      mutateCreate.mockClear();
      const user = userEvent.setup();
      const view = renderAppt(full ? { layout: 'full' } : {});
      await user.type(title(), 'Cardiology follow-up');
      const date = screen.getByLabelText(/^Date/);
      await user.clear(date);
      await user.type(date, '2026-10-29');
      const time = screen.getByLabelText(/^Time/);
      await user.clear(time);
      await user.type(time, '14:30');
      if (full) {
        await user.selectOptions(screen.getByLabelText('Assigned to'), LUIS_ID);
        await user.type(screen.getByLabelText('Location'), 'Clinic');
        await user.click(screen.getByRole('button', { name: 'Create' }));
      } else {
        await user.click(screen.getByRole('radio', { name: 'Luis' }));
        await user.click(screen.getByRole('button', { name: /Place/ }));
        await user.type(screen.getByLabelText('Location'), 'Clinic');
        await user.click(screen.getByRole('button', { name: 'Add appointment' }));
      }
      await waitFor(() => expect(mutateCreate).toHaveBeenCalledTimes(1));
      const payload = mutateCreate.mock.calls[0][0];
      view.unmount();
      return payload;
    };
    const simple = await run(false);
    const full = await run(true);
    expect(simple).toEqual(full);
    expect(simple).toMatchObject({
      event_type: 'appointment',
      title: 'Cardiology follow-up',
      scheduled_date: '2026-10-29',
      scheduled_time: '16:30',
      assigned_to: LUIS_ID,
      location: 'Clinic',
    });
  });

  it('analytics: opened, steps who/when/what once, abandon with the LAST field touched', async () => {
    const user = userEvent.setup();
    renderAppt({ entry: 'quick_access' });
    expect(opened).toHaveBeenCalledWith({ type: 'appointment', entry: 'quick_access' });

    await user.type(title(), 'Visit');
    await user.tab();
    await user.click(screen.getByRole('radio', { name: 'Ana' }));
    await user.click(screen.getByRole('radio', { name: 'Luis' }));
    expect((stepDone.mock.calls as Array<[unknown]>).map((c) => c[0])).toEqual([
      { type: 'appointment', step: 'what' },
      { type: 'appointment', step: 'who' },
    ]);

    await user.click(screen.getByRole('button', { name: 'Cancel' }));
    expect(apptAbandoned).toHaveBeenCalledTimes(1);
    expect(apptAbandoned.mock.calls[0][0].lastField).toBe('who');
    expect(medAbandoned).not.toHaveBeenCalled();
  });

  it('abandon reports "none" when nothing was touched, and never fires after a save', async () => {
    const user = userEvent.setup();
    const { unmount } = renderAppt();
    await user.click(screen.getByRole('button', { name: 'Cancel' }));
    expect(apptAbandoned).toHaveBeenCalledWith(expect.objectContaining({ lastField: 'none' }));
    unmount();

    apptAbandoned.mockClear();
    renderAppt();
    await user.type(title(), 'Visit');
    await user.click(screen.getByRole('button', { name: 'Add appointment' }));
    await waitFor(() => expect(mutateCreate).toHaveBeenCalled());
    expect(apptAbandoned).not.toHaveBeenCalled();
  });

  it('large_text_layout reports the appointment screen', () => {
    renderAppt();
    expect(largeText).toHaveBeenCalledWith('appt_form', false);
  });
});

describe('where the full form still applies', () => {
  it('a type-less open keeps the type switch and the full fields', () => {
    render(<AddEventModal circleId={CIRCLE_ID} onClose={vi.fn()} />);
    expect(screen.getByLabelText('Type')).toBeInTheDocument();
    expect(screen.getByTestId('add-event-save')).toHaveTextContent('Create');
    expect(screen.queryByTestId('simple-medication-form')).toBeNull();
  });

  it('a task opened for tasks has no type switch but keeps the full layout', () => {
    render(<AddEventModal circleId={CIRCLE_ID} initialType="task" onClose={vi.fn()} />);
    expect(screen.queryByLabelText('Type')).toBeNull();
    expect(title()).toBeInTheDocument();
    expect(screen.getByTestId('add-event-save')).toHaveTextContent('Create');
  });
});
