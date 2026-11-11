import fs from 'fs';
import path from 'path';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import '@/i18n';
import type { CalendarEvent } from '@/api/calendarEvents';
import { Analytics } from '@/lib/analytics';
import { resetLargeTextReports } from '@/lib/largeText';
import { AddEventModal } from '../AddEventModal';

// THE MEDICATION FORM ON THE TASK / SHIFT PATTERN (owner 2026-11-08, "cohesiveness"): the start date moved up
// into "When?" ("Starts"), How often? became the shared grid (Every day / Every week / Custom… / When needed)
// and the Repeat select left More details. Same state, same `buildPayload`, same Save, SAME FRAMES (the start
// date is still the viewer-frame field it was): for the same choices every request body must be BYTE-IDENTICAL.
//
// The old side is a fixture CAPTURED FROM THE OLD FORM (CAPTURE_OLD_MED_FORM=1 with the pre-change
// AddEventModal in place): `__fixtures__/medFormOldLayoutPayloads.json`. Each case is one intent, driven
// through the old controls (More details > Start date / Repeat select, the old How often tiles) and the new
// ones. Create (every rule, extra doses, as needed) and edit (scheduled, as needed, a days series, ...).

const VIEWER_TZ = 'America/Denver';
const ORIGINAL_TZ = process.env.TZ;
beforeAll(() => {
  process.env.TZ = VIEWER_TZ;
});
afterAll(() => {
  process.env.TZ = ORIGINAL_TZ;
});

const FIXTURE = path.join(__dirname, '__fixtures__', 'medFormOldLayoutPayloads.json');
const CAPTURE = process.env.CAPTURE_OLD_MED_FORM === '1';
const NOW = new Date('2027-02-10T18:40:00Z');
const CIRCLE_ID = 'circle-1';
const ME_ID = 'aaaaaaaa-1111-4111-8111-111111111111';

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
vi.mock('@/store/authStore', () => ({
  useAuthStore: (select: (s: { user: { id: string } }) => unknown) => select({ user: { id: ME_ID } }),
}));
const useCircleResult = {
  circle: { recipient_name: 'Rosa', is_self_care: false, owner_id: ME_ID },
  circleSummary: undefined,
  timezone: 'America/New_York',
  members: [{ id: ME_ID, email: 'luis@example.com', first_name: 'Luis', is_care_recipient: false }],
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
  ] as const) {
    vi.spyOn(Analytics, name).mockImplementation(() => {});
  }
});
afterEach(() => {
  vi.restoreAllMocks();
  vi.useRealTimers();
});

type User = ReturnType<typeof userEvent.setup>;
type Repeat =
  | 'none'
  | 'daily'
  | 'weekly'
  | 'every_other_day'
  | 'monthly'
  | 'yearly'
  | 'cycle'
  | 'days_of_week'
  | 'as_needed';
type Chip = 'Morning' | 'Midday' | 'Evening' | 'Bedtime';
interface RepeatExtra {
  days?: string[];
  cycle?: [string, string];
}

interface Driver {
  startDate(day: string): Promise<void>;
  repeat(choice: Repeat, extra?: RepeatExtra): Promise<void>;
}

// Build 11 (owner 2026-11-10): TIME-FIRST chips ("8:00 AM Morning"), checkboxes on a new medication (multi-select),
// radios on an edit (one dose). Same chips, same times.
const chipRadio = (name: Chip) => {
  const group = within(document.getElementById('time-chips') as HTMLElement);
  return (
    group.queryByRole('checkbox', { name: new RegExp(`${name}$`) }) ??
    group.getByRole('radio', { name: new RegExp(`${name}$`) })
  );
};

async function openMore(user: User) {
  const toggle = screen.getByRole('button', { name: /^More details/ });
  if (toggle.getAttribute('aria-expanded') !== 'true') await user.click(toggle);
}
async function daysAndCycle(user: User, extra?: RepeatExtra) {
  for (const day of extra?.days ?? []) await user.click(screen.getByRole('checkbox', { name: day }));
  if (extra?.cycle) {
    fireEvent.change(screen.getByLabelText(/^Days on/), { target: { value: extra.cycle[0] } });
    fireEvent.change(screen.getByLabelText(/^Days off/), { target: { value: extra.cycle[1] } });
  }
}

