import fs from 'fs';
import path from 'path';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import '@/i18n';
import { Analytics } from '@/lib/analytics';
import { resetLargeTextReports } from '@/lib/largeText';
import { AddEventModal } from '../AddEventModal';

// "OTHER TIME" ON THE RECIPIENT'S CLOCK (owner 1.4.0, mobile parity, "one clock on the control").
//
// The chips and the "Other time" tile name the CARE RECIPIENT's clock; the time field "Other time" reveals used
// to be typed in the VIEWER's clock and converted on save. It is now typed in the recipient's clock and
// labelled "Time in <city>" when the zones differ.
//
// WHAT MUST NOT CHANGE: the saved pair (naive recipient-local). Typing X in the new field must post EXACTLY
// what typing "X converted to the viewer's clock" (with the viewer-frame start date) posted in the old field.
// The old side is a fixture CAPTURED FROM THE OLD MODAL (CAPTURE_OLD_OTHER_TIME=1 with HEAD's AddEventModal
// in place): `__fixtures__/otherTimeOldFieldPayloads.json`.
//
// The viewer (browser) zone is pinned to America/Denver for the file; the recipient zone carries the
// coverage: Auckland, Kiritimati (+14), Midway (-11), Denver itself, and DST days in both zones.

const VIEWER_TZ = 'America/Denver';
const ORIGINAL_TZ = process.env.TZ;
beforeAll(() => {
  process.env.TZ = VIEWER_TZ;
});
afterAll(() => {
  process.env.TZ = ORIGINAL_TZ;
});

const FIXTURE = path.join(__dirname, '__fixtures__', 'otherTimeOldFieldPayloads.json');
const CAPTURE = process.env.CAPTURE_OLD_OTHER_TIME === '1';
const NOW = new Date('2026-11-01T18:40:00Z');
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

beforeEach(() => {
  vi.clearAllMocks();
  resetLargeTextReports();
  vi.useFakeTimers({ toFake: ['Date'], now: NOW });
  mutateCreate.mockResolvedValue({ id: 'new' });
  mutateUpdate.mockResolvedValue({ id: 'ev-1' });
  for (const name of [
    'entryFormOpened',
    'entryFormStepCompleted',
    'timeChipSelected',
    'entrySaveTapped',
    'medicationCreated',
    'largeTextLayout',
    'firstRunMedicationSaved',
  ] as const) {
    vi.spyOn(Analytics, name).mockImplementation(() => {});
  }
});
afterEach(() => {
  vi.restoreAllMocks();
  vi.useRealTimers();
});

interface Case {
  name: string;
  zone: string;
  day: string;
  time: string;
}
const CASES: Case[] = [
  { name: 'auckland-morning', zone: 'Pacific/Auckland', day: '2027-02-10', time: '07:15' },
  { name: 'auckland-evening', zone: 'Pacific/Auckland', day: '2027-02-10', time: '20:45' },
  { name: 'kiritimati-early', zone: 'Pacific/Kiritimati', day: '2027-02-10', time: '06:00' },
  { name: 'kiritimati-late', zone: 'Pacific/Kiritimati', day: '2027-02-10', time: '23:30' },
  { name: 'midway-late', zone: 'Pacific/Midway', day: '2027-02-10', time: '23:45' },
  { name: 'midway-morning', zone: 'Pacific/Midway', day: '2027-02-10', time: '08:05' },
  { name: 'same-zone', zone: VIEWER_TZ, day: '2027-02-10', time: '14:30' },
  // DST days: the US falls back 2027-11-07 (01:00-01:59 twice), springs forward 2027-03-14; Auckland falls
  // back 2027-04-04 (02:00-02:59 twice), springs forward 2027-09-26.
  { name: 'denver-fall-back-repeated', zone: 'America/Denver', day: '2027-11-07', time: '01:30' },
  { name: 'denver-fall-back-after', zone: 'America/Denver', day: '2027-11-07', time: '09:00' },
  { name: 'denver-spring-forward', zone: 'America/Denver', day: '2027-03-14', time: '08:00' },
  { name: 'auckland-fall-back-repeated', zone: 'Pacific/Auckland', day: '2027-04-04', time: '02:30' },
  { name: 'auckland-spring-forward', zone: 'Pacific/Auckland', day: '2027-09-26', time: '18:00' },
];
/**
 * Kiritimati 22:15 on 2027-11-07 is 08:15Z, the SECOND 01:15 in Denver (MST). The old viewer-frame field cannot
 * name the second reading of the viewer's repeated hour (`01:15` resolves to the first, 07:15Z), so the old
 * field saved 21:15, an hour early (the fixture holds it). The recipient-frame field saves the intended 22:15.
 */
