import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import '@/i18n';
import { Analytics } from '@/lib/analytics';
import { resetLargeTextReports } from '@/lib/largeText';
import { AddEventModal } from '../AddEventModal';

// DST / zone fixes on the web form (FIX-SPEC BC-1, BC-2, BC-3 pin, BC-4, BC-8). The VIEWER is the PROCESS zone (TZ):
// each test picks its case from the ambient zone and throws when the zone is not in the table, so the file bites
// under every zone it is run in (`TZ=<zone> npx vitest run <file>`; the six zones of the spec).

const AMBIENT = Intl.DateTimeFormat().resolvedOptions().timeZone;
const NOW = new Date('2026-11-12T12:00:00Z');
const CIRCLE_ID = 'circle-1';

const mutateCreate = vi.fn();
const mutateUpdate = vi.fn();
vi.mock('../DoseQuietHoursNote', () => ({ DoseQuietHoursNote: () => null }));
vi.mock('@/api/drugs', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/api/drugs')>()),
  searchDrugs: vi.fn().mockResolvedValue([]),
}));
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
  circle: { recipient_name: 'Rosa', is_self_care: false } as { recipient_name?: string; is_self_care?: boolean },
  circleSummary: undefined,
  timezone: 'America/Denver',
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
  mutateUpdate.mockResolvedValue({ id: 'med-1' });
  for (const name of [
    'entryFormOpened',
    'entryFormStepCompleted',
    'timeChipSelected',
    'entrySaveTapped',
    'largeTextLayout',
    'medicationCreated',
    'asNeededMedicationCreated',
    'firstRunMedicationSaved',
  ] as const) {
    vi.spyOn(Analytics, name).mockImplementation(() => {});
  }
});
afterEach(() => {
  vi.restoreAllMocks();
  vi.useRealTimers();
});

type User = ReturnType<typeof userEvent.setup>;
const chipBox = (label: RegExp) => {
  const group = within(document.getElementById('time-chips') as HTMLElement);
  return group.getByRole('checkbox', { name: label });
};
async function nameIt(user: User) {
  await user.type(screen.getByRole('combobox', { name: /Medication name/ }), 'Metformin');
}
async function saveAll(user: User): Promise<Array<Record<string, unknown>>> {
  mutateCreate.mockClear();
  await user.click(screen.getByTestId('add-event-save'));
  await waitFor(() => expect(mutateCreate.mock.calls.length).toBeGreaterThanOrEqual(1));
  return mutateCreate.mock.calls.map((c) => JSON.parse(JSON.stringify(c[0])) as Record<string, unknown>);
}

// ── BC-1 ────────────────────────────────────────────────────────────────────────────────────────────────────────
// ambient viewer zone(s) -> circle, the two chips (circle clock) on circle day 2026-11-12.
const BC1: Array<{ viewer: string[]; circle: string; first: RegExp; second: RegExp; times: [string, string] }> = [
  { viewer: ['America/Denver'], circle: 'Asia/Tokyo', first: /Morning$/, second: /Bedtime$/, times: ['08:00', '21:00'] },
  { viewer: ['UTC', 'Etc/UTC'], circle: 'America/Denver', first: /Morning$/, second: /Evening$/, times: ['08:00', '18:00'] },
  { viewer: ['America/New_York'], circle: 'America/Los_Angeles', first: /Morning$/, second: /Bedtime$/, times: ['08:00', '21:00'] },
  { viewer: ['Europe/London'], circle: 'America/Denver', first: /Morning$/, second: /Evening$/, times: ['08:00', '18:00'] },
  { viewer: ['Pacific/Auckland'], circle: 'Europe/London', first: /Morning$/, second: /Evening$/, times: ['08:00', '18:00'] },
  { viewer: ['Asia/Kolkata', 'Asia/Calcutta'], circle: 'America/Los_Angeles', first: /Morning$/, second: /Bedtime$/, times: ['08:00', '21:00'] },
];

describe('BC-1 extra doses start on the primary circle day', () => {
  it('two doses from another zone start on the same circle day', async () => {
    const row = BC1.find((r) => r.viewer.includes(AMBIENT));
    if (!row) throw new Error(`ambient zone ${AMBIENT} is not in the BC-1 table`);
    useCircleResult.timezone = row.circle;
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
    render(<AddEventModal circleId={CIRCLE_ID} initialType="medication" onClose={vi.fn()} />);
    await nameIt(user);
    await user.click(chipBox(row.first));
    await user.click(chipBox(row.second));
    const bodies = await saveAll(user);
    expect(bodies).toHaveLength(2);
    expect(bodies[0].scheduled_date).toBe('2026-11-12');
    expect(bodies[1].scheduled_date).toBe(bodies[0].scheduled_date);
    expect([bodies[0].scheduled_time, bodies[1].scheduled_time]).toEqual(row.times);
  });
});

