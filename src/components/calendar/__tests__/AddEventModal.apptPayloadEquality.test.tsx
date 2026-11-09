import fs from 'fs';
import path from 'path';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import '@/i18n';
import type { CalendarEvent } from '@/api/calendarEvents';
import type { Provider } from '@/api/providers';
import { Analytics } from '@/lib/analytics';
import { resetLargeTextReports } from '@/lib/largeText';
import { AddEventModal } from '../AddEventModal';

// THE APPOINTMENT FORM ON THE TASK / SHIFT PATTERN (owner 2026-11-08, "cohesiveness"): When? = the date field +
// a "Time" tile (revealing the SAME viewer-frame time field) + "Any time"; How often? = the task grid; Who's
// going? = the task's tiles (Anyone / Me / members); Doctor, Location, Length, Details, End date and Reminders sit
// in one "More details". Same state, same `buildPayload`, same frames: for the same choices every request body
// must be BYTE-IDENTICAL to the old form's (Doctor / Place / Notes / Repeat rows, the end time under the start).
//
// The old side is a fixture CAPTURED FROM THE OLD FORM (CAPTURE_OLD_APPT_FORM=1 with the pre-change
// AddEventModal in place): `__fixtures__/apptFormOldLayoutPayloads.json`.

const VIEWER_TZ = 'America/Denver';
const ORIGINAL_TZ = process.env.TZ;
beforeAll(() => {
  process.env.TZ = VIEWER_TZ;
});
afterAll(() => {
  process.env.TZ = ORIGINAL_TZ;
});

const FIXTURE = path.join(__dirname, '__fixtures__', 'apptFormOldLayoutPayloads.json');
const CAPTURE = process.env.CAPTURE_OLD_APPT_FORM === '1';
const NOW = new Date('2027-02-10T18:40:00Z');
const CIRCLE_ID = 'circle-1';
const ME_ID = 'aaaaaaaa-1111-4111-8111-111111111111';
const ANA_ID = 'bbbbbbbb-2222-4222-8222-222222222222';
const ROSA_ID = 'cccccccc-3333-4333-8333-333333333333';
const PATEL_ID = '11111111-1111-4111-8111-111111111111';
const KIM_ID = '22222222-2222-4222-8222-222222222222';

function doctor(over: Partial<Provider> & { id: string; name: string }): Provider {
  return {
    specialty: null,
    phone: null,
    country_code: null,
    phone_extension: null,
    address: null,
    is_primary: false,
    sort_order: 1,
    archived_at: null,
    created_at: '',
    updated_at: '',
    ...over,
  };
}
const PROVIDERS = [
  doctor({ id: PATEL_ID, name: 'Dr. Patel', is_primary: true, sort_order: 0, address: '1200 Heart Center Dr\nSuite 300' }),
  doctor({ id: KIM_ID, name: 'Dr. Kim' }),
];

const mutateCreate = vi.fn();
const mutateUpdate = vi.fn();
vi.mock('../DoseQuietHoursNote', () => ({ DoseQuietHoursNote: () => null }));
vi.mock('@/hooks/useProviders', () => ({ useProviders: () => ({ providers: PROVIDERS, isSuccess: true }) }));
vi.mock('@/hooks/useEmergencyInfo', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/hooks/useEmergencyInfo')>()),
  useEmergencyInfo: () => ({ data: null }),
}));
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
  mutateUpdate.mockResolvedValue({ id: 'appt-1' });
  for (const name of [
    'entryFormOpened',
    'entryFormStepCompleted',
    'timeChipSelected',
    'entrySaveTapped',
    'largeTextLayout',
    'providerLinked',
    'providerUnlinked',
  ] as const) {
    vi.spyOn(Analytics, name).mockImplementation(() => {});
  }
});
afterEach(() => {
  vi.restoreAllMocks();
  vi.useRealTimers();
});

type User = ReturnType<typeof userEvent.setup>;
type Repeat = 'none' | 'daily' | 'weekly' | 'every_other_day' | 'monthly' | 'yearly' | 'cycle' | 'days_of_week';
type Who = 'anyone' | 'me' | 'ana' | 'rosa';
interface RepeatExtra {
  days?: string[];
  cycle?: [string, string];
}

interface Driver {
  time(time: string): Promise<void>;
  clearTime(): Promise<void>;
  endTime(time: string): Promise<void>;
  duration(label: string): Promise<void>;
  repeat(choice: Repeat, extra?: RepeatExtra): Promise<void>;
  repeatEnd(day: string): Promise<void>;
  who(who: Who): Promise<void>;
  doctor(id: string): Promise<void>;
  location(text: string): Promise<void>;
  notes(text: string): Promise<void>;
  reminders(): Promise<void>;
  titleChip(): Promise<void>;
}

