import { act, renderHook, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { ReactNode } from 'react';
import type { Mock } from 'vitest';

// REAL `useTasks` + REAL `useCompleteEvent` against a REAL QueryClient — only
// the HTTP layer (`apiClient`, mocked globally in src/test/setup.ts) is
// stubbed. This is the ONE surface where a mock of `useCompleteEvent` (as
// TasksPage.test.tsx and OpenTasksCard.test.tsx use, for speed) can't prove
// anything: the bug this file guards against is entirely about the real
// interaction between `useCompleteEvent`'s own invalidation and this hook's
// wait for it, which a mocked mutation papers over by construction.

vi.mock('@/components/ui', () => ({ useToast: () => ({ showToast: vi.fn() }) }));
vi.mock('@/hooks/usePremiumGate', () => ({ usePremiumGate: () => ({ promptUpgrade: vi.fn() }) }));
vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (key: string) => key }),
  initReactI18next: { type: '3rdParty', init: () => {} },
}));
vi.mock('@/lib/analytics', () => ({
  Analytics: {
    taskCompleted: vi.fn(),
    appointmentCompleted: vi.fn(),
    errorOccurred: vi.fn(),
  },
}));

import { apiClient } from '@/lib/api';
import { useTasks } from '@/hooks/useTasks';
import { useTaskCompletion, UNDO_DELAY_MS } from '@/hooks/useTaskCompletion';
import { REFETCH_CAP_MS } from '@/lib/refetchCap';
import { tokenAccessor } from '@/lib/tokenAccessor';
import type { CalendarEvent } from '@/api/calendarEvents';
import type { GetTasksResponse } from '@/api/tasks';

const get = apiClient.get as unknown as Mock;
const post = apiClient.post as unknown as Mock;

const CIRCLE_ID = 'circle-1';

const OPEN_TASK: CalendarEvent = {
  id: 'task-1',
  circle_id: CIRCLE_ID,
  event_type: 'task',
  title: 'Water plants',
  scheduled_date: '2026-03-15',
  scheduled_time: null,
  completed_at: null,
  assigned_to: null,
  created_at: '2026-03-01T00:00:00Z',
  updated_at: '2026-03-01T00:00:00Z',
};

function tasksEnvelope(tasks: CalendarEvent[]): { success: true; data: GetTasksResponse } {
  return {
    success: true,
    data: { tasks, today: '2026-03-15', timezone: 'America/Chicago' },
  };
}

function completeEnvelope(event: CalendarEvent) {
  return { success: true, data: { event } };
}

/** The rows-driving read (`useTasks`) alongside the completion orchestration —
 * exactly the pairing OpenTasksCard and TasksPage each wire up themselves. */
function useHarness(circleId: string) {
  const tasksQuery = useTasks(circleId, { status: 'open' });
  const completion = useTaskCompletion(circleId);
  return { tasksQuery, completion };
}

function makeWrapper() {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  const wrapper = ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
  );
  return { queryClient, wrapper };
}

beforeEach(() => {
  get.mockReset();
  post.mockReset();
});

afterEach(() => {
  vi.useRealTimers();
});