// ── shared test oracle (independent of the code under test) ──────────────────────────────────────────────────────
import { oracleInstant, wallIn } from '@/utils/__tests__/helpers/dstTransitions';

/** "1:00 – 4:00 AM" from two 24h clocks, English 12h, the shared AM / PM said once. */
function range12(from: string, to: string): string {
  const f = (hm: string) => {
    const [h, m] = hm.split(':').map(Number);
    return { digits: `${h % 12 === 0 ? 12 : h % 12}:${String(m).padStart(2, '0')}`, suffix: h < 12 ? 'AM' : 'PM' };
  };
  const a = f(from);
  const b = f(to);
  return a.suffix === b.suffix ? `${a.digits} – ${b.digits} ${b.suffix}` : `${a.digits} ${a.suffix} – ${b.digits} ${b.suffix}`;
}
const normSpaces = (text: string | null) => (text ?? '').replace(/[  ]/g, ' ');

// ── BC-4: the caption's "your time" END follows the circle's wall clock ──────────────────────────────────────────
describe('BC-4 caption range, wired in the appointment form', () => {
  it.each([
    ['2026-03-08', '17:00', '19:00'],
    ['2026-11-01', '16:00', '18:00'],
    ['2026-06-10', '17:00', '19:00'],
  ])('Tokyo circle, %s From %s To %s: the viewer range is the circle end resolved to an instant', async (day, from, to) => {
    if (AMBIENT === 'Asia/Tokyo') throw new Error('Tokyo ambient: the zones agree, no caption');
    vi.setSystemTime(new Date('2026-02-01T12:00:00Z'));
    useCircleResult.timezone = 'Asia/Tokyo';
    render(<AddEventModal circleId={CIRCLE_ID} initialType="appointment" onClose={vi.fn()} />);
    fireEvent.change(screen.getByLabelText(/^Starts/), { target: { value: day } });
    await userEvent.setup({ advanceTimers: vi.advanceTimersByTime }).click(screen.getByRole('radio', { name: 'Pick a time' }));
    fireEvent.change(screen.getByLabelText('From', { selector: 'input' }), { target: { value: from } });
    fireEvent.change(screen.getByLabelText('To', { selector: 'input' }), { target: { value: to } });
    const start = wallIn(AMBIENT, oracleInstant('Asia/Tokyo', day, from));
    const end = wallIn(AMBIENT, oracleInstant('Asia/Tokyo', day, to));
    expect(normSpaces(screen.getByTestId('time-zone-caption').textContent)).toContain(
      `${range12(start.time, end.time)} your time`
    );
  });
});

// ── BC-3 (pin): the zone caption / conversion gate is judged at the EVENT instant ────────────────────────────────
// Web already does this (`showDualTimezone`); the table pins it. Mobile judged it at device midnight.
const BC3: Array<{ viewer: string[]; circle: string; day: string; deviceTime: string; shown: boolean }> = [
  { viewer: ['America/Denver'], circle: 'America/Phoenix', day: '2026-03-08', deviceTime: '10:00', shown: true },
  { viewer: ['America/Denver'], circle: 'America/Phoenix', day: '2026-03-08', deviceTime: '01:00', shown: false },
  { viewer: ['America/Denver'], circle: 'America/Regina', day: '2026-11-01', deviceTime: '10:00', shown: true },
  { viewer: ['America/Denver'], circle: 'America/Regina', day: '2026-11-01', deviceTime: '00:30', shown: false },
  { viewer: ['America/New_York'], circle: 'America/Bogota', day: '2026-11-01', deviceTime: '10:00', shown: false },
  { viewer: ['America/New_York'], circle: 'America/Bogota', day: '2026-11-01', deviceTime: '00:30', shown: true },
  { viewer: ['Europe/London'], circle: 'Africa/Abidjan', day: '2026-03-29', deviceTime: '10:00', shown: true },
  { viewer: ['Europe/London'], circle: 'Africa/Abidjan', day: '2026-03-29', deviceTime: '00:30', shown: false },
  { viewer: ['Pacific/Auckland'], circle: 'Pacific/Fiji', day: '2026-04-05', deviceTime: '10:00', shown: false },
  { viewer: ['Pacific/Auckland'], circle: 'Pacific/Fiji', day: '2026-04-05', deviceTime: '00:30', shown: true },
  { viewer: ['UTC', 'Etc/UTC', 'Asia/Kolkata', 'Asia/Calcutta'], circle: 'America/Denver', day: '2026-03-08', deviceTime: '10:00', shown: true },
  { viewer: ['UTC', 'Etc/UTC', 'Asia/Kolkata', 'Asia/Calcutta'], circle: 'America/Denver', day: '2026-11-01', deviceTime: '00:30', shown: true },
];