async function openDisclosure(user: User, id: string) {
  const toggle = document.getElementById(id);
  if (toggle && toggle.getAttribute('aria-expanded') !== 'true') await user.click(toggle);
}
async function daysAndCycle(user: User, extra?: RepeatExtra) {
  for (const day of extra?.days ?? []) await user.click(screen.getByRole('checkbox', { name: day }));
  if (extra?.cycle) {
    fireEvent.change(screen.getByLabelText(/^Days on/), { target: { value: extra.cycle[0] } });
    fireEvent.change(screen.getByLabelText(/^Days off/), { target: { value: extra.cycle[1] } });
  }
}
async function title(user: User, text: string) {
  const box = screen.getByRole('textbox', { name: /^Title/ });
  await user.clear(box);
  await user.type(box, text);
}
function date(day: string) {
  fireEvent.change(screen.getByLabelText(/^Date/), { target: { value: day } });
}
const timeInput = () => screen.getByLabelText(/^Time/, { selector: 'input' });
async function reminderClicks(user: User) {
  await user.click(screen.getByRole('checkbox', { name: 'At the scheduled time' }));
  await user.click(screen.getByRole('checkbox', { name: '1 hour before' }));
}
async function typeInto(user: User, el: HTMLElement, text: string) {
  await user.clear(el);
  if (text.trim()) await user.type(el, text);
  else fireEvent.change(el, { target: { value: text } });
}

function oldDriver(user: User): Driver {
  return {
    async time(time) {
      fireEvent.change(timeInput(), { target: { value: time } });
    },
    async clearTime() {
      fireEvent.change(timeInput(), { target: { value: '' } });
    },
    async endTime(time) {
      fireEvent.change(screen.getByLabelText(/^End time/), { target: { value: time } });
    },
    async duration(label) {
      await user.click(screen.getByRole('radio', { name: label }));
    },
    async repeat(choice, extra) {
      await openDisclosure(user, 'row-repeat');
      await user.selectOptions(screen.getByRole('combobox', { name: /^Repeat/ }), choice);
      await daysAndCycle(user, extra);
    },
    async repeatEnd(day) {
      await openDisclosure(user, 'row-repeat');
      fireEvent.change(screen.getByLabelText(/^End date/), { target: { value: day } });
    },
    async who(who) {
      const name = { anyone: 'Anyone', me: 'Luis', ana: 'Ana', rosa: /^Rosa/ }[who];
      const group = screen.getByRole('radiogroup', { name: "Who's going?" });
      await user.click(within(group).getByRole('radio', { name }));
    },
    async doctor(id) {
      await openDisclosure(user, 'row-doctor');
      await user.selectOptions(screen.getByRole('combobox', { name: 'Doctor' }), id);
    },
    async location(text) {
      await openDisclosure(user, 'row-place');
      await typeInto(user, screen.getByLabelText(/^Location/), text);
    },
    async notes(text) {
      await openDisclosure(user, 'row-notes');
      await typeInto(user, screen.getByLabelText(/^Details/), text);
    },
    async reminders() {
      await openDisclosure(user, 'row-notes');
      await reminderClicks(user);
    },
    async titleChip() {
      const group = screen.getByRole('radiogroup', { name: 'Title suggestions' });
      await user.click(within(group).getByRole('radio', { name: 'Lab work' }));
    },
  };
}

