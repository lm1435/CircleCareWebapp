import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import '@/i18n';
import { Analytics } from '@/lib/analytics';
import { resetLargeTextReports } from '@/lib/largeText';
import { AddEventModal } from '../AddEventModal';
import type { CalendarEvent } from '@/api/calendarEvents';

// GUARD (web twin of mobile bugs C1 and C2): in a far zone the form's internal (viewer-frame) date can move off the
// circle's day when a time is picked. C1: clearing the only time (When needed and back, Any time and back, untap
// the chip) must leave the CIRCLE's day, not the viewer's. C2: the saved `recurrence_end_date` (a circle day the
// user picked) must not drift by a day when the time changes, the primary dose is removed, a chip is deselected or
// the start moves across a clock change.
//
// The viewer is the process zone: run with TZ=<zone> (America/Denver, UTC, America/New_York, Europe/London,
// Pacific/Auckland, Asia/Kolkata). Each sequence runs against a spread of far circles; expected days come from the
// Intl oracle below, never from the app.

vi.setConfig({ testTimeout: 60000, hookTimeout: 60000 });

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
  circle: { recipient_name: 'Rosa', is_self_care: false } as { recipient_name?: string; is_self_care?: boolean },
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
  mutateCreate.mockResolvedValue({ id: 'new' });
  mutateUpdate.mockResolvedValue({ id: 'ev-1' });
  for (const name of ['entrySaveTapped', 'entryFormStepCompleted', 'entryFormOpened', 'largeTextLayout', 'timeChipSelected', 'medicationCreated', 'firstRunMedicationSaved'] as const) {
    vi.spyOn(Analytics as unknown as Record<string, () => void>, name).mockImplementation(() => {});
  }
});
afterEach(() => {
  vi.restoreAllMocks();
  vi.useRealTimers();
});

