import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import '@/i18n';
import { Analytics } from '@/lib/analytics';
import { resetLargeTextReports } from '@/lib/largeText';
import { getDateInTimezone } from '@/utils/timezone';
import { AddEventModal } from '../AddEventModal';
import type { CalendarEvent } from '@/api/calendarEvents';

// 1. The time chips (Morning 8:00 AM, Midday 12:00 PM, Evening 6:00 PM, Bedtime 9:00 PM) name the CARE
// RECIPIENT's clock, as they do on mobile (AddEventScreen `handleTimeChipSelect`): "Evening" is 6 PM where
// the person lives. They used to be the VIEWER's clock on web, so a Denver caregiver tapping Evening for a
// New York recipient saved 20:00 New York, and the same tap saved 18:00 from the phone.
//
// 2. The viewer's repeated (fall-back) hour: a time on its SECOND reading (a chip, or an edit hydrating a
// stored time that lands there) must save back as itself, not an hour early.
//
// The viewer (browser) zone is pinned to America/Denver for the whole file and the clock to
// Sat 2026-10-31 18:40Z, which:
//  - is already Sun 2026-11-01 in Tokyo and Kiritimati (the chip day is the recipient's, not the viewer's);
//  - puts Pago Pago's Bedtime (21:00 SST on 10-31 = 08:00Z) on the SECOND 01:00 of Denver's 2026-11-01
//    fall-back, which the viewer-frame fields cannot name (see `viewerInstant`'s held instant).

const ORIGINAL_TZ = process.env.TZ;
beforeAll(() => {
  process.env.TZ = 'America/Denver';
});
afterAll(() => {
  process.env.TZ = ORIGINAL_TZ;
});

const NOW = new Date('2026-10-31T18:40:00Z');
const CIRCLE_ID = 'circle-1';

