// The History tab's list.
//
// TIME IS PINNED TWO WAYS, because every assertion here is date-sensitive and
// the suite runs in several zones (npm run test:timezones):
//  - the system clock is frozen with `vi.setSystemTime`, so "Today" and
//    "Yesterday" mean one thing;
//  - `Intl.resolvedOptions` is spied to the CIRCLE's zone, so the rendered
//    times carry no zone suffix (that suffix only appears when the viewer is
//    somewhere else). One test deliberately un-pins it to prove the grouping
//    follows the recipient rather than the device.

import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import '@/i18n';
import { HistoryList } from '../HistoryList';
import type { HistoryConfirmation } from '../historyQuery';

const mockUseMedicationConfirmations = vi.fn();
vi.mock('@/hooks/useMedConfirmation', () => ({
  useMedicationConfirmations: (circleId: string, params: unknown) =>
    mockUseMedicationConfirmations(circleId, params),
}));

const mockUseHourCycle = vi.fn();
vi.mock('@/hooks/useHourCycle', () => ({
  useHourCycle: () => mockUseHourCycle(),
}));

const TZ = 'America/Denver';
// 2026-09-05T18:00:00Z = 12:00 PM MDT → "today" in the circle's zone is
// 2026-09-05 (a Saturday).
const NOW = new Date('2026-09-05T18:00:00Z');

function makeConfirmation(overrides: Partial<HistoryConfirmation> = {}): HistoryConfirmation {
  return {
    id: 'conf-1',
    event_id: 'evt-1',
    circle_id: 'circle-1',
    confirmed_by: 'u1',
    confirmed_at: '2026-09-05T14:12:00Z', // 08:12 MDT
    status: 'taken',
    scheduled_time: '08:00:00',
    confirmed_by_user: { email: 'ana@example.com', first_name: 'Ana', last_name: 'Ruiz' },
    event: {
      id: 'evt-1',
      title: 'Metformin',
      medication_name: 'Metformin',
      medication_dosage: '500 mg',
      scheduled_date: '2026-09-05',
    },
    ...overrides,
  };
}

const TAKEN_TODAY = makeConfirmation();
const MISSED_YESTERDAY = makeConfirmation({
  id: 'conf-2',
  event_id: 'evt-2',
  status: 'missed',
  scheduled_time: '20:00:00',
  confirmed_at: '2026-09-05T04:00:00Z', // 22:00 MDT on the 4th
  event: {
    id: 'evt-2',
    title: 'Warfarin',
    medication_name: 'Warfarin',
    medication_dosage: '5 mg',
    scheduled_date: '2026-09-04',
  },
});
const SKIPPED_EARLIER = makeConfirmation({
  id: 'conf-3',
  event_id: 'evt-3',
  status: 'skipped',
  scheduled_time: '09:00:00',
  confirmed_at: '2026-09-01T15:30:00Z',
  confirmed_by_user: { email: 'sam@example.com', first_name: null, last_name: null },
  event: {
    id: 'evt-3',
    title: 'Atorvastatin',
    medication_name: 'Atorvastatin',
    medication_dosage: null,
    scheduled_date: '2026-09-01',
  },
});

const fetchNextPage = vi.fn();

function mockPage(confirmations: HistoryConfirmation[], overrides: Record<string, unknown> = {}) {
  mockUseMedicationConfirmations.mockReturnValue({
    data: { confirmations, hasMore: false },
    isPending: false,
    isError: false,
    hasNextPage: false,
    isFetchingNextPage: false,
    fetchNextPage,
    refetch: vi.fn(),
    ...overrides,
  });
}

function renderList(medicationName: string | null = null) {
  return render(
    <HistoryList circleId="circle-1" timezone={TZ} medicationName={medicationName} />
  );
}

/** The card holding a given medication's row. */
function card(medication: string): HTMLElement {
  const item = screen.getByText(medication).closest('li');
  if (!item) throw new Error(`card for ${medication} not found`);
  return item;
}

