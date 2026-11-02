import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import '@/i18n';
import type { CalendarEvent } from '@/api/calendarEvents';
import { Analytics } from '@/lib/analytics';
import { resetLargeTextReports } from '@/lib/largeText';
import { AddEventModal } from '../AddEventModal';

// THE DURATION CHIPS COUNT THEIR LENGTH ON THE CARE RECIPIENT'S CLOCK (1.4.0).
//
// The task / appointment forms hold their times on the viewer's (browser's) clock but work in the recipient's
// frame: the save sends the recipient's start and `duration_minutes`. A chip ("30 min" / "1 hr" / "2 hrs") and
// the default length used to cap the end at 23:59 on the VIEWER's clock, so a viewer far from the recipient lost
// minutes: a Denver viewer adding "2 hrs" to an 18:30 Auckland task (the viewer's 22:30) saved 89. Now the chip's
// full length is counted on the recipient's clock and an end past the recipient's midnight carries to the next
// day (mobile's rule, and this form's recipient-clock end row's). Same zone too: no 23:59 cap, the end carries
// past midnight as on the phone (a same-zone 22:30 + "2 hrs" saved 89 on web, 120 on mobile; see `presetEndTimeStr`).
//
// The viewer zone is set per block (process.env.TZ); the recipient zone is the circle's. Date pinned 2027-02-10.

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

const ORIGINAL_TZ = process.env.TZ;
afterAll(() => {
  process.env.TZ = ORIGINAL_TZ;
});
function viewerZone(zone: string) {
  beforeAll(() => {
    process.env.TZ = zone;
  });
}

/** The same-zone request bodies HEAD (before the fix) posted, captured from it: the fix must not move a byte. */
// Captured HEAD bodies with the duration corrected: HEAD saved 89 / 14 / 1440 / 89 here (the 23:59 cap; 23:59 +
// "30 min" capped to an equal end, which reads as a 24-hour span). Every other byte is unchanged.
const SAME_ZONE_EXPECTED: Record<string, unknown> = {
  '10:00|1 hr': {"event_type":"task","title":"Physio","scheduled_date":"2027-02-15","scheduled_time":"10:00","duration_minutes":60,"notifications_enabled":true,"reminder_at_due":true,"reminder_24h":false,"reminder_1h":false,"reminder_30m":false,"reminder_15m":false,"assigned_to":null,"entry_source":"form"},
  '22:30|2 hrs': {"event_type":"task","title":"Physio","scheduled_date":"2027-02-15","scheduled_time":"22:30","duration_minutes":120,"notifications_enabled":true,"reminder_at_due":true,"reminder_24h":false,"reminder_1h":false,"reminder_30m":false,"reminder_15m":false,"assigned_to":null,"entry_source":"form"},
  '23:45|null': {"event_type":"task","title":"Physio","scheduled_date":"2027-02-15","scheduled_time":"23:45","duration_minutes":30,"notifications_enabled":true,"reminder_at_due":true,"reminder_24h":false,"reminder_1h":false,"reminder_30m":false,"reminder_15m":false,"assigned_to":null,"entry_source":"form"},
  '23:59|30 min': {"event_type":"task","title":"Physio","scheduled_date":"2027-02-15","scheduled_time":"23:59","duration_minutes":30,"notifications_enabled":true,"reminder_at_due":true,"reminder_24h":false,"reminder_1h":false,"reminder_30m":false,"reminder_15m":false,"assigned_to":null,"entry_source":"form"},
  'appt|22:30|2 hrs': {"eventId":"appt-1","data":{"event_type":"appointment","title":"Cardiology","scheduled_date":"2027-02-15","scheduled_time":"22:30","duration_minutes":120,"notifications_enabled":true,"reminder_at_due":true,"reminder_24h":false,"reminder_1h":false,"reminder_30m":false,"reminder_15m":false,"assigned_to":null,"provider_id":null}},
};

const DEN = 'America/Denver';
const AKL = 'Pacific/Auckland';
const HNL = 'Pacific/Honolulu';
type Chip = '30 min' | '1 hr' | '2 hrs';

