// The deferral window under "Gave a dose": undo cancels BEFORE any request;
// the POST carries the client_request_id; a dose the card already called
// "Logged" is FLUSHED (not lost) on unmount / pagehide.

import { act, renderHook } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { ReactNode } from 'react';
import type { Mock } from 'vitest';
import { apiClient } from '@/lib/api';
import { ToastProvider } from '@/components/ui';
import { MEDICATION_UNDO_DELAY_MS } from '../useMedicationUndo';
import { useAsNeededUndo } from '../useAsNeededUndo';

const post = apiClient.post as unknown as Mock;
const REQUEST_ID = '5b1c8c0e-3e1f-4a43-9f43-0d2c1f3d9a11';
const URL = '/circles/c1/medications/prn-1/as-needed-doses';
const entry = {
  eventId: 'prn-1',
  name: 'Ibuprofen',
  body: { client_request_id: REQUEST_ID, note: null, known_last_dose_id: null },
};

function setup(handlers: Parameters<typeof useAsNeededUndo>[0] extends infer T ? Partial<T> : never = {}) {
  const qc = new QueryClient({ defaultOptions: { mutations: { retry: false } } });
  const wrapper = ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={qc}>
      <ToastProvider>{children}</ToastProvider>
    </QueryClientProvider>
  );
  return renderHook(() => useAsNeededUndo({ circleId: 'c1', ...handlers }), { wrapper });
}

beforeEach(() => {
  post.mockReset();
  post.mockResolvedValue({ success: true, data: { dose: { id: 'd' }, summary: { last_dose: null } } });
  vi.useFakeTimers();
});
afterEach(() => vi.useRealTimers());

describe('useAsNeededUndo', () => {
  it('log() marks pending and sends NOTHING until the window closes', async () => {
    const { result } = setup();
    act(() => result.current.log(entry));
    expect(result.current.pending['prn-1']).toBe(true);
    await act(async () => {
      vi.advanceTimersByTime(MEDICATION_UNDO_DELAY_MS - 1);
    });
    expect(post).not.toHaveBeenCalled();
    await act(async () => {
      vi.advanceTimersByTime(1);
    });
    expect(post).toHaveBeenCalledWith(URL, entry.body);
  });

  it('undo() inside the window: never any request', async () => {
    const { result } = setup();
    act(() => result.current.log(entry));
    let cancelled = false;
    act(() => {
      cancelled = result.current.undo('prn-1');
    });
    expect(cancelled).toBe(true);
    expect(result.current.pending['prn-1']).toBeUndefined();
    await act(async () => {
      vi.advanceTimersByTime(MEDICATION_UNDO_DELAY_MS * 2);
    });
    expect(post).not.toHaveBeenCalled();
  });

  it('undo() after the request left is refused (the badge must not lie about a recorded dose)', async () => {
    post.mockReturnValue(new Promise(() => {}));
    const { result } = setup();
    act(() => result.current.log(entry));
    await act(async () => {
      vi.advanceTimersByTime(MEDICATION_UNDO_DELAY_MS);
    });
    let cancelled = true;
    act(() => {
      cancelled = result.current.undo('prn-1');
    });
    expect(cancelled).toBe(false);
    expect(result.current.inFlight['prn-1']).toBe(true);
  });

  it('a pending dose is FLUSHED on unmount, not dropped', async () => {
    const { result, unmount } = setup();
    act(() => result.current.log(entry));
    expect(post).not.toHaveBeenCalled();
    unmount();
    await vi.waitFor(() => expect(post).toHaveBeenCalledTimes(1));
    expect(post).toHaveBeenCalledWith(URL, entry.body);
  });

  it('pagehide flushes ONCE (the unmount that follows does not send it twice)', async () => {
    // No bearer token in the test, so the keepalive path declines and the
    // ordinary request takes over — one request either way.
    const { result, unmount } = setup();
    act(() => result.current.log(entry));
    act(() => {
      window.dispatchEvent(new Event('pagehide'));
    });
    unmount();
    await vi.waitFor(() => expect(post).toHaveBeenCalledTimes(1));
    for (let i = 0; i < 5; i++) await Promise.resolve();
    expect(post).toHaveBeenCalledTimes(1);
  });

  it('a second log() for the same medication while one is pending is ignored (never two doses)', async () => {
    const { result } = setup();
    act(() => {
      result.current.log(entry);
      result.current.log({ ...entry, body: { ...entry.body, client_request_id: 'other' } });
    });
    await act(async () => {
      vi.advanceTimersByTime(MEDICATION_UNDO_DELAY_MS);
    });
    expect(post).toHaveBeenCalledTimes(1);
    expect(post.mock.calls[0][1].client_request_id).toBe(REQUEST_ID);
  });

  it('logNow() sends immediately (no window) with the body it was given', async () => {
    const { result } = setup();
    act(() => result.current.logNow({ ...entry, circleId: 'c1', body: { ...entry.body, acknowledge_recent: true } }));
    await act(async () => {});
    expect(post).toHaveBeenCalledWith(URL, { ...entry.body, acknowledge_recent: true });
  });

  it('the dose goes to the circle it was logged in, even if the hook later renders another', async () => {
    const qc = new QueryClient();
    let circle = 'c1';
    const wrapper = ({ children }: { children: ReactNode }) => (
      <QueryClientProvider client={qc}>
        <ToastProvider>{children}</ToastProvider>
      </QueryClientProvider>
    );
    const { result, rerender } = renderHook(() => useAsNeededUndo({ circleId: circle }), { wrapper });
    act(() => result.current.log(entry));
    circle = 'c2';
    rerender();
    await act(async () => {
      vi.advanceTimersByTime(MEDICATION_UNDO_DELAY_MS);
    });
    expect(post.mock.calls[0][0]).toBe(URL);
  });
});
