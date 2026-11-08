import fs from 'fs';
import path from 'path';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router-dom';
import '@/i18n';
import type { CalendarEvent } from '@/api/calendarEvents';
import type { CircleMember } from '@/api/circleMembers';
import { createShift, updateShift } from '@/api/shifts';
import { ToastProvider } from '@/components/ui';
import { useCircle } from '@/hooks/useCircle';
import { useAuthStore } from '@/store/authStore';
import { ShiftComposer } from '../ShiftComposer';
import { ShiftFormModal } from '../ShiftFormModal';

// PAYLOAD EQUALITY (owner 1.4.0, the simple shift form).
//
// The new layout (tiles, sections, "More details") only rearranges the same state. For the same answers it must
// POST EXACTLY what the old form posted: every create body (once / daily / weekly / some days; open / me / another
// member; each reminder; a repeat end; overnight; "add the next shift") and every edit request (one-off date /
// time / assignee / reminder changes; a series occurrence and "all upcoming").
//
// The old side is a fixture CAPTURED FROM THE OLD FORM: run this file with CAPTURE_OLD_SHIFT_FORM=1 while HEAD's
// ShiftFormModal.tsx (the dropdown layout) is in place; capture mode drives the OLD controls and writes
// `__fixtures__/shiftFormOldLayoutPayloads.json`. Without the flag the file drives the NEW controls with the
// same answers and compares. Fixed 2027 dates, the clock pinned.

const CAPTURE = process.env.CAPTURE_OLD_SHIFT_FORM === '1';
const FIXTURE = path.join(__dirname, '__fixtures__', 'shiftFormOldLayoutPayloads.json');
const NOW = new Date('2027-03-01T15:00:00Z');

vi.mock('@/api/shifts', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/api/shifts')>()),
  createShift: vi.fn(),
  updateShift: vi.fn(),
}));
vi.mock('@/hooks/useCircle', () => ({ useCircle: vi.fn() }));
vi.mock('@/hooks/useHourCycle', () => ({ useHourCycle: () => '12h' }));
vi.mock('@/lib/analytics', () => ({
  Analytics: {
    shiftCreated: vi.fn(),
    shiftEdited: vi.fn(),
    shiftAddNextTapped: vi.fn(),
    shiftSavedSheetAction: vi.fn(),
    shiftRepeatCustomOpened: vi.fn(),
    shiftEditTasksWarningShown: vi.fn(),
    shiftTakeConflict: vi.fn(),
  },
}));
vi.spyOn(Intl.DateTimeFormat.prototype, 'resolvedOptions').mockReturnValue({
  timeZone: 'America/Chicago',
} as Intl.ResolvedDateTimeFormatOptions);

const mockCreate = vi.mocked(createShift);
const mockUpdate = vi.mocked(updateShift);

const members = [
  { id: 'u-me', first_name: 'Pat', last_name: 'L', email: 'pat@x.test', role: 'owner', is_care_recipient: false },
  { id: 'u-ana', first_name: 'Ana', last_name: 'R', email: 'ana@x.test', role: 'member', is_care_recipient: false },
  { id: 'u-rosa', first_name: 'Rosa', last_name: 'G', email: 'rosa@x.test', role: 'member', is_care_recipient: true },
] as unknown as CircleMember[];

type Assignee = 'open' | 'me' | 'ana';
type Repeat = 'none' | 'daily' | 'weekly' | 'days';
const REPEAT_LABEL: Record<Repeat, string> = {
  none: 'Once',
  daily: 'Every day',
  weekly: 'Every week',
  days: 'Some days',
};
const REPEAT_OLD_VALUE: Record<Repeat, string> = {
  none: 'none',
  daily: 'daily',
  weekly: 'weekly',
  days: 'days_of_week',
};
const REMINDER_LABEL: Record<string, string> = {
  off: 'Off',
  '60': '1 hour',
  '120': '2 hours',
  '240': '4 hours',
  '1440': '1 day',
};

interface Answers {
  name?: string;
  date?: string;
  start?: string;
  end?: string;
  repeat?: Repeat;
  /** Weekday names to have ticked (the date's own weekday is ticked by default). */
  days?: string[];
  repeatEnd?: string;
  assignee?: Assignee;
  reminder?: string;
  scope?: 'occurrence' | 'future';
}