function newDriver(user: User): Driver {
  const more = () => openDisclosure(user, 'more-details');
  return {
    async time(time) {
      if (!document.getElementById('scheduled_time')) await user.click(screen.getByTestId('appt-time-tile'));
      fireEvent.change(timeInput(), { target: { value: time } });
    },
    async clearTime() {
      await user.click(screen.getByRole('radio', { name: 'Any time' }));
    },
    async endTime(time) {
      await more();
      fireEvent.change(screen.getByLabelText(/^End time/), { target: { value: time } });
    },
    async duration(label) {
      await more();
      await user.click(screen.getByRole('radio', { name: label }));
    },
    async repeat(choice, extra) {
      const tile: Partial<Record<Repeat, string>> = { none: 'Once', daily: 'Every day', weekly: 'Every week' };
      const custom: Partial<Record<Repeat, string>> = {
        every_other_day: 'Every other day',
        cycle: 'Days on / off',
        days_of_week: 'Some days',
        monthly: 'Monthly',
        yearly: 'Yearly',
      };
      if (tile[choice]) {
        await user.click(screen.getByRole('radio', { name: tile[choice] }));
      } else {
        const opener = screen.getByTestId('repeat-custom');
        if (opener.getAttribute('aria-expanded') !== 'true') await user.click(opener);
        await user.click(screen.getByRole('radio', { name: custom[choice] }));
      }
      await daysAndCycle(user, extra);
    },
    async repeatEnd(day) {
      await more();
      fireEvent.change(screen.getByLabelText(/^End date/), { target: { value: day } });
    },
    async who(who) {
      const name = { anyone: 'Anyone', me: 'Me', ana: 'Ana', rosa: /^Rosa/ }[who];
      const group = screen.getByRole('radiogroup', { name: "Who's going?" });
      await user.click(within(group).getByRole('radio', { name }));
    },
    async doctor(id) {
      await more();
      await user.selectOptions(screen.getByRole('combobox', { name: 'Doctor' }), id);
    },
    async location(text) {
      await more();
      await typeInto(user, screen.getByLabelText(/^Location/), text);
    },
    async notes(text) {
      await more();
      await typeInto(user, screen.getByLabelText(/^Details/), text);
    },
    async reminders() {
      await more();
      await reminderClicks(user);
    },
    async titleChip() {
      const group = screen.getByRole('radiogroup', { name: 'Title suggestions' });
      await user.click(within(group).getByRole('radio', { name: 'Lab work' }));
    },
  };
}

type Act = (d: Driver, user: User) => Promise<void>;
interface CreateCase {
  name: string;
  act: Act;
}
const named: Act = async (_d, u) => title(u, 'Cardiology check-up');
const CREATE_CASES: CreateCase[] = [
  { name: 'create-title-only', act: named },
  { name: 'create-title-chip', act: (d) => d.titleChip() },
  { name: 'create-date-only', act: async (d, u) => { await named(d, u); date('2027-02-15'); } },
  { name: 'create-timed', act: async (d, u) => { await named(d, u); date('2027-02-15'); await d.time('10:00'); } },
  { name: 'create-time-then-date', act: async (d, u) => { await named(d, u); await d.time('16:30'); date('2027-03-14'); } },
  { name: 'create-any-time-after-time', act: async (d, u) => { await named(d, u); date('2027-02-15'); await d.time('10:00'); await d.clearTime(); } },
  { name: 'create-duration-1hr', act: async (d, u) => { await named(d, u); await d.time('09:00'); await d.duration('1 hr'); } },
  { name: 'create-duration-2hrs', act: async (d, u) => { await named(d, u); await d.time('09:00'); await d.duration('2 hrs'); } },
  { name: 'create-custom-end', act: async (d, u) => { await named(d, u); await d.time('09:00'); await d.endTime('10:45'); } },
  { name: 'create-moved-start-keeps-length', act: async (d, u) => { await named(d, u); await d.time('09:00'); await d.duration('1 hr'); await d.time('13:00'); } },
  { name: 'create-repeat-daily', act: async (d, u) => { await named(d, u); await d.time('09:00'); await d.repeat('daily'); } },
  { name: 'create-repeat-weekly', act: async (d, u) => { await named(d, u); await d.time('09:00'); await d.repeat('weekly'); } },
  { name: 'create-repeat-every-other-day', act: async (d, u) => { await named(d, u); await d.repeat('every_other_day'); } },
  { name: 'create-repeat-monthly', act: async (d, u) => { await named(d, u); date('2027-03-15'); await d.time('11:00'); await d.repeat('monthly'); } },
  { name: 'create-repeat-yearly', act: async (d, u) => { await named(d, u); date('2027-03-15'); await d.repeat('yearly'); } },
  { name: 'create-repeat-cycle', act: async (d, u) => { await named(d, u); await d.repeat('cycle', { cycle: ['5', '2'] }); } },
  { name: 'create-repeat-some-days', act: async (d, u) => { await named(d, u); await d.time('09:00'); await d.repeat('days_of_week', { days: ['Monday', 'Friday'] }); } },
  { name: 'create-repeat-then-once', act: async (d, u) => { await named(d, u); await d.repeat('weekly'); await d.repeat('none'); } },
  { name: 'create-repeat-end', act: async (d, u) => { await named(d, u); await d.time('09:00'); await d.repeat('weekly'); await d.repeatEnd('2027-05-01'); } },
  { name: 'create-who-anyone', act: async (d, u) => { await named(d, u); await d.who('ana'); await d.who('anyone'); } },
  { name: 'create-who-me', act: async (d, u) => { await named(d, u); await d.who('me'); } },
  { name: 'create-who-other', act: async (d, u) => { await named(d, u); await d.who('ana'); } },
  { name: 'create-who-care-recipient', act: async (d, u) => { await named(d, u); await d.who('rosa'); } },
  { name: 'create-doctor-fills-location', act: async (d, u) => { await named(d, u); await d.doctor(PATEL_ID); } },
  { name: 'create-doctor-no-address', act: async (d, u) => { await named(d, u); await d.doctor(KIM_ID); } },
  { name: 'create-location', act: async (d, u) => { await named(d, u); await d.location('Home visit'); } },
  { name: 'create-location-then-doctor', act: async (d, u) => { await named(d, u); await d.location('Clinic B'); await d.doctor(PATEL_ID); } },
  { name: 'create-notes', act: async (d, u) => { await named(d, u); await d.notes('Bring the insurance card'); } },
  { name: 'create-reminders', act: async (d, u) => { await named(d, u); await d.time('15:00'); await d.reminders(); } },
  { name: 'create-everything', act: async (d, u) => {
    await named(d, u);
    date('2027-02-17');
    await d.time('10:00');
    await d.duration('1 hr');
    await d.repeat('days_of_week', { days: ['Friday'] });
    await d.repeatEnd('2027-06-30');
    await d.who('me');
    await d.doctor(PATEL_ID);
    await d.notes('Fasting');
    await d.reminders();
  } },
];

