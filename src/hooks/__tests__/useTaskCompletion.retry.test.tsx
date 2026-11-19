import { act, renderHook } from '@testing-library/react';
import { QueryClient, QueryClientProvider, onlineManager } from '@tanstack/react-query';
import type { ReactNode } from 'react';
import type { Mock } from 'vitest';

// 1.4.3 item 7 (web): task completion's quiet retry, through the REAL
// `useTaskCompletion` + REAL `useCompleteEvent` + REAL queue and notice host.
// Only the HTTP layer (`apiClient`, mocked globally in src/test/setup.ts) is
// stubbed. Case names mirror mobile's (docs/plans/purchase-trial-gaps-1-4-3.md).

const showToast = vi.hoisted(() => vi.fn());
vi.mock('@/components/ui', () => ({ useToast: () => ({ showToast }) }));
vi.mock('@/hooks/usePremiumGate', () => ({
  usePremiumGate: () => ({ promptUpgrade: vi.fn(), promptLapsed: vi.fn() }),
}));
vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string, o?: { count?: number }) => (o?.count !== undefined ? `${key}:${o.count}` : key),
  }),
  initReactI18next: { type: '3rdParty', init: () => {} },
}));
vi.mock('@/lib/analytics', () => ({
  Analytics: {
    taskCompleted: vi.fn(),
    taskUndone: vi.fn(),
    appointmentCompleted: vi.fn(),
    errorOccurred: vi.fn(),
    shiftTaskCompleted: vi.fn(),
    taskCompleteRecovered: vi.fn(),
    writeRetryScheduled: vi.fn(),
    writeRetrySucceeded: vi.fn(),
    writeRetryGaveUp: vi.fn(),
  },
}));

import { apiClient } from '@/lib/api';
import { Analytics } from '@/lib/analytics';
import { useTaskCompletion, UNDO_DELAY_MS } from '@/hooks/useTaskCompletion';
import { WriteRetryNoticeHost, NOTICE_SETTLE_MS } from '@/components/WriteRetryNoticeHost';
import {
  WRITE_RETRY_MAX_AGE_MS,
  __resetWriteRetryForTests,
  pendingCount,
} from '@/lib/writeRetryQueue';
import type { CalendarEvent } from '@/api/calendarEvents';

const get = apiClient.get as unknown as Mock;
const post = apiClient.post as unknown as Mock;

const network = () => ({ isAxiosError: true, code: 'ERR_NETWORK', message: 'Network Error' });
const refusal = (code: string) => ({ success: false, error: { code, message: code } });

const task = (id: string, over: Partial<CalendarEvent> = {}): CalendarEvent => ({
  id,
  circle_id: 'A',
  event_type: 'task',
  title: `Task ${id}`,
  scheduled_date: '2026-03-15',
  scheduled_time: null,
  completed_at: null,
  assigned_to: null,
  created_at: '2026-03-01T00:00:00Z',
  updated_at: '2026-03-01T00:00:00Z',
  ...over,
});
const done = (t: CalendarEvent): CalendarEvent => ({ ...t, completed_at: '2026-03-15T12:00:00Z' });
const completeOk = (t: CalendarEvent) => ({ success: true, data: { event: done(t) } });
const eventsEnvelope = (events: CalendarEvent[]) => ({ success: true, data: { events } });
const tasksEnvelope = (tasks: CalendarEvent[]) => ({
  success: true,
  data: { tasks, today: '2026-03-15', timezone: 'America/Chicago' },
});

function setup(circleId = 'A') {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  const wrapper = ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={queryClient}>
      {children}
      <WriteRetryNoticeHost />
    </QueryClientProvider>
  );
  return renderHook(({ id }) => useTaskCompletion(id), {
    wrapper,
    initialProps: { id: circleId },
  });
}

/** Tap Done and let the undo window elapse so the first send happens. */
async function tapAndSend(result: { current: ReturnType<typeof useTaskCompletion> }, t: CalendarEvent) {
  act(() => result.current.handleComplete(t));
  await act(async () => {
    await vi.advanceTimersByTimeAsync(UNDO_DELAY_MS + 10);
  });
}
const advance = (ms: number) =>
  act(async () => {
    await vi.advanceTimersByTimeAsync(ms);
  });

const completePosts = () => post.mock.calls.filter(([url]) => String(url).endsWith('/complete'));

