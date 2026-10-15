import { act, renderHook, waitFor } from '@testing-library/react';
import {
  QueryClient,
  QueryClientProvider,
  onlineManager,
  useMutation,
  useQuery,
} from '@tanstack/react-query';
import type { AxiosAdapter } from 'axios';
import type { ReactNode } from 'react';
import { queryClient as appQueryClient } from '@/lib/queryClient';

// NO OFFLINE WRITE QUEUE (owner decision 2026-10-14).
//
// Under `mutations.networkMode: 'online'` a write fired offline was PAUSED and
// silently REPLAYED on reconnect — a dose marked offline could land on top of
// a different answer another caregiver gave meanwhile. These tests drive the
// APP's own defaults (lib/queryClient.ts) and the REAL apiClient (lib/api.ts,
// unmocked here — test/setup.ts mocks it globally) with only the network
// adapter faked, so they fail if either half regresses: flip mutations back to
// 'online' and the write never runs offline and is replayed on reconnect; drop
// the api.ts backstop and the offline write reaches the network.

const { apiClient } = await vi.importActual<typeof import('@/lib/api')>('@/lib/api');

const adapter = vi.fn<AxiosAdapter>(async (config) => ({
  data: { success: true, data: { ok: true } },
  status: 200,
  statusText: 'OK',
  headers: {},
  config,
}));

let originalAdapter: unknown;
beforeAll(() => {
  originalAdapter = apiClient.defaults.adapter;
  apiClient.defaults.adapter = adapter;
});
afterAll(() => {
  apiClient.defaults.adapter = originalAdapter as typeof apiClient.defaults.adapter;
});

beforeEach(() => adapter.mockClear());
afterEach(() => onlineManager.setOnline(true));

/** A client built from the app's real defaults (not a test-local config). */
function appDefaultsClient(): QueryClient {
  return new QueryClient({ defaultOptions: appQueryClient.getDefaultOptions() });
}

function wrapperFor(client: QueryClient) {
  return ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={client}>{children}</QueryClientProvider>
  );
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

describe('offline writes: fail at once, never replayed', () => {
  it('the app runs mutations with networkMode "always"', () => {
    expect(appQueryClient.getDefaultOptions().mutations?.networkMode).toBe('always');
    // Reads still pause offline (and refetch on reconnect) — unchanged.
    expect(appQueryClient.getDefaultOptions().queries?.networkMode).toBe('online');
    expect(appQueryClient.getDefaultOptions().queries?.refetchOnReconnect).toBe('always');
  });

  it('a write fired offline fails immediately with OFFLINE, sends nothing, and is not replayed on reconnect', async () => {
    const client = appDefaultsClient();
    const mutationFn = vi.fn(() =>
      apiClient.post('/circles/c-1/medication-confirmations', { status: 'taken' })
    );
    const { result } = renderHook(() => useMutation({ mutationFn }), {
      wrapper: wrapperFor(client),
    });

    act(() => onlineManager.setOnline(false));
    act(() => result.current.mutate());

    await waitFor(() => expect(result.current.isError).toBe(true));
    expect(result.current.isPaused).toBe(false);
    expect(result.current.error).toMatchObject({ error: { code: 'OFFLINE' } });
    expect(mutationFn).toHaveBeenCalledTimes(1);
    expect(adapter).not.toHaveBeenCalled();

    // Reconnect: nothing is held to resume.
    await act(async () => {
      onlineManager.setOnline(true);
      await sleep(50);
    });
    expect(mutationFn).toHaveBeenCalledTimes(1);
    expect(adapter).not.toHaveBeenCalled();
    expect(client.getMutationCache().getAll().some((m) => m.state.isPaused)).toBe(false);
    expect(result.current.isError).toBe(true);
  });

  it('online, the same write is sent once', async () => {
    const client = appDefaultsClient();
    const { result } = renderHook(
      () => useMutation({ mutationFn: () => apiClient.post('/circles/c-1/notes', { body: 'x' }) }),
      { wrapper: wrapperFor(client) }
    );
    act(() => result.current.mutate());
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(adapter).toHaveBeenCalledTimes(1);
  });

  it('every write verb is refused offline; reads are not touched by the backstop', async () => {
    onlineManager.setOnline(false);
    for (const send of [
      () => apiClient.post('/circles/c-1/events', {}),
      () => apiClient.put('/circles/c-1/emergency-info', {}),
      () => apiClient.patch('/circles/c-1/events/e-1', {}),
      () => apiClient.delete('/circles/c-1/notes/n-1'),
    ]) {
      await expect(send()).rejects.toMatchObject({ error: { code: 'OFFLINE' } });
    }
    expect(adapter).not.toHaveBeenCalled();

    // A GET is React Query's to pause, not the interceptor's to refuse.
    await apiClient.get('/circles');
    expect(adapter).toHaveBeenCalledTimes(1);
  });

  it('reconnect refetches what is on screen, even data younger than staleTime', async () => {
    const client = appDefaultsClient();
    const queryFn = vi.fn(async () => 'rows');
    const { result } = renderHook(() => useQuery({ queryKey: ['doses'], queryFn }), {
      wrapper: wrapperFor(client),
    });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(queryFn).toHaveBeenCalledTimes(1);

    act(() => onlineManager.setOnline(false));
    // Offline: the loaded data stays on screen (read-only), nothing refetches.
    expect(result.current.data).toBe('rows');
    await act(async () => {
      onlineManager.setOnline(true);
      await sleep(20);
    });
    await waitFor(() => expect(queryFn).toHaveBeenCalledTimes(2));
  });
});
