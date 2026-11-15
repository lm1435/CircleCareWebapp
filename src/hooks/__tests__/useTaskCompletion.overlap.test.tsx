import { act, renderHook, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { ReactNode } from 'react';
import type { Mock } from 'vitest';

// BH-009: two completions overlap on ONE shared useMutation observer. TanStack v5 keeps only
// the LAST mutate() call's per-call callbacks, so the first call's onSuccess/onError never ran:
// a failed task kept "Completing... Undo" forever and shift_task_completed was lost. The hook
// now settles each call on its own mutateAsync promise.

vi.mock('@/components/ui', () => ({ useToast: () => ({ showToast: vi.fn() }) }));
vi.mock('@/hooks/usePremiumGate', () => ({ usePremiumGate: () => ({ promptUpgrade: vi.fn() }) }));
vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (key: string) => key }),
  initReactI18next: { type: '3rdParty', init: () => {} },
}));
vi.mock('@/lib/analytics', () => ({
  Analytics: {
    taskCompleted: vi.fn(),
    taskUndone: vi.fn(),
    appointmentCompleted: vi.fn(),
    errorOccurred: vi.fn(),
    shiftTaskCompleted: vi.fn(),
  },
}));

import { apiClient } from '@/lib/api';
import { Analytics } from '@/lib/analytics';
import { useTaskCompletion, UNDO_DELAY_MS } from '@/hooks/useTaskCompletion';
import type { CalendarEvent } from '@/api/calendarEvents';

const get = apiClient.get as unknown as Mock;
const post = apiClient.post as unknown as Mock;
const CIRCLE_ID = 'circle-1';

function task(id: string): CalendarEvent {
  return {
    id,
    circle_id: CIRCLE_ID,
    event_type: 'task',
    title: id,
    scheduled_date: '2026-03-15',
    scheduled_time: null,
    completed_at: null,
    assigned_to: null,
    created_at: '2026-03-01T00:00:00Z',
    updated_at: '2026-03-01T00:00:00Z',
    shift: { status: 'inside' },
  } as unknown as CalendarEvent;
}
const A = task('task-a');
const B = task('task-b');

function deferred<T>() {
  let resolve!: (v: T) => void;
  let reject!: (e: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

function setup() {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  const wrapper = ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
  );
  return renderHook(() => useTaskCompletion(CIRCLE_ID, 'tasks'), { wrapper });
}

const ok = (t: CalendarEvent) => ({
  success: true,
  data: { event: { ...t, completed_at: '2026-03-15T12:00:00Z' } },
});

/** Tap A, then B 1s later so B's timer fires while A's POST (gated) is in flight. */
async function overlap(
  result: ReturnType<typeof setup>['result']
): Promise<{ a: ReturnType<typeof deferred<unknown>>; b: ReturnType<typeof deferred<unknown>> }> {
  const a = deferred<unknown>();
  const b = deferred<unknown>();
  post.mockImplementation((url: string) => (url.includes('task-a') ? a.promise : b.promise));
  vi.useFakeTimers();
  act(() => result.current.handleComplete(A));
  await act(async () => {
    await vi.advanceTimersByTimeAsync(1000);
  });
  act(() => result.current.handleComplete(B));
  await act(async () => {
    await vi.advanceTimersByTimeAsync(UNDO_DELAY_MS - 1000); // A fires
    await vi.advanceTimersByTimeAsync(1000); // B fires while A is pending
  });
  vi.useRealTimers();
  expect(post).toHaveBeenCalledTimes(2);
  return { a, b };
}

beforeEach(() => {
  get.mockReset();
  post.mockReset();
  get.mockResolvedValue({ success: true, data: { tasks: [], today: '2026-03-15', timezone: 'UTC' } });
  (Analytics.shiftTaskCompleted as Mock).mockClear();
});
afterEach(() => vi.useRealTimers());

describe('useTaskCompletion: overlapping completions (BH-009)', () => {
  it('positive: a FAILED first completion releases its row even though a second started meanwhile', async () => {
    const { result } = setup();
    const { a, b } = await overlap(result);
    await act(async () => {
      a.reject({ success: false, error: { code: 'CONFLICT' } });
      await Promise.resolve();
    });
    await waitFor(() => expect(result.current.pendingIds.has(A.id)).toBe(false));
    // B is still in flight and still shows pending.
    expect(result.current.pendingIds.has(B.id)).toBe(true);
    await act(async () => {
      b.resolve(ok(B));
    });
  });

  it('positive: both overlapping successes fire shift_task_completed, one each', async () => {
    const { result } = setup();
    const { a, b } = await overlap(result);
    await act(async () => {
      a.resolve(ok(A));
      b.resolve(ok(B));
    });
    await waitFor(() => expect(Analytics.shiftTaskCompleted).toHaveBeenCalledTimes(2));
    await waitFor(() => expect(result.current.pendingIds.size).toBe(0));
  });

  it('negative: a failed completion fires NO shift_task_completed (success only)', async () => {
    const { result } = setup();
    const { a, b } = await overlap(result);
    await act(async () => {
      a.reject({ success: false, error: { code: 'CONFLICT' } });
      b.reject({ success: false, error: { code: 'CONFLICT' } });
    });
    await waitFor(() => expect(result.current.pendingIds.size).toBe(0));
    expect(Analytics.shiftTaskCompleted).not.toHaveBeenCalled();
  });

  it('negative: the success of B does not release A while A is still in flight', async () => {
    const { result } = setup();
    const { a, b } = await overlap(result);
    await act(async () => {
      b.resolve(ok(B));
    });
    await waitFor(() => expect(result.current.pendingIds.has(B.id)).toBe(false));
    expect(result.current.pendingIds.has(A.id)).toBe(true);
    await act(async () => {
      a.resolve(ok(A));
    });
  });

  it('positive: flushPending with two pending shift tasks reports both', async () => {
    const { result } = setup();
    post.mockImplementation((_u: string) => Promise.resolve(ok(A)));
    act(() => {
      result.current.handleComplete(A);
      result.current.handleComplete(B);
    });
    await act(async () => {
      result.current.flushPending();
    });
    await waitFor(() => expect(Analytics.shiftTaskCompleted).toHaveBeenCalledTimes(2));
  });
});