// The steps that did not move (name, dose, the chips, Other time, + Another dose, instructions, reminders, end date).
async function name(user: User, text: string) {
  const box = screen.getByRole('combobox', { name: /Medication name/ });
  await user.clear(box);
  await user.type(box, text);
}
async function dose(user: User, text: string) {
  await user.clear(screen.getByLabelText('Dosage'));
  await user.type(screen.getByLabelText('Dosage'), text);
}
async function chip(user: User, c: Chip) {
  await user.click(chipRadio(c));
}
async function otherTime(user: User, time: string) {
  // "Other…" is the time picker itself (a PickerTile over the hidden `#scheduled_time`).
  await user.click(screen.getByTestId('time-chip-other'));
  fireEvent.change(screen.getByLabelText('Other time', { selector: 'input' }), { target: { value: time } });
}
/**
 * "+ Another dose" added the first chip not already used; the multi-select chips (build 11) say the same thing
 * by choosing that chip as a further time.
 */
async function extraDose(user: User) {
  const group = within(document.getElementById('time-chips') as HTMLElement);
  const next = group.getAllByRole('checkbox').find((c) => c.getAttribute('aria-checked') !== 'true');
  await user.click(next as HTMLElement);
}
async function instructions(user: User, text: string) {
  await openMore(user);
  await user.clear(screen.getByLabelText('Instructions'));
  await user.type(screen.getByLabelText('Instructions'), text);
}
async function endDate(user: User, day: string) {
  // The "Repeats until" tile in When? (build 11), no longer in More details.
  if (!screen.queryByLabelText(/^Repeats until/)) await openMore(user);
  fireEvent.change(screen.queryByLabelText(/^Repeats until/) ?? screen.getByLabelText(/^End date/), {
    target: { value: day },
  });
}
/** The simple forms' Reminders card is the summary row's accordion (owner 2026-11-10), not in More details. */
async function expandReminders(user: User) {
  const row = screen.queryByTestId('reminders-summary-row');
  if (row && row.getAttribute('aria-expanded') !== 'true') await user.click(row);
}
async function reminders(user: User) {
  if (screen.queryByTestId('reminders-summary-row')) await expandReminders(user);
  else await openMore(user);
  await user.click(screen.getByRole('checkbox', { name: 'At the scheduled time' }));
  await user.click(screen.getByRole('checkbox', { name: '1 hour before' }));
}
async function reason(user: User, text: string) {
  await user.type(screen.getByLabelText(/^What is it for/), text);
}

function oldDriver(user: User): Driver {
  return {
    async startDate(day) {
      await openMore(user);
      fireEvent.change(screen.getByLabelText(/^Start date/), { target: { value: day } });
    },
    async repeat(choice, extra) {
      const tile: Partial<Record<Repeat, string>> = {
        daily: 'Every day',
        days_of_week: 'Some days',
        as_needed: 'When needed',
      };
      if (tile[choice]) {
        await user.click(screen.getByRole('radio', { name: tile[choice] }));
      } else {
        await openMore(user);
        await user.selectOptions(screen.getByRole('combobox', { name: /^Repeat/ }), choice);
      }
      await daysAndCycle(user, extra);
    },
  };
}