const VIEWER_REPEAT_CASE: Case = { name: 'kiritimati-us-fall-back', zone: 'Pacific/Kiritimati', day: '2027-11-07', time: '22:15' };

/** The real instant of a naive wall clock in `zone` (an oracle independent of the code under test). */
function instantIn(day: string, time: string, zone: string): Date {
  const naive = Date.parse(`${day}T${time}:00Z`);
  const offsetAt = (t: number) => {
    const p = Object.fromEntries(
      new Intl.DateTimeFormat('en-US', { timeZone: zone, hourCycle: 'h23', year: 'numeric', month: 'numeric', day: 'numeric', hour: 'numeric', minute: 'numeric' })
        .formatToParts(new Date(t))
        .map((x) => [x.type, x.value])
    );
    return Date.UTC(+p.year, +p.month - 1, +p.day, +p.hour % 24, +p.minute) - t;
  };
  let t = naive - offsetAt(naive);
  t = naive - offsetAt(t);
  // The second reading of a repeated wall clock (the app resolves to it): step forward while it still reads the same.
  for (const step of [30, 60, 90, 120]) {
    const later = t + step * 60000;
    if (later + offsetAt(later) === naive) t = later;
  }
  return new Date(t);
}
const viewerWall = (instant: Date) => {
  const p = Object.fromEntries(
    new Intl.DateTimeFormat('en-CA', { timeZone: VIEWER_TZ, hourCycle: 'h23', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' })
      .formatToParts(instant)
      .map((x) => [x.type, x.value])
  );
  return { day: `${p.year}-${p.month}-${p.day}`, time: `${String(+p.hour % 24).padStart(2, '0')}:${p.minute}` };
};

function renderMed() {
  return render(<AddEventModal circleId={CIRCLE_ID} initialType="medication" onClose={vi.fn()} />);
}

/** Start date (More details) then the "Other time" field, the way a person fills them. */
async function fill(user: ReturnType<typeof userEvent.setup>, zone: string, day: string, time: string) {
  useCircleResult.timezone = zone;
  renderMed();
  await user.type(screen.getByRole('combobox', { name: /Medication name/ }), 'Metformin');
  await user.click(screen.getByRole('button', { name: /More details/ }));
  fireEvent.change(screen.getByLabelText(/^Start date/), { target: { value: day } });
  await user.click(screen.getByRole('button', { name: 'Other time' }));
  const field = await screen.findByLabelText(/^Time/);
  await user.clear(field);
  await user.type(field, time);
}

async function save(user: ReturnType<typeof userEvent.setup>): Promise<Record<string, unknown>> {
  mutateCreate.mockClear();
  await user.click(screen.getByTestId('add-event-save'));
  await waitFor(() => expect(mutateCreate).toHaveBeenCalledTimes(1));
  return JSON.parse(JSON.stringify(mutateCreate.mock.calls[0][0])) as Record<string, unknown>;
}

if (CAPTURE) {
  it('captures the OLD field payloads (run with HEAD\'s AddEventModal in place)', async () => {
    const out: Record<string, unknown> = {};
    for (const c of [...CASES, VIEWER_REPEAT_CASE]) {
      const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
      const viewer = viewerWall(instantIn(c.day, c.time, c.zone));
      await fill(user, c.zone, viewer.day, viewer.time);
      out[c.name] = await save(user);
      document.body.innerHTML = '';
    }
    fs.writeFileSync(FIXTURE, JSON.stringify(out, null, 2) + '\n');
  });
} else {
  const OLD: Record<string, Record<string, unknown>> = fs.existsSync(FIXTURE)
    ? JSON.parse(fs.readFileSync(FIXTURE, 'utf8'))
    : {};

  describe('payload equality: typing X in the recipient-clock field saves what the old field saved for X converted', () => {
    it('the fixture covers every case', () => {
      for (const c of [...CASES, VIEWER_REPEAT_CASE]) expect(OLD[c.name]).toBeDefined();
    });

    it.each(CASES.map((c) => [c.name, c] as const))('%s', async (_name, c) => {
      const user = userEvent.setup();
      await fill(user, c.zone, c.day, c.time);
      const body = await save(user);
      expect(body).toEqual(OLD[c.name]);
      expect(body.scheduled_date).toBe(c.day);
      expect(body.scheduled_time).toBe(c.time);
    });

    it('the comparison can tell the frames apart: the old field was fed the viewer clock', () => {
      const differing = CASES.filter((c) => viewerWall(instantIn(c.day, c.time, c.zone)).time !== c.time);
      expect(differing.length).toBeGreaterThan(5);
    });

    it("the viewer's repeated hour: saves as intended (the old field saved it an hour early)", async () => {
      const user = userEvent.setup();
      const c = VIEWER_REPEAT_CASE;
      await fill(user, c.zone, c.day, c.time);
      const body = await save(user);
      expect(body.scheduled_date).toBe(c.day);
      expect(body.scheduled_time).toBe(c.time);
      expect(OLD[c.name].scheduled_time).toBe('21:15');
    });
  });

  describe('the field and the tile speak one clock', () => {
    it('labelled "Time in <city>" when the zones differ; the tile, the field and the line agree', async () => {
      const user = userEvent.setup();
      await fill(user, 'Pacific/Auckland', '2027-02-10', '07:15');
      const field = screen.getByLabelText(/^Time in Auckland/);
      expect(field).toHaveValue('07:15');
      expect(screen.getByTestId('time-chip-other-time')).toHaveTextContent(/^7:15 AM$/);
      // The viewer's clock is only in the conversion line (7:15 AM Auckland = 11:15 AM the day before in Denver).
      expect(screen.getByText(/^7:15 AM in Auckland is 11:15 AM the day before for you/)).toBeInTheDocument();
    });

    it('plain "Time" when the viewer is in the recipient\'s zone', async () => {
      const user = userEvent.setup();
      await fill(user, VIEWER_TZ, '2027-02-10', '14:30');
      expect(screen.getByLabelText(/^Time/)).toHaveValue('14:30');
      expect(screen.queryByLabelText(/^Time in/)).toBeNull();
    });

    it('a typed time that is a chip lights that chip', async () => {
      const user = userEvent.setup();
      await fill(user, 'Pacific/Midway', '2027-02-10', '18:00');
      const evening = screen.getByRole('radio', { name: /Evening/ });
      expect(evening).toBeChecked();
    });

    it('an edit shows the STORED recipient time in the field and saves it back untouched', async () => {
      useCircleResult.timezone = 'Pacific/Kiritimati';
      const user = userEvent.setup();
      render(
        <AddEventModal
          circleId={CIRCLE_ID}
          event={{
            id: 'ev-1',
            circle_id: CIRCLE_ID,
            event_type: 'medication',
            title: 'Metformin',
            medication_name: 'Metformin',
            scheduled_date: '2027-02-10',
            scheduled_time: '07:40:00',
            recurrence_rule: 'daily',
            notifications_enabled: true,
            reminder_at_due: true,
          } as never}
          onClose={vi.fn()}
        />
      );
      expect(screen.getByLabelText(/^Time in Kiritimati/)).toHaveValue('07:40');
      await user.click(screen.getByRole('button', { name: 'Save changes' }));
      await waitFor(() => expect(mutateUpdate).toHaveBeenCalledTimes(1));
      const data = (mutateUpdate.mock.calls[0][0] as { data: Record<string, unknown> }).data;
      expect(data.scheduled_time).toBe('07:40');
      expect(data.scheduled_date).toBe('2027-02-10');
    });
  });
}