// ── Oracle (Intl only) ───────────────────────────────────────────────────────
const addDays = (ymd: string, n: number) => {
  const d = new Date(`${ymd}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
};
const dayIn = (at: Date, tz: string) =>
  new Intl.DateTimeFormat('en-CA', { year: 'numeric', month: '2-digit', day: '2-digit', timeZone: tz }).format(at);
const dayForms = (ymd: string) =>
  ['en-US', 'en-GB'].map((loc) =>
    new Intl.DateTimeFormat(loc, { weekday: 'short', month: 'short', day: 'numeric', timeZone: 'UTC' })
      .format(new Date(`${ymd}T12:00:00Z`))
      .replace(',', '')
  );
const showsDay = (shown: string, ymd: string) => dayForms(ymd).some((l) => shown.replace(/,/g, '').includes(l));

// ── UI helpers ───────────────────────────────────────────────────────────────
const radio = (name: string | RegExp) => screen.getByRole('radio', { name });
const startsInput = () => screen.getByLabelText(/^Starts/, { selector: 'input' }) as HTMLInputElement;
const repeatEndInput = () => screen.getByLabelText(/^Repeats until/, { selector: 'input' }) as HTMLInputElement;
const fromInput = () => screen.getByLabelText('From', { selector: 'input' }) as HTMLInputElement;
const chipOf = (name: RegExp) => {
  const group = document.getElementById('time-chips') as HTMLElement;
  return Array.from(group.querySelectorAll('[role="checkbox"],[role="radio"]')).find(
    (el) => name.test(el.textContent ?? '') || name.test(el.getAttribute('aria-label') ?? '')
  ) as HTMLElement;
};
const isOn = (el: HTMLElement) => el.getAttribute('aria-checked') === 'true';
const tapChip = async (user: ReturnType<typeof userEvent.setup>, name: RegExp) => {
  await user.click(chipOf(name));
};
const ensureChip = async (user: ReturnType<typeof userEvent.setup>, name: RegExp) => {
  if (!isOn(chipOf(name))) await user.click(chipOf(name));
  expect(isOn(chipOf(name))).toBe(true);
};
const startsText = () => screen.getByTestId('starts-tile').textContent ?? '';
const endText = () => screen.getByTestId('repeats-until-tile').textContent ?? '';

type Kind = 'medication' | 'appointment' | 'task';
function open(kind: Kind, zone: string, now: string) {
  useCircleResult.timezone = zone;
  vi.useFakeTimers({ toFake: ['Date'], now: new Date(now) });
  const user = userEvent.setup({ advanceTimers: () => {} });
  render(<AddEventModal circleId={CIRCLE_ID} initialType={kind} onClose={vi.fn()} />);
  return user;
}
async function nameIt(user: ReturnType<typeof userEvent.setup>, kind: Kind) {
  if (kind === 'medication') await user.type(screen.getByRole('combobox', { name: /Medication name/ }), 'Metformin');
  else await user.type(screen.getByRole('textbox', { name: /^Title/ }), 'Visit');
}
async function saveNew(): Promise<Record<string, unknown>> {
  mutateCreate.mockClear();
  fireEvent.click(screen.getByTestId('add-event-save'));
  await waitFor(() => expect(mutateCreate).toHaveBeenCalledTimes(1));
  return mutateCreate.mock.calls[0][0] as Record<string, unknown>;
}
async function saveEdit(): Promise<Record<string, unknown>> {
  mutateUpdate.mockClear();
  fireEvent.click(screen.getByRole('button', { name: 'Save changes' }));
  await waitFor(() => expect(mutateUpdate).toHaveBeenCalledTimes(1));
  return (mutateUpdate.mock.calls[0][0] as { data: Record<string, unknown> }).data;
}
const pickTime = async (user: ReturnType<typeof userEvent.setup>, time: string) => {
  if (!screen.queryByLabelText('From', { selector: 'input' })) await user.click(radio('Pick a time'));
  fireEvent.change(fromInput(), { target: { value: time } });
};

const CIRCLES = ['Asia/Tokyo', 'Pacific/Pago_Pago', 'Pacific/Kiritimati', 'Pacific/Auckland', 'America/Denver', 'Pacific/Honolulu', 'Europe/London'];
const NOWS = ['2026-11-11T08:14:00Z', '2026-11-10T11:00:00Z', '2026-11-11T23:50:00Z'];
const MATRIX = CIRCLES.flatMap((c) => NOWS.map((n) => [c, n] as const));

// ═══ C1: clearing a time keeps the circle's day ═════════════════════════════════════════════════
describe.each(MATRIX)('C1, circle %s, now %s', (circle, now) => {
  const today = () => dayIn(new Date(now), circle);

  it('medication: Morning -> When needed -> Every day -> Morning saves the circle today, Starts tile agrees', async () => {
    const user = open('medication', circle, now);
    await nameIt(user, 'medication');
    await tapChip(user, /Morning/);
    await user.click(radio('When needed'));
    await user.click(radio('Every day'));
    await ensureChip(user, /Morning/);
    expect(showsDay(startsText(), today())).toBe(true);
    const body = await saveNew();
    expect(body.scheduled_date).toBe(today());
    expect(body.scheduled_time).toBe('08:00');
    expect(startsInput().value).toBe(today());
  });

  it('medication: Morning chip untapped (only time cleared), then Bedtime: still the circle today', async () => {
    const user = open('medication', circle, now);
    await nameIt(user, 'medication');
    await tapChip(user, /Morning/);
    await tapChip(user, /Morning/);
    expect(showsDay(startsText(), today())).toBe(true);
    await tapChip(user, /Bedtime/);
    const body = await saveNew();
    expect(body.scheduled_date).toBe(today());
    expect(body.scheduled_time).toBe('21:00');
  });

  it.each(['appointment', 'task'] as const)('%s: 08:00 -> Any time saves the circle today, no time', async (kind) => {
    const user = open(kind, circle, now);
    await nameIt(user, kind);
    await pickTime(user, '08:00');
    await user.click(radio('Any time'));
    const shown = startsText();
    const body = await saveNew();
    expect(body.scheduled_date).toBe(today());
    expect(body.scheduled_time ?? null).toBeNull();
    expect(startsInput().value).toBe(today());
    expect(showsDay(shown, today())).toBe(true);
  });

  it.each(['appointment', 'task'] as const)('%s: 08:00 -> Any time -> 21:00 -> Any time stays on the circle today', async (kind) => {
    const user = open(kind, circle, now);
    await nameIt(user, kind);
    await pickTime(user, '08:00');
    await user.click(radio('Any time'));
    await pickTime(user, '21:00');
    await user.click(radio('Any time'));
    const shown = startsText();
    const body = await saveNew();
    expect(body.scheduled_date).toBe(today());
    expect(body.scheduled_time ?? null).toBeNull();
    expect(showsDay(shown, today())).toBe(true);
  });

  it.each(['appointment', 'task'] as const)('%s: a chosen start day survives Pick time -> Any time', async (kind) => {
    const user = open(kind, circle, now);
    await nameIt(user, kind);
    const day = addDays(today(), 3);
    fireEvent.change(startsInput(), { target: { value: day } });
    await pickTime(user, '23:30');
    await user.click(radio('Any time'));
    const body = await saveNew();
    expect(body.scheduled_date).toBe(day);
  });
});

// ═══ C2: the repeat end stays the circle day the user picked ═══════════════════════════════════
const RE_MATRIX = CIRCLES.flatMap((c) => NOWS.slice(0, 2).map((n) => [c, n] as const));
describe.each(RE_MATRIX)('C2, circle %s, now %s', (circle, now) => {
  const today = () => dayIn(new Date(now), circle);
  const endDay = () => addDays(today(), 10);
  const eventBase = {
    circle_id: CIRCLE_ID,
    created_at: '2026-01-01T00:00:00Z',
    updated_at: '2026-01-01T00:00:00Z',
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
    completed_at: null,
  };
  const stored = (type: Kind, time: string) =>
    ({
      ...eventBase,
      id: 'ev-1',
      event_type: type,
      title: 'Thing',
      medication_name: type === 'medication' ? 'Thing' : undefined,
      medication_dosage: type === 'medication' ? '10 mg' : undefined,
      scheduled_date: addDays(today(), 2),
      scheduled_time: `${time}:00`,
      recurrence_rule: 'daily',
      recurrence_end_date: endDay(),
      ...(type === 'medication' ? {} : { duration_minutes: 45 }),
    }) as unknown as CalendarEvent;
  const renderEdit = (type: Kind, time: string) => {
    useCircleResult.timezone = circle;
    vi.useFakeTimers({ toFake: ['Date'], now: new Date(now) });
    const user = userEvent.setup({ advanceTimers: () => {} });
    render(<AddEventModal circleId={CIRCLE_ID} event={stored(type, time)} onClose={vi.fn()} />);
    return user;
  };

  it.each([['08:00', /Bedtime/, '21:00'], ['21:00', /Morning/, '08:00']] as const)(
    'EDIT daily medication stored %s, change to %s: end and start unchanged',
    async (from, chip, to) => {
      const user = renderEdit('medication', from);
      await user.click(chipOf(chip));
      expect(repeatEndInput().value).toBe(endDay());
      const body = await saveEdit();
      expect(body.scheduled_time).toBe(to);
      expect(body.scheduled_date).toBe(addDays(today(), 2));
      expect(body.recurrence_end_date).toBe(endDay());
    }
  );

  it.each([['task'], ['appointment']] as const)('EDIT %s: changing the time keeps start and end', async (kind) => {
    const user = renderEdit(kind, '08:00');
    fireEvent.change(fromInput(), { target: { value: '23:30' } });
    expect(repeatEndInput().value).toBe(endDay());
    let body = await saveEdit();
    expect(body.scheduled_time).toBe('23:30');
    expect(body.scheduled_date).toBe(addDays(today(), 2));
    expect(body.recurrence_end_date).toBe(endDay());
    fireEvent.change(fromInput(), { target: { value: '00:15' } });
    body = await saveEdit();
    expect(body.scheduled_date).toBe(addDays(today(), 2));
    expect(body.recurrence_end_date).toBe(endDay());
    await user.click(radio('Any time'));
    body = await saveEdit();
    expect(body.scheduled_date).toBe(addDays(today(), 2));
    expect(body.recurrence_end_date).toBe(endDay());
  });

  it('NEW medication Morning + Bedtime, Repeats until X, remove Morning: X kept', async () => {
    const user = open('medication', circle, now);
    await nameIt(user, 'medication');
    await tapChip(user, /Morning/);
    await tapChip(user, /Bedtime/);
    await user.click(radio('Every day'));
    fireEvent.change(repeatEndInput(), { target: { value: endDay() } });
    expect(repeatEndInput().value).toBe(endDay());
    await tapChip(user, /Morning/);
    expect(repeatEndInput().value).toBe(endDay());
    expect(showsDay(endText(), endDay())).toBe(true);
    const body = await saveNew();
    expect(body.scheduled_time).toBe('21:00');
    expect(body.scheduled_date).toBe(today());
    expect(body.recurrence_end_date).toBe(endDay());
  });

  it('NEW medication Morning + Bedtime, remove Bedtime then Morning swaps: X kept', async () => {
    const user = open('medication', circle, now);
    await nameIt(user, 'medication');
    await tapChip(user, /Bedtime/);
    await tapChip(user, /Morning/);
    await user.click(radio('Every day'));
    fireEvent.change(repeatEndInput(), { target: { value: endDay() } });
    await tapChip(user, /Bedtime/);
    expect(repeatEndInput().value).toBe(endDay());
    const body = await saveNew();
    expect(body.scheduled_time).toBe('08:00');
    expect(body.recurrence_end_date).toBe(endDay());
  });

  it('NEW medication Morning, Repeats until X, deselect Morning: the tile still reads X', async () => {
    const user = open('medication', circle, now);
    await nameIt(user, 'medication');
    await tapChip(user, /Morning/);
    await user.click(radio('Every day'));
    fireEvent.change(repeatEndInput(), { target: { value: endDay() } });
    await tapChip(user, /Morning/);
    expect(isOn(chipOf(/Morning/))).toBe(false);
    expect(repeatEndInput().value).toBe(endDay());
    expect(showsDay(endText(), endDay())).toBe(true);
    await tapChip(user, /Evening/);
    const body = await saveNew();
    expect(body.recurrence_end_date).toBe(endDay());
    expect(body.scheduled_date).toBe(today());
  });

  it('NEW medication: Repeats until X then picking a different time through Other... keeps X', async () => {
    const user = open('medication', circle, now);
    await nameIt(user, 'medication');
    await user.click(radio('Every day'));
    fireEvent.change(repeatEndInput(), { target: { value: endDay() } });
    await user.click(screen.getByTestId('time-chip-other'));
    fireEvent.change(screen.getByLabelText('Other time', { selector: 'input' }), { target: { value: '23:30' } });
    expect(repeatEndInput().value).toBe(endDay());
    fireEvent.change(screen.getByLabelText('Change 11:30 PM dose time', { selector: 'input' }), { target: { value: '00:30' } });
    const body = await saveNew();
    expect(body.scheduled_time).toBe('00:30');
    expect(body.recurrence_end_date).toBe(endDay());
  });

  it.each([['task'], ['appointment']] as const)('NEW %s: time changes and Any time keep Repeats until X', async (kind) => {
    const user = open(kind, circle, now);
    await nameIt(user, kind);
    await user.click(radio('Every day'));
    fireEvent.change(repeatEndInput(), { target: { value: endDay() } });
    await pickTime(user, '23:30');
    expect(repeatEndInput().value).toBe(endDay());
    await pickTime(user, '00:15');
    expect(repeatEndInput().value).toBe(endDay());
    await pickTime(user, '08:00');
    await user.click(radio('Any time'));
    expect(repeatEndInput().value).toBe(endDay());
    const body = await saveNew();
    expect(body.recurrence_end_date).toBe(endDay());
    expect(body.scheduled_date).toBe(today());
  });
});

// ═══ C2: the start moves across a clock change (the Phoenix / Denver sequence, generalised) ═════
// Viewer-zone spans are fixed-length, circle days are not: 2026-11-01 is the US fall-back, so the start moving
// from 10-20 to 11-05 crosses a DST change in the viewer's (or circle's) zone.
describe.each(['America/Denver', 'America/Phoenix', 'Europe/London', 'Pacific/Auckland', 'Asia/Tokyo', 'Pacific/Kiritimati'])(
  'C2 start across a clock change, circle %s',
  (circle) => {
    const NOW = '2026-10-20T12:00:00Z';
    const START = '2026-11-05';
    const END = '2026-11-20';

    it('medication: Other... 23:30, Repeats until 11-20, Starts -> 11-05 saves end 11-20', async () => {
      const user = open('medication', circle, NOW);
      await nameIt(user, 'medication');
      await user.click(radio('Every day'));
      await user.click(screen.getByTestId('time-chip-other'));
      fireEvent.change(screen.getByLabelText('Other time', { selector: 'input' }), { target: { value: '23:30' } });
      fireEvent.change(repeatEndInput(), { target: { value: END } });
      fireEvent.change(startsInput(), { target: { value: START } });
      expect(repeatEndInput().value).toBe(END);
      expect(startsInput().value).toBe(START);
      const body = await saveNew();
      expect(body.scheduled_date).toBe(START);
      expect(body.scheduled_time).toBe('23:30');
      expect(body.recurrence_end_date).toBe(END);
    });

    it.each([['task'], ['appointment']] as const)('%s: 23:30, Repeats until 11-20, Starts -> 11-05 saves end 11-20', async (kind) => {
      const user = open(kind, circle, NOW);
      await nameIt(user, kind);
      await user.click(radio('Every day'));
      await pickTime(user, '23:30');
      fireEvent.change(repeatEndInput(), { target: { value: END } });
      fireEvent.change(startsInput(), { target: { value: START } });
      fireEvent.change(startsInput(), { target: { value: '2026-10-25' } });
      fireEvent.change(startsInput(), { target: { value: START } });
      expect(repeatEndInput().value).toBe(END);
      const body = await saveNew();
      expect(body.scheduled_date).toBe(START);
      expect(body.scheduled_time).toBe('23:30');
      expect(body.recurrence_end_date).toBe(END);
    });

    it('medication Morning chip: Starts moved there and back keeps end 11-20', async () => {
      const user = open('medication', circle, NOW);
      await nameIt(user, 'medication');
      await user.click(radio('Every day'));
      await tapChip(user, /Bedtime/);
      fireEvent.change(repeatEndInput(), { target: { value: END } });
      fireEvent.change(startsInput(), { target: { value: START } });
      await tapChip(user, /Bedtime/);
      await tapChip(user, /Morning/);
      expect(repeatEndInput().value).toBe(END);
      const body = await saveNew();
      expect(body.scheduled_date).toBe(START);
      expect(body.recurrence_end_date).toBe(END);
    });
  }
);