beforeEach(() => {
  vi.useFakeTimers();
  __resetWriteRetryForTests();
  vi.clearAllMocks();
  get.mockReset();
  post.mockReset();
  showToast.mockReset();
  onlineManager.setOnline(true);
  // Every re-read says: not completed.
  get.mockImplementation((url: string) =>
    String(url).endsWith('/events')
      ? Promise.resolve(eventsEnvelope([task('t1'), task('t2')]))
      : Promise.resolve(tasksEnvelope([task('t1'), task('t2')]))
  );
});
afterEach(() => {
  vi.useRealTimers();
  onlineManager.setOnline(true);
});

describe('useTaskCompletion: quiet retry on a network failure', () => {
  it('a network failure shows NO error: the row stays done and the send is queued', async () => {
    post.mockRejectedValueOnce(network()).mockResolvedValue(completeOk(task('t1')));
    const { result } = setup();
    await tapAndSend(result, task('t1'));
    expect(completePosts()).toHaveLength(1);
    expect(pendingCount()).toBe(1);
    expect(result.current.pendingIds.has('t1')).toBe(true);
    expect(showToast).not.toHaveBeenCalled();
    expect(Analytics.errorOccurred).not.toHaveBeenCalled();
  });

  it('P7-3 the retry succeeds on the backoff: the row settles, one extra POST, no notice', async () => {
    post.mockRejectedValueOnce(network()).mockResolvedValue(completeOk(task('t1')));
    const { result } = setup();
    await tapAndSend(result, task('t1'));
    await advance(2100);
    expect(completePosts()).toHaveLength(2);
    await advance(0);
    expect(result.current.pendingIds.has('t1')).toBe(false);
    expect(Analytics.taskCompleted).toHaveBeenCalledWith('A');
    expect(Analytics.writeRetrySucceeded).toHaveBeenCalledWith('task_complete', 1, 'backoff');
    await advance(NOTICE_SETTLE_MS + 5000);
    expect(showToast).not.toHaveBeenCalled();
  });

  it('P7-2 a retry after a resume succeeds', async () => {
    post.mockRejectedValueOnce(network()).mockResolvedValue(completeOk(task('t1')));
    const { result } = setup();
    await tapAndSend(result, task('t1'));
    await act(async () => {
      document.dispatchEvent(new Event('visibilitychange'));
      await vi.advanceTimersByTimeAsync(0);
    });
    expect(completePosts()).toHaveLength(2);
    expect(Analytics.writeRetrySucceeded).toHaveBeenCalledWith('task_complete', 1, 'resume');
    expect(result.current.pendingIds.has('t1')).toBe(false);
  });

  it('P7-1 eleven failures give one notice: one toast, N = 11, no per-item toast', async () => {
    post.mockRejectedValue(network());
    const { result } = setup();
    for (let i = 0; i < 11; i++) {
      act(() => result.current.handleComplete(task(`t${i}`)));
    }
    await advance(UNDO_DELAY_MS + 10);
    expect(completePosts()).toHaveLength(11);
    await advance(WRITE_RETRY_MAX_AGE_MS + 60_000);
    await advance(NOTICE_SETTLE_MS + 50);
    expect(showToast).toHaveBeenCalledTimes(1);
    const [message, type, action] = showToast.mock.calls[0];
    expect(message).toBe('writeRetry.notice:11');
    expect(type).toBe('error');
    expect(action.label).toBe('writeRetry.retry');
    // Given up: the rows no longer claim to be done.
    expect(result.current.pendingIds.size).toBe(0);
    expect(Analytics.errorOccurred).toHaveBeenCalledTimes(11);
  });

  it('P7-4 the notice Retry sends them again and they land', async () => {
    post.mockRejectedValue(network());
    const { result } = setup();
    await tapAndSend(result, task('t1'));
    await advance(WRITE_RETRY_MAX_AGE_MS + 60_000);
    await advance(NOTICE_SETTLE_MS + 50);
    const before = completePosts().length;
    post.mockResolvedValue(completeOk(task('t1')));
    await act(async () => {
      showToast.mock.calls[0][2].onClick();
      await vi.advanceTimersByTimeAsync(0);
    });
    expect(completePosts()).toHaveLength(before + 1);
    expect(Analytics.writeRetrySucceeded).toHaveBeenCalledWith('task_complete', 1, 'manual');
  });

  it('P7-8 a replayed:true answer (no event in the body) is success: no toast, row settles', async () => {
    post.mockRejectedValueOnce(network()).mockResolvedValue({ success: true, data: { replayed: true } });
    const { result } = setup();
    await tapAndSend(result, task('t1'));
    await advance(2100);
    await advance(0);
    expect(showToast).not.toHaveBeenCalled();
    expect(result.current.pendingIds.has('t1')).toBe(false);
    expect(pendingCount()).toBe(0);
  });
});

