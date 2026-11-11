import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import '@/i18n';
import { Analytics } from '@/lib/analytics';
import { resetLargeTextReports } from '@/lib/largeText';
import { AddEventModal } from '../AddEventModal';

// WEB PARITY for mobile's "extra dose custom time on the circle's clock": a NEW medication's second dose, picked
// through "Other…" (or its custom chip), is typed on the CARE RECIPIENT's clock like the primary's, and saves that
// HH:MM on the primary's circle day. Viewer Denver, circle Tokyo.

const VIEWER_TZ = 'America/Denver';
const ORIGINAL_TZ = process.env.TZ;
beforeAll(() => {
  process.env.TZ = VIEWER_TZ;
});
afterAll(() => {
  process.env.TZ = ORIGINAL_TZ;
});

const NOW = new Date('2026-11-01T18:40:00Z');
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
  circle: { recipient_name: 'Rosa', is_self_care: false } as
    | { recipient_name?: string; is_self_care?: boolean }
    | undefined,
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
  vi.useFakeTimers({ toFake: ['Date'], now: NOW });
  mutateCreate.mockResolvedValue({ id: 'new' });
  mutateUpdate.mockResolvedValue({ id: 'ev-1' });
  for (const name of [
    'entryFormOpened',
    'entryFormStepCompleted',
    'timeChipSelected',
    'entrySaveTapped',
    'medicationCreated',
    'largeTextLayout',
    'firstRunMedicationSaved',
  ] as const) {
    vi.spyOn(Analytics, name).mockImplementation(() => {});
  }
});
afterEach(() => {
  vi.restoreAllMocks();
  vi.useRealTimers();
});


async function setup(zone: string, day: string) {
  useCircleResult.timezone = zone;
  const user = userEvent.setup();
  render(<AddEventModal circleId={CIRCLE_ID} initialType="medication" onClose={vi.fn()} />);
  await user.type(screen.getByRole('combobox', { name: /Medication name/ }), 'Metformin');
  fireEvent.change(screen.getByLabelText(/^Starts/), { target: { value: day } });
  await user.click(screen.getByRole('checkbox', { name: /Morning$/ }));
  return user;
}
async function saveAll(user: ReturnType<typeof userEvent.setup>) {
  mutateCreate.mockClear();
  await user.click(screen.getByTestId('add-event-save'));
  await waitFor(() => expect(mutateCreate).toHaveBeenCalled());
  return mutateCreate.mock.calls
    .map((c) => ({ date: String(c[0].scheduled_date), time: String(c[0].scheduled_time).slice(0, 5) }))
    .sort((a, b) => a.time.localeCompare(b.time));
}

describe.each([
  ['Asia/Tokyo', '2027-02-10'],
  ['Pacific/Kiritimati', '2027-02-10'],
  [VIEWER_TZ, '2027-02-10'],
])('viewer Denver, circle %s: an extra dose picked through "Other…"', (zone, day) => {
  it('is entered on the circle clock: saves the circle 14:00 on the primary circle day, chip names 2:00 PM', async () => {
    const user = await setup(zone, day);
    await user.click(screen.getByTestId('time-chip-other'));
    fireEvent.change(screen.getByLabelText('Other time', { selector: 'input' }), { target: { value: '14:00' } });
    expect(screen.getByTestId('time-chip-custom')).toHaveTextContent(/^2:00 PM\s*Other$/);
    expect(await saveAll(user)).toEqual([
      { date: day, time: '08:00' },
      { date: day, time: '14:00' },
    ]);
  });

  it('editing the custom extra in place opens on its circle clock and saves the new circle clock', async () => {
    const user = await setup(zone, day);
    await user.click(screen.getByTestId('time-chip-other'));
    fireEvent.change(screen.getByLabelText('Other time', { selector: 'input' }), { target: { value: '14:00' } });
    const change = screen.getByLabelText('Change 2:00 PM dose time', { selector: 'input' });
    expect(change).toHaveValue('14:00');
    fireEvent.change(change, { target: { value: '16:30' } });
    expect(await saveAll(user)).toEqual([
      { date: day, time: '08:00' },
      { date: day, time: '16:30' },
    ]);
  });
});