const base = {
  circle_id: CIRCLE_ID,
  event_type: 'appointment' as const,
  created_at: '2027-01-01T00:00:00Z',
  updated_at: '2027-01-01T00:00:00Z',
  notifications_enabled: true,
  reminder_at_due: true,
  reminder_24h: false,
  reminder_1h: true,
  reminder_30m: false,
  reminder_15m: false,
  description: null,
  location: null,
  assigned_to: null,
  duration_minutes: null,
  recurrence_rule: null,
  recurrence_end_date: null,
};
function appt(over: Partial<CalendarEvent>): CalendarEvent {
  return {
    ...base,
    id: 'appt-1',
    title: 'Cardiology',
    scheduled_date: '2027-02-15',
    scheduled_time: '10:00:00',
    duration_minutes: 30,
    ...over,
  } as CalendarEvent;
}
const A = {
  timed: appt({}),
  allDay: appt({ id: 'appt-2', scheduled_time: null, duration_minutes: null }),
  noDuration: appt({ id: 'appt-3', duration_minutes: null }),
  long: appt({ id: 'appt-4', duration_minutes: 90, assigned_to: ANA_ID, location: 'Clinic', description: 'Fasting' }),
  doctor: appt({ id: 'appt-5', provider_id: PATEL_ID, location: '1200 Heart Center Dr, Suite 300' } as Partial<CalendarEvent>),
  weekly: appt({ id: 'appt-6', recurrence_rule: 'weekly', recurrence_end_date: '2027-06-01' }),
  someDays: appt({ id: 'appt-7', recurrence_rule: 'weekly', recurrence_days: [1, 4] } as Partial<CalendarEvent>),
  monthly: appt({ id: 'appt-8', recurrence_rule: 'monthly' }),
  cycle: appt({ id: 'appt-9', recurrence_rule: 'cycle:3:4' }),
  mine: appt({ id: 'appt-10', assigned_to: ME_ID }),
  rosa: appt({ id: 'appt-11', assigned_to: ROSA_ID, reminder_1h: false }),
};
interface EditCase {
  name: string;
  event: CalendarEvent;
  act?: Act;
}
const UNTOUCHED: EditCase[] = (Object.entries(A) as [string, CalendarEvent][]).map(([key, event]) => ({
  name: `edit-untouched-${key}`,
  event,
}));
const EDIT_CASES: EditCase[] = [
  ...UNTOUCHED,
  { name: 'edit-title', event: A.timed, act: async (_d, u) => { await title(u, 'Cardiology follow-up'); } },
  { name: 'edit-date', event: A.timed, act: async () => { date('2027-02-20'); } },
  { name: 'edit-time', event: A.timed, act: (d) => d.time('14:15') },
  { name: 'edit-clear-time', event: A.long, act: (d) => d.clearTime() },
  { name: 'edit-add-time', event: A.allDay, act: (d) => d.time('09:30') },
  { name: 'edit-time-no-duration', event: A.noDuration, act: (d) => d.time('11:00') },
  { name: 'edit-duration', event: A.timed, act: (d) => d.duration('2 hrs') },
  { name: 'edit-end-time', event: A.long, act: (d) => d.endTime('12:00') },
  { name: 'edit-repeat-weekly', event: A.timed, act: (d) => d.repeat('weekly') },
  { name: 'edit-repeat-once', event: A.weekly, act: (d) => d.repeat('none') },
  { name: 'edit-some-days-change', event: A.someDays, act: (d) => d.repeat('days_of_week', { days: ['Friday'] }) },
  { name: 'edit-some-days-to-daily', event: A.someDays, act: (d) => d.repeat('daily') },
  { name: 'edit-monthly-to-yearly', event: A.monthly, act: (d) => d.repeat('yearly') },
  { name: 'edit-cycle-change', event: A.cycle, act: (d) => d.repeat('cycle', { cycle: ['2', '5'] }) },
  { name: 'edit-repeat-end', event: A.weekly, act: (d) => d.repeatEnd('2027-07-01') },
  { name: 'edit-who-me', event: A.long, act: (d) => d.who('me') },
  { name: 'edit-who-anyone', event: A.mine, act: (d) => d.who('anyone') },
  { name: 'edit-who-rosa', event: A.timed, act: (d) => d.who('rosa') },
  { name: 'edit-doctor-change', event: A.doctor, act: (d) => d.doctor(KIM_ID) },
  { name: 'edit-doctor-none', event: A.doctor, act: (d) => d.doctor('') },
  { name: 'edit-doctor-add', event: A.timed, act: (d) => d.doctor(PATEL_ID) },
  { name: 'edit-location', event: A.long, act: (d) => d.location('Clinic, room 4') },
  { name: 'edit-notes-cleared', event: A.long, act: (d) => d.notes(' ') },
  { name: 'edit-reminders', event: A.rosa, act: (d) => d.reminders() },
];