describe('useTaskCompletion: what the retry must NOT do', () => {
  it('N7-1 complete, network fail, undo, then the retry timer fires: nothing is sent (the undo wins)', async () => {
    post.mockRejectedValue(network());
    const { result } = setup();
    await tapAndSend(result, task('t1'));
    expect(completePosts()).toHaveLength(1);
    act(() => result.current.handleUndo('t1'));
    expect(result.current.pendingIds.has('t1')).toBe(false);
    expect(Analytics.taskUndone).toHaveBeenCalledWith('A');
    await advance(WRITE_RETRY_MAX_AGE_MS);
    expect(completePosts()).toHaveLength(1);
    expect(pendingCount()).toBe(0);
  });

  it('N7-2 the first attempt actually landed (lost response): the re-read says so, NO second POST', async () => {
    post.mockRejectedValue(network());
    // 1st re-read (inside the failed first attempt): not completed. 2nd (the queue's landed()): completed.
    let reads = 0;
    get.mockImplementation((url: string) => {
      if (!String(url).endsWith('/events')) return Promise.resolve(tasksEnvelope([task('t1')]));
      reads += 1;
      return Promise.resolve(eventsEnvelope([reads === 1 ? task('t1') : done(task('t1'))]));
    });
    const { result } = setup();
    await tapAndSend(result, task('t1'));
    await advance(2100);
    await advance(0);
    expect(reads).toBeGreaterThanOrEqual(2);
    expect(completePosts()).toHaveLength(1);
    expect(result.current.pendingIds.has('t1')).toBe(false);
    expect(Analytics.taskCompleted).toHaveBeenCalledTimes(1);
    expect(showToast).not.toHaveBeenCalled();
  });

  it.each(['VIEW_ONLY', 'NOT_FOUND', 'CONFLICT'])(
    'N7-3 a non-network error (%s) is not retried: one report, one POST',
    async (code) => {
      post.mockRejectedValue(refusal(code));
      const { result } = setup();
      await tapAndSend(result, task('t1'));
      expect(showToast).toHaveBeenCalledTimes(1);
      await advance(WRITE_RETRY_MAX_AGE_MS);
      expect(completePosts()).toHaveLength(1);
      expect(pendingCount()).toBe(0);
      expect(result.current.pendingIds.has('t1')).toBe(false);
    }
  );

  it('N7-8 circle switched: the retry still posts to the circle the tap was made in', async () => {
    post.mockRejectedValueOnce(network()).mockResolvedValue(completeOk(task('t1')));
    const { result, rerender } = setup('A');
    await tapAndSend(result, task('t1'));
    rerender({ id: 'B' });
    await advance(2100);
    const urls = completePosts().map(([url]) => String(url));
    expect(urls).toHaveLength(2);
    expect(urls.every((u) => u.startsWith('/circles/A/'))).toBe(true);
  });

  it('a re-tap while it waits for a retry is ignored (one in flight per key)', async () => {
    post.mockRejectedValueOnce(network()).mockResolvedValue(completeOk(task('t1')));
    const { result } = setup();
    await tapAndSend(result, task('t1'));
    act(() => result.current.handleComplete(task('t1')));
    await advance(UNDO_DELAY_MS + 10);
    // Still only the first POST: the second tap armed nothing (the 2 s retry is the next send).
    expect(completePosts().length).toBeLessThanOrEqual(2);
    await advance(WRITE_RETRY_MAX_AGE_MS);
    expect(completePosts()).toHaveLength(2);
  });

  it('offline at retry time: nothing is sent until the browser is back', async () => {
    post.mockRejectedValueOnce(network()).mockResolvedValue(completeOk(task('t1')));
    const { result } = setup();
    await tapAndSend(result, task('t1'));
    onlineManager.setOnline(false);
    await advance(10_000);
    expect(completePosts()).toHaveLength(1);
    onlineManager.setOnline(true);
    await act(async () => {
      window.dispatchEvent(new Event('online'));
      await vi.advanceTimersByTimeAsync(0);
    });
    expect(completePosts()).toHaveLength(2);
    expect(result.current.pendingIds.has('t1')).toBe(false);
  });
});
