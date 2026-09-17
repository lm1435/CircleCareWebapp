import { act, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { QueryClient, QueryClientProvider, onlineManager } from '@tanstack/react-query';
import type { Mock } from 'vitest';
import '@/i18n';
import { apiClient } from '@/lib/api';
import { queryKeys } from '@/lib/queryKeys';
import { useAuthStore } from '@/store/authStore';
import { addDays } from '@/components/calendar/dateMath';
import { getDateInTimezone } from '@/utils/timezone';
import { GettingStartedChecklist } from '../GettingStartedChecklist';

// The Get-started checklist against a REAL QueryClient: the events PRESENCE
// read and emergency info go through the real `useEventsPresence` /
// `useEmergencyInfo`, so "paused offline" and "errored" are states React Query
// itself produces. The sibling GettingStartedChecklist.test.tsx drives the same
// branches through mocked hooks.
//
// `useCircle` stays mocked — the circle is known in every case here; what is
// under test is the two presence reads that decide the steps.

vi.mock('@/hooks/useCircle', () => ({
  useCircle: () => ({
    circle: { owner_id: 'owner', pending_invites: [] },
    members: [{ id: 'owner' }],
    timezone: 'America/New_York',
    canEdit: true,
    isLoading: false,
  }),
}));
vi.mock('@/lib/analytics', () => ({
  Analytics: { gettingStartedStepTapped: vi.fn(), gettingStartedDismissed: vi.fn() },
}));

const get = apiClient.get as unknown as Mock;
const MED = { id: 'm1', event_type: 'medication', title: 'Lisinopril' };
const EVENTS_URL = '/circles/circle-1/events';
const PRESENCE_URL = '/circles/circle-1/events/presence';
const OLD_BACKEND_404 = { success: false, error: { code: 'NOT_FOUND', message: 'Event not found' } };

interface AnswerState {
  failPresence: boolean;
  /** Older backend: the presence route does not exist (404 NOT_FOUND). */
  presenceMissing: boolean;
}

function answer(events: unknown[], overrides: Partial<AnswerState> = {}): AnswerState {
  const state: AnswerState = { failPresence: false, presenceMissing: false, ...overrides };
  get.mockImplementation((url: string) => {
    if (url === '/circles/circle-1/emergency-info') {
      return Promise.resolve({ success: true, data: { emergency_info: null } });
    }
    if (url === PRESENCE_URL) {
      if (state.presenceMissing) return Promise.reject(OLD_BACKEND_404);
      if (state.failPresence) return Promise.reject({ success: false, error: { code: 'SERVER_ERROR' } });
      const types = new Set(events.map((e) => (e as { event_type: string }).event_type));
      return Promise.resolve({
        success: true,
        data: {
          medication: types.has('medication'),
          appointment: types.has('appointment'),
          task: types.has('task'),
        },
      });
    }
    if (url === EVENTS_URL) {
      return Promise.resolve({ success: true, data: { events } });
    }
    return Promise.reject(new Error(`unexpected GET ${url}`));
  });
  return state;
}

/** Every events-LIST request, as "start..end". */
const listRanges = () =>
  get.mock.calls
    .filter(([url]) => url === EVENTS_URL)
    .map(([, c]) => `${c?.params?.start_date}..${c?.params?.end_date}`);

const newClient = () =>
  new QueryClient({ defaultOptions: { queries: { retry: false, networkMode: 'online' } } });

function renderChecklist(client: QueryClient) {
  return render(
    <MemoryRouter>
      <QueryClientProvider client={client}>
        <GettingStartedChecklist circleId="circle-1" />
      </QueryClientProvider>
    </MemoryRouter>
  );
}

const region = () => screen.queryByRole('region', { name: 'Get started' });

const settle = () =>
  act(async () => {
    await new Promise((r) => setTimeout(r, 50));
  });

function window211() {
  const today = getDateInTimezone('America/New_York');
  return { start_date: addDays(today, -30), end_date: addDays(today, 180) };
}

beforeEach(() => {
  get.mockReset();
  localStorage.clear();
  useAuthStore.setState({
    user: { id: 'owner', email: 'owner@example.com', first_name: 'O', last_name: 'W' },
    isAuthenticated: true,
  });
});

afterEach(() => {
  onlineManager.setOnline(true);
});

it('(a) offline: a circle WITH a medication gets no "Add a medication" step while its reads are paused; online lands the real state', async () => {
  answer([MED]);
  onlineManager.setOnline(false);
  const client = newClient();
  renderChecklist(client);
  await settle();

  const presence = client.getQueryCache().find({ queryKey: queryKeys.calendarEventsPresence('circle-1', window211()) });
  const emergency = client.getQueryCache().find({ queryKey: ['emergencyInfo', 'circle-1'] });
  expect(`${presence?.state.status}/${presence?.state.fetchStatus}`).toBe('pending/paused');
  expect(`${emergency?.state.status}/${emergency?.state.fetchStatus}`).toBe('pending/paused');
  expect(get).not.toHaveBeenCalled();

  expect(region()).toBeNull();
  expect(screen.queryByText('Add a medication')).toBeNull();
  expect(screen.queryByRole('button', { name: /Add/ })).toBeNull();

  await act(async () => {
    onlineManager.setOnline(true);
    await new Promise((r) => setTimeout(r, 50));
  });
  await waitFor(() => expect(region()).not.toBeNull());
  expect(screen.getByText('Add a medication').className).toContain('line-through');
  expect(screen.getByText('1 of 3 done')).toBeInTheDocument();
});

it('(b) the presence read errors: no card; a refetch of the SHARED calendar key (TodaysMeds\' Retry) brings it back correct', async () => {
  const state = answer([MED], { failPresence: true });
  const client = newClient();
  renderChecklist(client);

  await waitFor(() =>
    expect(
      client.getQueryCache().find({ queryKey: queryKeys.calendarEventsPresence('circle-1', window211()) })?.state.status
    ).toBe('error')
  );
  await waitFor(() =>
    expect(client.getQueryCache().findAll({ queryKey: ['emergencyInfo', 'circle-1'] })[0]?.state.status).toBe('success')
  );
  expect(region()).toBeNull();
  expect(screen.queryByText('Add a medication')).toBeNull();
  expect(screen.queryByRole('button', { name: /Add/ })).toBeNull();
  // An error is not a reason to download the 211-day list.
  expect(listRanges()).toEqual([]);

  state.failPresence = false;
  await act(async () => {
    await client.refetchQueries({ queryKey: ['calendarEvents', 'circle-1'] });
  });
  await waitFor(() => expect(region()).not.toBeNull());
  expect(screen.getByText('Add a medication').className).toContain('line-through');
});

it('(c) online, both reads succeed empty: "Add a medication" is pending with its Add', async () => {
  answer([]);
  renderChecklist(newClient());
  await waitFor(() => expect(region()).not.toBeNull());
  expect(screen.getByText('0 of 3 done')).toBeInTheDocument();
  expect(screen.getAllByRole('button', { name: /Add/ })).toHaveLength(2);
});

it('(d) online, the circle has a medication: the step is done', async () => {
  answer([MED]);
  renderChecklist(newClient());
  await waitFor(() => expect(region()).not.toBeNull());
  expect(screen.getByText('Add a medication').className).toContain('line-through');
  expect(screen.getAllByRole('button', { name: /Add/ })).toHaveLength(1);
});

it('(e) presence succeeds: one presence request with the 211-day window and NO events-list request at all', async () => {
  answer([MED]);
  renderChecklist(newClient());
  await waitFor(() => expect(region()).not.toBeNull());
  await settle();

  expect(get).toHaveBeenCalledWith(PRESENCE_URL, { params: window211() });
  expect(get.mock.calls.filter(([url]) => url === PRESENCE_URL)).toHaveLength(1);
  expect(listRanges()).toEqual([]);
});

describe('(f) older backend without the presence route (404)', () => {
  it('falls back to ONE full-range list read (no prefetch): a circle with a medication shows the step done', async () => {
    answer([MED], { presenceMissing: true });
    renderChecklist(newClient());
    await waitFor(() => expect(region()).not.toBeNull());
    await settle();

    expect(screen.getByText('Add a medication').className).toContain('line-through');
    const w = window211();
    expect(listRanges()).toEqual([`${w.start_date}..${w.end_date}`]);
  });

  it('falls back on an empty circle: the step is pending with its Add, exactly as before', async () => {
    answer([], { presenceMissing: true });
    renderChecklist(newClient());
    await waitFor(() => expect(region()).not.toBeNull());
    expect(screen.getByText('0 of 3 done')).toBeInTheDocument();
    expect(screen.getAllByRole('button', { name: /Add/ })).toHaveLength(2);
  });
});