const created = (over: Partial<CalendarEvent> = {}): CalendarEvent => ({
  id: 'new-1',
  circle_id: 'c',
  event_type: 'shift',
  title: 'Morning',
  scheduled_date: '2027-03-09',
  scheduled_time: '08:00:00',
  duration_minutes: 360,
  recurrence_rule: null,
  reminder_lead_minutes: 60,
  assigned_to: null,
  created_at: '',
  updated_at: '',
  ...over,
});

const ONE_OFF = created({ id: 'one', title: 'Day', scheduled_date: '2027-03-09' });
const HELD = created({ id: 'held', title: 'Day', assigned_to: 'u-ana', reminder_lead_minutes: 120 });
const OCCURRENCE = created({
  id: 'root_2027-03-10',
  parent_event_id: 'root',
  recurrence_rule: 'daily',
  scheduled_date: '2027-03-10',
  title: 'Night',
  scheduled_time: '20:00:00',
  duration_minutes: 720,
  assigned_to: 'u-ana',
  reminder_lead_minutes: 60,
});

const CREATES: Record<string, Answers> = {
  'once-open': { name: 'Day', start: '08:00', end: '14:00' },
  'once-open-default-times': { name: 'Defaults' },
  'once-me': { name: 'Mine', assignee: 'me', start: '09:00', end: '17:30' },
  'once-ana': { name: 'Hers', assignee: 'ana', start: '09:00', end: '12:00' },
  'daily-open': { name: 'Morning', repeat: 'daily', start: '06:00', end: '10:00' },
  'daily-ana-end': { name: 'Aide', repeat: 'daily', assignee: 'ana', repeatEnd: '2027-06-30' },
  'weekly-me': { name: 'Sundays', repeat: 'weekly', assignee: 'me', date: '2027-03-14' },
  'weekly-end': { name: 'Weekly', repeat: 'weekly', repeatEnd: '2027-09-01', reminder: '1440' },
  'days-default': { name: 'Tuesdays', repeat: 'days' },
  'days-many': { name: 'Mon Thu Sat', repeat: 'days', days: ['Monday', 'Thursday', 'Saturday'], assignee: 'ana' },
  'days-end': { name: 'Days', repeat: 'days', days: ['Tuesday', 'Friday'], repeatEnd: '2027-05-01' },
  'overnight-daily': { name: 'Night', repeat: 'daily', start: '20:00', end: '08:00' },
  'overnight-24h': { name: 'Full day', start: '08:00', end: '08:00' },
  'short-15': { name: 'Quick', start: '10:00', end: '10:15' },
  'reminder-off': { name: 'R0', reminder: 'off' },
  'reminder-60': { name: 'R1', reminder: '60' },
  'reminder-120': { name: 'R2', reminder: '120' },
  'reminder-240': { name: 'R4', reminder: '240' },
  'reminder-1440': { name: 'R24', reminder: '1440' },
};

const EDITS: Record<string, { shift: CalendarEvent; answers: Answers }> = {
  'oneoff-date': { shift: ONE_OFF, answers: { date: '2027-03-11' } },
  'oneoff-time': { shift: ONE_OFF, answers: { start: '09:00', end: '13:30' } },
  'oneoff-end-only': { shift: ONE_OFF, answers: { end: '16:00' } },
  'oneoff-rename': { shift: ONE_OFF, answers: { name: 'Renamed' } },
  'oneoff-assign-me': { shift: ONE_OFF, answers: { assignee: 'me' } },
  'oneoff-assign-ana': { shift: ONE_OFF, answers: { assignee: 'ana' } },
  'oneoff-reminder-240': { shift: ONE_OFF, answers: { reminder: '240' } },
  'oneoff-reminder-off': { shift: ONE_OFF, answers: { reminder: 'off' } },
  'held-to-open': { shift: HELD, answers: { assignee: 'open' } },
  'held-to-me': { shift: HELD, answers: { assignee: 'me' } },
  'held-untouched': { shift: HELD, answers: {} },
  'occurrence-time': { shift: OCCURRENCE, answers: { start: '21:00' } },
  'occurrence-assign-open': { shift: OCCURRENCE, answers: { assignee: 'open' } },
  'future-reminder': {
    shift: OCCURRENCE,
    answers: { scope: 'future', reminder: '1440', name: 'Night owl' },
  },
  'future-untouched': { shift: OCCURRENCE, answers: { scope: 'future' } },
};