/** A NEW task on the recipient's `day` at the recipient's `time` (the simple form's Other day + Pick a time). */
async function createTask(zone: string, day: string, time: string, chip: Chip | null) {
  useCircleResult.timezone = zone;
  const user = userEvent.setup();
  const view = render(<AddEventModal circleId={CIRCLE_ID} initialType="task" onClose={vi.fn()} />);
  await user.type(screen.getByRole('textbox', { name: /^Title/ }), 'Physio');
  await user.click(screen.getByRole('button', { name: /^Other day/ }));
  fireEvent.change(screen.getByLabelText(/^Date/), { target: { value: day } });
  await user.click(screen.getByRole('button', { name: /^Pick a time/ }));
  fireEvent.change(screen.getByLabelText(/^Time/, { selector: 'input' }), { target: { value: time } });
  if (chip) {
    await user.click(screen.getByRole('button', { name: /^More details/ }));
    await user.click(screen.getByRole('radio', { name: chip }));
  }
  mutateCreate.mockClear();
  await user.click(screen.getByTestId('add-event-save'));
  await waitFor(() => expect(mutateCreate).toHaveBeenCalledTimes(1));
  view.unmount();
  return JSON.parse(JSON.stringify(mutateCreate.mock.calls[0][0]));
}

const appt = (over: Partial<CalendarEvent>): CalendarEvent =>
  ({
    id: 'appt-1', circle_id: CIRCLE_ID, event_type: 'appointment', title: 'Cardiology',
    created_at: '2027-01-01T00:00:00Z', updated_at: '2027-01-01T00:00:00Z', notifications_enabled: true,
    reminder_at_due: true, reminder_24h: false, reminder_1h: false, reminder_30m: false, reminder_15m: false,
    description: null, location: null, assigned_to: null, duration_minutes: 30, recurrence_rule: null,
    recurrence_end_date: null, scheduled_date: '2027-02-15', scheduled_time: '18:30:00', ...over,
  }) as CalendarEvent;

/** An EDIT of an appointment stored at the recipient's `day` `time`, tapping `chip`. */
async function editAppointmentChip(zone: string, day: string, time: string, chip: Chip) {
  useCircleResult.timezone = zone;
  const user = userEvent.setup();
  const view = render(
    <AddEventModal circleId={CIRCLE_ID} event={appt({ scheduled_date: day, scheduled_time: `${time}:00` })} onClose={vi.fn()} />
  );
  await user.click(screen.getByRole('radio', { name: chip }));
  mutateUpdate.mockClear();
  await user.click(screen.getByTestId('add-event-save'));
  await waitFor(() => expect(mutateUpdate).toHaveBeenCalledTimes(1));
  view.unmount();
  return JSON.parse(JSON.stringify(mutateUpdate.mock.calls[0][0]));
}

describe('viewer BEHIND the recipient (Denver viewing Auckland)', () => {
  viewerZone(DEN);
  it('task: 18:30 + "2 hrs" saves 120, not 89 (the viewer\'s 22:30 capped at the viewer\'s 23:59)', async () => {
    const body = await createTask(AKL, '2027-02-15', '18:30', '2 hrs');
    expect(body).toMatchObject({ scheduled_date: '2027-02-15', scheduled_time: '18:30', duration_minutes: 120 });
  });
  it('appointment edit: 18:30 + "2 hrs" saves 120', async () => {
    const body = await editAppointmentChip(AKL, '2027-02-15', '18:30', '2 hrs');
    expect(body.data).toMatchObject({ scheduled_time: '18:30', duration_minutes: 120 });
  });
  it('a recipient DST day (Auckland 2027-09-26, clocks forward 02:00): 18:30 + "1 hr" saves 60 (was 29)', async () => {
    const body = await createTask(AKL, '2027-09-26', '18:30', '1 hr');
    expect(body).toMatchObject({ scheduled_date: '2027-09-26', scheduled_time: '18:30', duration_minutes: 60 });
  });
  it('the default length, for a start the viewer sees at 23:45 (Auckland 19:45): the full 30 (was 14)', async () => {
    const body = await createTask(AKL, '2027-02-15', '19:45', null);
    expect(body).toMatchObject({ scheduled_time: '19:45', duration_minutes: 30 });
  });
  it('past the RECIPIENT\'s midnight: carried to the next day (mobile\'s rule), 23:00 + "2 hrs" saves 120', async () => {
    const body = await createTask(AKL, '2027-02-15', '23:00', '2 hrs');
    expect(body).toMatchObject({ scheduled_time: '23:00', duration_minutes: 120 });
  });
});