describe('BC-3 the zone caption is judged at the event instant', () => {
  const rows = BC3.filter((r) => r.viewer.includes(AMBIENT));
  it('the ambient zone is in the table', () => {
    if (rows.length === 0) throw new Error(`ambient zone ${AMBIENT} is not in the BC-3 table`);
  });
  it.each(rows.map((r) => [`${r.circle} ${r.day} device ${r.deviceTime}`, r] as const))('%s', async (_name, row) => {
    vi.setSystemTime(new Date('2026-02-01T12:00:00Z'));
    useCircleResult.timezone = row.circle;
    const [y, m, d] = row.day.split('-').map(Number);
    const [hh, mm] = row.deviceTime.split(':').map(Number);
    // The circle day / clock of the viewer's wall time (what the form's circle-clock controls hold).
    const at = wallIn(row.circle, new Date(y, m - 1, d, hh, mm));
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
    render(<AddEventModal circleId={CIRCLE_ID} initialType="medication" onClose={vi.fn()} />);
    fireEvent.change(screen.getByLabelText(/^Starts/), { target: { value: at.day } });
    await user.click(screen.getByTestId('time-chip-other'));
    fireEvent.change(screen.getByLabelText('Other time', { selector: 'input' }), { target: { value: at.time } });
    if (row.shown) expect(screen.getByTestId('time-zone-caption')).toBeInTheDocument();
    else expect(screen.queryByTestId('time-zone-caption')).toBeNull();
  });
});

// ── BC-2: an untouched edit of a stored gap time sends the stored pair ──────────────────────────────────────────
describe('BC-2 untouched edit, wired in the form', () => {
  it('an untouched edit of a circle spring-forward-gap time saves the stored 02:30', async () => {
    useCircleResult.timezone = 'America/Denver';
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
    render(
      <AddEventModal
        circleId={CIRCLE_ID}
        event={
          {
            id: 'med-1',
            circle_id: CIRCLE_ID,
            event_type: 'medication',
            title: 'Metformin',
            medication_name: 'Metformin',
            scheduled_date: '2026-03-08',
            scheduled_time: '02:30:00',
            recurrence_rule: 'daily',
            notifications_enabled: true,
            reminder_at_due: true,
          } as never
        }
        onClose={vi.fn()}
      />
    );
    await user.click(screen.getByRole('button', { name: 'Save changes' }));
    await waitFor(() => expect(mutateUpdate).toHaveBeenCalledTimes(1));
    const data = (mutateUpdate.mock.calls[0][0] as { data: Record<string, unknown> }).data;
    expect(data.scheduled_date).toBe('2026-03-08');
    expect(data.scheduled_time).toBe('02:30');
  });
});

// ── BC-8: the schedule presets mean the CIRCLE's clock ───────────────────────────────────────────────────────────
// The web form's strip has the two single-time presets (the multi-dose ones live in the first-run builders, tested in
// utils/__tests__/firstRunMedication.test.ts). `layout="full"` is the only layout that shows the strip.
const BC8: Array<{ viewer: string[]; circle: string; preset: 'Every morning' | 'Every evening'; time: string; day: string }> = [
  { viewer: ['America/New_York'], circle: 'America/Denver', preset: 'Every morning', time: '08:00', day: '2026-11-12' },
  { viewer: ['America/Denver'], circle: 'America/New_York', preset: 'Every morning', time: '08:00', day: '2026-11-12' },
  { viewer: ['UTC', 'Etc/UTC'], circle: 'America/Denver', preset: 'Every evening', time: '20:00', day: '2026-11-12' },
  { viewer: ['Europe/London'], circle: 'America/Denver', preset: 'Every morning', time: '08:00', day: '2026-11-12' },
  { viewer: ['Pacific/Auckland'], circle: 'America/Denver', preset: 'Every evening', time: '20:00', day: '2026-11-12' },
  { viewer: ['Asia/Kolkata', 'Asia/Calcutta'], circle: 'America/Los_Angeles', preset: 'Every evening', time: '20:00', day: '2026-11-12' },
];

