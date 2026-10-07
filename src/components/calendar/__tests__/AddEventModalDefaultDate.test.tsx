import { act, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import '@/i18n';
import type { CalendarEvent } from '@/api/calendarEvents';
import { AddEventModal } from '../AddEventModal';

/**
 * A NEW event defaults its date to the CARE RECIPIENT's "today".
 *
 * User-approved 2026-10-01. The default used to be the VIEWER's today, so a
 * caregiver 25 hours behind their recipient (Midway -> Kiritimati) got a
 * date-only task one day before the recipient's today.
 *
 * The VIEWER zone is set per case through `process.env.TZ` (this file's sibling
 * AddEventModal.test.tsx relies on the same thing) and the clock is pinned, so
 * each pair is on distinct calendar days. The default must not depend on the
 * viewer at all - that is the property under test.
 */

const ORIGINAL_TZ = process.env.TZ;
afterAll(() => {
  process.env.TZ = ORIGINAL_TZ;
  vi.useRealTimers();
});

const CIRCLE_ID = 'circle-1';
const mutateCreate = vi.fn();

// The quiet-hours note reads the current user over React Query; these suites have no
// QueryClient and are not about it (see DoseQuietHoursNote.test.tsx).
vi.mock('../DoseQuietHoursNote', () => ({ DoseQuietHoursNote: () => null }));
vi.mock('@/api/drugs', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/api/drugs')>();
  return { ...actual, searchDrugs: vi.fn().mockResolvedValue([]) };
});

vi.mock('@/hooks/useCalendarEvents', () => ({
  useCreateEvent: () => ({ mutateAsync: mutateCreate, isPending: false }),
  useUpdateEvent: () => ({ mutateAsync: vi.fn(), isPending: false }),
  useCachedCircleEvents: () => [] as CalendarEvent[],
}));

vi.mock('@/hooks/useSeriesRoot', () => ({
  useSeriesRoot: (_c: string, event: CalendarEvent | null | undefined) => ({ root: event ?? null }),
}));

const useCircleResult = {
  circle: undefined as undefined,
  circleSummary: undefined,
  timezone: 'America/Denver' as string | null,
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

const showToast = vi.fn();
vi.mock('@/components/ui', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/components/ui')>();
  return { ...actual, useToast: () => ({ showToast }) };
});

function setWorld(viewer: string, recipient: string | null, clock: string) {
  process.env.TZ = viewer;
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(new Date(clock));
  useCircleResult.timezone = recipient;
  useCircleResult.canEdit = recipient !== null;
  useCircleResult.isLoading = recipient === null;
}

beforeEach(() => {
  vi.clearAllMocks();
  mutateCreate.mockResolvedValue({ id: 'x' });
});

const dateInput = () => screen.getByLabelText(/^Date/) as HTMLInputElement;

// [label, viewer zone, recipient zone, clock, expected recipient today]
const PAIRS: Array<[string, string, string, string, string]> = [
  ['Midway viewer -> Kiritimati recipient', 'Pacific/Midway', 'Pacific/Kiritimati', '2026-09-30T23:30:00Z', '2026-10-01'],
  ['Kiritimati viewer -> Midway recipient', 'Pacific/Kiritimati', 'Pacific/Midway', '2026-10-01T10:30:00Z', '2026-09-30'],
  ['Tokyo viewer -> Denver recipient', 'Asia/Tokyo', 'America/Denver', '2026-10-01T10:30:00Z', '2026-10-01'],
  ['Denver viewer -> Tokyo recipient', 'America/Denver', 'Asia/Tokyo', '2026-09-30T23:30:00Z', '2026-10-01'],
  ['Denver viewer -> Denver recipient (same-zone control)', 'America/Denver', 'America/Denver', '2026-10-01T10:30:00Z', '2026-10-01'],
];

describe('AddEventModal - a NEW event defaults to the recipient\'s today', () => {
  it.each(PAIRS)('%s', async (_l, viewer, recipient, clock, expected) => {
    setWorld(viewer, recipient, clock);
    render(<AddEventModal circleId={CIRCLE_ID} initialType="task" onClose={vi.fn()} />);
    expect(dateInput().value).toBe(expected);
  });

  it('a date-only task SAVES on the recipient\'s today (Midway viewer, Kiritimati recipient)', async () => {
    setWorld('Pacific/Midway', 'Pacific/Kiritimati', '2026-09-30T23:30:00Z');
    const user = userEvent.setup({ advanceTimers: () => undefined });
    render(<AddEventModal circleId={CIRCLE_ID} initialType="task" onClose={vi.fn()} />);
    await user.type(screen.getByLabelText(/^Title( \* \(required\))?$/), 'Water plants');
    await user.click(screen.getByRole('button', { name: 'Create' }));
    await waitFor(() => expect(mutateCreate).toHaveBeenCalledTimes(1));
    expect(mutateCreate.mock.calls[0][0].scheduled_date).toBe('2026-10-01');
  });

  it('while the zone is loading: nothing is rendered (no wrong day), then the recipient day appears', () => {
    setWorld('Pacific/Midway', null, '2026-09-30T23:30:00Z');
    const { rerender, container } = render(
      <AddEventModal circleId={CIRCLE_ID} initialType="task" onClose={vi.fn()} />
    );
    expect(container).toBeEmptyDOMElement();
    expect(screen.queryByLabelText(/^Date/)).toBeNull();

    useCircleResult.timezone = 'Pacific/Kiritimati';
    useCircleResult.canEdit = true;
    useCircleResult.isLoading = false;
    act(() => {
      rerender(<AddEventModal circleId={CIRCLE_ID} initialType="task" onClose={vi.fn()} />);
    });
    expect(dateInput().value).toBe('2026-10-01');
  });

  it('a date the user typed is not overwritten when the zone changes afterwards', async () => {
    setWorld('Asia/Tokyo', 'America/Denver', '2026-10-01T10:30:00Z');
    const user = userEvent.setup({ advanceTimers: () => undefined });
    const { rerender } = render(
      <AddEventModal circleId={CIRCLE_ID} initialType="task" onClose={vi.fn()} />
    );
    await user.clear(dateInput());
    await user.type(dateInput(), '2026-10-15');
    useCircleResult.timezone = 'Pacific/Kiritimati';
    rerender(<AddEventModal circleId={CIRCLE_ID} initialType="task" onClose={vi.fn()} />);
    expect(dateInput().value).toBe('2026-10-15');
  });
});
