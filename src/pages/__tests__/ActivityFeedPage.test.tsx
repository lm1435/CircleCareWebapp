import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import i18n from '@/i18n';
import ActivityFeedPage from '@/pages/ActivityFeedPage';
import { getActivityFeed, type ActivityFeedItem, type ActivityFeedPage as Page } from '@/api/activityFeed';

// Tasks 25-27 — feed grouped by viewer-local day with "Load more" pagination.
// `getActivityFeed` is mocked; the hook + page wiring stays real.

// The way back to the daily updates (hook covered by useLatestDailyUpdatePath.test).
let latestDailyUpdate: string | null = null;
vi.mock('@/hooks/useDailyUpdate', () => ({
  useLatestDailyUpdatePath: () => latestDailyUpdate,
}));

vi.mock('@/api/activityFeed', async () => {
  const actual = await vi.importActual<typeof import('@/api/activityFeed')>('@/api/activityFeed');
  return { ...actual, getActivityFeed: vi.fn() };
});

// Pin the "device" timezone for day grouping (the dev machine is
// America/Denver — tests must never depend on it). Same Intl spy pattern as
// src/utils/__tests__/timezone.test.ts: only resolvedOptions() is spied;
// formatToParts/format with an explicit timeZone are unaffected.
vi.spyOn(Intl.DateTimeFormat.prototype, 'resolvedOptions').mockReturnValue({
  timeZone: 'America/New_York',
} as Intl.ResolvedDateTimeFormatOptions);

const mockedGetActivityFeed = vi.mocked(getActivityFeed);

const HOUR_MS = 60 * 60 * 1000;
const DAY_MS = 24 * HOUR_MS;

function makeActivity(overrides: Partial<ActivityFeedItem> = {}): ActivityFeedItem {
  return {
    id: `activity-${Math.random().toString(36).slice(2)}`,
    circle_id: 'circle-1',
    action_type: 'medication_confirmed',
    description: 'Confirmed Medication: Aspirin 100mg (taken)',
    created_at: new Date().toISOString(),
    actor: {
      id: 'user-1',
      email: 'pat@example.com',
      first_name: 'Pat',
      last_name: 'Rivera',
    },
    ...overrides,
  };
}

function dateKeyInNY(date: Date): string {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'America/New_York',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(date);
}

function renderPage() {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  return render(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter initialEntries={['/circles/circle-1/activity']}>
        <Routes>
          <Route path="/circles/:circleId/activity" element={<ActivityFeedPage />} />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>
  );
}

