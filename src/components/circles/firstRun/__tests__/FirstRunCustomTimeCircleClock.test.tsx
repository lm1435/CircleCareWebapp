import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import '@/i18n';
import { Analytics } from '@/lib/analytics';
import { resetLargeTextReports } from '@/lib/largeText';
import { queryClient } from '@/lib/queryClient';
import { searchDrugs } from '@/api/drugs';
import { AddEventModal } from '@/components/calendar/AddEventModal';

// Onboarding 1.3.1: the simple medication form in FIRST-RUN MODE (heading, hint, Skip for now,
// what it hands back on save), the med_name_suggestion_outcome event, and the Today "Mark it"
// note the add-menu path writes. The form's payload/validation have their own suites.


const mutateCreate = vi.fn();
vi.mock('@/components/calendar/DoseQuietHoursNote', () => ({ DoseQuietHoursNote: () => null }));
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


// FIRST-RUN WIZARD CUSTOM TIME ON THE CIRCLE'S CLOCK (owner 2026-11-11). The ambient (browser) zone comes from the
// shell: `TZ=<zone> npx vitest run <this file>`; the circle's zone is per case. A custom time typed under "Other..."
// in the wizard means that clock in the CIRCLE's zone: saved scheduled_time === typed, scheduled_date === the circle's
// day (today there, rolled to the next day when that time has passed).
const CIRCLE_ID = 'circle-1';
let mockNow = new Date();
interface Case { name: string; zone: string; now: string; typed: string; date: string; time?: string }
const CASES: Case[] = [
  // 2026-11-11 20:00Z = Tokyo 11-12 05:00 (browser Denver 11-11 13:00)
  { name: 'tokyo later today', zone: 'Asia/Tokyo', now: '2026-11-11T20:00:00Z', typed: '09:30', date: '2026-11-12' },
  { name: 'tokyo already passed -> tomorrow', zone: 'Asia/Tokyo', now: '2026-11-11T20:00:00Z', typed: '03:00', date: '2026-11-12' },
  // Kiritimati +14: 2026-11-11 20:00Z = 11-12 10:00
  { name: 'kiritimati later today', zone: 'Pacific/Kiritimati', now: '2026-11-11T20:00:00Z', typed: '15:00', date: '2026-11-12' },
  { name: 'kiritimati passed -> tomorrow', zone: 'Pacific/Kiritimati', now: '2026-11-11T20:00:00Z', typed: '06:00', date: '2026-11-12' },
  { name: 'same zone Denver', zone: 'America/Denver', now: '2026-11-11T20:00:00Z', typed: '14:30', date: '2026-11-11' },
  // Denver falls back 2026-11-01; 2026-10-31 12:00Z = 06:00 MDT on 10-31
  { name: 'denver repeated hour', zone: 'America/Denver', now: '2026-10-31T12:00:00Z', typed: '01:30', date: '2026-10-31' },
  // Denver springs forward 2026-03-08 (02:30 does not exist); 03-07 20:00Z = 13:00 MST
  { name: 'denver gap 02:30', zone: 'America/Denver', now: '2026-03-07T20:00:00Z', typed: '02:30', date: '2026-03-07' },
  // Auckland falls back 2026-04-05 (02:00-02:59 twice); 04-04 00:00Z = 13:00 NZDT on 04-04
  { name: 'auckland repeated 02:30', zone: 'Pacific/Auckland', now: '2026-04-04T00:00:00Z', typed: '02:30', date: '2026-04-04' },
];

beforeEach(() => {
  vi.clearAllMocks();
  resetLargeTextReports();
  window.localStorage.clear();
  queryClient.clear();
  mutateCreate.mockResolvedValue({ id: 'ev-1' });
  vi.mocked(searchDrugs).mockResolvedValue([]);
  for (const n of ['medNameSuggestionOutcome','firstRunMedicationSaved','medicationCreated','entryFormOpened','entryFormStepCompleted','timeChipSelected','entrySaveTapped','largeTextLayout'] as const) {
    vi.spyOn(Analytics, n).mockImplementation(() => {});
  }
});
afterEach(() => {
  vi.restoreAllMocks();
  vi.useRealTimers();
});

describe('first-run wizard: a custom time is the circle clock', () => {
  it.each(CASES)('$name', async (c) => {
    mockNow = new Date(c.now);
    useCircleResult.timezone = c.zone;
    vi.useFakeTimers({ toFake: ['Date'], now: mockNow });
    render(<AddEventModal circleId={CIRCLE_ID} initialType="medication" firstRun onClose={vi.fn()} onSaved={vi.fn()} />);
    const u = userEvent.setup();
    await u.type(screen.getByRole('combobox', { name: /^Medication name/ }), 'Metformin');
    await u.click(screen.getByTestId('time-chip-other'));
    fireEvent.change(screen.getByLabelText('Other time', { selector: 'input' }), { target: { value: c.typed } });
    await u.click(screen.getByTestId('add-event-save'));
    await waitFor(() => expect(mutateCreate).toHaveBeenCalled());
    const sent = mutateCreate.mock.calls[0][0];
    expect({ date: sent.scheduled_date, time: sent.scheduled_time }).toEqual({ date: c.date, time: c.time ?? c.typed });
  });
});
