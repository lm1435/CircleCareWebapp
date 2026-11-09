import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import '@/i18n';
import type { CalendarEvent } from '@/api/calendarEvents';
import { Analytics } from '@/lib/analytics';
import { resetLargeTextReports } from '@/lib/largeText';
import { AddEventModal } from '../AddEventModal';

// A STORED RULE THE REPEAT CONTROL HAS NO OPTION FOR (sweep 2026-11-08). A phone-calendar import writes
// `custom:N` (mobile's `mapExpoRecurrenceToCircleCare`: a fortnightly appointment arrives as `custom:14`). The
// web form parsed it to "none", so the edit form LIT "Once" (and the full layout's Repeat select read "Never")
// on a series that repeats every 14 days. Mobile lights no tile and names the rule under the grid
// (AddEventScreen `how-often-summary`); web does the same now. What is SAVED is unchanged: an untouched save
// still leaves the rule alone (the payload-equality suites pin that too).

const VIEWER_TZ = 'America/Denver';
const ORIGINAL_TZ = process.env.TZ;
beforeAll(() => {
  process.env.TZ = VIEWER_TZ;
});
afterAll(() => {
  process.env.TZ = ORIGINAL_TZ;
});

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
  mutateUpdate.mockResolvedValue({ id: 'e-1' });
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

function row(over: Partial<CalendarEvent>): CalendarEvent {
  return {
    id: 'e-1',
    circle_id: CIRCLE_ID,
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
    scheduled_date: '2027-02-15',
    scheduled_time: '10:00:00',
    recurrence_rule: 'custom:14',
    ...over,
  } as CalendarEvent;
}

const ROWS: Array<[string, CalendarEvent]> = [
  ['task', row({ event_type: 'task', title: 'Water the plants' })],
  ['appointment', row({ event_type: 'appointment', title: 'Cardiology', duration_minutes: 30 })],
  [
    'medication',
    row({
      event_type: 'medication',
      title: 'Lisinopril',
      medication_name: 'Lisinopril',
      medication_dosage: '10 mg',
      scheduled_time: '08:00:00',
    }),
  ],
];

function checkedRepeatTiles(): string[] {
  return screen
    .queryAllByRole('radio')
    .filter((r) => r.getAttribute('aria-checked') === 'true')
    .map((r) => r.textContent ?? '')
    .filter((label) => /^(Once|Every day|Every week|Every other day|Days on \/ off|Some days|Monthly|Yearly)$/.test(label.trim()));
}

describe('an imported custom:14 series in the edit form', () => {
  it.each(ROWS)('%s (simple form): no repeat tile is lit and the rule is named under the grid', async (_kind, event) => {
    render(<AddEventModal circleId={CIRCLE_ID} event={event} onClose={vi.fn()} />);
    expect(await screen.findByTestId('how-often-summary')).toHaveTextContent('Every 14 days');
    expect(checkedRepeatTiles()).toEqual([]);
  });

  it.each(ROWS)('%s (simple form): an untouched save still leaves the rule alone', async (_kind, event) => {
    const user = userEvent.setup();
    render(<AddEventModal circleId={CIRCLE_ID} event={event} onClose={vi.fn()} />);
    await screen.findByTestId('how-often-summary');
    await user.click(screen.getByTestId('add-event-save'));
    await waitFor(() => expect(mutateUpdate).toHaveBeenCalledTimes(1));
    const body = JSON.parse(JSON.stringify(mutateUpdate.mock.calls[0][0]));
    const data = body.data ?? body;
    expect(data).not.toHaveProperty('recurrence_rule');
  });

  it('choosing a tile replaces the name (the user now owns the answer)', async () => {
    const user = userEvent.setup();
    render(<AddEventModal circleId={CIRCLE_ID} event={ROWS[0][1]} onClose={vi.fn()} />);
    await screen.findByTestId('how-often-summary');
    await user.click(screen.getByRole('radio', { name: 'Every week' }));
    expect(screen.queryByTestId('how-often-summary')).toBeNull();
    expect(checkedRepeatTiles()).toEqual(['Every week']);
  });

  it('full layout: the Repeat select names the stored rule instead of reading "Never"', async () => {
    const user = userEvent.setup();
    render(<AddEventModal circleId={CIRCLE_ID} event={ROWS[0][1]} layout="full" onClose={vi.fn()} />);
    const select = (await screen.findByLabelText(/^Repeat/)) as HTMLSelectElement;
    expect(select.selectedOptions[0]?.textContent).toBe('Every 14 days');
    // Untouched save: the rule is left alone.
    await user.click(screen.getByTestId('add-event-save'));
    await waitFor(() => expect(mutateUpdate).toHaveBeenCalledTimes(1));
    const body = JSON.parse(JSON.stringify(mutateUpdate.mock.calls[0][0]));
    expect(body.data ?? body).not.toHaveProperty('recurrence_rule');
  });

  it('full layout: picking another option is saved as that option', async () => {
    const user = userEvent.setup();
    render(<AddEventModal circleId={CIRCLE_ID} event={ROWS[0][1]} layout="full" onClose={vi.fn()} />);
    const select = (await screen.findByLabelText(/^Repeat/)) as HTMLSelectElement;
    await user.selectOptions(select, 'weekly');
    expect(select.value).toBe('weekly');
    await user.click(screen.getByTestId('add-event-save'));
    await waitFor(() => expect(mutateUpdate).toHaveBeenCalledTimes(1));
    const body = JSON.parse(JSON.stringify(mutateUpdate.mock.calls[0][0]));
    expect((body.data ?? body).recurrence_rule).toBe('weekly');
  });
});
