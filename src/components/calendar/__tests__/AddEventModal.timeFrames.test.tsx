import { render, screen, waitFor, within } from '@testing-library/react';
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
const chip = (name: RegExp) =>
  within(screen.getByRole('radiogroup', { name: 'Common dose times' })).getByRole('radio', { name });

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
    await user.click(chip(/Morning/));
    await user.click(chip(/Bedtime/));
    await user.click(chip(/Midday/));
    expect(chip(/Midday/)).toBeChecked();
    const body = await save(user);
    expect({ date: body.scheduled_date, time: body.scheduled_time }).toEqual({
      date: getDateInTimezone(zone, NOW),
      time: '12:00',
    });
  });

  describe('the conversion line under a lit chip (mobile parity)', () => {
    // Denver viewer. Chips are the recipient's clock, so Evening 6:00 PM New York is 4:00 PM Denver.
    it('zones differ: a lit chip shows the line with both clocks, described by the chip group', async () => {
      const user = userEvent.setup();
      renderMed();
      await user.click(chip(/Evening/));
      const line = screen.getByTestId('time-conversion');
      // Recipient first, the viewer second, in plain words (owner 1.4.0); same day here.
      expect(line).toHaveTextContent(/^6:00 PM in New York is 4:00 PM for you \(Denver\)$/);
      // Read with the chip: the radiogroup is described by the line.
      expect(screen.getByRole('radiogroup', { name: 'Common dose times' })).toHaveAccessibleDescription(
        '6:00 PM in New York is 4:00 PM for you (Denver)'
      );
      await user.click(chip(/Morning/));
      expect(screen.getByTestId('time-conversion')).toHaveTextContent(/^8:00 AM in New York is 6:00 AM for you \(Denver\)$/);
    });

    it('no time yet: no line', () => {
      renderMed();
      expect(screen.queryByTestId('time-conversion')).toBeNull();
    });

    it('zones equal: a lit chip shows no line', async () => {
      useCircleResult.timezone = 'America/Denver';
      const user = userEvent.setup();
      renderMed();
      await user.click(chip(/Evening/));
      expect(chip(/Evening/)).toBeChecked();
      expect(screen.queryByTestId('time-conversion')).toBeNull();
      expect(screen.queryByText(/ for you /)).toBeNull();
    });

    it('the repeated-hour chip names the stored 9:00 PM (the second 01:00), not 8:00 PM', async () => {
      useCircleResult.timezone = 'Pacific/Pago_Pago';
      const user = userEvent.setup();
      renderMed();
      await user.click(chip(/Bedtime/));
      // 9 PM in Pago Pago is after midnight in Denver: the NEXT day for the viewer (build 8 said "(+1 day)" the wrong way).
      expect(screen.getByTestId('time-conversion')).toHaveTextContent(
        /^9:00 PM in Pago Pago is 1:00 AM the next day for you \(Denver\)$/
      );
      expect(screen.getByTestId('time-conversion')).not.toHaveTextContent('8:00 PM');
    });

    it('Other time shows the live conversion as the field hint (once, not also as the chip line)', async () => {
      const user = userEvent.setup();
      renderMed();
      await user.click(chip(/Evening/));
      await user.click(screen.getByRole('button', { name: 'Other time' }));
      // The field is typed on the RECIPIENT's clock (owner 1.4.0), and says whose.
      const time = await screen.findByLabelText(/^Time in New York/);
      await user.clear(time);
      await user.type(time, '18:30');
      expect(screen.getAllByText(/^6:30 PM in New York is 4:30 PM for you/)).toHaveLength(1);
      expect(screen.queryByTestId('time-conversion')).toBeNull();
    });
  });

  it('a chip after the start date was cleared lands on the recipient today', async () => {
    useCircleResult.timezone = 'Asia/Tokyo';
    const user = userEvent.setup();
    renderMed();
    await user.type(screen.getByRole('combobox', { name: /Medication name/ }), 'Metformin');
    await user.click(screen.getByRole('button', { name: /More details/ }));
    await user.clear(screen.getByLabelText(/^Start date/));
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

  it('+ Another dose starts on the next chip on the recipient clock', async () => {
    mutateCreate.mockResolvedValueOnce({ id: 'p' }).mockResolvedValue({ id: 's' });
    const user = userEvent.setup();
    renderMed();
    await user.type(screen.getByRole('combobox', { name: /Medication name/ }), 'Metformin');
    await user.click(chip(/Morning/));
    await user.click(screen.getByTestId('add-another-dose'));
    // Midday 12:00 New York, shown in the viewer's field as 10:00 Denver.
    expect(screen.getByLabelText('Dose 2')).toHaveValue('10:00');
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

  it('the conversion line names the stored 9:00 PM, not 8:00 PM', () => {
    useCircleResult.timezone = 'Pacific/Pago_Pago';
    render(<AddEventModal circleId={CIRCLE_ID} event={stored('medication')} onClose={vi.fn()} />);
    expect(screen.getByText(/^9:00 PM in .* is 1:00 AM the next day for you/)).toBeInTheDocument();
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
    await user.selectOptions(screen.getByLabelText('Type'), 'appointment');
    await user.type(screen.getByLabelText(/^Title( \*)?( \(required\))?$/), 'Dentist');
    const end = screen.getByLabelText(/^End time/);
    await user.clear(end);
    await user.type(end, '09:15');
    await user.click(screen.getByRole('button', { name: 'Create' }));
    await waitFor(() => expect(mutateCreate).toHaveBeenCalledTimes(1));
    expect(mutateCreate.mock.calls[0][0]).toMatchObject({ event_type: 'appointment', duration_minutes: 75 });
  });
});
