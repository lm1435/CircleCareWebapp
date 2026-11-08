import fs from 'fs';
import path from 'path';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import '@/i18n';
import type { CalendarEvent } from '@/api/calendarEvents';
import { Analytics } from '@/lib/analytics';
import { resetLargeTextReports } from '@/lib/largeText';
import { AddEventModal } from '../AddEventModal';

// THE NEW / EDIT TASK FORM IN THE SIMPLE STYLE (owner 1.4.0, mobile parity): same state, same `buildPayload`,
// same Save. Only the arrangement changed ("What needs doing? / When? / How often? / Who's doing it? / More
// details"), so the request body for the same choices must be BYTE-IDENTICAL to the old full task form's.
//
// The old side is a fixture CAPTURED FROM THE OLD FORM (CAPTURE_OLD_TASK_FORM=1 with HEAD's AddEventModal in
// place, where a task always opened the full layout): `__fixtures__/taskFormOldLayoutPayloads.json`. Every
// case names the SAME intent twice: how the old form was driven (a viewer-frame Date + Time, the Repeat and
// Assigned-to selects) and how the new one is (recipient-day tiles, "Pick a time" on the recipient's clock,
// the How often / Who tiles, More details). Create AND edit, every option kind.
//
// The viewer (browser) zone is pinned to America/Denver; the recipient zone carries the coverage (New York,
// Denver itself, Auckland, Kiritimati +14, Midway -11) and a DST day. Date is pinned to 2027-02-10 18:40Z.

const VIEWER_TZ = 'America/Denver';
const ORIGINAL_TZ = process.env.TZ;
beforeAll(() => {
  process.env.TZ = VIEWER_TZ;
});
afterAll(() => {
  process.env.TZ = ORIGINAL_TZ;
});

const FIXTURE = path.join(__dirname, '__fixtures__', 'taskFormOldLayoutPayloads.json');
const CAPTURE = process.env.CAPTURE_OLD_TASK_FORM === '1';
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
vi.mock('@/store/authStore', () => ({
  useAuthStore: (select: (s: { user: { id: string } }) => unknown) => select({ user: { id: ME_ID } }),
}));
const useCircleResult = {
  circle: { recipient_name: 'Rosa', is_self_care: false, owner_id: ME_ID },
  circleSummary: undefined,
  timezone: 'America/New_York',
  members: [
    { id: ANA_ID, email: 'ana@example.com', first_name: 'Ana', is_care_recipient: false },
    { id: ME_ID, email: 'luis@example.com', first_name: 'Luis', is_care_recipient: false },
    { id: ROSA_ID, email: 'rosa@example.com', first_name: 'Rosa', is_care_recipient: true },
  ],
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
  mutateUpdate.mockResolvedValue({ id: 'task-1' });
  for (const name of [
    'entryFormOpened',
    'entryFormStepCompleted',
    'timeChipSelected',
    'entrySaveTapped',
    'largeTextLayout',
  ] as const) {
    vi.spyOn(Analytics, name).mockImplementation(() => {});
  }
});
afterEach(() => {
  vi.restoreAllMocks();
  vi.useRealTimers();
});

// ── Frame oracles (independent of the code under test) ─────────────────────────────────────────────

