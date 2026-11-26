import { act, renderHook, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { ReactNode } from 'react';
import '@/i18n';
import { makeItem } from '@/test/fixtures/inbox';

vi.mock('@/api/inbox', () => ({
  getInbox: vi.fn(),
  getInboxUnread: vi.fn(),
  markInboxRead: vi.fn(),
}));
const showToast = vi.hoisted(() => vi.fn());
vi.mock('@/components/ui', () => ({ useToast: () => ({ showToast }) }));

import { getInbox, getInboxUnread, markInboxRead } from '@/api/inbox';
import { useMarkInboxRead } from '@/hooks/useInbox';
import { queryKeys } from '@/lib/queryKeys';

const mockMark = vi.mocked(markInboxRead);
const refused = { success: false, error: { code: 'FORBIDDEN', message: 'x' } };

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

beforeEach(() => vi.clearAllMocks());

describe('useMarkInboxRead error feedback (W6)', () => {
  it('POSITIVE: a failed mark-read of a row rolls back and shows the generic save error once', async () => {
    const { client, item, wrapper } = setup();
    mockMark.mockRejectedValue(refused);
    const { result } = renderHook(() => useMarkInboxRead(), { wrapper });
    act(() => result.current.mutate({ ids: [item.id] }));
    await waitFor(() => expect(showToast).toHaveBeenCalledTimes(1));
    expect(showToast).toHaveBeenCalledWith("Couldn't save your changes. Please try again.", 'error');
    const list = client.getQueryData<{ items: { read_at: string | null }[] }>(queryKeys.inbox);
    expect(list?.items[0].read_at).toBeNull();
  });

  it('NEGATIVE: a successful mark-read shows no toast', async () => {
    const { item, wrapper } = setup();
    mockMark.mockResolvedValue(1);
    const { result } = renderHook(() => useMarkInboxRead(), { wrapper });
    await act(async () => {
      await result.current.mutateAsync({ ids: [item.id] });
    });
    expect(showToast).not.toHaveBeenCalled();
  });

  it('NEGATIVE: a failed mark-ALL does not toast in the hook (the page owns that message)', async () => {
    const { wrapper } = setup();
    mockMark.mockRejectedValue(refused);
    const { result } = renderHook(() => useMarkInboxRead(), { wrapper });
    await act(async () => {
      await result.current.mutateAsync({ all: true }).catch(() => undefined);
    });
    expect(showToast).not.toHaveBeenCalled();
  });
});
