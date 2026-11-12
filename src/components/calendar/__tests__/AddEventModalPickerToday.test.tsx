import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import '@/i18n';
import type { CalendarEvent } from '@/api/calendarEvents';
import { getDateInTimezone, getDeviceTimezone } from '@/utils/timezone';
import { AddEventModal } from '../AddEventModal';

/**
 * The date picker's "Today" in AddEventModal is the RECIPIENT's today, timed or not: the simple form's
 * Starts tile shows the circle's calendar.
 *
 * The recipient zone is picked at runtime to sit on a different calendar day
 * from the device (process) zone, so both cases discriminate from any TZ.
 */

vi.mock('../DoseQuietHoursNote', () => ({ DoseQuietHoursNote: () => null }));
vi.mock('@/api/drugs', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/api/drugs')>();
  return { ...actual, searchDrugs: vi.fn().mockResolvedValue([]) };
});
vi.mock('@/hooks/useProviders', () => ({
  useProviders: () => ({ providers: [], isSuccess: true }),
}));
vi.mock('@/hooks/useCalendarEvents', () => ({
  useCreateEvent: () => ({ mutateAsync: vi.fn(), isPending: false }),
  useUpdateEvent: () => ({ mutateAsync: vi.fn(), isPending: false }),
  useCachedCircleEvents: () => [] as CalendarEvent[],
}));
vi.mock('@/hooks/useSeriesRoot', () => ({
  useSeriesRoot: (_c: string, event: CalendarEvent | null | undefined) => ({ root: event ?? null }),
}));

const NOW = new Date('2026-10-28T03:00:00Z');
const CANDIDATES = ['Australia/Sydney', 'America/Denver', 'Pacific/Kiritimati', 'Pacific/Midway'];
const deviceToday = () => getDateInTimezone(getDeviceTimezone(), NOW);
const RECIPIENT = { zone: 'UTC' };

const useCircleResult = {
  circle: undefined as undefined,
  circleSummary: undefined,
  get timezone() {
    return RECIPIENT.zone;
  },
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
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(NOW);
  const zone = CANDIDATES.find((z) => getDateInTimezone(z, NOW) !== deviceToday());
  if (!zone) throw new Error('no candidate zone on a different day');
  RECIPIENT.zone = zone;
});
afterEach(() => {
  vi.useRealTimers();
});

async function ringedAfterOpening(user: ReturnType<typeof userEvent.setup>): Promise<string | null> {
  await user.click(screen.getByTestId('starts-tile'));
  await screen.findByRole('dialog', { name: 'Date picker' });
  return document.querySelector('[aria-current="date"]')?.getAttribute('data-day') ?? null;
}

describe('AddEventModal date picker "Today"', () => {
  it('untimed task: rings the RECIPIENT today', async () => {
    const user = userEvent.setup({ advanceTimers: () => undefined });
    render(<AddEventModal circleId="c" initialType="task" onClose={vi.fn()} />);
    expect(await ringedAfterOpening(user)).toBe(getDateInTimezone(RECIPIENT.zone, NOW));
  });

  it('timed task: the Starts tile is the recipient calendar too, so Today is the RECIPIENT today', async () => {
    const user = userEvent.setup({ advanceTimers: () => undefined });
    render(
      <AddEventModal circleId="c" initialType="task" onClose={vi.fn()} />
    );
    expect(await ringedAfterOpening(user)).toBe(getDateInTimezone(RECIPIENT.zone, NOW));
    expect(getDateInTimezone(RECIPIENT.zone, NOW)).not.toBe(deviceToday());
  });
});