describe('ActivityFeedPage', () => {
  beforeEach(() => {
    mockedGetActivityFeed.mockReset();
    latestDailyUpdate = null;
    // Pin "now" to a deterministic mid-afternoon NY instant so Today/Yesterday
    // grouping never depends on the real wall clock (it previously flaked
    // between ~midnight–1am ET). Fake ONLY Date — real setTimeout/microtasks
    // keep React Query + userEvent working.
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date('2026-06-15T18:00:00Z')); // 2:00 PM America/New_York (EDT)
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('renders activity items by type with icon, actor name, action text, and timestamp', async () => {
    mockedGetActivityFeed.mockResolvedValueOnce({
      activities: [
        makeActivity({
          id: 'a1',
          created_at: new Date(Date.now() - 5 * 60 * 1000).toISOString(),
        }),
        makeActivity({
          id: 'a2',
          action_type: 'appointment_created',
          description: 'Added Appointment: Dentist checkup',
          created_at: new Date(Date.now() - 2 * HOUR_MS).toISOString(),
          actor: { id: 'user-2', email: 'sam@example.com', first_name: null, last_name: null },
        }),
      ],
      hasMore: false,
    });

    const { container } = renderPage();

    // The latest entry (a1) is spotlighted in the hero AND repeated in its list
    // row below, so its description/actor/time legitimately appear twice; scope
    // the list-row assertions to listitems. a2 appears only in the list.
    await screen.findByText('Added Appointment: Dentist checkup');
    expect(
      screen.getAllByText('Confirmed Medication: Aspirin 100mg (taken)').length
    ).toBeGreaterThanOrEqual(1);

    const items = screen.getAllByRole('listitem');
    expect(within(items[0]!).getByText('Confirmed Medication: Aspirin 100mg (taken)')).toBeInTheDocument();
    expect(within(items[1]!).getByText('Added Appointment: Dentist checkup')).toBeInTheDocument();

    // Actor names: full name, and email prefix fallback
    expect(within(items[0]!).getByText('Pat Rivera')).toBeInTheDocument();
    expect(within(items[1]!).getByText('sam')).toBeInTheDocument();

    // Relative viewer-local timestamps
    expect(within(items[0]!).getByText('5m ago')).toBeInTheDocument();
    expect(within(items[1]!).getByText('2h ago')).toBeInTheDocument();

    // Type icons, decorative only
    const medIcon = container.querySelector('[data-activity-icon="medication"]');
    const apptIcon = container.querySelector('[data-activity-icon="appointment"]');
    expect(medIcon).not.toBeNull();
    expect(apptIcon).not.toBeNull();
    expect(medIcon).toHaveAttribute('aria-hidden', 'true');

    // Items live in a semantic list
    expect(screen.getAllByRole('listitem')).toHaveLength(2);

    // "Latest / New" hero spotlights the most recent entry when there is data:
    // it LEADS WITH WHAT HAPPENED (the same localized description the feed rows
    // render), attributed to the actor with the relative time, plus a "New"
    // badge (never "LIVE" — the feed is fetched, not realtime).
    const hero = screen.getByRole('region', { name: 'Latest' });
    expect(hero).toBeInTheDocument();
    expect(within(hero).getByText('New')).toBeInTheDocument();
    expect(
      within(hero).getByText('Confirmed Medication: Aspirin 100mg (taken)')
    ).toBeInTheDocument();
    expect(within(hero).getByText('Pat Rivera')).toBeInTheDocument();
    expect(within(hero).getByText('5m ago')).toBeInTheDocument();

    expect(mockedGetActivityFeed).toHaveBeenCalledWith('circle-1', { limit: 30, offset: 0 });
  });

  it('groups activities under Today / Yesterday / formatted date headings', async () => {
    const now = new Date();
    const oldDate = new Date(now.getTime() - 30 * DAY_MS);
    mockedGetActivityFeed.mockResolvedValueOnce({
      activities: [
        makeActivity({ id: 'today-1', created_at: new Date(now.getTime() - HOUR_MS).toISOString() }),
        makeActivity({
          id: 'yesterday-1',
          created_at: new Date(now.getTime() - DAY_MS).toISOString(),
          description: 'Added Task: Pick up prescriptions',
          action_type: 'task_created',
        }),
        makeActivity({
          id: 'old-1',
          created_at: oldDate.toISOString(),
          description: 'Updated health information',
          action_type: 'emergency_info_updated',
        }),
      ],
      hasMore: false,
    });

    renderPage();

    expect(await screen.findByRole('heading', { level: 2, name: 'Today' })).toBeInTheDocument();
    expect(screen.getByRole('heading', { level: 2, name: 'Yesterday' })).toBeInTheDocument();

    // The older entry gets a real date heading, formatted from its
    // viewer-local (America/New_York) day key.
    const oldKey = dateKeyInNY(oldDate);
    const sameYear = oldKey.slice(0, 4) === dateKeyInNY(now).slice(0, 4);
    const expectedLabel = new Date(`${oldKey}T12:00:00Z`).toLocaleDateString(i18n.language, {
      weekday: 'short',
      month: 'short',
      day: 'numeric',
      year: sameYear ? undefined : 'numeric',
      timeZone: 'UTC',
    });
    expect(screen.getByRole('heading', { level: 2, name: expectedLabel })).toBeInTheDocument();

    // Three day groups → three lists
    expect(screen.getAllByRole('list')).toHaveLength(3);
  });

  it('loads the next page on "Load more" with aria-busy, then shows the end-of-feed message', async () => {
    mockedGetActivityFeed.mockResolvedValueOnce({
      activities: [
        makeActivity({ id: 'a1', description: 'Confirmed Medication: Aspirin (taken)' }),
        makeActivity({ id: 'a2', description: 'Added Task: Water plants', action_type: 'task_created' }),
      ],
      hasMore: true,
    });

    let resolvePage2: (page: Page) => void = () => {};
    mockedGetActivityFeed.mockImplementationOnce(
      () => new Promise<Page>((resolve) => (resolvePage2 = resolve))
    );

    renderPage();
    const user = userEvent.setup();

    const loadMore = await screen.findByRole('button', { name: 'Load more' });
    await user.click(loadMore);

    // Loading state while the next page is in flight
    const busyButton = await screen.findByRole('button', { name: 'Loading more...' });
    expect(busyButton).toHaveAttribute('aria-busy', 'true');
    expect(busyButton).toBeDisabled();

    resolvePage2({
      activities: [
        makeActivity({ id: 'a3', description: 'Updated health information', action_type: 'emergency_info_updated' }),
      ],
      hasMore: false,
    });

    // Next page appends — earlier items stay rendered. a1 ("Aspirin") is the
    // latest entry, so it appears in the hero AND its list row (2 matches).
    expect(await screen.findByText('Updated health information')).toBeInTheDocument();
    expect(
      screen.getAllByText('Confirmed Medication: Aspirin (taken)').length
    ).toBeGreaterThanOrEqual(1);

    // Offset = total items fetched so far
    expect(mockedGetActivityFeed).toHaveBeenLastCalledWith('circle-1', { limit: 30, offset: 2 });

    // No more pages → end-of-feed message replaces the button
    expect(screen.getByText("You're all caught up.")).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Load more' })).not.toBeInTheDocument();
  });

  // The backend returns EVERY raw row; a note row whose note/event is gone
  // comes back flagged `note_missing` (never dropped — the next offset is the
  // raw row count). The page hides flagged rows at RENDER time only.
  it('hides note_missing rows but still pages by the RAW row count', async () => {
    mockedGetActivityFeed.mockResolvedValueOnce({
      activities: [
        makeActivity({ id: 'a1', description: 'Completed Task: Groceries', action_type: 'task_completed' }),
        makeActivity({
          id: 'a2',
          action_type: 'care_note_added',
          subject_type: 'care_note',
          description: 'ZZ orphaned care note row',
          note_preview: null,
          note_missing: true,
        }),
        makeActivity({
          id: 'a3',
          action_type: 'note_added',
          subject_type: 'event_note',
          description: 'ZZ removed event note row',
          note_preview: null,
          note_missing: true,
        }),
      ],
      hasMore: true,
    });
    mockedGetActivityFeed.mockResolvedValueOnce({
      activities: [makeActivity({ id: 'a4', description: 'Updated health information', action_type: 'emergency_info_updated' })],
      hasMore: false,
    });

    renderPage();
    const user = userEvent.setup();

    expect((await screen.findAllByText('Completed Task: Groceries')).length).toBeGreaterThanOrEqual(1);
    expect(screen.queryByText('ZZ orphaned care note row')).not.toBeInTheDocument();
    expect(screen.queryByText('ZZ removed event note row')).not.toBeInTheDocument();

    await user.click(await screen.findByRole('button', { name: 'Load more' }));
    expect(await screen.findByText('Updated health information')).toBeInTheDocument();
    // 3 raw rows fetched (2 hidden) → offset 3, not 1.
    expect(mockedGetActivityFeed).toHaveBeenLastCalledWith('circle-1', { limit: 30, offset: 3 });
  });

  it('fetches past a first page whose rows are ALL note_missing instead of showing the empty state', async () => {
    mockedGetActivityFeed.mockResolvedValueOnce({
      activities: [
        makeActivity({ id: 'g1', description: 'ZZ gone 1', note_preview: null, note_missing: true }),
        makeActivity({ id: 'g2', description: 'ZZ gone 2', note_preview: null, note_missing: true }),
      ],
      hasMore: true,
    });
    mockedGetActivityFeed.mockResolvedValueOnce({
      activities: [makeActivity({ id: 'v1', description: 'Completed Task: Groceries', action_type: 'task_completed' })],
      hasMore: false,
    });

    renderPage();

    expect((await screen.findAllByText('Completed Task: Groceries')).length).toBeGreaterThanOrEqual(1);
    expect(mockedGetActivityFeed).toHaveBeenCalledTimes(2);
    expect(mockedGetActivityFeed).toHaveBeenLastCalledWith('circle-1', { limit: 30, offset: 2 });
    expect(screen.queryByText('ZZ gone 1')).not.toBeInTheDocument();
    expect(screen.queryByText('No Activity Yet')).not.toBeInTheDocument();
  });

  // A FAILED next-page fetch flips isFetchingNextPage true→false, which used to
  // re-fire the auto-advance effect with nothing changed: a nonstop retry loop.
  // Auto-advance must stop on the error; only a user action (Retry) resumes.
  it('does not loop when the auto-advance fetch fails; Retry resumes it', async () => {
    const hiddenPage = {
      activities: [
        makeActivity({ id: 'g1', description: 'ZZ gone 1', note_preview: null, note_missing: true }),
        makeActivity({ id: 'g2', description: 'ZZ gone 2', note_preview: null, note_missing: true }),
      ],
      hasMore: true,
    };
    // A real request takes time, so the page renders isFetchingNextPage=true
    // before the failure lands (an instant rejection gets batched away).
    const failSlowly = () =>
      new Promise<Page>((_, reject) => setTimeout(() => reject(new Error('500')), 20));
    mockedGetActivityFeed.mockResolvedValueOnce(hiddenPage); // offset 0
    // offset 2 (auto-advance) fails — and anything after it is a loop, so keep
    // failing to keep a loop a loop.
    mockedGetActivityFeed.mockImplementation(failSlowly);

    renderPage();

    expect(await screen.findByText("Couldn't load the activity feed")).toBeInTheDocument();
    // Give a looping effect every chance to show itself.
    await new Promise((r) => setTimeout(r, 300));
    expect(mockedGetActivityFeed).toHaveBeenCalledTimes(2);
    expect(mockedGetActivityFeed).toHaveBeenLastCalledWith('circle-1', { limit: 30, offset: 2 });
    // Not "still loading" forever: the error card is the whole story.
    expect(screen.queryByRole('status')).not.toBeInTheDocument();

    // A user action retries: the cached page refetches, then auto-advance moves on.
    mockedGetActivityFeed.mockReset();
    mockedGetActivityFeed.mockResolvedValueOnce(hiddenPage);
    mockedGetActivityFeed.mockResolvedValueOnce({
      activities: [makeActivity({ id: 'v1', description: 'Completed Task: Groceries', action_type: 'task_completed' })],
      hasMore: false,
    });
    const user = userEvent.setup();
    await user.click(screen.getByRole('button', { name: 'Retry' }));

    expect((await screen.findAllByText('Completed Task: Groceries')).length).toBeGreaterThanOrEqual(1);
    expect(mockedGetActivityFeed).toHaveBeenCalledTimes(2);
    expect(mockedGetActivityFeed).toHaveBeenLastCalledWith('circle-1', { limit: 30, offset: 2 });
  });

  // `maxPages: 20` evicts the oldest cached page. The next offset used to be the
  // SUM over CACHED pages, which stops growing at 20 x 30 = 600 — past that the
  // same page was re-served forever (and an all-hidden one looped). The offset
  // must be the last page's own offset + its RAW length.
  it('keeps advancing the offset past the maxPages cap (evicted pages still count)', async () => {
    const TOTAL_PAGES = 24;
    const seenOffsets: number[] = [];
    mockedGetActivityFeed.mockImplementation(async (_circleId, opts) => {
      const offset = opts?.offset ?? 0;
      seenOffsets.push(offset);
      await new Promise((r) => setTimeout(r, 5)); // network-like latency
      const index = offset / 30;
      // Safety valve: a frozen offset would otherwise loop without end.
      if (seenOffsets.length > TOTAL_PAGES + 5) return { activities: [], hasMore: false };
      if (index === TOTAL_PAGES - 1) {
        return {
          activities: [makeActivity({ id: 'last', description: 'ZZ final visible row', action_type: 'task_completed' })],
          hasMore: false,
        };
      }
      // Pages 0..22: 30 raw rows each, every one hidden → auto-advance chain.
      return {
        activities: Array.from({ length: 30 }, (_, i) =>
          makeActivity({ id: `h-${offset + i}`, description: 'ZZ hidden', note_preview: null, note_missing: true })
        ),
        hasMore: true,
      };
    });

    renderPage();

    expect((await screen.findAllByText('ZZ final visible row', {}, { timeout: 4000 })).length).toBeGreaterThanOrEqual(1);
    expect(seenOffsets).toEqual(Array.from({ length: TOTAL_PAGES }, (_, i) => i * 30));
  });

  // The effect used to depend only on (lastPageHidden, hasNextPage,
  // isFetchingNextPage). When a response lands before React renders the
  // in-flight state, all three read the same before and after the hop, the
  // effect never re-runs, and the page sits on the skeleton for good.
  it('chains through several all-hidden pages even when responses are instant', async () => {
    const hidden = (offset: number) => ({
      activities: [
        makeActivity({ id: `h-${offset}`, description: 'ZZ hidden', note_preview: null, note_missing: true }),
      ],
      hasMore: true,
    });
    mockedGetActivityFeed.mockResolvedValueOnce(hidden(0));
    mockedGetActivityFeed.mockResolvedValueOnce(hidden(1));
    mockedGetActivityFeed.mockResolvedValueOnce(hidden(2));
    mockedGetActivityFeed.mockResolvedValueOnce({
      activities: [makeActivity({ id: 'v1', description: 'Completed Task: Groceries', action_type: 'task_completed' })],
      hasMore: false,
    });

    renderPage();

    expect((await screen.findAllByText('Completed Task: Groceries')).length).toBeGreaterThanOrEqual(1);
    expect(mockedGetActivityFeed.mock.calls.map(([, opts]) => opts?.offset)).toEqual([0, 1, 2, 3]);
  });

  it('links to the latest daily update at the top, only while that entry is shown', async () => {
    latestDailyUpdate = '/circles/circle-1/daily-update/2026-06-14';
    mockedGetActivityFeed.mockResolvedValueOnce({ activities: [], hasMore: false });
    renderPage();
    const link = await screen.findByRole('link', { name: 'Daily updates' });
    expect(link).toHaveAttribute('href', '/circles/circle-1/daily-update/2026-06-14');
    // Above the feed content (here: the empty state).
    const empty = await screen.findByText('No Activity Yet');
    expect(link.compareDocumentPosition(empty) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });

  it('has no daily-updates link while the entry is hidden', async () => {
    mockedGetActivityFeed.mockResolvedValueOnce({ activities: [], hasMore: false });
    renderPage();
    await screen.findByText('No Activity Yet');
    expect(screen.queryByRole('link', { name: 'Daily updates' })).toBeNull();
  });

  it('renders the empty state when the circle has no activity', async () => {
    mockedGetActivityFeed.mockResolvedValueOnce({ activities: [], hasMore: false });

    renderPage();

    expect(await screen.findByText('No Activity Yet')).toBeInTheDocument();
    expect(
      screen.getByText(
        "Activity will appear here as your care team takes actions. Activity is better together — invite family and caregivers so everyone can see what's been handled."
      )
    ).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Load more' })).not.toBeInTheDocument();
    expect(screen.queryByText("You're all caught up.")).not.toBeInTheDocument();

    // The "Latest / New" hero must never render on the empty state.
    expect(screen.queryByRole('region', { name: 'Latest' })).not.toBeInTheDocument();
    expect(screen.queryByText('New')).not.toBeInTheDocument();
  });

  it('renders the error state and recovers on retry', async () => {
    mockedGetActivityFeed.mockRejectedValueOnce(new Error('network down'));
    mockedGetActivityFeed.mockResolvedValueOnce({
      activities: [makeActivity({ id: 'a1' })],
      hasMore: false,
    });

    renderPage();
    const user = userEvent.setup();

    expect(await screen.findByText("Couldn't load the activity feed")).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'Retry' }));

    // a1 is the only entry → it shows in the hero AND its list row (2 matches).
    expect(
      (await screen.findAllByText('Confirmed Medication: Aspirin 100mg (taken)')).length
    ).toBeGreaterThanOrEqual(1);
    await waitFor(() =>
      expect(screen.queryByText("Couldn't load the activity feed")).not.toBeInTheDocument()
    );
  });

  it('shows the skeleton loading state while the first page is in flight', () => {
    mockedGetActivityFeed.mockImplementationOnce(() => new Promise<Page>(() => {}));

    renderPage();

    const status = screen.getByRole('status');
    expect(status).toBeInTheDocument();
    expect(screen.getByText('Loading activity...')).toBeInTheDocument();
  });
});
