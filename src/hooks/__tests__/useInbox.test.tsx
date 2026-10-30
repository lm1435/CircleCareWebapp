import { act, renderHook, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { ReactNode } from 'react';
import { CIRCLE_A, CIRCLE_B, makeItem } from '@/test/fixtures/inbox';

vi.mock('@/api/inbox', () => ({
  getInbox: vi.fn(),
  getInboxUnread: vi.fn(),
  markInboxRead: vi.fn(),
}));

import { getInbox, getInboxUnread, markInboxRead, type InboxUnread } from '@/api/inbox';
import {
  useInbox,
  useInboxUnreadCount,
  useInboxUnreadSummary,
  useMarkInboxRead,
} from '@/hooks/useInbox';
import { queryKeys } from '@/lib/queryKeys';
import { useAuthStore } from '@/store/authStore';

const mockGet = vi.mocked(getInbox);
const mockCount = vi.mocked(getInboxUnread);
const total = (n: number): InboxUnread => ({ unread_count: n, by_circle: null });
const mockMark = vi.mocked(markInboxRead);

function setup() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const wrapper = ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={client}>{children}</QueryClientProvider>
  );
  return { client, wrapper };
}

describe('useInbox hooks', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.stubEnv('VITE_NOTIFICATIONS_INBOX', 'on');
    useAuthStore.setState({ isAuthenticated: true });
  });
  afterEach(() => vi.unstubAllEnvs());

  it('flag off: no request is made', async () => {
    vi.stubEnv('VITE_NOTIFICATIONS_INBOX', 'off');
    const { wrapper } = setup();
    renderHook(() => ({ a: useInbox(), b: useInboxUnreadCount() }), { wrapper });
    await new Promise((r) => setTimeout(r, 20));
    expect(mockGet).not.toHaveBeenCalled();
    expect(mockCount).not.toHaveBeenCalled();
  });

  it('signed out: no request is made', async () => {
    useAuthStore.setState({ isAuthenticated: false });
    const { wrapper } = setup();
    renderHook(() => useInboxUnreadCount(), { wrapper });
    await new Promise((r) => setTimeout(r, 20));
    expect(mockCount).not.toHaveBeenCalled();
  });

  it('loads the list and the unread count', async () => {
    const item = makeItem();
    mockGet.mockResolvedValue({ items: [item], unread_count: 1 });
    mockCount.mockResolvedValue({ unread_count: 4, by_circle: { [CIRCLE_A]: 4 } });
    const { wrapper } = setup();
    const { result } = renderHook(
      () => ({ a: useInbox(), b: useInboxUnreadCount(), c: useInboxUnreadSummary() }),
      { wrapper }
    );
    await waitFor(() => expect(result.current.a.data?.items).toEqual([item]));
    await waitFor(() => expect(result.current.b.data).toBe(4));
    expect(result.current.c.data).toEqual({ unread_count: 4, by_circle: { [CIRCLE_A]: 4 } });
    // One request feeds both the total and the per-circle split.
    expect(mockCount).toHaveBeenCalledTimes(1);
    expect(mockGet).toHaveBeenCalledWith(undefined);
  });

  it('scoped list: passes circle_id and lives under its own key', async () => {
    const mine = makeItem({ circle_id: CIRCLE_A });
    const { client, wrapper } = setup();
    // Another scope's cached rows must never show here.
    client.setQueryData(queryKeys.inbox, { items: [makeItem({ circle_id: CIRCLE_B })], unread_count: 1 });
    mockGet.mockResolvedValue({ items: [mine], unread_count: 1 });
    const { result } = renderHook(() => useInbox(CIRCLE_A), { wrapper });
    expect(result.current.data).toBeUndefined();
    await waitFor(() => expect(result.current.data?.items).toEqual([mine]));
    expect(mockGet).toHaveBeenCalledWith(CIRCLE_A);
    expect(client.getQueryData(queryKeys.inboxForCircle(CIRCLE_A))).toEqual({
      items: [mine],
      unread_count: 1,
    });
  });

  it('scoped mark all: sends circle_id, only that circle clears (lists + summary)', async () => {
    const a1 = makeItem({ circle_id: CIRCLE_A });
    const a2 = makeItem({ circle_id: CIRCLE_A });
    const b1 = makeItem({ circle_id: CIRCLE_B });
    const { client, wrapper } = setup();
    client.setQueryData(queryKeys.inbox, { items: [a1, b1, a2], unread_count: 3 });
    client.setQueryData(queryKeys.inboxForCircle(CIRCLE_A), { items: [a1, a2], unread_count: 2 });
    client.setQueryData(queryKeys.inboxForCircle(CIRCLE_B), { items: [b1], unread_count: 1 });
    client.setQueryData<InboxUnread>(queryKeys.inboxUnread, {
      unread_count: 3,
      by_circle: { [CIRCLE_A]: 2, [CIRCLE_B]: 1 },
    });
    let resolve!: (n: number) => void;
    mockMark.mockReturnValue(new Promise<number>((r) => (resolve = r)));
    mockGet.mockImplementation(() => new Promise(() => {}));
    mockCount.mockImplementation(() => new Promise(() => {}));
    const { result } = renderHook(() => useMarkInboxRead(), { wrapper });
    act(() => result.current.mutate({ all: true, circle_id: CIRCLE_A }));
    await waitFor(() =>
      expect(client.getQueryData(queryKeys.inboxUnread)).toEqual({
        unread_count: 1,
        by_circle: { [CIRCLE_B]: 1 },
      })
    );
    expect(mockMark).toHaveBeenCalledWith({ all: true, circle_id: CIRCLE_A });
    type L = { items: (typeof a1)[]; unread_count: number };
    const all = client.getQueryData<L>(queryKeys.inbox)!;
    expect(all.unread_count).toBe(1);
    expect(all.items.find((i) => i.id === b1.id)?.read_at).toBeNull();
    expect(all.items.filter((i) => i.circle_id === CIRCLE_A).every((i) => i.read_at)).toBe(true);
    const scopedA = client.getQueryData<L>(queryKeys.inboxForCircle(CIRCLE_A))!;
    expect(scopedA.unread_count).toBe(0);
    expect(scopedA.items.every((i) => i.read_at)).toBe(true);
    const scopedB = client.getQueryData<L>(queryKeys.inboxForCircle(CIRCLE_B))!;
    expect(scopedB).toEqual({ items: [b1], unread_count: 1 });
    await act(async () => resolve(2));
  });

  it('mark by ids: by_circle drops for that row\'s circle only', async () => {
    const a1 = makeItem({ circle_id: CIRCLE_A });
    const { client, wrapper } = setup();
    client.setQueryData(queryKeys.inboxForCircle(CIRCLE_A), { items: [a1], unread_count: 1 });
    client.setQueryData<InboxUnread>(queryKeys.inboxUnread, {
      unread_count: 2,
      by_circle: { [CIRCLE_A]: 1, [CIRCLE_B]: 1 },
    });
    mockMark.mockReturnValue(new Promise<number>(() => {}));
    mockGet.mockImplementation(() => new Promise(() => {}));
    const { result } = renderHook(() => useMarkInboxRead(), { wrapper });
    act(() => result.current.mutate({ ids: [a1.id] }));
    await waitFor(() =>
      expect(client.getQueryData(queryKeys.inboxUnread)).toEqual({
        unread_count: 1,
        by_circle: { [CIRCLE_B]: 1 },
      })
    );
  });

  it('mark read: optimistic for ids, then invalidates', async () => {
    const a = makeItem();
    const b = makeItem();
    const { client, wrapper } = setup();
    client.setQueryData(queryKeys.inbox, { items: [a, b], unread_count: 2 });
    client.setQueryData(queryKeys.inboxUnread, total(2));
    let resolve!: (n: number) => void;
    mockMark.mockReturnValue(new Promise<number>((r) => (resolve = r)));
    mockGet.mockResolvedValue({ items: [a, b], unread_count: 1 });
    mockCount.mockResolvedValue(total(1));
    const { result } = renderHook(() => useMarkInboxRead(), { wrapper });
    act(() => result.current.mutate({ ids: [a.id] }));
    await waitFor(() => {
      const list = client.getQueryData<{ items: typeof a[]; unread_count: number }>(queryKeys.inbox);
      expect(list?.items.find((i) => i.id === a.id)?.read_at).not.toBeNull();
      expect(list?.items.find((i) => i.id === b.id)?.read_at).toBeNull();
      expect(list?.unread_count).toBe(1);
    });
    expect(client.getQueryData(queryKeys.inboxUnread)).toEqual(total(1));
    expect(mockMark).toHaveBeenCalledWith({ ids: [a.id] });
    await act(async () => resolve(1));
  });

  it('mark all: zeroes the count; failure rolls back', async () => {
    const a = makeItem();
    const { client, wrapper } = setup();
    client.setQueryData(queryKeys.inbox, { items: [a], unread_count: 1 });
    client.setQueryData(queryKeys.inboxUnread, total(1));
    let reject!: (e: Error) => void;
    mockMark.mockReturnValue(new Promise<number>((_, r) => (reject = r)));
    mockGet.mockResolvedValue({ items: [a], unread_count: 1 });
    mockCount.mockResolvedValue(total(1));
    const { result } = renderHook(() => useMarkInboxRead(), { wrapper });
    act(() => result.current.mutate({ all: true }));
    await waitFor(() => expect(client.getQueryData(queryKeys.inboxUnread)).toEqual(total(0)));
    await act(async () => reject(new Error('boom')));
    await waitFor(() => expect(result.current.isError).toBe(true));
    expect(client.getQueryData(queryKeys.inboxUnread)).toEqual(total(1));
    expect(
      client.getQueryData<{ items: typeof a[] }>(queryKeys.inbox)?.items[0].read_at
    ).toBeNull();
  });
});