type Layout = 'old' | 'new';
async function runCreate(c: CreateCase, layout: Layout): Promise<unknown> {
  const user = userEvent.setup();
  const view = render(<AddEventModal circleId={CIRCLE_ID} initialType="appointment" onClose={vi.fn()} />);
  await c.act(layout === 'old' ? oldDriver(user) : newDriver(user), user);
  mutateCreate.mockClear();
  await user.click(screen.getByTestId('add-event-save'));
  await waitFor(() => expect(mutateCreate).toHaveBeenCalledTimes(1));
  view.unmount();
  return JSON.parse(JSON.stringify(mutateCreate.mock.calls[0][0]));
}
async function runEdit(c: EditCase, layout: Layout): Promise<unknown> {
  const user = userEvent.setup();
  const view = render(<AddEventModal circleId={CIRCLE_ID} event={c.event} onClose={vi.fn()} />);
  if (c.act) await c.act(layout === 'old' ? oldDriver(user) : newDriver(user), user);
  mutateUpdate.mockClear();
  await user.click(screen.getByTestId('add-event-save'));
  await waitFor(() => expect(mutateUpdate).toHaveBeenCalledTimes(1));
  view.unmount();
  return JSON.parse(JSON.stringify(mutateUpdate.mock.calls[0][0]));
}

