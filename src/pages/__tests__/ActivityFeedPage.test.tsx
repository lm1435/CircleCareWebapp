import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import i18n from '@/i18n';
import ActivityFeedPage from '@/pages/ActivityFeedPage';
import { getActivityFeed, type ActivityFeedItem, type ActivityFeedPage as Page } from '@/api/activityFeed';

// Tasks 25-27 — feed grouped by viewer-local day with "Load more" pagination.
// `getActivityFeed` is mocked; the hook + page wiring stays real.

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

    expect(await screen.findByText('Confirmed Medication: Aspirin 100mg (taken)')).toBeInTheDocument();
    expect(screen.getByText('Added Appointment: Dentist checkup')).toBeInTheDocument();

    // Actor names: full name, and email prefix fallback
    expect(screen.getByText('Pat Rivera')).toBeInTheDocument();
    expect(screen.getByText('sam')).toBeInTheDocument();

    // Relative viewer-local timestamps
    expect(screen.getByText('5m ago')).toBeInTheDocument();
    expect(screen.getByText('2h ago')).toBeInTheDocument();

    // Type icons, decorative only
    const medIcon = container.querySelector('[data-activity-icon="medication"]');
    const apptIcon = container.querySelector('[data-activity-icon="appointment"]');
    expect(medIcon).not.toBeNull();
    expect(apptIcon).not.toBeNull();
    expect(medIcon).toHaveAttribute('aria-hidden', 'true');

    // Items live in a semantic list
    expect(screen.getAllByRole('listitem')).toHaveLength(2);

    // "Latest / LIVE" hero spotlights the most recent entry when there is data.
    const hero = screen.getByRole('region', { name: 'Latest' });
    expect(hero).toBeInTheDocument();
    expect(within(hero).getByText('LIVE')).toBeInTheDocument();
    expect(within(hero).getByText('5m ago · Pat Rivera')).toBeInTheDocument();

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

    // Next page appends — earlier items stay rendered
    expect(await screen.findByText('Updated health information')).toBeInTheDocument();
    expect(screen.getByText('Confirmed Medication: Aspirin (taken)')).toBeInTheDocument();

    // Offset = total items fetched so far
    expect(mockedGetActivityFeed).toHaveBeenLastCalledWith('circle-1', { limit: 30, offset: 2 });

    // No more pages → end-of-feed message replaces the button
    expect(screen.getByText("You're all caught up.")).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Load more' })).not.toBeInTheDocument();
  });

  it('renders the empty state when the circle has no activity', async () => {
    mockedGetActivityFeed.mockResolvedValueOnce({ activities: [], hasMore: false });

    renderPage();

    expect(await screen.findByText('No Activity Yet')).toBeInTheDocument();
    expect(
      screen.getByText('Activity will appear here as your care team takes actions.')
    ).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Load more' })).not.toBeInTheDocument();
    expect(screen.queryByText("You're all caught up.")).not.toBeInTheDocument();

    // The "Latest / LIVE" hero must never render on the empty state.
    expect(screen.queryByRole('region', { name: 'Latest' })).not.toBeInTheDocument();
    expect(screen.queryByText('LIVE')).not.toBeInTheDocument();
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

    expect(await screen.findByText('Confirmed Medication: Aspirin 100mg (taken)')).toBeInTheDocument();
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
