import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { renderHook, waitFor } from '@testing-library/react';
import { createElement, type ReactNode } from 'react';
import { apiClient } from '@/lib/api';
import { useEventNotesRange } from '@/hooks/useEventNotes';

// task 30 — the care summary share sheet's "visit notes" source. A separate
// query family from the per-event `useEventNotes` (see useEventNotes.test.tsx
// in this same directory for that one).

const mockGet = vi.mocked(apiClient.get);

function makeWrapper(client: QueryClient) {
  return function Wrapper({ children }: { children: ReactNode }) {
    return createElement(QueryClientProvider, { client }, children);
  };
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe('useEventNotesRange', () => {
  it('fetches the range endpoint once circleId + params are both present', async () => {
    mockGet.mockResolvedValueOnce({ success: true, data: { notes: [] } } as never);
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });

    const { result } = renderHook(
      () =>
        useEventNotesRange('circle-1', {
          from: '2026-05-01',
          to: '2026-06-01',
          event_type: 'appointment',
        }),
      { wrapper: makeWrapper(client) }
    );

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(mockGet).toHaveBeenCalledWith('/circles/circle-1/event-notes', {
      params: { from: '2026-05-01', to: '2026-06-01', event_type: 'appointment' },
    });
  });

  it('stays disabled — no request at all — while params are undefined', () => {
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });

    const { result } = renderHook(() => useEventNotesRange('circle-1', undefined), {
      wrapper: makeWrapper(client),
    });

    expect(result.current.fetchStatus).toBe('idle');
    expect(mockGet).not.toHaveBeenCalled();
  });

  it('keys two different windows separately (no cross-window cache collision)', async () => {
    mockGet
      .mockResolvedValueOnce({ success: true, data: { notes: [] } } as never)
      .mockResolvedValueOnce({ success: true, data: { notes: [] } } as never);
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });

    const { result, rerender } = renderHook(
      ({ from, to }: { from: string; to: string }) =>
        useEventNotesRange('circle-1', { from, to }),
      { wrapper: makeWrapper(client), initialProps: { from: '2026-05-01', to: '2026-06-01' } }
    );
    await waitFor(() => expect(result.current.isSuccess).toBe(true));

    rerender({ from: '2026-04-01', to: '2026-05-01' });
    await waitFor(() => expect(mockGet).toHaveBeenCalledTimes(2));

    expect(mockGet).toHaveBeenNthCalledWith(1, '/circles/circle-1/event-notes', {
      params: { from: '2026-05-01', to: '2026-06-01' },
    });
    expect(mockGet).toHaveBeenNthCalledWith(2, '/circles/circle-1/event-notes', {
      params: { from: '2026-04-01', to: '2026-05-01' },
    });
  });
});
