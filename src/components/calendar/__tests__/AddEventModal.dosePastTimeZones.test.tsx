import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import '@/i18n';
import { Analytics } from '@/lib/analytics';
import { resetLargeTextReports } from '@/lib/largeText';
import { AddEventModal } from '../AddEventModal';

// "Starts with the next dose. 9:00 AM has already passed today." on a NEW medication is judged on the CIRCLE's
// calendar and clock (naive local time in the recipient zone), never the viewer's. The 34-zone sweep caught the
// EXTRA doses being judged on the primary's VIEWER day: a Berlin or Tokyo viewer of a New York circle at 12:30
// there, Evening (6 PM NY = the NEXT viewer day) plus "Other…" 9:00 AM, never saw the note, while the save put
// both rows on the circle's today and the backend rolled the 9:00 AM one.
//
// The viewer is PINNED per block (process.env.TZ, as AddEventModal.timeFrames does), so every case runs the zone
// relation it names whatever zone the sweep runs the file under. Circle: America/New_York. Now: 12:30 there.
//   Europe/Berlin    18:30 the same day  (ahead; 1:00 PM is "past" on a bare viewer clock, still ahead in NY)
//   Asia/Tokyo       01:30 the NEXT day  (ahead, across the date line of the circle's day)
//   Pacific/Honolulu 06:30 the same day  (behind; 9:00 AM is still ahead on the viewer's clock, past in NY)

const CIRCLE_ID = 'circle-1';
const CIRCLE_ZONE = 'America/New_York';
const NOON_NY = '2026-06-15T16:30:00Z'; // 12:30 PM in New York, Monday 2026-06-15
const CIRCLE_TODAY = '2026-06-15';
const ORIGINAL_TZ = process.env.TZ;

const mutateCreate = vi.fn();
vi.mock('../DoseQuietHoursNote', () => ({ DoseQuietHoursNote: () => null }));
vi.mock('@/api/drugs', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/api/drugs')>();
  return { ...actual, searchDrugs: vi.fn().mockResolvedValue([]) };
});
vi.mock('@/hooks/useProviders', () => ({ useProviders: () => ({ providers: [], isSuccess: true }) }));
vi.mock('@/hooks/useCalendarEvents', () => ({
  useCreateEvent: () => ({ mutateAsync: mutateCreate, isPending: false }),
  useUpdateEvent: () => ({ mutateAsync: vi.fn(), isPending: false }),
  useCachedCircleEvents: () => [],
}));
vi.mock('@/hooks/useSeriesRoot', () => ({
  useSeriesRoot: (_c: string, event: unknown) => ({ root: event ?? null }),
}));
vi.mock('@/hooks/useCircle', () => ({
  useCircle: () => ({
    circle: { recipient_name: 'Rosa', is_self_care: false },
    circleSummary: undefined,
    timezone: CIRCLE_ZONE,
    members: [],
    canEdit: true,
    accessLevel: 'full',
    viewOnly: false,
    readOnly: false,
    isLoading: false,
    isError: false,
    refetch: vi.fn(),
  }),
}));
vi.mock('@/hooks/useHourCycle', () => ({ useHourCycle: () => '12h' }));
vi.mock('@/components/ui', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/components/ui')>();
  return { ...actual, useToast: () => ({ showToast: vi.fn() }) };
});

beforeEach(() => {
  vi.clearAllMocks();
  resetLargeTextReports();
  mutateCreate.mockResolvedValue({ id: 'new' });
  for (const name of [
    'entryFormOpened',
    'entryFormStepCompleted',
    'timeChipSelected',
    'entrySaveTapped',
    'medicationCreated',
    'largeTextLayout',
    'firstRunMedicationSaved',
    'doseTimeDuplicateBlocked',
  ] as const) {
    vi.spyOn(Analytics, name).mockImplementation(() => {});
  }
});
afterEach(() => {
  vi.restoreAllMocks();
  vi.useRealTimers();
});
afterAll(() => {
  process.env.TZ = ORIGINAL_TZ;
});

const chip = (name: RegExp) =>
  within(screen.getByRole('group', { name: 'Common dose times' })).getByRole('checkbox', { name });
const pastNotes = () => screen.queryAllByTestId(/^dose-past-time-note/);

async function setup(now = NOON_NY) {
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(new Date(now));
  const user = userEvent.setup();
  render(<AddEventModal circleId={CIRCLE_ID} initialType="medication" onClose={vi.fn()} />);
  await user.type(screen.getByRole('combobox', { name: /Medication name/ }), 'Metformin');
  return user;
}
/** "Other…": a time on the circle's clock (the first dose, or a new extra). */
async function other(user: ReturnType<typeof userEvent.setup>, hhmm: string) {
  await user.click(screen.getByTestId('time-chip-other'));
  fireEvent.change(screen.getByLabelText('Other time', { selector: 'input' }), { target: { value: hhmm } });
  await user.keyboard('{Escape}');
}
/** The circle (date, time) pairs the save sends, one per row, in time order. */
async function savedPairs(user: ReturnType<typeof userEvent.setup>) {
  mutateCreate.mockClear();
  await user.click(screen.getByTestId('add-event-save'));
  await waitFor(() => expect(mutateCreate).toHaveBeenCalled());
  return mutateCreate.mock.calls
    .map((c) => `${c[0].scheduled_date} ${String(c[0].scheduled_time).slice(0, 5)}`)
    .sort();
}