const mutateCreate = vi.fn();
const mutateUpdate = vi.fn();
vi.mock('../DoseQuietHoursNote', () => ({ DoseQuietHoursNote: () => null }));
vi.mock('@/api/drugs', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/api/drugs')>();
  return { ...actual, searchDrugs: vi.fn().mockResolvedValue([]) };
});
vi.mock('@/hooks/useProviders', () => ({ useProviders: () => ({ providers: [], isSuccess: true }) }));
vi.mock('@/hooks/useCalendarEvents', () => ({
  useCreateEvent: () => ({ mutateAsync: mutateCreate, isPending: false }),
  useUpdateEvent: () => ({ mutateAsync: mutateUpdate, isPending: false }),
  useCachedCircleEvents: () => [],
}));
vi.mock('@/hooks/useSeriesRoot', () => ({
  useSeriesRoot: (_c: string, event: unknown) => ({ root: event ?? null }),
}));
const useCircleResult = {
  circle: { recipient_name: 'Rosa', is_self_care: false } as
    | { recipient_name?: string; is_self_care?: boolean }
    | undefined,
  circleSummary: undefined,
  timezone: 'America/New_York',
  members: [] as never[],
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

let firstRunSaved: ReturnType<typeof vi.spyOn>;

beforeEach(() => {
  vi.clearAllMocks();
  resetLargeTextReports();
  vi.useFakeTimers({ toFake: ['Date'], now: NOW });
  useCircleResult.timezone = 'America/New_York';
  mutateCreate.mockResolvedValue({ id: 'new' });
  mutateUpdate.mockResolvedValue({ id: 'ev-1' });
  firstRunSaved = vi.spyOn(Analytics, 'firstRunMedicationSaved').mockImplementation(() => {});
  vi.spyOn(Analytics, 'entryFormOpened').mockImplementation(() => {});
  vi.spyOn(Analytics, 'entryFormStepCompleted').mockImplementation(() => {});
  vi.spyOn(Analytics, 'timeChipSelected').mockImplementation(() => {});
  vi.spyOn(Analytics, 'entrySaveTapped').mockImplementation(() => {});
  vi.spyOn(Analytics, 'medicationCreated').mockImplementation(() => {});
  vi.spyOn(Analytics, 'largeTextLayout').mockImplementation(() => {});
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
// Build 11 (owner 2026-11-10): time-first chips ("6:00 PM Evening"), checkboxes on a new medication
// (multi-select), radios on an edit (one dose).
const chip = (name: RegExp) => {
  const group = within(document.getElementById('time-chips') as HTMLElement);
  return group.queryByRole('checkbox', { name }) ?? group.getByRole('radio', { name });
};

async function save(user: ReturnType<typeof userEvent.setup>): Promise<Record<string, unknown>> {
  await user.click(screen.getByTestId('add-event-save'));
  await waitFor(() => expect(mutateCreate).toHaveBeenCalledTimes(1));
  return mutateCreate.mock.calls[0][0] as Record<string, unknown>;
}

const CHIPS = [
  [/Morning/, '08:00'],
  [/Midday/, '12:00'],
  [/Evening/, '18:00'],
  [/Bedtime/, '21:00'],
] as const;
const ZONES = [
  'America/New_York',
  'Asia/Tokyo',
  'Pacific/Kiritimati',
  'Pacific/Pago_Pago',
  'Europe/London',
  'America/Denver',
];

describe("the chips are the recipient's clock (mobile parity)", () => {
  it('Denver caregiver, New York recipient: Evening saves 18:00 New York (it saved 20:00)', async () => {
    const user = userEvent.setup();
    renderMed();
    await user.type(screen.getByRole('combobox', { name: /Medication name/ }), 'Metformin');
    await user.click(chip(/Evening/));
    expect(chip(/Evening/)).toBeChecked();
    expect(await save(user)).toMatchObject({ scheduled_time: '18:00', scheduled_date: '2026-10-31' });
  });

  it.each(ZONES)(
    'recipient in %s: each chip lights and posts its own HH:MM on the recipient day',
    async (zone) => {
      useCircleResult.timezone = zone;
      for (const [name, time] of CHIPS) {
        mutateCreate.mockClear();
        const user = userEvent.setup();
        const view = renderMed();
        await user.type(screen.getByRole('combobox', { name: /Medication name/ }), 'Metformin');
        await user.click(chip(name));
        expect(chip(name)).toBeChecked();
        const body = await save(user);
        expect({ date: body.scheduled_date, time: body.scheduled_time }).toEqual({
          date: getDateInTimezone(zone, NOW),
          time,
        });
        view.unmount();
      }
    }
  );

  it('the Pago Pago Bedtime chip is on the second 01:00 of the Denver fall-back (the held instant case)', () => {
    const bedtime = Date.UTC(2026, 10, 1, 8, 0); // 21:00 SST (UTC-11) on 2026-10-31
    expect(new Date(bedtime).getHours()).toBe(1);
    expect(new Date(bedtime - 3600000).getHours()).toBe(1); // the first 01:00, an hour earlier
  });

  it.each(ZONES)('recipient in %s: switching chips keeps the recipient day', async (zone) => {
    useCircleResult.timezone = zone;
    const user = userEvent.setup();
    renderMed();
    await user.type(screen.getByRole('combobox', { name: /Medication name/ }), 'Metformin');
    // Multi-select (build 11): switching is un-choosing one chip and choosing another.
    await user.click(chip(/Morning/));
    await user.click(chip(/Morning/));
    await user.click(chip(/Bedtime/));
    await user.click(chip(/Bedtime/));
    await user.click(chip(/Midday/));
    expect(chip(/Midday/)).toBeChecked();
    for (const other of [/Morning/, /Evening/, /Bedtime/]) expect(chip(other)).not.toBeChecked();
    const body = await save(user);
    expect({ date: body.scheduled_date, time: body.scheduled_time }).toEqual({
      date: getDateInTimezone(zone, NOW),
      time: '12:00',
    });
  });

  describe('the zone caption under the chips (build 11, replaces the conversion line)', () => {
    // Denver viewer. Chips are the recipient's clock, so Evening 6:00 PM New York is 4:00 PM Denver.
    it('zones differ: a lit chip shows the caption, circle time first, described by the chip group', async () => {
      const user = userEvent.setup();
      renderMed();
      await user.click(chip(/Evening/));
      const line = screen.getByTestId('time-zone-caption');
      expect(line).toHaveTextContent(/^New York time · 4:00 PM your time \(Denver\)$/);
      // Read with the chips: the group is described by the caption.
      expect(screen.getByRole('group', { name: 'Common dose times' })).toHaveAccessibleDescription(
        'New York time · 4:00 PM your time (Denver)'
      );
      // Switching (un-choose Evening, choose Morning) moves the caption with it.
      await user.click(chip(/Evening/));
      await user.click(chip(/Morning/));
      expect(screen.getByTestId('time-zone-caption')).toHaveTextContent(
        /^New York time · 6:00 AM your time \(Denver\)$/
      );
    });

    it('no time yet: no caption', () => {
      renderMed();
      expect(screen.queryByTestId('time-zone-caption')).toBeNull();
    });

    it('zones equal: a lit chip shows no caption', async () => {
      useCircleResult.timezone = 'America/Denver';
      const user = userEvent.setup();
      renderMed();
      await user.click(chip(/Evening/));
      expect(chip(/Evening/)).toBeChecked();
      expect(screen.queryByTestId('time-zone-caption')).toBeNull();
      expect(screen.queryByText(/your time/)).toBeNull();
    });

    it('the repeated-hour chip stays the stored 9:00 PM (the second 01:00), not 8:00 PM', async () => {
      useCircleResult.timezone = 'Pacific/Pago_Pago';
      const user = userEvent.setup();
      renderMed();
      await user.click(chip(/Bedtime/));
      // 9 PM in Pago Pago is 1:00 AM in Denver (the second 01:00 of the fall-back).
      expect(screen.getByTestId('time-zone-caption')).toHaveTextContent(
        /^Pago Pago time · 1:00 AM your time \(Denver\)$/
      );
      // Read back on the recipient's clock it is still Bedtime: a first-01:00 reading would be 8:00 PM, a
      // custom chip.
      expect(chip(/Bedtime/)).toBeChecked();
      expect(screen.queryByTestId('time-chip-custom')).toBeNull();
    });

    it('a time from Other… joins the ONE caption ("… and …"), never a second line', async () => {
      const user = userEvent.setup();
      renderMed();
      await user.click(chip(/Evening/));
      await user.click(screen.getByTestId('time-chip-other'));
      // On the RECIPIENT's clock (6:30 PM New York): a new medication's next time, its own chip.
      fireEvent.change(screen.getByLabelText('Other time', { selector: 'input' }), { target: { value: '18:30' } });
      expect(screen.getByTestId('time-chip-custom')).toHaveTextContent(/^6:30 PM\s*Other$/);
      expect(screen.getAllByTestId('time-zone-caption')).toHaveLength(1);
      expect(screen.getByTestId('time-zone-caption')).toHaveTextContent(
        /^New York time · 4:00 PM and 4:30 PM your time \(Denver\)$/
      );
    });
  });

  it('a chip after the start date was cleared lands on the recipient today', async () => {
    useCircleResult.timezone = 'Asia/Tokyo';
    const user = userEvent.setup();
    renderMed();
    await user.type(screen.getByRole('combobox', { name: /Medication name/ }), 'Metformin');
    // The Starts tile's hidden input, emptied (what an empty start date is).
    fireEvent.change(screen.getByLabelText(/^Starts/), { target: { value: '' } });
    await user.click(chip(/Evening/));
    expect(chip(/Evening/)).toBeChecked();
    expect(await save(user)).toMatchObject({ scheduled_date: '2026-11-01', scheduled_time: '18:00' });
  });

  it('first-run save reports the lit chip, not the viewer clock', async () => {
    const user = userEvent.setup();
    renderMed({ firstRun: true });
    await user.type(screen.getByRole('combobox', { name: /Medication name/ }), 'Metformin');
    await user.click(chip(/Evening/));
    await user.click(screen.getByTestId('add-event-save'));
    await waitFor(() => expect(firstRunSaved).toHaveBeenCalled());
    expect(firstRunSaved).toHaveBeenCalledWith(expect.objectContaining({ preset: 'evening' }));
  });

  it('a second chosen chip is an extra dose on the recipient clock (what + Another dose did)', async () => {
    mutateCreate.mockResolvedValueOnce({ id: 'p' }).mockResolvedValue({ id: 's' });
    const user = userEvent.setup();
    renderMed();
    await user.type(screen.getByRole('combobox', { name: /Medication name/ }), 'Metformin');
    await user.click(chip(/Morning/));
    await user.click(chip(/Midday/));
    expect(chip(/Morning/)).toBeChecked();
    expect(chip(/Midday/)).toBeChecked();
    // Midday 12:00 New York is 10:00 Denver on the viewer's side (the extra's field value).
    expect(screen.getByTestId('time-zone-caption')).toHaveTextContent(
      /^New York time · 6:00 AM and 10:00 AM your time \(Denver\)$/
    );
    await user.click(screen.getByTestId('add-event-save'));
    await waitFor(() => expect(mutateCreate).toHaveBeenCalledTimes(2));
    expect(mutateCreate.mock.calls.map((c) => (c[0] as { scheduled_time: string }).scheduled_time)).toEqual(
      ['08:00', '12:00']
    );
  });
});

describe("the viewer's repeated hour: an untouched edit saves the stored pair back", () => {
  // Stored 21:00 Pago Pago on 2026-10-31 = 08:00Z = the SECOND 01:00 in Denver. The fields hydrate to
  // 2026-11-01 01:00, which the Date constructor reads as the FIRST 01:00 (07:00Z = 20:00 Pago Pago).
  const stored = (type: 'medication' | 'appointment'): CalendarEvent => ({
    id: 'ev-1',
    circle_id: CIRCLE_ID,
    event_type: type,
    title: 'Metformin',
    medication_name: type === 'medication' ? 'Metformin' : undefined,
    scheduled_date: '2026-10-31',
    scheduled_time: '21:00:00',
    recurrence_rule: 'daily',
    duration_minutes: type === 'appointment' ? 60 : undefined,
    created_at: '2026-10-01T00:00:00Z',
    updated_at: '2026-10-01T00:00:00Z',
  });

  it.each(['medication', 'appointment'] as const)('%s', async (type) => {
    useCircleResult.timezone = 'Pacific/Pago_Pago';
    const user = userEvent.setup();
    render(<AddEventModal circleId={CIRCLE_ID} event={stored(type)} onClose={vi.fn()} />);
    await user.click(screen.getByRole('button', { name: 'Save changes' }));
    await waitFor(() => expect(mutateUpdate).toHaveBeenCalledTimes(1));
    const { data } = mutateUpdate.mock.calls[0][0] as { data: Record<string, unknown> };
    expect({ date: data.scheduled_date, time: data.scheduled_time }).toEqual({
      date: '2026-10-31',
      time: '21:00',
    });
    if (type === 'appointment') expect(data.duration_minutes).toBe(60);
  });

  it('the edit lights the stored 9:00 PM (Bedtime), not 8:00 PM; the caption gives 1:00 AM Denver', () => {
    useCircleResult.timezone = 'Pacific/Pago_Pago';
    render(<AddEventModal circleId={CIRCLE_ID} event={stored('medication')} onClose={vi.fn()} />);
    expect(chip(/Bedtime/)).toBeChecked();
    expect(screen.queryByTestId('time-chip-custom')).toBeNull();
    expect(screen.getByTestId('time-zone-caption')).toHaveTextContent(
      /^Pago Pago time · 1:00 AM your time \(Denver\)$/
    );
  });
});

describe('the end time (mobile fix 3): web has no equivalent of the anchor-day frame bug', () => {
  // Mobile kept times as Dates on an anchor day, and a real-day start (a preset or a chip) plus the end
  // picker gave a duration near +/-3.59 million minutes. Web keeps start and end as viewer-frame HH:MM
  // strings and derives the duration from the two strings (`spanMinutes`), so the same sequence on the
  // type-less form (the only one with both presets and a type switch) must give the real duration.
  it('preset -> switch to Appointment -> end time: the duration is the picked span', async () => {
    const user = userEvent.setup();
    render(<AddEventModal circleId={CIRCLE_ID} layout="full" onClose={vi.fn()} />);
    const presets = screen.getByRole('radiogroup', { name: 'Common schedules' });
    await user.click(within(presets).getByRole('radio', { name: 'Every morning (8:00 AM)' }));
    // The preset is the CIRCLE's 08:00 (BC-8); the field holds the viewer's clock for it, so the end that is 75
    // minutes later is derived from what the field reads.
    const [sh, sm] = (screen.getByLabelText(/^Time/) as HTMLInputElement).value.split(':').map(Number);
    const endTotal = (sh * 60 + sm + 75) % 1440;
    const endValue = `${String(Math.floor(endTotal / 60)).padStart(2, '0')}:${String(endTotal % 60).padStart(2, '0')}`;
    await user.selectOptions(screen.getByLabelText('Type'), 'appointment');
    await user.type(screen.getByLabelText(/^Title( \*)?( \(required\))?$/), 'Dentist');
    const end = screen.getByLabelText(/^End time/);
    await user.clear(end);
    await user.type(end, endValue);
    await user.click(screen.getByRole('button', { name: 'Create' }));
    await waitFor(() => expect(mutateCreate).toHaveBeenCalledTimes(1));
    expect(mutateCreate.mock.calls[0][0]).toMatchObject({ event_type: 'appointment', duration_minutes: 75 });
  });
});
