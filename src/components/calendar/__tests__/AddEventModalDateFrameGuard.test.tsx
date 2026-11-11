import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import '@/i18n';
import { Analytics } from '@/lib/analytics';
import { resetLargeTextReports } from '@/lib/largeText';
import { AddEventModal } from '../AddEventModal';
import type { CalendarEvent } from '@/api/calendarEvents';

// GUARD: EVERY DATE AND TIME THE SIMPLE FORMS SHOW AGREES WITH WHAT THE SAVE SENDS (web twin of mobile's
// src/__tests__/screens/AddEventDateFrameGuard.test.tsx; the class behind the mobile medication Starts-tile bug).
//
// Table-driven over the simple MEDICATION, APPOINTMENT and TASK forms, NEW and EDIT, for viewer / circle zone
// pairs, at instants a minute either side of BOTH zones' midnights on three DST days (US fall back 2026-11-01,
// US spring forward 2026-03-08, Auckland fall back 2026-04-05). The viewer is the process zone: run
// `TZ=<zone> npx vitest run <file>` (America/Denver, UTC, America/New_York, Europe/London, Pacific/Auckland,
// Asia/Kolkata, Pacific/Pago_Pago). After the save, the Starts tile, Repeats until tile, chip / From / To tiles and
// the zone caption must read what the request body carries, and the body what was picked. Expected values come from
// the Intl-based oracle below, never the app.

const VIEWER = ((z: string) =>
  ({ 'Asia/Calcutta': 'Asia/Kolkata', 'Etc/UTC': 'UTC', 'Etc/GMT': 'UTC' } as Record<string, string>)[z] ?? z)(
  new Intl.DateTimeFormat().resolvedOptions().timeZone
);
const PAIRS: Record<string, string[]> = {
  'America/Denver': ['Asia/Tokyo', 'Pacific/Kiritimati'],
  'Pacific/Pago_Pago': ['America/Denver'],
  'Pacific/Auckland': ['Pacific/Honolulu'],
  'America/New_York': ['Europe/London'],
  UTC: ['Pacific/Pago_Pago'],
  'Europe/London': ['America/Denver'],
  'Asia/Kolkata': ['Pacific/Kiritimati'],
};
const DST_DAYS = ['2026-11-01', '2026-03-08', '2026-04-05'];