describe('viewer AHEAD of the recipient (Auckland viewing Denver)', () => {
  viewerZone(AKL);
  it('task: 18:30 + "2 hrs" saves 120', async () => {
    const body = await createTask(DEN, '2027-02-15', '18:30', '2 hrs');
    expect(body).toMatchObject({ scheduled_date: '2027-02-15', scheduled_time: '18:30', duration_minutes: 120 });
  });
  it('task: 02:30 (the viewer\'s 22:30) + "2 hrs" saves 120, not 89', async () => {
    const body = await createTask(DEN, '2027-02-15', '02:30', '2 hrs');
    expect(body).toMatchObject({ scheduled_time: '02:30', duration_minutes: 120 });
  });
  it('appointment edit: 03:30 (the viewer\'s 23:30) + "1 hr" saves 60, not 29', async () => {
    const body = await editAppointmentChip(DEN, '2027-02-15', '03:30', '1 hr');
    expect(body.data).toMatchObject({ scheduled_time: '03:30', duration_minutes: 60 });
  });
  it('a recipient DST day (Denver 2027-03-14, clocks forward 02:00): 04:30 (the viewer\'s 23:30) + "1 hr" saves 60 (was 29)', async () => {
    const body = await createTask(DEN, '2027-03-14', '04:30', '1 hr');
    expect(body).toMatchObject({ scheduled_date: '2027-03-14', scheduled_time: '04:30', duration_minutes: 60 });
  });
});

describe('Honolulu viewing Auckland', () => {
  viewerZone(HNL);
  it('task: 21:30 (the viewer\'s 22:30 the day before) + "2 hrs" saves 120, not 89', async () => {
    const body = await createTask(AKL, '2027-02-15', '21:30', '2 hrs');
    expect(body).toMatchObject({ scheduled_date: '2027-02-15', scheduled_time: '21:30', duration_minutes: 120 });
  });
  it('task: 18:30 + "2 hrs" saves 120', async () => {
    const body = await createTask(AKL, '2027-02-15', '18:30', '2 hrs');
    expect(body).toMatchObject({ scheduled_time: '18:30', duration_minutes: 120 });
  });
});

describe('same zone (Denver viewing Denver): the full length, carried past midnight (mobile parity)', () => {
  viewerZone(DEN);
  it.each([
    ['10:00', '1 hr' as Chip],
    ['22:30', '2 hrs' as Chip],
    ['23:45', null],
    ['23:59', '30 min' as Chip],
  ])('task %s + %s', async (time, chip) => {
    const body = await createTask(DEN, '2027-02-15', time, chip);
    expect(JSON.stringify(body)).toBe(JSON.stringify(SAME_ZONE_EXPECTED[`${time}|${chip}`]));
  });
  it('same zone 22:30 + "2 hrs" saves 120 (was 89 on web; 120 on mobile)', async () => {
    const body = await createTask(DEN, '2027-02-15', '22:30', '2 hrs');
    expect(body).toMatchObject({ scheduled_date: '2027-02-15', scheduled_time: '22:30', duration_minutes: 120 });
  });
  it('appointment edit 22:30 + "2 hrs"', async () => {
    const body = await editAppointmentChip(DEN, '2027-02-15', '22:30', '2 hrs');
    expect(JSON.stringify(body)).toBe(JSON.stringify(SAME_ZONE_EXPECTED['appt|22:30|2 hrs']));
  });
});
