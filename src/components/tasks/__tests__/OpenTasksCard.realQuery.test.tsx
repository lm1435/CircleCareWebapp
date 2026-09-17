import { act, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { QueryClient, QueryClientProvider, onlineManager } from '@tanstack/react-query';
import type { Mock } from 'vitest';
import '@/i18n';
import { apiClient } from '@/lib/api';
import { ToastProvider } from '@/components/ui';
import { OpenTasksCard } from '@/components/tasks/OpenTasksCard';

// OpenTasksCard against a REAL QueryClient, so "paused offline" and "errored"
// are the states React Query itself produces — not a mock's description of
// them. The sibling OpenTasksCard.test.tsx drives every branch through a mocked
// `useTasks`; this file proves the real library lands in those branches.
//
// Only the HTTP layer (`@/lib/api`, mocked globally in src/test/setup.ts) and
// the card's unrelated dependencies are stubbed.

vi.mock('@/hooks/useCircle', () => ({ useCircle: () => ({ canEdit: true, members: [] }) }));
vi.mock('@/hooks/useHourCycle', () => ({ useHourCycle: () => '12h' }));
vi.mock('@/lib/analytics', () => ({ Analytics: { homeEmptyCtaTapped: vi.fn() } }));
vi.mock('@/components/calendar/AddEventModal', () => ({ AddEventModal: () => null }));

const get = apiClient.get as unknown as Mock;
const CTA = 'Add your first task';
const CAUGHT_UP = "You're all caught up — no open tasks.";

/** Nothing open; the probe answers `ever` (or fails while `state.failProbe`). */
function answer(ever: Array<{ id: string }>, state = { failProbe: false }) {
  get.mockImplementation((url: string) => {
    const isProbe = url.includes('status=all');
    if (isProbe && state.failProbe) {
      return Promise.reject({ success: false, error: { code: 'SERVER_ERROR' } });
    }
    return Promise.resolve({
      success: true,
      data: {
        tasks: isProbe ? ever.map((t) => ({ ...t, title: 'x', event_type: 'task' })) : [],
        today: '2026-09-13',
        timezone: 'America/Chicago',
      },
    });
  });
  return state;
}

function renderCard(client: QueryClient) {
  return render(
    <MemoryRouter>
      <QueryClientProvider client={client}>
        <ToastProvider>
          <OpenTasksCard circleId="circle-1" />
        </ToastProvider>
      </QueryClientProvider>
    </MemoryRouter>
  );
}

const newClient = () =>
  new QueryClient({ defaultOptions: { queries: { retry: false, networkMode: 'online' } } });

const settle = () =>
  act(async () => {
    await new Promise((r) => setTimeout(r, 50));
  });

beforeEach(() => {
  get.mockReset();
});

afterEach(() => {
  onlineManager.setOnline(true);
});

it('(a) offline: a circle WITH a completed task gets no first-run door while its reads are paused; online lands the real state', async () => {
  answer([{ id: 't-done' }]);
  onlineManager.setOnline(false);
  const client = newClient();
  renderCard(client);
  await settle();

  // Genuinely paused — not loading, not errored, no data, nothing sent.
  const states = client.getQueryCache().getAll().map((q) => `${q.state.status}/${q.state.fetchStatus}`);
  expect(states).toEqual(['pending/paused', 'pending/paused']);
  expect(get).not.toHaveBeenCalled();

  expect(screen.queryByRole('button', { name: CTA })).toBeNull();
  expect(screen.getByRole('status')).toHaveTextContent('Loading...');

  await act(async () => {
    onlineManager.setOnline(true);
    await new Promise((r) => setTimeout(r, 50));
  });
  expect(await screen.findByText(CAUGHT_UP)).toBeInTheDocument();
  expect(screen.queryByRole('button', { name: CTA })).toBeNull();
});

it('(b) the probe errors: neutral copy, no door; Retry refetches the probe and lands the real state', async () => {
  const state = answer([{ id: 't-done' }], { failProbe: true });
  const client = newClient();
  renderCard(client);

  expect(await screen.findByText("Couldn't load open tasks")).toBeInTheDocument();
  expect(screen.queryByRole('button', { name: CTA })).toBeNull();

  const probeCalls = () => get.mock.calls.filter(([url]) => String(url).includes('status=all')).length;
  const before = probeCalls();
  state.failProbe = false;
  await userEvent.setup().click(screen.getByRole('button', { name: 'Retry' }));

  expect(await screen.findByText(CAUGHT_UP)).toBeInTheDocument();
  expect(probeCalls()).toBe(before + 1);
  expect(screen.queryByRole('button', { name: CTA })).toBeNull();
});

it('(c) online, success and truly empty: the first-run door', async () => {
  answer([]);
  renderCard(newClient());
  expect(await screen.findByRole('button', { name: CTA })).toBeInTheDocument();
});

it('(d) online, success with a past task: no door', async () => {
  answer([{ id: 't-done' }]);
  renderCard(newClient());
  expect(await screen.findByText(CAUGHT_UP)).toBeInTheDocument();
  expect(screen.queryByRole('button', { name: CTA })).toBeNull();
});