beforeEach(() => {
  vi.clearAllMocks();
  fetchNextPage.mockClear();
  vi.useFakeTimers({ toFake: ['Date'], now: NOW });
  vi.spyOn(Intl.DateTimeFormat.prototype, 'resolvedOptions').mockReturnValue({
    timeZone: TZ,
  } as Intl.ResolvedDateTimeFormatOptions);
  mockUseHourCycle.mockReturnValue('12h');
});

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe('HistoryList', () => {
  it('groups by day, newest first, with relative titles for today and yesterday', () => {
    mockPage([SKIPPED_EARLIER, TAKEN_TODAY, MISSED_YESTERDAY]);
    renderList();

    const headings = screen.getAllByRole('heading', { level: 3 }).map((h) => h.textContent);
    expect(headings[0]).toBe('Today');
    expect(headings[1]).toBe('Yesterday');
    expect(headings[2]).toMatch(/September 1/);
    // Not the relative words for a day that is neither.
    expect(headings[2]).not.toMatch(/Today|Yesterday/);
  });

  // The three recorded outcomes, each in its own pill. Mobile lumps `skipped`
  // in with `missed` and calls both "Missed"; a caregiver who deliberately
  // skipped a dose (doctor's instruction, illness) is not the same record as
  // one nobody answered, and the clinician-facing report counts them apart.
  it('gives taken, missed and skipped their own pills', () => {
    mockPage([TAKEN_TODAY, MISSED_YESTERDAY, SKIPPED_EARLIER]);
    renderList();

    expect(within(card('Metformin')).getByText('Taken')).toBeInTheDocument();
    expect(within(card('Warfarin')).getByText('Missed')).toBeInTheDocument();
    expect(within(card('Atorvastatin')).getByText('Skipped')).toBeInTheDocument();
  });

  it('counts a late dose as taken', () => {
    mockPage([makeConfirmation({ status: 'taken_late' })]);
    renderList();

    expect(within(card('Metformin')).getByText('Taken')).toBeInTheDocument();
  });

  it('renders the scheduled and taken-at times in the circle timezone', () => {
    mockPage([TAKEN_TODAY]);
    renderList();

    const row = card('Metformin');
    expect(within(row).getByText('Scheduled')).toBeInTheDocument();
    expect(within(row).getByText('8:00 AM')).toBeInTheDocument();
    // 14:12Z is 08:12 in Denver — the instant read in the RECIPIENT's frame.
    expect(within(row).getByText('Taken at')).toBeInTheDocument();
    expect(within(row).getByText('8:12 AM')).toBeInTheDocument();
    expect(within(row).getByText('500 mg')).toBeInTheDocument();
  });

  it('follows the viewer’s 24h clock', () => {
    mockUseHourCycle.mockReturnValue('24h');
    mockPage([TAKEN_TODAY]);
    renderList();

    const row = card('Metformin');
    expect(within(row).getByText('08:00')).toBeInTheDocument();
    expect(within(row).getByText('08:12')).toBeInTheDocument();
  });

  // A dose nobody took has no "taken at". The column stays so every card is
  // the same shape, and says nothing rather than passing the confirmation
  // instant off as a dose time — that instant is when the CRON gave up.
  it('leaves the taken-at column empty for a missed dose', () => {
    mockPage([MISSED_YESTERDAY]);
    renderList();

    const row = card('Warfarin');
    expect(within(row).getByText('8:00 PM')).toBeInTheDocument();
    expect(within(row).getByText('—')).toBeInTheDocument();
    expect(within(row).queryByText('10:00 PM')).toBeNull();
  });

  it('names who confirmed, falling back to the email local part and then to Someone', () => {
    mockPage([
      TAKEN_TODAY,
      SKIPPED_EARLIER,
      makeConfirmation({
        id: 'conf-4',
        confirmed_by_user: null,
        event: { id: 'evt-4', medication_name: 'Aspirin', scheduled_date: '2026-09-05' },
      }),
    ]);
    renderList();

    expect(within(card('Metformin')).getByText('Ana Ruiz')).toBeInTheDocument();
    expect(within(card('Atorvastatin')).getByText('sam')).toBeInTheDocument();
    expect(within(card('Aspirin')).getByText('Someone')).toBeInTheDocument();
  });

  it('asks for the last 30 days in the circle timezone', () => {
    mockPage([]);
    renderList();

    // The WINDOW only — paging is the hook's job, and the window is the query
    // key, so the page's copy of this query and the list's share one entry.
    expect(mockUseMedicationConfirmations).toHaveBeenCalledWith('circle-1', {
      start_date: '2026-08-07',
      end_date: '2026-09-05',
    });
  });

  // THE GROUPING IS THE RECIPIENT'S, NOT THE VIEWER'S. A dose confirmed at
  // 22:00 in Denver is already the NEXT day in London; a caregiver abroad must
  // still see it filed under the day the care recipient lived it.
  it('groups in the circle timezone even when the viewer is elsewhere', () => {
    vi.spyOn(Intl.DateTimeFormat.prototype, 'resolvedOptions').mockReturnValue({
      timeZone: 'Europe/London',
    } as Intl.ResolvedDateTimeFormatOptions);
    // No `scheduled_date` on the join, so the day has to be derived from the
    // instant — the path where a device-local read would show.
    mockPage([
      makeConfirmation({
        id: 'conf-5',
        confirmed_at: '2026-09-05T04:00:00Z', // 22:00 MDT Sept 4 / 05:00 BST Sept 5
        event: { id: 'evt-5', medication_name: 'Warfarin' },
      }),
    ]);
    renderList();

    expect(screen.getAllByRole('heading', { level: 3 })[0]).toHaveTextContent('Yesterday');
  });

  it('narrows to one medication when the filter names it', () => {
    mockPage([TAKEN_TODAY, MISSED_YESTERDAY]);
    renderList('Warfarin');

    expect(screen.getByText('Warfarin')).toBeInTheDocument();
    expect(screen.queryByText('Metformin')).toBeNull();
  });

  it('shows the empty state when nothing has been recorded', () => {
    mockPage([]);
    renderList();

    expect(screen.getByText('No medication history')).toBeInTheDocument();
    expect(
      screen.getByText('Medication confirmations will appear here once recorded')
    ).toBeInTheDocument();
  });

  it('shows the empty state when the filter matches nothing', () => {
    mockPage([TAKEN_TODAY]);
    renderList('Warfarin');

    expect(screen.getByText('No medication history')).toBeInTheDocument();
  });

  it('offers a retry when the fetch failed', () => {
    mockPage([], { isError: true, data: undefined });
    renderList();

    expect(screen.getByText("Couldn't load medication history")).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Retry' })).toBeInTheDocument();
  });

  it('announces itself as busy while loading', () => {
    mockPage([], { isPending: true, data: undefined });
    renderList();

    expect(screen.getByText('Loading history…')).toBeInTheDocument();
  });

  // THE LIST PAGES. Without this the "last 30 days" stopped at the first page
  // and said nothing about it — a fortnight of a five-medication circle's
  // history simply did not exist on web.
  describe('paging', () => {
    it('offers Load more only while another page exists', () => {
      const { unmount } = renderList();
      expect(screen.queryByRole('button', { name: 'Load more' })).toBeNull();
      unmount();

      mockPage([TAKEN_TODAY], { hasNextPage: true });
      renderList();
      expect(screen.getByRole('button', { name: 'Load more' })).toBeInTheDocument();
    });

    it('fetches the next page when it is pressed', async () => {
      const user = userEvent.setup();
      mockPage([TAKEN_TODAY], { hasNextPage: true });
      renderList();

      await user.click(screen.getByRole('button', { name: 'Load more' }));
      expect(fetchNextPage).toHaveBeenCalledTimes(1);
    });

    it('shows the button busy while the next page is in flight', () => {
      mockPage([TAKEN_TODAY], { hasNextPage: true, isFetchingNextPage: true });
      renderList();

      expect(screen.getByRole('button', { name: 'Load more' })).toBeDisabled();
    });

    // Pages arrive already flattened by the hook's `select`, so a dose from
    // page two groups under its own day exactly like one from page one.
    it('renders rows from every loaded page in one grouped list', () => {
      mockPage([TAKEN_TODAY, MISSED_YESTERDAY, SKIPPED_EARLIER], { hasNextPage: true });
      renderList();

      expect(screen.getAllByRole('heading', { level: 3 })).toHaveLength(3);
      expect(screen.getByText('Atorvastatin')).toBeInTheDocument();
    });
  });
});