function setCircle(): void {
  vi.mocked(useCircle).mockReturnValue({
    circle: { id: 'c', recipient_name: 'Rosa', owner_id: 'u-me' },
    timezone: 'America/Chicago',
    members,
    canEdit: true,
    canManageMembers: true,
    viewerRole: 'owner',
  } as unknown as ReturnType<typeof useCircle>);
}

function shell(ui: React.ReactElement) {
  return render(
    <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
      <ToastProvider>
        <MemoryRouter>{ui}</MemoryRouter>
      </ToastProvider>
    </QueryClientProvider>
  );
}

const byId = (id: string): HTMLInputElement => {
  const el = document.getElementById(id);
  if (!el) throw new Error(`#${id} is not on screen`);
  return el as HTMLInputElement;
};

/** Drive the form (OLD controls in capture mode, the NEW ones otherwise) to give `answers`. */
async function fill(answers: Answers, editing: boolean): Promise<void> {
  const user = userEvent.setup({ advanceTimers: () => undefined });
  if (answers.name !== undefined) {
    fireEvent.change(byId('shift_name'), { target: { value: answers.name } });
  }
  if (answers.date !== undefined) fireEvent.change(byId('shift_date'), { target: { value: answers.date } });
  for (const [id, tile, value] of [
    ['shift_start', 'shift-start-tile', answers.start],
    ['shift_end', 'shift-end-tile', answers.end],
  ] as const) {
    if (value === undefined) continue;
    if (!CAPTURE && !document.getElementById(id)) await user.click(screen.getByTestId(tile));
    fireEvent.change(byId(id), { target: { value } });
  }
  if (answers.repeat !== undefined && !editing) {
    if (CAPTURE) {
      await user.selectOptions(screen.getByLabelText('Repeats'), REPEAT_OLD_VALUE[answers.repeat]);
    } else {
      const label = REPEAT_LABEL[answers.repeat];
      const top = within(screen.getByRole('radiogroup', { name: 'How often?' })).queryByRole('radio', { name: label });
      if (top) {
        await user.click(top);
      } else {
        // The rarer repeats sit behind "Custom…" (approved mock 2026-11-08).
        if (!screen.queryByRole('radiogroup', { name: 'Custom' })) await user.click(screen.getByTestId('shift-repeat-custom'));
        await user.click(within(screen.getByRole('radiogroup', { name: 'Custom' })).getByRole('radio', { name: label }));
      }
    }
  }
  if (answers.days) {
    const wanted = new Set(answers.days);
    for (const box of screen.getAllByRole('checkbox')) {
      const name = box.getAttribute('aria-label') ?? '';
      const on = box.getAttribute('aria-checked') === 'true';
      if (wanted.has(name) !== on) await user.click(box);
    }
  }
  if (answers.assignee !== undefined) {
    const label = { open: 'Leave open', me: 'Me', ana: 'Ana' }[answers.assignee];
    const group = screen.getByRole('radiogroup', { name: "Who's with Rosa?" });
    await user.click(within(group).getByRole('radio', { name: new RegExp(`^${label}`) }));
  }
  if (answers.reminder !== undefined || answers.repeatEnd !== undefined) {
    if (!CAPTURE) await user.click(screen.getByRole('button', { name: /^More details/ }));
  }
  if (answers.reminder !== undefined) {
    if (CAPTURE) {
      await user.selectOptions(screen.getByLabelText('Reminder'), answers.reminder);
    } else {
      const group = screen.getByRole('radiogroup', { name: 'Reminder' });
      await user.click(within(group).getByRole('radio', { name: REMINDER_LABEL[answers.reminder] }));
    }
  }
  if (answers.repeatEnd !== undefined) {
    fireEvent.change(byId('shift_repeat_end'), { target: { value: answers.repeatEnd } });
  }
  if (answers.scope) {
    await user.click(
      screen.getByRole('radio', { name: answers.scope === 'future' ? 'All upcoming shifts' : 'This shift' })
    );
  }
}

async function save(editing: boolean): Promise<void> {
  const user = userEvent.setup({ advanceTimers: () => undefined });
  await user.click(
    screen.getByRole('button', { name: CAPTURE || !editing ? 'Save shift' : 'Save changes' })
  );
}

type Recorded = unknown[];