const VIEWERS = [
  { viewer: 'Europe/Berlin', relation: 'ahead, same day' },
  { viewer: 'Asia/Tokyo', relation: 'ahead, the next day' },
  { viewer: 'Pacific/Honolulu', relation: 'behind, same day' },
] as const;

describe.each(VIEWERS)('viewer $viewer ($relation), circle New York at 12:30', ({ viewer }) => {
  beforeAll(() => {
    process.env.TZ = viewer;
  });

  it('the viewer zone is really pinned', () => {
    expect(Intl.DateTimeFormat().resolvedOptions().timeZone).toBe(viewer);
  });

  // POSITIVE
  it('P1 an EXTRA dose past on the circle clock (Evening, then Other 9:00 AM): the note names 9:00 AM', async () => {
    const user = await setup();
    await user.click(chip(/Evening/)); // 6:00 PM New York: still ahead
    await other(user, '09:00');
    expect(pastNotes()).toHaveLength(1);
    expect(screen.getByTestId('dose-past-time-note')).toHaveTextContent(
      'Starts with the next dose. 9:00 AM has already passed today.'
    );
    // The note speaks for what the save sends: both rows on the circle's today (the backend then rolls 9:00 AM).
    expect(await savedPairs(user)).toEqual([`${CIRCLE_TODAY} 09:00`, `${CIRCLE_TODAY} 18:00`]);
  });

  it('P2 the FIRST dose past on the circle clock (Other 9:00 AM alone): the note shows', async () => {
    const user = await setup();
    await other(user, '09:00');
    expect(pastNotes()).toHaveLength(1);
    expect(screen.getByTestId('dose-past-time-note')).toHaveTextContent('Starts with the next dose.');
  });

  it('P3 two past extras and a future first dose: ONE note, both past times in order', async () => {
    const user = await setup();
    await user.click(chip(/Evening/));
    await other(user, '09:00');
    await user.click(chip(/Morning/));
    expect(pastNotes()).toHaveLength(1);
    expect(screen.getByTestId('dose-past-time-note')).toHaveTextContent(
      'Starts with the next dose. 8:00 AM and 9:00 AM have already passed today.'
    );
  });

  // NEGATIVE
  it('N1 a time still ahead on the circle clock (1:00 PM, NY is at 12:30): no note, first dose or extra', async () => {
    // On a Berlin viewer's bare clock (18:30) 1:00 PM has "passed"; in New York it has not.
    const user = await setup();
    await other(user, '13:00');
    expect(pastNotes()).toHaveLength(0);
    await user.click(chip(/Evening/)); // an extra ahead too
    expect(pastNotes()).toHaveLength(0);
    expect(await savedPairs(user)).toEqual([`${CIRCLE_TODAY} 13:00`, `${CIRCLE_TODAY} 18:00`]);
  });

  it('N2 doses on ANOTHER circle day (Starts 2026-06-17): no note even for 8:00 / 9:00 AM', async () => {
    const user = await setup();
    fireEvent.change(screen.getByLabelText(/^Starts/), { target: { value: '2026-06-17' } });
    await user.click(chip(/Evening/));
    await other(user, '09:00');
    await user.click(chip(/Morning/));
    expect(pastNotes()).toHaveLength(0);
    const pairs = await savedPairs(user);
    expect(pairs).toHaveLength(3);
    for (const pair of pairs) expect(pair.startsWith(CIRCLE_TODAY)).toBe(false);
  });
});

describe('the reverse relation: past on the circle clock, still AHEAD on the viewer clock', () => {
  beforeAll(() => {
    process.env.TZ = 'Pacific/Honolulu';
  });

  it('R1 Honolulu at 06:30, New York at 12:30: 9:00 AM (an extra) shows the note', async () => {
    const user = await setup();
    await user.click(chip(/Bedtime/));
    await other(user, '09:00'); // 9:00 AM is still 2.5 h away on the viewer's own clock
    expect(screen.getByTestId('dose-past-time-note')).toHaveTextContent(
      'Starts with the next dose. 9:00 AM has already passed today.'
    );
  });

  it('R2 Honolulu at 06:30, New York at 12:30: 12:45 PM (ahead in NY, ahead on the viewer clock) shows nothing', async () => {
    const user = await setup();
    await user.click(chip(/Bedtime/));
    await other(user, '12:45');
    expect(pastNotes()).toHaveLength(0);
  });
});

describe("the circle's day turned, the viewer's did not (Tokyo viewer, New York just past midnight)", () => {
  beforeAll(() => {
    process.env.TZ = 'Asia/Tokyo';
  });

  it("N3 New York 00:30 Tuesday (Tokyo 13:30 Tuesday): 9:00 AM is AHEAD on the circle's new day, no note", async () => {
    const user = await setup('2026-06-16T04:30:00Z');
    await user.click(chip(/Bedtime/));
    await other(user, '09:00');
    await user.click(chip(/Morning/));
    expect(pastNotes()).toHaveLength(0);
  });
});