/** The real instant of a naive wall clock in `zone`. */
function instantIn(day: string, time: string, zone: string): Date {
  const naive = Date.parse(`${day}T${time}:00Z`);
  const offsetAt = (t: number) => {
    const p = Object.fromEntries(
      new Intl.DateTimeFormat('en-US', {
        timeZone: zone, hourCycle: 'h23', year: 'numeric', month: 'numeric', day: 'numeric',
        hour: 'numeric', minute: 'numeric',
      })
        .formatToParts(new Date(t))
        .map((x) => [x.type, x.value])
    );
    return Date.UTC(+p.year, +p.month - 1, +p.day, +p.hour % 24, +p.minute) - t;
  };
  let t = naive - offsetAt(naive);
  t = naive - offsetAt(t);
  return new Date(t);
}
function viewerWall(instant: Date): { day: string; time: string } {
  const p = Object.fromEntries(
    new Intl.DateTimeFormat('en-CA', {
      timeZone: VIEWER_TZ, hourCycle: 'h23', year: 'numeric', month: '2-digit', day: '2-digit',
      hour: '2-digit', minute: '2-digit',
    })
      .formatToParts(instant)
      .map((x) => [x.type, x.value])
  );
  return { day: `${p.year}-${p.month}-${p.day}`, time: `${String(+p.hour % 24).padStart(2, '0')}:${p.minute}` };
}
function daysFrom(a: string, b: string): number {
  return Math.round((Date.parse(`${b}T12:00:00Z`) - Date.parse(`${a}T12:00:00Z`)) / 86400000);
}
function spanOf(start: string, end: string): number {
  const [sh, sm] = start.split(':').map(Number);
  const [eh, em] = end.split(':').map(Number);
  const diff = eh * 60 + em - (sh * 60 + sm);
  return diff > 0 ? diff : diff + 1440;
}
function clockPlus(clock: string, minutes: number): string {
  const [h, m] = clock.split(':').map(Number);
  const total = (h * 60 + m + minutes) % 1440;
  return `${String(Math.floor(total / 60)).padStart(2, '0')}:${String(total % 60).padStart(2, '0')}`;
}
function plusDays(day: string, n: number): string {
  const d = new Date(`${day}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

// ── The two drivers: the same intent through the old full form and the new simple one ───────────

type User = ReturnType<typeof userEvent.setup>;
type Repeat = 'none' | 'daily' | 'weekly' | 'every_other_day' | 'monthly' | 'yearly' | 'cycle' | 'days_of_week';
type Who = 'anyone' | 'me' | 'ana' | 'rosa';

interface Driver {
  title(text: string): Promise<void>;
  /** The recipient's day (and the recipient's time, or none). `timeFirst`: the new form picks the time first. */
  when(zone: string, day: string, time: string | null, opts?: { timeFirst?: boolean }): Promise<void>;
  clearTime(): Promise<void>;
  repeat(choice: Repeat, extra?: { days?: string[]; cycle?: [string, string] }): Promise<void>;
  /** The repeat's last day as the RECIPIENT counts it, for a series starting on the recipient's `start` (+ time). */
  repeatEnd(zone: string, start: string, time: string | null, end: string): Promise<void>;
  who(who: Who): Promise<void>;
  details(text: string): Promise<void>;
  duration(label: string): Promise<void>;
  /** The end on the RECIPIENT's clock, for a start at the recipient's `day` + `start`. */
  endTime(zone: string, day: string, start: string, end: string): Promise<void>;
  reminders(): Promise<void>;
}

const WHO_ID: Record<Who, string> = { anyone: '', me: ME_ID, ana: ANA_ID, rosa: ROSA_ID };

const titleBox = () => screen.getByRole('textbox', { name: /^Title/ });

async function changeTitle(user: User, text: string) {
  await user.clear(titleBox());
  await user.type(titleBox(), text);
}
async function pickRepeatSelect(user: User, choice: Repeat, extra?: { days?: string[]; cycle?: [string, string] }) {
  await user.selectOptions(screen.getByRole('combobox', { name: /^Repeat/ }), choice);
  await pickDaysAndCycle(user, extra);
}
async function pickDaysAndCycle(user: User, extra?: { days?: string[]; cycle?: [string, string] }) {
  for (const day of extra?.days ?? []) await user.click(screen.getByRole('checkbox', { name: day }));
  if (extra?.cycle) {
    fireEvent.change(screen.getByLabelText(/^Days on/), { target: { value: extra.cycle[0] } });
    fireEvent.change(screen.getByLabelText(/^Days off/), { target: { value: extra.cycle[1] } });
  }
}
async function remindersCommon(user: User) {
  await user.click(screen.getByRole('checkbox', { name: 'At the scheduled time' }));
  await user.click(screen.getByRole('checkbox', { name: '1 hour before' }));
}

function oldDriver(user: User): Driver {
  return {
    title: (text) => changeTitle(user, text),
    async when(zone, day, time) {
      if (time) {
        const wall = viewerWall(instantIn(day, time, zone));
        fireEvent.change(screen.getByLabelText(/^Date/), { target: { value: wall.day } });
        fireEvent.change(screen.getByLabelText(/^Time/, { selector: 'input' }), { target: { value: wall.time } });
      } else {
        fireEvent.change(screen.getByLabelText(/^Date/), { target: { value: day } });
      }
    },
    async clearTime() {
      fireEvent.change(screen.getByLabelText(/^Time/, { selector: 'input' }), { target: { value: '' } });
    },
    repeat: (choice, extra) => pickRepeatSelect(user, choice, extra),
    async repeatEnd(zone, start, time, end) {
      // The old End date was typed on the viewer's side: its span from the viewer's start day is what is kept.
      const viewerStart = time ? viewerWall(instantIn(start, time, zone)).day : start;
      const typed = plusDays(viewerStart, daysFrom(start, end));
      fireEvent.change(screen.getByLabelText(/^End date/), { target: { value: typed } });
    },
    async who(who) {
      await user.selectOptions(screen.getByRole('combobox', { name: /^Assigned to/ }), WHO_ID[who]);
    },
    async details(text) {
      await user.clear(screen.getByLabelText(/^Details/));
      await user.type(screen.getByLabelText(/^Details/), text);
    },
    async duration(label) {
      await user.click(screen.getByRole('radio', { name: label }));
    },
    async endTime(zone, day, start, end) {
      // The old End time was the viewer's clock: the viewer start plus the same span.
      const viewerStart = viewerWall(instantIn(day, start, zone)).time;
      fireEvent.change(screen.getByLabelText(/^End time/), {
        target: { value: clockPlus(viewerStart, spanOf(start, end)) },
      });
    },
    reminders: () => remindersCommon(user),
  };
}

function newDriver(user: User): Driver {
  async function openMore() {
    const toggle = screen.getByRole('button', { name: /^More details/ });
    if (toggle.getAttribute('aria-expanded') !== 'true') await user.click(toggle);
  }
  async function chooseDay(_zone: string, day: string) {
    // The date field is always there (no Today / Tomorrow / Other day tiles any more).
    fireEvent.change(screen.getByLabelText(/^Date/), { target: { value: day } });
  }
  async function chooseTime(time: string) {
    await user.click(screen.getByTestId('task-time-tile'));
    fireEvent.change(screen.getByLabelText(/^Time/, { selector: 'input' }), { target: { value: time } });
  }
  return {
    title: (text) => changeTitle(user, text),
    async when(zone, day, time, opts) {
      if (time && opts?.timeFirst) {
        await chooseTime(time);
        await chooseDay(zone, day);
        return;
      }
      await chooseDay(zone, day);
      if (time) await chooseTime(time);
    },
    async clearTime() {
      await user.click(screen.getByRole('radio', { name: 'Any time' }));
    },
    async repeat(choice, extra) {
      const tile: Partial<Record<Repeat, string>> = { none: 'Once', daily: 'Every day', weekly: 'Every week' };
      const custom: Partial<Record<Repeat, string>> = {
        every_other_day: 'Every other day', cycle: 'Days on / off', days_of_week: 'Some days',
        monthly: 'Monthly', yearly: 'Yearly',
      };
      if (tile[choice]) {
        await user.click(screen.getByRole('radio', { name: tile[choice] }));
      } else {
        const opener = screen.getByTestId('task-repeat-custom');
        if (opener.getAttribute('aria-expanded') !== 'true') await user.click(opener);
        await user.click(screen.getByRole('radio', { name: custom[choice] }));
      }
      await pickDaysAndCycle(user, extra);
    },
    async repeatEnd(_zone, _start, _time, end) {
      await openMore();
      fireEvent.change(screen.getByLabelText(/^End date/), { target: { value: end } });
    },
    async who(who) {
      const name = { anyone: 'Anyone', me: 'Me', ana: 'Ana', rosa: /^Rosa/ }[who];
      await user.click(screen.getByRole('radio', { name }));
    },
    async details(text) {
      await openMore();
      await user.clear(screen.getByLabelText(/^Details/));
      await user.type(screen.getByLabelText(/^Details/), text);
    },
    async duration(label) {
      await openMore();
      await user.click(screen.getByRole('radio', { name: label }));
    },
    async endTime(_zone, _day, _start, end) {
      await openMore();
      fireEvent.change(screen.getByLabelText(/^End time/), { target: { value: end } });
    },
    async reminders() {
      await openMore();
      await remindersCommon(user);
    },
  };
}

// ── Cases ─────────────────────────────────────────────────────────────────────────────────────────

interface CreateCase {
  name: string;
  zone: string;
  act: (d: Driver) => Promise<void>;
}
const NY = 'America/New_York';
const CREATE_CASES: CreateCase[] = [
  { name: 'create-date-only-today', zone: NY, act: async (d) => { await d.title('Water the plants'); await d.when(NY, '2027-02-10', null); } },
  { name: 'create-date-only-tomorrow', zone: NY, act: async (d) => { await d.title('Water the plants'); await d.when(NY, '2027-02-11', null); } },
  { name: 'create-date-only-later', zone: NY, act: async (d) => { await d.title('Water the plants'); await d.when(NY, '2027-03-15', null); } },
  { name: 'create-date-only-today-kiritimati', zone: 'Pacific/Kiritimati', act: async (d) => { await d.title('Call the pharmacy'); await d.when('Pacific/Kiritimati', '2027-02-11', null); } },
  { name: 'create-date-only-tomorrow-midway', zone: 'Pacific/Midway', act: async (d) => { await d.title('Call the pharmacy'); await d.when('Pacific/Midway', '2027-02-11', null); } },
  { name: 'create-timed-ny-tomorrow', zone: NY, act: async (d) => { await d.title('Pick up prescription'); await d.when(NY, '2027-02-11', '09:00'); } },
  { name: 'create-timed-same-zone', zone: VIEWER_TZ, act: async (d) => { await d.title('Pick up prescription'); await d.when(VIEWER_TZ, '2027-02-10', '14:30'); } },
  { name: 'create-timed-auckland-other-day', zone: 'Pacific/Auckland', act: async (d) => { await d.title('Book a ride'); await d.when('Pacific/Auckland', '2027-02-14', '07:15'); } },
  { name: 'create-timed-kiritimati-today-late', zone: 'Pacific/Kiritimati', act: async (d) => { await d.title('Book a ride'); await d.when('Pacific/Kiritimati', '2027-02-11', '23:30'); } },
  { name: 'create-timed-kiritimati-time-first', zone: 'Pacific/Kiritimati', act: async (d) => { await d.title('Book a ride'); await d.when('Pacific/Kiritimati', '2027-02-12', '23:30', { timeFirst: true }); } },
  { name: 'create-timed-midway-today', zone: 'Pacific/Midway', act: async (d) => { await d.title('Book a ride'); await d.when('Pacific/Midway', '2027-02-10', '23:45'); } },
  { name: 'create-timed-ny-dst-day', zone: NY, act: async (d) => { await d.title('Book a ride'); await d.when(NY, '2027-03-14', '08:00'); } },
  { name: 'create-duration-1hr', zone: NY, act: async (d) => { await d.title('Clean the kitchen'); await d.when(NY, '2027-02-11', '10:00'); await d.duration('1 hr'); } },
  { name: 'create-duration-time-first-across-dst', zone: 'Pacific/Auckland', act: async (d) => { await d.title('Clean the kitchen'); await d.when('Pacific/Auckland', '2027-04-10', '09:00', { timeFirst: true }); await d.duration('1 hr'); } },
  { name: 'create-custom-end-time', zone: NY, act: async (d) => { await d.title('Clean the kitchen'); await d.when(NY, '2027-02-11', '10:00'); await d.endTime(NY, '2027-02-11', '10:00', '11:45'); } },
  { name: 'create-repeat-daily', zone: NY, act: async (d) => { await d.title('Walk'); await d.when(NY, '2027-02-11', null); await d.repeat('daily'); } },
  { name: 'create-repeat-weekly', zone: NY, act: async (d) => { await d.title('Walk'); await d.when(NY, '2027-02-11', '08:00'); await d.repeat('weekly'); } },
  { name: 'create-repeat-some-days', zone: NY, act: async (d) => { await d.title('Walk'); await d.when(NY, '2027-02-11', null); await d.repeat('days_of_week', { days: ['Monday', 'Saturday'] }); } },
  { name: 'create-repeat-every-other-day', zone: NY, act: async (d) => { await d.title('Walk'); await d.when(NY, '2027-02-11', null); await d.repeat('every_other_day'); } },
  { name: 'create-repeat-monthly', zone: NY, act: async (d) => { await d.title('Pay the rent'); await d.when(NY, '2027-03-15', '09:00'); await d.repeat('monthly'); } },
  { name: 'create-repeat-yearly', zone: NY, act: async (d) => { await d.title('Renew the license'); await d.when(NY, '2027-03-15', null); await d.repeat('yearly'); } },
  { name: 'create-repeat-cycle', zone: NY, act: async (d) => { await d.title('Rotate'); await d.when(NY, '2027-02-11', null); await d.repeat('cycle', { cycle: ['5', '2'] }); } },
  { name: 'create-repeat-end', zone: NY, act: async (d) => { await d.title('Walk'); await d.when(NY, '2027-02-11', '08:00'); await d.repeat('daily'); await d.repeatEnd(NY, '2027-02-11', '08:00', '2027-03-31'); } },
  { name: 'create-repeat-end-kiritimati', zone: 'Pacific/Kiritimati', act: async (d) => { await d.title('Walk'); await d.when('Pacific/Kiritimati', '2027-02-12', '06:00'); await d.repeat('weekly'); await d.repeatEnd('Pacific/Kiritimati', '2027-02-12', '06:00', '2027-03-26'); } },
  { name: 'create-who-anyone', zone: NY, act: async (d) => { await d.title('Groceries'); await d.who('anyone'); } },
  { name: 'create-who-me', zone: NY, act: async (d) => { await d.title('Groceries'); await d.who('me'); } },
  { name: 'create-who-other', zone: NY, act: async (d) => { await d.title('Groceries'); await d.who('ana'); } },
  { name: 'create-who-care-recipient', zone: NY, act: async (d) => { await d.title('Groceries'); await d.who('rosa'); } },
  { name: 'create-details', zone: NY, act: async (d) => { await d.title('Groceries'); await d.details('Milk, eggs, bread'); } },
  { name: 'create-reminders', zone: NY, act: async (d) => { await d.title('Groceries'); await d.when(NY, '2027-02-11', '16:00'); await d.reminders(); } },
  { name: 'create-everything', zone: 'Pacific/Auckland', act: async (d) => {
    await d.title('Physio exercises');
    await d.when('Pacific/Auckland', '2027-02-15', '18:30');
    await d.repeat('days_of_week', { days: ['Wednesday'] });
    await d.who('rosa');
    await d.details('20 minutes');
    await d.duration('2 hrs');
    await d.repeatEnd('Pacific/Auckland', '2027-02-15', '18:30', '2027-05-01');
    await d.reminders();
  } },
];

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
};
function task(over: Partial<CalendarEvent>): CalendarEvent {
  return { ...base, id: 'task-1', title: 'Pick up prescription', scheduled_date: '2027-02-15', scheduled_time: null, ...over } as CalendarEvent;
}
const T = {
  dateOnly: task({}),
  timed: task({ id: 'task-2', scheduled_date: '2027-02-12', scheduled_time: '10:00:00', duration_minutes: 45, assigned_to: ANA_ID, description: 'Ask about refills' }),
  dailyEnd: task({ id: 'task-3', recurrence_rule: 'daily', scheduled_time: '08:00:00', duration_minutes: 30, recurrence_end_date: '2027-03-31' }),
  someDays: task({ id: 'task-4', recurrence_rule: 'weekly', recurrence_days: [1, 3, 5] } as Partial<CalendarEvent>),
  everyOther: task({ id: 'task-5', recurrence_rule: 'every_other_day' }),
  monthly: task({ id: 'task-6', recurrence_rule: 'monthly', scheduled_time: '09:00:00', duration_minutes: 60 }),
  yearly: task({ id: 'task-7', recurrence_rule: 'yearly' }),
  cycle: task({ id: 'task-8', recurrence_rule: 'cycle:21:7' }),
  weekly: task({ id: 'task-9', recurrence_rule: 'weekly' }),
  rosaReminders: task({ id: 'task-10', assigned_to: ROSA_ID, scheduled_time: '17:00:00', duration_minutes: 30, reminder_at_due: false, reminder_1h: true }),
  noDuration: task({ id: 'task-11', scheduled_time: '11:00:00', duration_minutes: null }),
  kiritimati: task({ id: 'task-12', scheduled_date: '2027-02-12', scheduled_time: '23:30:00', duration_minutes: 30 }),
  mine: task({ id: 'task-13', assigned_to: ME_ID }),
  kiriDaily: task({ id: 'task-15', scheduled_date: '2027-02-12', scheduled_time: '06:00:00', duration_minutes: 30, recurrence_rule: 'daily', recurrence_end_date: '2027-03-31' }),
  past: task({ id: 'task-14', scheduled_date: '2027-01-20', recurrence_rule: 'weekly', recurrence_days: [3] } as Partial<CalendarEvent>),
};

interface EditCase {
  name: string;
  zone: string;
  event: CalendarEvent;
  act?: (d: Driver) => Promise<void>;
}
const UNTOUCHED: EditCase[] = (Object.entries(T) as [string, CalendarEvent][]).map(([key, event]) => ({
  name: `edit-untouched-${key}`,
  zone: key.startsWith('kiri') ? 'Pacific/Kiritimati' : NY,
  event,
}));
const EDIT_CASES: EditCase[] = [
  ...UNTOUCHED,
  { name: 'edit-title', zone: NY, event: T.timed, act: (d) => d.title('Pick up the new prescription') },
  { name: 'edit-day-tomorrow', zone: NY, event: T.dateOnly, act: (d) => d.when(NY, '2027-02-11', null) },
  { name: 'edit-day-today', zone: NY, event: T.dateOnly, act: (d) => d.when(NY, '2027-02-10', null) },
  { name: 'edit-day-other-keeps-time', zone: NY, event: T.timed, act: (d) => d.when(NY, '2027-02-20', '10:00') },
  { name: 'edit-time', zone: NY, event: T.timed, act: (d) => d.when(NY, '2027-02-12', '15:30') },
  { name: 'edit-clear-time', zone: NY, event: T.timed, act: (d) => d.clearTime() },
  { name: 'edit-add-time', zone: NY, event: T.dateOnly, act: (d) => d.when(NY, '2027-02-15', '09:15') },
  { name: 'edit-add-time-no-duration-row', zone: NY, event: T.noDuration, act: (d) => d.when(NY, '2027-02-15', '12:00') },
  { name: 'edit-repeat-weekly', zone: NY, event: T.dateOnly, act: (d) => d.repeat('weekly') },
  { name: 'edit-repeat-once', zone: NY, event: T.dailyEnd, act: (d) => d.repeat('none') },
  { name: 'edit-repeat-some-days', zone: NY, event: T.weekly, act: (d) => d.repeat('days_of_week', { days: ['Wednesday'] }) },
  { name: 'edit-some-days-to-daily', zone: NY, event: T.someDays, act: (d) => d.repeat('daily') },
  { name: 'edit-some-days-change-days', zone: NY, event: T.someDays, act: (d) => d.repeat('days_of_week', { days: ['Friday', 'Sunday'] }) },
  { name: 'edit-monthly-to-yearly', zone: NY, event: T.monthly, act: (d) => d.repeat('yearly') },
  { name: 'edit-every-other-day-to-weekly', zone: NY, event: T.everyOther, act: (d) => d.repeat('weekly') },
  { name: 'edit-repeat-end', zone: NY, event: T.dailyEnd, act: (d) => d.repeatEnd(NY, '2027-02-15', '08:00', '2027-04-30') },
  { name: 'edit-who-anyone', zone: NY, event: T.timed, act: (d) => d.who('anyone') },
  { name: 'edit-who-me', zone: NY, event: T.timed, act: (d) => d.who('me') },
  { name: 'edit-who-care-recipient', zone: NY, event: T.dateOnly, act: (d) => d.who('rosa') },
  { name: 'edit-who-other-from-me', zone: NY, event: T.mine, act: (d) => d.who('ana') },
  { name: 'edit-details', zone: NY, event: T.dateOnly, act: (d) => d.details('Bring the card') },
  { name: 'edit-details-cleared', zone: NY, event: T.timed, act: (d) => d.details(' ') },
  { name: 'edit-duration', zone: NY, event: T.timed, act: (d) => d.duration('2 hrs') },
  { name: 'edit-reminders', zone: NY, event: T.dailyEnd, act: (d) => d.reminders() },
  { name: 'edit-kiritimati-other-day', zone: 'Pacific/Kiritimati', event: T.kiritimati, act: (d) => d.when('Pacific/Kiritimati', '2027-02-14', '23:30') },
  { name: 'edit-kiritimati-repeat-end', zone: 'Pacific/Kiritimati', event: T.kiriDaily, act: (d) => d.repeatEnd('Pacific/Kiritimati', '2027-02-12', '06:00', '2027-04-15') },
  { name: 'edit-kiritimati-today', zone: 'Pacific/Kiritimati', event: T.kiritimati, act: (d) => d.when('Pacific/Kiritimati', '2027-02-11', '23:30') },
];

// ── Runner ────────────────────────────────────────────────────────────────────────────────────────

type Layout = 'old' | 'new';
async function runCreate(c: CreateCase, layout: Layout): Promise<unknown> {
  useCircleResult.timezone = c.zone;
  const user = userEvent.setup();
  const view = render(<AddEventModal circleId={CIRCLE_ID} initialType="task" onClose={vi.fn()} />);
  await c.act(layout === 'old' ? oldDriver(user) : newDriver(user));
  mutateCreate.mockClear();
  await user.click(screen.getByTestId('add-event-save'));
  await waitFor(() => expect(mutateCreate).toHaveBeenCalledTimes(1));
  view.unmount();
  return JSON.parse(JSON.stringify(mutateCreate.mock.calls[0][0]));
}
async function runEdit(c: EditCase, layout: Layout): Promise<unknown> {
  useCircleResult.timezone = c.zone;
  const user = userEvent.setup();
  const view = render(<AddEventModal circleId={CIRCLE_ID} event={c.event} onClose={vi.fn()} />);
  if (c.act) await c.act(layout === 'old' ? oldDriver(user) : newDriver(user));
  mutateUpdate.mockClear();
  await user.click(screen.getByTestId('add-event-save'));
  await waitFor(() => expect(mutateUpdate).toHaveBeenCalledTimes(1));
  view.unmount();
  return JSON.parse(JSON.stringify(mutateUpdate.mock.calls[0][0]));
}

if (CAPTURE) {
  it("captures the OLD task form's bodies (run with HEAD's AddEventModal in place)", async () => {
    const out: Record<string, unknown> = {};
    for (const c of CREATE_CASES) out[c.name] = await runCreate(c, 'old');
    for (const c of EDIT_CASES) out[c.name] = await runEdit(c, 'old');
    fs.writeFileSync(FIXTURE, JSON.stringify(out, null, 2) + '\n');
  }, 120_000);
} else {
  const OLD: Record<string, unknown> = fs.existsSync(FIXTURE)
    ? JSON.parse(fs.readFileSync(FIXTURE, 'utf8'))
    : {};

  describe('task form payload equality: the simple layout posts what the old full form posted', () => {
    it('the fixture covers every case', () => {
      for (const c of [...CREATE_CASES, ...EDIT_CASES]) expect(OLD[c.name], c.name).toBeDefined();
    });

    it('the new layout is really the one under test (a new task opens "What needs doing?")', () => {
      render(<AddEventModal circleId={CIRCLE_ID} initialType="task" onClose={vi.fn()} />);
      expect(screen.getByRole('heading', { name: 'What needs doing?' })).toBeInTheDocument();
      expect(screen.queryByLabelText(/^Assigned to/)).toBeNull();
    });

    it.each(CREATE_CASES.map((c) => [c.name, c] as const))('%s', async (_name, c) => {
      expect(await runCreate(c, 'new')).toEqual(OLD[c.name]);
    });

    it.each(EDIT_CASES.map((c) => [c.name, c] as const))('%s', async (_name, c) => {
      expect(await runEdit(c, 'new')).toEqual(OLD[c.name]);
    });

    it('byte-identical, not just deep-equal: the serialized bodies match key order too', async () => {
      const c = CREATE_CASES.find((x) => x.name === 'create-everything') as CreateCase;
      expect(JSON.stringify(await runCreate(c, 'new'))).toBe(JSON.stringify(OLD[c.name]));
      const e = EDIT_CASES.find((x) => x.name === 'edit-kiritimati-other-day') as EditCase;
      expect(JSON.stringify(await runEdit(e, 'new'))).toBe(JSON.stringify(OLD[e.name]));
    });

    it('the cases tell the frames apart: several old drives typed a viewer clock that differs from the recipient one', () => {
      const timed = (OLD['create-timed-auckland-other-day'] as { scheduled_date: string; scheduled_time: string });
      expect(timed.scheduled_date).toBe('2027-02-14');
      expect(timed.scheduled_time).toBe('07:15');
      expect(viewerWall(instantIn('2027-02-14', '07:15', 'Pacific/Auckland')).day).toBe('2027-02-13');
    });
  });
}