describe('BC-8 schedule presets are the circle clock', () => {
  it('preset from another zone saves the circle clock and stays selected', async () => {
    const row = BC8.find((r) => r.viewer.includes(AMBIENT));
    if (!row) throw new Error(`ambient zone ${AMBIENT} is not in the BC-8 table`);
    useCircleResult.timezone = row.circle;
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
    render(<AddEventModal circleId={CIRCLE_ID} initialType="medication" layout="full" onClose={vi.fn()} />);
    await user.type(screen.getByLabelText(/Medication name/), 'Metformin');
    const strip = within(document.getElementById('schedule-presets') as HTMLElement);
    await user.click(strip.getByRole('radio', { name: new RegExp(`^${row.preset}`) }));
    expect(strip.getByRole('radio', { name: new RegExp(`^${row.preset}`) })).toHaveAttribute('aria-checked', 'true');
    await user.click(screen.getByTestId('add-event-save'));
    await waitFor(() => expect(mutateCreate).toHaveBeenCalledTimes(1));
    const body = mutateCreate.mock.calls[0][0] as Record<string, unknown>;
    expect(body.scheduled_time).toBe(row.time);
    expect(body.scheduled_date).toBe(row.day);
    expect(body.recurrence_rule).toBe('daily');
  });

  it('a hydrated daily 08:00 medication shows "Every morning" selected for every viewer', () => {
    useCircleResult.timezone = 'Pacific/Auckland';
    render(
      <AddEventModal
        circleId={CIRCLE_ID}
        layout="full"
        event={
          {
            id: 'med-1',
            circle_id: CIRCLE_ID,
            event_type: 'medication',
            title: 'Metformin',
            medication_name: 'Metformin',
            scheduled_date: '2026-11-12',
            scheduled_time: '08:00:00',
            recurrence_rule: 'daily',
            notifications_enabled: true,
            reminder_at_due: true,
          } as never
        }
        onClose={vi.fn()}
      />
    );
    const strip = within(document.getElementById('schedule-presets') as HTMLElement);
    expect(strip.getByRole('radio', { name: /^Every morning/ })).toHaveAttribute('aria-checked', 'true');
  });
});

// ── Reviewer follow-ups (mobile 1cc6ca60) ────────────────────────────────────────────────────────────────────────
describe('preset untap and dose promotion keep the circle day', () => {
  it('tapping a day-moving preset off puts the circle day back', async () => {
    const rows: Record<string, string> = { 'Pacific/Auckland': 'America/Denver', 'America/Denver': 'Asia/Tokyo' };
    const circle = rows[AMBIENT];
    if (!circle) return; // the preset does not move the viewer day from this zone
    useCircleResult.timezone = circle;
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
    render(<AddEventModal circleId={CIRCLE_ID} initialType="medication" layout="full" onClose={vi.fn()} />);
    const day = wallIn(circle, NOW).day;
    const dateField = () => screen.getByLabelText(/^Date/) as HTMLInputElement;
    expect(dateField().value).toBe(day);
    const strip = within(document.getElementById('schedule-presets') as HTMLElement);
    const morning = () => strip.getByRole('radio', { name: /^Every morning/ });
    await user.click(morning());
    expect(dateField().value).not.toBe(day); // the preset moved the viewer-frame day
    await user.click(morning());
    expect(dateField().value).toBe(day);
  });

  it('removing the first dose promotes the extra on the same circle day (New York viewer, Los Angeles circle)', async () => {
    if (AMBIENT !== 'America/New_York') return;
    useCircleResult.timezone = 'America/Los_Angeles';
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
    render(<AddEventModal circleId={CIRCLE_ID} initialType="medication" onClose={vi.fn()} />);
    await nameIt(user);
    await user.click(chipBox(/Morning$/));
    await user.click(chipBox(/Bedtime$/));
    await user.click(chipBox(/Morning$/)); // remove the first dose; Bedtime is promoted
    const bodies = await saveAll(user);
    expect(bodies).toHaveLength(1);
    expect(bodies[0]).toMatchObject({ scheduled_date: '2026-11-12', scheduled_time: '21:00' });
  });
});

// ── An extra dose on the second reading of the viewer's repeated hour ────────────────────────────────────────────
describe('an extra dose in the viewer repeated hour keeps its clock', () => {
  it('London viewer, New York circle, 2026-10-24: Morning + Bedtime saves 08:00 and 21:00', async () => {
    if (AMBIENT !== 'Europe/London') return; // the repeated hour is the viewer's: 21:00 EDT = 01:00 GMT, the second 01:00
    vi.setSystemTime(new Date('2026-10-20T12:00:00Z'));
    useCircleResult.timezone = 'America/New_York';
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
    render(<AddEventModal circleId={CIRCLE_ID} initialType="medication" onClose={vi.fn()} />);
    await nameIt(user);
    fireEvent.change(screen.getByLabelText(/^Starts/), { target: { value: '2026-10-24' } });
    await user.click(chipBox(/Morning$/));
    await user.click(chipBox(/Bedtime$/));
    const bodies = await saveAll(user);
    expect(bodies.map((b) => [b.scheduled_date, b.scheduled_time])).toEqual([
      ['2026-10-24', '08:00'],
      ['2026-10-24', '21:00'],
    ]);
  });
});