if (CAPTURE) {
  it("captures the OLD appointment form's bodies (run with the pre-change AddEventModal in place)", async () => {
    const out: Record<string, unknown> = {};
    for (const c of CREATE_CASES) out[c.name] = await runCreate(c, 'old');
    for (const c of EDIT_CASES) out[c.name] = await runEdit(c, 'old');
    fs.writeFileSync(FIXTURE, JSON.stringify(out, null, 2) + '\n');
  }, 180_000);
} else {
  const OLD: Record<string, unknown> = fs.existsSync(FIXTURE)
    ? JSON.parse(fs.readFileSync(FIXTURE, 'utf8'))
    : {};

  describe('appointment form payload equality: the task-pattern layout posts what the old one posted', () => {
    it('the fixture covers every case', () => {
      for (const c of [...CREATE_CASES, ...EDIT_CASES]) expect(OLD[c.name], c.name).toBeDefined();
    });

    it('the new layout is really the one under test (a Time tile, no Repeat row)', () => {
      render(<AddEventModal circleId={CIRCLE_ID} initialType="appointment" onClose={vi.fn()} />);
      expect(screen.getByTestId('appt-time-tile')).toBeInTheDocument();
      expect(document.getElementById('row-repeat')).toBeNull();
    });

    it.each(CREATE_CASES.map((c) => [c.name, c] as const))('%s', async (_name, c) => {
      expect(await runCreate(c, 'new')).toEqual(OLD[c.name]);
    });

    it.each(EDIT_CASES.map((c) => [c.name, c] as const))('%s', async (_name, c) => {
      expect(await runEdit(c, 'new')).toEqual(OLD[c.name]);
    });

    it('byte-identical, not just deep-equal: key order too', async () => {
      const c = CREATE_CASES.find((x) => x.name === 'create-everything') as CreateCase;
      expect(JSON.stringify(await runCreate(c, 'new'))).toBe(JSON.stringify(OLD[c.name]));
      const e = EDIT_CASES.find((x) => x.name === 'edit-doctor-change') as EditCase;
      expect(JSON.stringify(await runEdit(e, 'new'))).toBe(JSON.stringify(OLD[e.name]));
    });

    it('the fixture is not vacuous: Me is the signed-in member, the doctor filled the location', () => {
      expect((OLD['create-who-me'] as { assigned_to: string }).assigned_to).toBe(ME_ID);
      expect((OLD['create-doctor-fills-location'] as { location: string }).location).toBe(
        '1200 Heart Center Dr, Suite 300'
      );
      expect((OLD['create-duration-1hr'] as { duration_minutes: number }).duration_minutes).toBe(60);
    });
  });
}

// ── CLEARABLE ON EDIT (sweep 2026-11-08): deliberate changes to the fixture above ─────────────────
// The fixture used to record the BUGGY old bodies for "Once" on a series, "Any time" on a timed
// appointment and emptied notes (the key was OMITTED, so the server kept the old value). They now send
// `null`. Otherwise only two mechanical changes, audited key by key when the fixture was rewritten: on
// an edit an UNCHANGED description / location is left out (utils/editPatch), and the recurrence keys
// follow mobile's `recurrenceForSave(…, { clearing: isEditing })`.
if (!CAPTURE) {
  describe('appointment edit: an emptied field is cleared with null (explicit, not just fixture equality)', () => {
    const run = async (c: EditCase) => ((await runEdit(c, 'new')) as { data: Record<string, unknown> }).data;
    const named = (name: string) => EDIT_CASES.find((x) => x.name === name) as EditCase;

    it('"Once" on a weekly appointment ends the series', async () => {
      const data = await run(named('edit-repeat-once'));
      expect(data).toHaveProperty('recurrence_rule', null);
      expect(data).toHaveProperty('recurrence_end_date', null);
    });

    it('"Any time" on a timed appointment clears the time and the end', async () => {
      const data = await run(named('edit-clear-time'));
      expect(data).toHaveProperty('scheduled_time', null);
      expect(data).toHaveProperty('duration_minutes', null);
    });

    it('emptied notes are null; untouched notes and place are left out', async () => {
      expect(await run(named('edit-notes-cleared'))).toHaveProperty('description', null);
      const untouched = await run(named('edit-untouched-long'));
      expect(untouched).not.toHaveProperty('description');
      expect(untouched).not.toHaveProperty('location');
    });

    it('an emptied place is null', async () => {
      const data = await run({
        name: 'edit-location-cleared',
        event: named('edit-untouched-long').event,
        act: (d) => d.location(' '),
      } as EditCase);
      expect(data).toHaveProperty('location', null);
      expect(data).not.toHaveProperty('description');
    });

    it('a stored rule the Repeat control cannot show (an imported custom:14) is NOT ended by an untouched save', async () => {
      const data = await run({
        name: 'edit-untouched-custom14',
        event: appt({ id: 'appt-c14', recurrence_rule: 'custom:14' }),
      } as EditCase);
      expect(data.recurrence_rule).toBeUndefined();
      expect(data.recurrence_end_date).toBeUndefined();
    });

    it('a CREATE never sends null for a clearable field', () => {
      const fixture = JSON.parse(fs.readFileSync(FIXTURE, 'utf8')) as Record<string, unknown>;
      for (const c of CREATE_CASES) {
        const bodies = ([] as Record<string, unknown>[]).concat(fixture[c.name] as Record<string, unknown>);
        for (const body of bodies) {
          for (const key of ['description', 'location', 'medication_dosage', 'scheduled_time', 'duration_minutes', 'recurrence_rule', 'recurrence_end_date']) {
            expect([c.name, key, body[key] === null]).toEqual([c.name, key, false]);
          }
        }
      }
    });
  });
}