function newDriver(user: User): Driver {
  return {
    async startDate(day) {
      fireEvent.change(screen.getByLabelText(/^Starts/), { target: { value: day } });
    },
    async repeat(choice, extra) {
      const tile: Partial<Record<Repeat, string>> = {
        daily: 'Every day',
        weekly: 'Every week',
        as_needed: 'When needed',
      };
      const custom: Partial<Record<Repeat, string>> = {
        none: 'Once',
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
  };
}

type Act = (d: Driver, user: User) => Promise<void>;
interface CreateCase {
  name: string;
  act: Act;
}
const named: Act = async (_d, u) => {
  await name(u, 'Metformin');
  await dose(u, '500 mg');
};
const CREATE_CASES: CreateCase[] = [
  { name: 'create-morning-default-daily', act: async (d, u) => { await named(d, u); await chip(u, 'Morning'); } },
  { name: 'create-evening-explicit-daily', act: async (d, u) => { await named(d, u); await chip(u, 'Evening'); await d.repeat('daily'); } },
  { name: 'create-other-time', act: async (d, u) => { await named(d, u); await otherTime(u, '07:15'); } },
  { name: 'create-once', act: async (d, u) => { await named(d, u); await chip(u, 'Midday'); await d.repeat('none'); } },
  { name: 'create-weekly', act: async (d, u) => { await named(d, u); await chip(u, 'Bedtime'); await d.repeat('weekly'); } },
  { name: 'create-every-other-day', act: async (d, u) => { await named(d, u); await chip(u, 'Morning'); await d.repeat('every_other_day'); } },
  { name: 'create-monthly', act: async (d, u) => { await named(d, u); await chip(u, 'Morning'); await d.repeat('monthly'); } },
  { name: 'create-yearly', act: async (d, u) => { await named(d, u); await chip(u, 'Morning'); await d.repeat('yearly'); } },
  { name: 'create-cycle', act: async (d, u) => { await named(d, u); await chip(u, 'Evening'); await d.repeat('cycle', { cycle: ['21', '7'] }); } },
  { name: 'create-some-days', act: async (d, u) => { await named(d, u); await chip(u, 'Morning'); await d.repeat('days_of_week', { days: ['Monday', 'Friday'] }); } },
  { name: 'create-as-needed', act: async (d, u) => { await named(d, u); await d.repeat('as_needed'); await reason(u, 'Headache'); } },
  { name: 'create-start-date', act: async (d, u) => { await named(d, u); await d.startDate('2027-02-20'); await chip(u, 'Bedtime'); } },
  { name: 'create-start-date-after-time', act: async (d, u) => { await named(d, u); await chip(u, 'Morning'); await d.startDate('2027-03-14'); } },
  { name: 'create-start-date-some-days', act: async (d, u) => { await named(d, u); await d.startDate('2027-02-17'); await chip(u, 'Morning'); await d.repeat('days_of_week', { days: ['Saturday'] }); } },
  { name: 'create-end-date', act: async (d, u) => { await named(d, u); await chip(u, 'Morning'); await endDate(u, '2027-03-31'); } },
  { name: 'create-weekly-end-date', act: async (d, u) => { await named(d, u); await chip(u, 'Morning'); await d.repeat('weekly'); await endDate(u, '2027-05-01'); } },
  { name: 'create-extra-doses', act: async (d, u) => { await named(d, u); await chip(u, 'Morning'); await extraDose(u); await extraDose(u); } },
  { name: 'create-extra-doses-every-other-day', act: async (d, u) => { await named(d, u); await chip(u, 'Morning'); await extraDose(u); await d.repeat('every_other_day'); } },
  { name: 'create-instructions-reminders', act: async (d, u) => { await named(d, u); await chip(u, 'Bedtime'); await instructions(u, 'With food'); await reminders(u); } },
  { name: 'create-everything', act: async (d, u) => {
    await named(d, u);
    await d.startDate('2027-02-15');
    await chip(u, 'Morning');
    await extraDose(u);
    await d.repeat('days_of_week', { days: ['Wednesday', 'Friday'] });
    await endDate(u, '2027-06-30');
    await instructions(u, 'Before breakfast');
    await reminders(u);
  } },
];

const base = {
  circle_id: CIRCLE_ID,
  event_type: 'medication' as const,
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
  recurrence_end_date: null,
};
function med(over: Partial<CalendarEvent>): CalendarEvent {
  return {
    ...base,
    id: 'med-1',
    title: 'Lisinopril',
    medication_name: 'Lisinopril',
    medication_dosage: '10 mg',
    scheduled_date: '2027-02-01',
    scheduled_time: '08:00:00',
    recurrence_rule: 'daily',
    ...over,
  } as CalendarEvent;
}
const M = {
  daily: med({}),
  oneOff: med({ id: 'med-2', recurrence_rule: null, scheduled_date: '2027-02-20' }),
  weekly: med({ id: 'med-3', recurrence_rule: 'weekly' }),
  someDays: med({ id: 'med-4', recurrence_rule: 'weekly', recurrence_days: [1, 3, 5] } as Partial<CalendarEvent>),
  everyOther: med({ id: 'med-5', recurrence_rule: 'every_other_day' }),
  monthly: med({ id: 'med-6', recurrence_rule: 'monthly' }),
  yearly: med({ id: 'med-7', recurrence_rule: 'yearly' }),
  cycle: med({ id: 'med-8', recurrence_rule: 'cycle:21:7' }),
  dailyEnd: med({ id: 'med-9', recurrence_end_date: '2027-03-31', description: 'With food' }),
  future: med({ id: 'med-10', scheduled_date: '2027-02-20', recurrence_rule: 'daily' }),
  asNeeded: med({ id: 'med-11', recurrence_rule: null, scheduled_time: null, as_needed: true, as_needed_reason: 'Pain' } as Partial<CalendarEvent>),
};
interface EditCase {
  name: string;
  event: CalendarEvent;
  act?: Act;
}
const UNTOUCHED: EditCase[] = (Object.entries(M) as [string, CalendarEvent][]).map(([key, event]) => ({
  name: `edit-untouched-${key}`,
  event,
}));
const EDIT_CASES: EditCase[] = [
  ...UNTOUCHED,
  { name: 'edit-chip', event: M.daily, act: async (_d, u) => { await chip(u, 'Evening'); } },
  { name: 'edit-other-time', event: M.daily, act: async (_d, u) => { await otherTime(u, '09:30'); } },
  { name: 'edit-start-date-future', event: M.future, act: (d) => d.startDate('2027-02-25') },
  { name: 'edit-daily-to-weekly', event: M.daily, act: (d) => d.repeat('weekly') },
  { name: 'edit-daily-to-once', event: M.future, act: (d) => d.repeat('none') },
  { name: 'edit-once-to-daily', event: M.oneOff, act: (d) => d.repeat('daily') },
  { name: 'edit-daily-to-some-days', event: M.daily, act: (d) => d.repeat('days_of_week', { days: ['Saturday'] }) },
  { name: 'edit-some-days-change', event: M.someDays, act: (d) => d.repeat('days_of_week', { days: ['Friday', 'Sunday'] }) },
  { name: 'edit-some-days-to-daily', event: M.someDays, act: (d) => d.repeat('daily') },
  { name: 'edit-monthly-to-yearly', event: M.monthly, act: (d) => d.repeat('yearly') },
  { name: 'edit-every-other-to-cycle', event: M.everyOther, act: (d) => d.repeat('cycle', { cycle: ['5', '2'] }) },
  { name: 'edit-cycle-change', event: M.cycle, act: (d) => d.repeat('cycle', { cycle: ['14', '14'] }) },
  { name: 'edit-weekly-to-every-other', event: M.weekly, act: (d) => d.repeat('every_other_day') },
  { name: 'edit-end-date', event: M.dailyEnd, act: async (_d, u) => { await endDate(u, '2027-04-30'); } },
  { name: 'edit-instructions', event: M.dailyEnd, act: async (_d, u) => { await instructions(u, 'After food'); } },
  { name: 'edit-reminders', event: M.daily, act: async (_d, u) => { await reminders(u); } },
  { name: 'edit-as-needed-reason', event: M.asNeeded, act: async (_d, u) => { await reason(u, ' or fever'); } },
  { name: 'edit-name-dose', event: M.weekly, act: async (_d, u) => { await name(u, 'Lisinopril HCT'); await dose(u, '20 mg'); } },
];

type Layout = 'old' | 'new';
async function runCreate(c: CreateCase, layout: Layout): Promise<unknown> {
  const user = userEvent.setup();
  const view = render(<AddEventModal circleId={CIRCLE_ID} initialType="medication" onClose={vi.fn()} />);
  await c.act(layout === 'old' ? oldDriver(user) : newDriver(user), user);
  mutateCreate.mockClear();
  await user.click(screen.getByTestId('add-event-save'));
  await waitFor(() => expect(mutateCreate).toHaveBeenCalled());
  // Let any sibling dose rows land too.
  await new Promise((r) => setTimeout(r, 0));
  view.unmount();
  return JSON.parse(JSON.stringify(mutateCreate.mock.calls.map((call) => call[0])));
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
  it("captures the OLD medication form's bodies (run with the pre-change AddEventModal in place)", async () => {
    const out: Record<string, unknown> = {};
    for (const c of CREATE_CASES) out[c.name] = await runCreate(c, 'old');
    for (const c of EDIT_CASES) out[c.name] = await runEdit(c, 'old');
    fs.writeFileSync(FIXTURE, JSON.stringify(out, null, 2) + '\n');
  }, 180_000);
} else {
  const OLD: Record<string, unknown> = fs.existsSync(FIXTURE)
    ? JSON.parse(fs.readFileSync(FIXTURE, 'utf8'))
    : {};

  describe('medication form payload equality: the task-pattern layout posts what the old one posted', () => {
    it('the fixture covers every case', () => {
      for (const c of [...CREATE_CASES, ...EDIT_CASES]) expect(OLD[c.name], c.name).toBeDefined();
    });

    it('the new layout is really the one under test (Starts in When?, no Repeat select)', () => {
      render(<AddEventModal circleId={CIRCLE_ID} initialType="medication" onClose={vi.fn()} />);
      expect(screen.getByLabelText(/^Starts/)).toBeInTheDocument();
      expect(screen.queryByRole('combobox', { name: /^Repeat/, hidden: true })).toBeNull();
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
      const e = EDIT_CASES.find((x) => x.name === 'edit-some-days-change') as EditCase;
      expect(JSON.stringify(await runEdit(e, 'new'))).toBe(JSON.stringify(OLD[e.name]));
    });

    it('the fixture is not vacuous: extra doses saved as separate rows, the start date moved', () => {
      expect((OLD['create-extra-doses'] as unknown[]).length).toBe(3);
      expect((OLD['create-start-date'] as Array<{ scheduled_date: string }>)[0].scheduled_date).toBe('2027-02-20');
      expect((OLD['create-once'] as Array<Record<string, unknown>>)[0].recurrence_rule).toBeUndefined();
    });
  });
}

// ── CLEARABLE ON EDIT (sweep 2026-11-08): deliberate changes to the fixture above ─────────────────
// "edit-daily-to-once" used to record the BUGGY old body (no `recurrence_rule` key, so the series kept
// going); it is now `recurrence_rule: null`. Otherwise only two mechanical changes, audited key by key
// when the fixture was rewritten: on an edit an UNCHANGED dosage / instructions is left out
// (utils/editPatch), and the recurrence keys follow mobile's `recurrenceForSave(…, { clearing: isEditing })`.
if (!CAPTURE) {
  describe('medication edit: an emptied field is cleared with null (explicit, not just fixture equality)', () => {
    const run = async (c: EditCase) => ((await runEdit(c, 'new')) as { data: Record<string, unknown> }).data;
    const named = (name: string) => EDIT_CASES.find((x) => x.name === name) as EditCase;

    it('"Once" on a daily medication ends the series', async () => {
      const data = await run(named('edit-daily-to-once'));
      expect(data).toHaveProperty('recurrence_rule', null);
      expect(data).toHaveProperty('recurrence_end_date', null);
    });

    it('a cleared dosage is null; an untouched one is left out', async () => {
      const cleared = await run({
        name: 'edit-dose-cleared',
        event: named('edit-untouched-daily').event,
        act: async (_d, u) => {
          await dose(u, ' ');
        },
      });
      expect(cleared).toHaveProperty('medication_dosage', null);
      expect(await run(named('edit-untouched-daily'))).not.toHaveProperty('medication_dosage');
    });

    it('cleared instructions are null; untouched ones are left out', async () => {
      const cleared = await run({
        name: 'edit-instructions-cleared',
        event: named('edit-untouched-dailyEnd').event,
        act: async (_d, u) => {
          await instructions(u, ' ');
        },
      });
      expect(cleared).toHaveProperty('description', null);
      expect(await run(named('edit-untouched-dailyEnd'))).not.toHaveProperty('description');
    });

    it('a medication never sends a null time (it always has one)', async () => {
      for (const c of EDIT_CASES) {
        const data = (OLD_FIXTURE()[c.name] as { data: Record<string, unknown> }).data;
        expect([c.name, data.scheduled_time === null]).toEqual([c.name, false]);
      }
    });

    it('a CREATE never sends null for a clearable field', () => {
      for (const c of CREATE_CASES) {
        const bodies = ([] as Record<string, unknown>[]).concat(OLD_FIXTURE()[c.name] as Record<string, unknown>);
        for (const body of bodies) {
          for (const key of ['description', 'location', 'medication_dosage', 'scheduled_time', 'duration_minutes', 'recurrence_rule', 'recurrence_end_date']) {
            expect([c.name, key, body[key] === null]).toEqual([c.name, key, false]);
          }
        }
      }
    });
  });
}
function OLD_FIXTURE(): Record<string, unknown> {
  return JSON.parse(fs.readFileSync(FIXTURE, 'utf8'));
}