describe('useTaskCompletion — holds the pending id for the tasks refetch, not just the POST', () => {
  // THE REGRESSION (see useTaskCompletion.ts's onSuccess comment). `useCompleteEvent`'s
  // own onSuccess invalidates the tasks list FIRE-AND-FORGET (it is shared with
  // EventDetailActions, which must not be slowed by a refetch it never
  // renders), so this hook's own wait has to be the thing holding the pending
  // id open — otherwise the row's "Done" button reappears for the length of
  // one refetch, over stale not-completed data.
  //
  // PAIRED BY CONSTRUCTION: the "still pending" read below and the "cleared"
  // read after releasing the gate are the same assertion on either side of the
  // one event (the tasks refetch landing).
  it('is still pending right after the POST resolves, and clears once the tasks list itself refetches', async () => {
    const { wrapper } = makeWrapper();

    let getCalls = 0;
    let releaseRefetch!: () => void;
    const refetchGate = new Promise<void>((resolve) => {
      releaseRefetch = resolve;
    });

    get.mockImplementation(() => {
      getCalls += 1;
      if (getCalls === 1) return Promise.resolve(tasksEnvelope([OPEN_TASK]));
      // The refetch `handleComplete`'s onSuccess kicks off — gated until the
      // test releases it, so the test can observe the in-between state.
      return refetchGate.then(() =>
        tasksEnvelope([{ ...OPEN_TASK, completed_at: '2026-03-15T12:00:00Z' }])
      );
    });
    post.mockResolvedValue(
      completeEnvelope({ ...OPEN_TASK, completed_at: '2026-03-15T12:00:00Z' })
    );

    const { result } = renderHook(() => useHarness(CIRCLE_ID), { wrapper });

    // Let the initial list load for real (no fake timers yet).
    await waitFor(() => expect(result.current.tasksQuery.isSuccess).toBe(true));
    expect(getCalls).toBe(1);

    // Fake timers must be installed BEFORE `handleComplete` schedules its
    // setTimeout — vitest cannot retroactively fake a timer already created
    // against the real clock.
    vi.useFakeTimers();
    act(() => {
      result.current.completion.handleComplete(OPEN_TASK);
    });
    expect(result.current.completion.pendingIds.has(OPEN_TASK.id)).toBe(true);

    // Elapse the 5s undo window: fires the commit, which POSTs (resolves
    // immediately here) and, on success, starts the tasks refetch above.
    await act(async () => {
      await vi.advanceTimersByTimeAsync(UNDO_DELAY_MS);
    });
    vi.useRealTimers();

    // The POST has settled — `post` was called and resolved — but the refetch
    // it triggered is still gated. Against the pre-fix code (which cleared the
    // pending id in `onSettled`, the instant the POST alone resolved) this is
    // where the assertion below would already be false.
    expect(post).toHaveBeenCalledTimes(1);
    expect(getCalls).toBe(2);
    expect(result.current.completion.pendingIds.has(OPEN_TASK.id)).toBe(true);

    // Let the refetch land.
    await act(async () => {
      releaseRefetch();
      await refetchGate;
      await Promise.resolve();
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(result.current.completion.pendingIds.has(OPEN_TASK.id)).toBe(false);
    // NO DOUBLE REQUEST: `useCompleteEvent`'s own invalidation already started
    // the ONE refetch above; this hook's `refetchQueries({ cancelRefetch:
    // false })` joins that in-flight promise instead of cancelling and
    // re-issuing it. A regression here would show as a 3rd `get` call.
    expect(getCalls).toBe(2);
  });

  it('clears the pending id immediately on a failed completion — no wait', async () => {
    const { wrapper } = makeWrapper();
    get.mockResolvedValue(tasksEnvelope([OPEN_TASK]));
    post.mockRejectedValue({ success: false, error: { code: 'CONFLICT' } });

    const { result } = renderHook(() => useHarness(CIRCLE_ID), { wrapper });
    await waitFor(() => expect(result.current.tasksQuery.isSuccess).toBe(true));

    vi.useFakeTimers();
    try {
      act(() => {
        result.current.completion.handleComplete(OPEN_TASK);
      });
      await act(async () => {
        await vi.advanceTimersByTimeAsync(UNDO_DELAY_MS);
      });
    } finally {
      vi.useRealTimers();
    }

    await waitFor(() =>
      expect(result.current.completion.pendingIds.has(OPEN_TASK.id)).toBe(false)
    );
  });

  it('releases the pending id at the 4s cap when the tasks refetch never resolves', async () => {
    const { wrapper } = makeWrapper();

    let getCalls = 0;
    get.mockImplementation(() => {
      getCalls += 1;
      if (getCalls === 1) return Promise.resolve(tasksEnvelope([OPEN_TASK]));
      return new Promise<never>(() => {}); // the refetch never lands
    });
    post.mockResolvedValue(
      completeEnvelope({ ...OPEN_TASK, completed_at: '2026-03-15T12:00:00Z' })
    );

    const { result } = renderHook(() => useHarness(CIRCLE_ID), { wrapper });
    await waitFor(() => expect(result.current.tasksQuery.isSuccess).toBe(true));

    vi.useFakeTimers();
    try {
      act(() => {
        result.current.completion.handleComplete(OPEN_TASK);
      });
      await act(async () => {
        await vi.advanceTimersByTimeAsync(UNDO_DELAY_MS);
      });
      expect(result.current.completion.pendingIds.has(OPEN_TASK.id)).toBe(true);

      // Just short of the cap — still pending.
      await act(async () => {
        await vi.advanceTimersByTimeAsync(REFETCH_CAP_MS - 1);
      });
      expect(result.current.completion.pendingIds.has(OPEN_TASK.id)).toBe(true);

      // The cap — released, with the refetch still hanging in the background.
      await act(async () => {
        await vi.advanceTimersByTimeAsync(1);
      });
      expect(result.current.completion.pendingIds.has(OPEN_TASK.id)).toBe(false);
    } finally {
      vi.useRealTimers();
    }
  });
});

// PK11 (approved 2026-09-30): the pagehide / hidden flush of a pending task
// completion is a keepalive fetch with the in-memory bearer token. One request
// per task; the unmount flush keeps axios.
describe('useTaskCompletion: PK11 keepalive flush', () => {
  const fetchMock = vi.fn();
  beforeEach(() => {
    fetchMock.mockReset();
    fetchMock.mockResolvedValue({ ok: true, status: 200 });
    vi.stubGlobal('fetch', fetchMock);
    tokenAccessor.setToken('tok-xyz', null);
    get.mockResolvedValue(tasksEnvelope([OPEN_TASK]));
  });
  afterEach(() => {
    vi.unstubAllGlobals();
    tokenAccessor.clear();
  });

  it('pagehide: one keepalive POST to the complete route with the bearer, no axios POST, never twice', async () => {
    const { wrapper } = makeWrapper();
    const { result, unmount } = renderHook(() => useHarness(CIRCLE_ID), { wrapper });
    await waitFor(() => expect(result.current.tasksQuery.isSuccess).toBe(true));

    act(() => {
      result.current.completion.handleComplete(OPEN_TASK);
    });
    act(() => {
      window.dispatchEvent(new Event('pagehide'));
    });
    // A second flush trigger for the same task must not send it again.
    act(() => {
      window.dispatchEvent(new Event('pagehide'));
    });
    unmount();

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0];
    expect(String(url)).toMatch(/\/circles\/circle-1\/events\/task-1\/complete$/);
    expect(init.keepalive).toBe(true);
    expect(init.headers.Authorization).toBe('Bearer tok-xyz');
    expect(post).not.toHaveBeenCalled();
  });

  it('unmount (page alive) keeps the axios path', async () => {
    const { wrapper } = makeWrapper();
    const { result, unmount } = renderHook(() => useHarness(CIRCLE_ID), { wrapper });
    await waitFor(() => expect(result.current.tasksQuery.isSuccess).toBe(true));
    post.mockResolvedValue(completeEnvelope({ ...OPEN_TASK, completed_at: '2026-03-15T12:00:00Z' }));

    act(() => {
      result.current.completion.handleComplete(OPEN_TASK);
    });
    unmount();

    expect(fetchMock).not.toHaveBeenCalled();
    await waitFor(() => expect(post).toHaveBeenCalledTimes(1));
  });

  it('no token: pagehide falls back to the ordinary mutation', async () => {
    tokenAccessor.clear();
    const { wrapper } = makeWrapper();
    const { result } = renderHook(() => useHarness(CIRCLE_ID), { wrapper });
    await waitFor(() => expect(result.current.tasksQuery.isSuccess).toBe(true));
    post.mockResolvedValue(completeEnvelope({ ...OPEN_TASK, completed_at: '2026-03-15T12:00:00Z' }));

    act(() => {
      result.current.completion.handleComplete(OPEN_TASK);
    });
    act(() => {
      window.dispatchEvent(new Event('pagehide'));
    });

    expect(fetchMock).not.toHaveBeenCalled();
    await waitFor(() => expect(post).toHaveBeenCalledTimes(1));
  });
});
