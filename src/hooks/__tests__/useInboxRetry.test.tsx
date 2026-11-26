import { act, renderHook } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { ReactNode } from 'react';
import { makeItem } from '@/test/fixtures/inbox';

vi.mock('@/api/inbox', () => ({
  getInbox: vi.fn(),
  getInboxUnread: vi.fn(),
  markInboxRead: vi.fn(),
}));
const showToast = vi.hoisted(() => vi.fn());
vi.mock('@/components/ui', () => ({ useToast: () => ({ showToast }) }));

vi.mock('@/lib/analytics', () => ({
  Analytics: { writeRetryScheduled: vi.fn(), writeRetrySucceeded: vi.fn(), writeRetryGaveUp: vi.fn() },
}));

import { getInbox, getInboxUnread, markInboxRead } from '@/api/inbox';
import { useMarkInboxRead } from '@/hooks/useInbox';
import { queryKeys } from '@/lib/queryKeys';
import { __resetWriteRetryForTests } from '@/lib/writeRetryQueue';

// 1.4.3 audit item 2: inbox mark-read / mark-all retry in the call; the optimistic rows stay
// while it retries and roll back only after the LAST attempt.

const mockMark = vi.mocked(markInboxRead);
const network = () => ({ isAxiosError: true, code: 'ERR_NETWORK', message: 'Network Error' });
type L = { items: ReturnType<typeof makeItem>[]; unread_count: number };

function setup() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const item = makeItem();
  client.setQueryData(queryKeys.inbox, { items: [item], unread_count: 1 });
  vi.mocked(getInbox).mockImplementation(() => new Promise(() => {}));
  vi.mocked(getInboxUnread).mockImplementation(() => new Promise(() => {}));
  const wrapper = ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={client}>{children}</QueryClientProvider>
  );
  return { client, item, wrapper };
}

beforeEach(() => {
  vi.useFakeTimers();
  vi.clearAllMocks();
  __resetWriteRetryForTests();
});
afterEach(() => vi.useRealTimers());

describe('useMarkInboxRead quiet retry', () => {
  it('a network blip then success: row stays read while retrying, one success, no rollback', async () => {
    const { client, item, wrapper } = setup();
    mockMark.mockRejectedValueOnce(network()).mockResolvedValueOnce(1);
    const onError = vi.fn();
    const { result } = renderHook(() => useMarkInboxRead(), { wrapper });
    act(() => result.current.mutate({ ids: [item.id] }, { onError }));
    await act(async () => vi.advanceTimersByTimeAsync(100));
    expect(mockMark).toHaveBeenCalledTimes(1);
    // Waiting for the retry: still optimistically read.
    expect(client.getQueryData<L>(queryKeys.inbox)!.items[0].read_at).not.toBeNull();
    await act(async () => vi.advanceTimersByTimeAsync(2_000));
    expect(mockMark).toHaveBeenCalledTimes(2);
    expect(onError).not.toHaveBeenCalled();
    expect(client.getQueryData<L>(queryKeys.inbox)!.items[0].read_at).not.toBeNull();
  });

  it('NEGATIVE: every attempt fails: rolls back only after the last one, onError once', async () => {
    const { client, item, wrapper } = setup();
    mockMark.mockRejectedValue(network());
    const onError = vi.fn();
    const { result } = renderHook(() => useMarkInboxRead(), { wrapper });
    act(() => result.current.mutate({ all: true }, { onError }));
    await act(async () => vi.advanceTimersByTimeAsync(2_000 + 5_000));
    expect(onError).not.toHaveBeenCalled();
    expect(client.getQueryData<L>(queryKeys.inbox)!.items[0].read_at).not.toBeNull();
    await act(async () => vi.advanceTimersByTimeAsync(10_000));
    expect(mockMark).toHaveBeenCalledTimes(4);
    expect(onError).toHaveBeenCalledTimes(1);
    expect(client.getQueryData<L>(queryKeys.inbox)!.items[0].read_at).toBeNull();
    expect(item.read_at).toBeNull();
  });

  it('NEGATIVE: a 4xx refusal is not retried', async () => {
    const { item, wrapper } = setup();
    mockMark.mockRejectedValue({ success: false, error: { code: 'FORBIDDEN', message: 'x' } });
    const onError = vi.fn();
    const { result } = renderHook(() => useMarkInboxRead(), { wrapper });
    act(() => result.current.mutate({ ids: [item.id] }, { onError }));
    await act(async () => vi.advanceTimersByTimeAsync(30_000));
    expect(mockMark).toHaveBeenCalledTimes(1);
    expect(onError).toHaveBeenCalledTimes(1);
  });

  it('NEGATIVE: two overlapping marks never refuse each other (unique key per call)', async () => {
    const { item, wrapper } = setup();
    mockMark.mockResolvedValue(1);
    const { result } = renderHook(() => useMarkInboxRead(), { wrapper });
    const onError = vi.fn();
    act(() => {
      result.current.mutate({ ids: [item.id] }, { onError });
      result.current.mutate({ ids: [item.id] }, { onError });
    });
    await act(async () => vi.advanceTimersByTimeAsync(100));
    expect(onError).not.toHaveBeenCalled();
  });
});