async function runCreate(answers: Answers): Promise<Recorded> {
  mockCreate.mockClear();
  mockCreate.mockResolvedValue(created());
  shell(
    <ShiftFormModal
      circleId="c"
      initialDate={answers.date ? undefined : '2027-03-09'}
      onClose={vi.fn()}
    />
  );
  await fill(answers, false);
  await save(false);
  await waitFor(() => expect(mockCreate).toHaveBeenCalledTimes(1));
  return mockCreate.mock.calls[0] as Recorded;
}

async function runEdit(shift: CalendarEvent, answers: Answers): Promise<Recorded> {
  mockUpdate.mockClear();
  mockUpdate.mockResolvedValue(created());
  shell(<ShiftFormModal circleId="c" shift={shift} onClose={vi.fn()} />);
  await fill(answers, true);
  await save(true);
  await waitFor(() => expect(mockUpdate).toHaveBeenCalledTimes(1));
  return mockUpdate.mock.calls[0] as Recorded;
}

/** Create, then "Add the next shift", then the second save. Returns both bodies. */
async function runAddNext(): Promise<Recorded[]> {
  const user = userEvent.setup({ advanceTimers: () => undefined });
  mockCreate.mockClear();
  mockCreate.mockResolvedValue(created({ recurrence_rule: 'daily' }));
  shell(<ShiftComposer circleId="c" initialDate="2027-03-09" source="shifts_view" onClose={vi.fn()} />);
  await fill({ name: 'Morning', start: '08:00', end: '14:00', repeat: 'daily', reminder: '120' }, false);
  await save(false);
  await user.click(await screen.findByRole('button', { name: /^Add (the next|another) shift$/ }));
  await waitFor(() => byId('shift_name'));
  await fill({ name: 'Afternoon', end: '20:00' }, false);
  await save(false);
  await waitFor(() => expect(mockCreate).toHaveBeenCalledTimes(2));
  return mockCreate.mock.calls as Recorded[];
}

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(NOW);
  useAuthStore.setState({
    user: { id: 'u-me', email: 'pat@x.test', first_name: 'Pat', last_name: 'L' },
    isAuthenticated: true,
  } as never);
  setCircle();
});
afterEach(() => {
  vi.useRealTimers();
});

describe('shift form: request bodies are identical to the old layout', () => {
  if (CAPTURE) {
    it('CAPTURE: records the OLD form requests', async () => {
      const out: { creates: Record<string, Recorded>; edits: Record<string, Recorded>; addNext: Recorded[] } = {
        creates: {},
        edits: {},
        addNext: [],
      };
      for (const [id, answers] of Object.entries(CREATES)) {
        out.creates[id] = await runCreate(answers);
        cleanup();
      }
      for (const [id, { shift, answers }] of Object.entries(EDITS)) {
        out.edits[id] = await runEdit(shift, answers);
        cleanup();
      }
      out.addNext = await runAddNext();
      fs.mkdirSync(path.dirname(FIXTURE), { recursive: true });
      fs.writeFileSync(
        FIXTURE,
        `${JSON.stringify(
          {
            _comment:
              'Captured from the OLD (dropdown) shift form with CAPTURE_OLD_SHIFT_FORM=1. Create = [circleId, body]; edit = [circleId, eventId, data].',
            ...out,
          },
          null,
          2
        )}\n`
      );
    });
    return;
  }

  const fixture = JSON.parse(fs.readFileSync(FIXTURE, 'utf8')) as {
    creates: Record<string, Recorded>;
    edits: Record<string, Recorded>;
    addNext: Recorded[];
  };

  it('the fixture covers every create and edit scenario', () => {
    expect(Object.keys(fixture.creates).sort()).toEqual(Object.keys(CREATES).sort());
    expect(Object.keys(fixture.edits).sort()).toEqual(Object.keys(EDITS).sort());
    expect(fixture.addNext).toHaveLength(2);
  });

  it.each(Object.keys(CREATES))('create: %s posts the old body', async (id) => {
    const actual = await runCreate(CREATES[id]);
    expect(JSON.stringify(actual)).toBe(JSON.stringify(fixture.creates[id]));
  });

  it.each(Object.keys(EDITS))('edit: %s sends the old request', async (id) => {
    const actual = await runEdit(EDITS[id].shift, EDITS[id].answers);
    expect(JSON.stringify(actual)).toBe(JSON.stringify(fixture.edits[id]));
  });

  it('"Add the next shift" posts the old pair of bodies', async () => {
    const actual = await runAddNext();
    expect(JSON.stringify(actual)).toBe(JSON.stringify(fixture.addNext));
  });
});