// ── Oracle (Intl only) ───────────────────────────────────────────────────────
const wallMs = (zone: string, ms: number): number => {
  const p = new Intl.DateTimeFormat('en-US', {
    timeZone: zone, hourCycle: 'h23', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit',
  }).formatToParts(new Date(ms));
  const g = (t: string) => Number(p.find((x) => x.type === t)?.value);
  return Date.UTC(g('year'), g('month') - 1, g('day'), g('hour') % 24, g('minute'));
};
const offsetMin = (zone: string, ms: number) => (wallMs(zone, Math.floor(ms / 60000) * 60000) - Math.floor(ms / 60000) * 60000) / 60000;
/** Instant of wall `day hh:mm` in `zone` (overlap -> the later reading, gap -> the pre-jump offset). */
function expectedInstant(zone: string, day: string, time: string): number {
  const [y, m, d] = day.split('-').map(Number);
  const [h, mi] = time.split(':').map(Number);
  const wall = Date.UTC(y, m - 1, d, h, mi);
  const cands = new Set<number>();
  for (const shift of [-1, 0, 1]) cands.add(wall - offsetMin(zone, wall + shift * 86400000) * 60000);
  const valid = [...cands].filter((t) => wallMs(zone, t) === wall).sort((a, b) => a - b);
  if (valid.length) return valid[valid.length - 1];
  return wall - offsetMin(zone, wall - 86400000) * 60000;
}
const addDays = (ymd: string, n: number) => {
  const d = new Date(`${ymd}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
};
const dayIn = (at: Date, tz: string) =>
  new Intl.DateTimeFormat('en-CA', { year: 'numeric', month: '2-digit', day: '2-digit', timeZone: tz }).format(at);
const clockMin = (at: Date, tz: string) => (wallMs(tz, at.getTime()) % 86400000) / 60000;
const mm = (hhmm: string) => {
  const [h, m] = hhmm.split(':').map(Number);
  return h * 60 + m;
};
const hhmmOf = (min: number) => {
  const v = ((min % 1440) + 1440) % 1440;
  return `${String(Math.floor(v / 60)).padStart(2, '0')}:${String(v % 60).padStart(2, '0')}`;
};
/** Every clock in a caption ("11:15 – 11:45 AM" shares one meridiem: a clock without one borrows the next's), in minutes. */
const clocksIn = (text: string): number[] => {
  const found = [...text.matchAll(/(\d{1,2}):(\d{2})\s?([AaPp]\.?[Mm]\.?)?/g)].map((m) => ({ h: Number(m[1]), mi: Number(m[2]), mer: m[3] ?? null }));
  return found.map((c, i) => {
    const mer = c.mer ?? found.slice(i + 1).find((x) => x.mer)?.mer ?? null;
    const h = mer ? (c.h % 12) + (/^p/i.test(mer) ? 12 : 0) : c.h;
    return h * 60 + c.mi;
  });
};
const dayForms = (ymd: string, year = false) =>
  ['en-US', 'en-GB'].map((loc) =>
    new Intl.DateTimeFormat(loc, { weekday: year ? undefined : 'short', month: 'short', day: 'numeric', year: year ? 'numeric' : undefined, timeZone: 'UTC' })
      .format(new Date(`${ymd}T12:00:00Z`))
      .replace(',', '')
  );
const showsDay = (shown: string, ymd: string, year = false) => dayForms(ymd, year).some((l) => shown.replace(/,/g, '').includes(l));

/** On each DST day: 23:50 on the viewer's clock (just before its midnight) and 00:10 on the circle's (just after its own). */
function instantsFor(viewer: string, circle: string): Array<[string, Date]> {
  const out: Array<[string, Date]> = [];
  for (const day of DST_DAYS) {
    out.push([`${day} 23:50 viewer`, new Date(expectedInstant(viewer, day, '23:50'))]);
    out.push([`${day} 00:10 circle`, new Date(expectedInstant(circle, day, '00:10'))]);
  }
  return out;
}
vi.setConfig({ testTimeout: 60000, hookTimeout: 60000 });

// ── Mocks (as AddEventModal.taskSimple.test.tsx) ─────────────────────────────
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
  recurrence_rule: null,
  recurrence_end_date: null,
  completed_at: null,
};

const radio = (name: string | RegExp) => screen.getByRole('radio', { name });
const startsInput = () => screen.getByLabelText(/^Starts/, { selector: 'input' }) as HTMLInputElement;
const repeatEndInput = () => screen.getByLabelText(/^Repeats until/, { selector: 'input' }) as HTMLInputElement;
const fromInput = () => screen.getByLabelText('From', { selector: 'input' }) as HTMLInputElement;
const toInput = () => screen.getByLabelText('To', { selector: 'input' }) as HTMLInputElement;
const chipOf = (name: RegExp) => {
  const group = document.getElementById('time-chips') as HTMLElement;
  return (group.querySelector(`[role="checkbox"],[role="radio"]`) ? Array.from(group.querySelectorAll('[role="checkbox"],[role="radio"]')) : []).find(
    (el) => name.test(el.textContent ?? '') || name.test(el.getAttribute('aria-label') ?? '')
  ) as HTMLElement;
};

type Kind = 'medication' | 'appointment' | 'task';
interface Want {
  day: string;
  time: string;
  endDay: string | null;
  durationMin: number | null;
}

/** Everything on screen must agree with the body. */
function expectShownMatchesBody(kind: Kind, body: Record<string, unknown>, want: Want, circle: string) {
  expect(body.scheduled_date).toBe(want.day);
  expect(body.scheduled_time).toBe(want.time);
  if (want.durationMin !== null) expect(body.duration_minutes).toBe(want.durationMin);
  // Starts
  expect(startsInput().value).toBe(body.scheduled_date);
  expect(showsDay(screen.getByTestId('starts-tile').textContent ?? '', body.scheduled_date as string)).toBe(true);
  // Repeats until
  if (want.endDay) {
    expect(body.recurrence_end_date).toBe(want.endDay);
    expect(repeatEndInput().value).toBe(want.endDay);
    expect(showsDay(screen.getByTestId('repeats-until-tile').textContent ?? '', want.endDay)).toBe(true);
  }
  // Time chip / From / To
  if (kind === 'medication') {
    const chip = chipOf(want.time === '08:00' ? /Morning/ : /Bedtime/);
    expect(chip.getAttribute('aria-checked')).toBe('true');
  } else {
    expect(fromInput().value).toBe(body.scheduled_time);
    if (body.duration_minutes) {
      expect(toInput().value).toBe(hhmmOf(mm(body.scheduled_time as string) + (body.duration_minutes as number)));
    }
  }
  // Zone caption: the viewer's clock of the circle instant the body names.
  const instant = new Date(expectedInstant(circle, body.scheduled_date as string, body.scheduled_time as string));
  const viewerClock = clockMin(instant, VIEWER);
  const differs = viewerClock !== mm(body.scheduled_time as string);
  const caption = screen.queryByTestId('time-zone-caption');
  if (differs) expect(caption).not.toBeNull();
  if (caption) expect(clocksIn(caption.textContent ?? '')[0]).toBe(viewerClock);
}

describe.each((PAIRS[VIEWER] ?? []).map((c) => [c]))('circle zone %s', (circle) => {
  describe.each(instantsFor(VIEWER, circle))('at %s', (_why, at) => {
    const circleToday = dayIn(at, circle);
    const startDay = addDays(circleToday, 2);
    const endDay = addDays(startDay, 5);
    const setup = () => {
      useCircleResult.timezone = circle;
      vi.useFakeTimers({ toFake: ['Date'], now: at });
      return userEvent.setup({ advanceTimers: () => {} });
    };
    const save = async (mock: typeof mutateCreate, edit: boolean) => {
      if (edit) fireEvent.click(screen.getByRole('button', { name: 'Save changes' }));
      else fireEvent.click(screen.getByTestId('add-event-save'));
      await waitFor(() => expect(mock).toHaveBeenCalledTimes(1));
      const arg = mock.mock.calls[0][0] as { data?: Record<string, unknown> };
      return (edit ? arg.data : arg) as Record<string, unknown>;
    };
    const setRepeatEnd = async (user: ReturnType<typeof userEvent.setup>) => {
      await user.click(radio('Every day'));
      fireEvent.change(repeatEndInput(), { target: { value: endDay } });
    };

    describe.each([['Morning', '08:00', /Morning/], ['Bedtime', '21:00', /Bedtime/]] as const)('NEW medication, %s chip', (_n, time, re) => {
      it('shows what it saves', async () => {
        const user = setup();
        render(<AddEventModal circleId={CIRCLE_ID} initialType="medication" onClose={vi.fn()} />);
        await user.type(screen.getByRole('combobox', { name: /Medication name/ }), 'Metformin');
        await user.click(chipOf(re));
        fireEvent.change(startsInput(), { target: { value: startDay } });
        await setRepeatEnd(user);
        const body = await save(mutateCreate, false);
        expectShownMatchesBody('medication', body, { day: startDay, time, endDay, durationMin: null }, circle);
      });
    });

    describe.each([['appointment'], ['task']] as const)('NEW %s', (kind) => {
      it.each([['23:30', 45], ['00:15', 45]])('picked %s for %s min shows what it saves', async (time, dur) => {
        const user = setup();
        render(<AddEventModal circleId={CIRCLE_ID} initialType={kind} onClose={vi.fn()} />);
        await user.type(screen.getByRole('textbox', { name: /^Title/ }), 'Visit');
        fireEvent.change(startsInput(), { target: { value: startDay } });
        await user.click(radio('Pick a time'));
        fireEvent.change(fromInput(), { target: { value: time } });
        fireEvent.change(toInput(), { target: { value: hhmmOf(mm(time) + dur) } });
        await setRepeatEnd(user);
        const body = await save(mutateCreate, false);
        expectShownMatchesBody(kind, body, { day: startDay, time, endDay, durationMin: dur }, circle);
      });
    });

    describe('EDIT', () => {
      const ev = (type: Kind, time: string, extra: Record<string, unknown> = {}) =>
        ({
          ...eventBase,
          id: 'ev-1',
          event_type: type,
          title: 'Thing',
          medication_name: type === 'medication' ? 'Thing' : undefined,
          medication_dosage: type === 'medication' ? '10 mg' : undefined,
          scheduled_date: startDay,
          scheduled_time: `${time}:00`,
          recurrence_rule: 'daily',
          recurrence_end_date: endDay,
          ...extra,
        }) as unknown as CalendarEvent;
      it.each([['08:00'], ['21:00']])('medication stored at %s shows what it saves', async (time) => {
        setup();
        render(<AddEventModal circleId={CIRCLE_ID} event={ev('medication', time)} onClose={vi.fn()} />);
        const body = await save(mutateUpdate, true);
        expectShownMatchesBody('medication', body, { day: startDay, time, endDay, durationMin: null }, circle);
      });
      it.each([['appointment', '23:30'], ['appointment', '00:15'], ['task', '23:30'], ['task', '00:15']] as const)(
        '%s stored at %s shows what it saves',
        async (kind, time) => {
          setup();
          render(<AddEventModal circleId={CIRCLE_ID} event={ev(kind, time, { duration_minutes: 45 })} onClose={vi.fn()} />);
          const body = await save(mutateUpdate, true);
          expectShownMatchesBody(kind, body, { day: startDay, time, endDay, durationMin: 45 }, circle);
        }
      );
    });
  });
});

it('has a pair for this process zone', () => {
  expect(PAIRS[VIEWER]).toBeDefined();
});
