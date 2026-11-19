// 1.4.3 item 7 (web): the as-needed dose's quiet retry. A network failure is
// queued (lib/writeRetryQueue.ts) and re-sent with the SAME client_request_id and
// the tap time's given_at; a definite refusal is not retried.

import { act, renderHook } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { ReactNode } from 'react';
import type { Mock } from 'vitest';

vi.mock('@/lib/analytics', () => ({
  Analytics: {
    writeRetryScheduled: vi.fn(),
    writeRetrySucceeded: vi.fn(),
    writeRetryGaveUp: vi.fn(),
    errorOccurred: vi.fn(),
  },
}));

import { apiClient } from '@/lib/api';
import { ToastProvider } from '@/components/ui';
import { MEDICATION_UNDO_DELAY_MS } from '../useMedicationUndo';
import { useAsNeededUndo } from '../useAsNeededUndo';
import {
  WRITE_RETRY_MAX_AGE_MS,
  __resetWriteRetryForTests,
  getFailedCount,
  pendingCount,
} from '@/lib/writeRetryQueue';

const post = apiClient.post as unknown as Mock;
const REQUEST_ID = '5b1c8c0e-3e1f-4a43-9f43-0d2c1f3d9a11';
const URL = '/circles/c1/medications/prn-1/as-needed-doses';
const TAP = new Date('2026-03-15T15:00:00.000Z');
const entry = {
  eventId: 'prn-1',
  name: 'Ibuprofen',
  body: { client_request_id: REQUEST_ID, note: null, known_last_dose_id: null },
};
const network = () => ({ isAxiosError: true, code: 'ERR_NETWORK', message: 'Network Error' });
const ok = (replayed = false) => ({
  success: true,
  data: { dose: { id: 'd1' }, summary: { last_dose: null }, replayed },
});

function setup(handlers: Record<string, unknown> = {}) {
  const qc = new QueryClient({ defaultOptions: { mutations: { retry: false } } });
  const wrapper = ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={qc}>
      <ToastProvider>{children}</ToastProvider>
    </QueryClientProvider>
  );
  return renderHook(() => useAsNeededUndo({ circleId: 'c1', ...handlers }), { wrapper });
}
const advance = (ms: number) =>
  act(async () => {
    await vi.advanceTimersByTimeAsync(ms);
  });

beforeEach(() => {
  vi.useFakeTimers({ now: TAP });
  __resetWriteRetryForTests();
  post.mockReset();
});
afterEach(() => vi.useRealTimers());

describe('useAsNeededUndo: quiet retry', () => {
  it('a network failure is not reported; the dose stays pending and is queued', async () => {
    post.mockRejectedValueOnce(network());
    const onError = vi.fn();
    const { result } = setup({ onError });
    act(() => result.current.log(entry));
    await advance(MEDICATION_UNDO_DELAY_MS);
    expect(post).toHaveBeenCalledTimes(1);
    expect(onError).not.toHaveBeenCalled();
    expect(pendingCount()).toBe(1);
    expect(result.current.inFlight['prn-1']).toBe(true);
  });

  it('P7-5 the retry reuses client_request_id and the given_at of the TAP, not "now"', async () => {
    post.mockRejectedValueOnce(network()).mockResolvedValue(ok());
    const onLogged = vi.fn();
    const { result } = setup({ onLogged });
    act(() => result.current.log(entry));
    await advance(MEDICATION_UNDO_DELAY_MS);
    // The first send carries no given_at (the server stamps now), as today.
    expect(post.mock.calls[0][1]).toEqual(entry.body);
    await advance(2100);
    expect(post).toHaveBeenCalledTimes(2);
    expect(post.mock.calls[1][0]).toBe(URL);
    expect(post.mock.calls[1][1]).toEqual({ ...entry.body, given_at: TAP.toISOString() });
    expect(onLogged).toHaveBeenCalledTimes(1);
    expect(result.current.pending['prn-1']).toBeUndefined();
  });

  it('a given_at the caregiver chose is kept as chosen', async () => {
    const chosen = '2026-03-15T14:30:00.000Z';
    post.mockRejectedValueOnce(network()).mockResolvedValue(ok());
    const { result } = setup();
    act(() => result.current.log({ ...entry, body: { ...entry.body, given_at: chosen } }));
    await advance(MEDICATION_UNDO_DELAY_MS);
    await advance(2100);
    expect(post.mock.calls[1][1].given_at).toBe(chosen);
  });

  it('N7-4 no duplicate dose: the first attempt landed (lost response), the retry is a replay', async () => {
    post.mockRejectedValueOnce(network()).mockResolvedValue(ok(true));
    const onLogged = vi.fn();
    const { result } = setup({ onLogged });
    act(() => result.current.log(entry));
    await advance(MEDICATION_UNDO_DELAY_MS);
    await advance(2100);
    // One caller notification, flagged replayed so the caller counts no NEW dose.
    expect(onLogged).toHaveBeenCalledTimes(1);
    expect(onLogged.mock.calls[0][1].replayed).toBe(true);
    // Both sends carry the same idempotency key.
    expect(post.mock.calls.map((c) => c[1].client_request_id)).toEqual([REQUEST_ID, REQUEST_ID]);
    expect(pendingCount()).toBe(0);
  });

  it('while queued, logging the same medication again is ignored (one in flight per key)', async () => {
    post.mockRejectedValue(network());
    const { result } = setup();
    act(() => result.current.log(entry));
    await advance(MEDICATION_UNDO_DELAY_MS);
    act(() => result.current.log({ ...entry, body: { ...entry.body, client_request_id: 'another' } }));
    await advance(MEDICATION_UNDO_DELAY_MS);
    expect(post.mock.calls.every((c) => c[1].client_request_id === REQUEST_ID)).toBe(true);
  });

  it('N7-3 409 AS_NEEDED_DOSE_RECENTLY_LOGGED is not retried: the "log another?" prompt', async () => {
    post.mockRejectedValue({
      success: false,
      error: { code: 'AS_NEEDED_DOSE_RECENTLY_LOGGED', message: 'x', details: { given_at: 'x', given_by: {} } },
    });
    const onError = vi.fn();
    const onRecentlyLogged = vi.fn();
    const { result } = setup({ onError, onRecentlyLogged });
    act(() => result.current.log(entry));
    await advance(MEDICATION_UNDO_DELAY_MS);
    await advance(WRITE_RETRY_MAX_AGE_MS);
    expect(post).toHaveBeenCalledTimes(1);
    expect(pendingCount()).toBe(0);
    expect(onError.mock.calls.length + onRecentlyLogged.mock.calls.length).toBe(1);
  });

  it('N7-3 403 VIEW_ONLY is not retried: today\'s error, once', async () => {
    post.mockRejectedValue({ success: false, error: { code: 'VIEW_ONLY', message: 'x' } });
    const onError = vi.fn();
    const { result } = setup({ onError });
    act(() => result.current.log(entry));
    await advance(MEDICATION_UNDO_DELAY_MS);
    await advance(WRITE_RETRY_MAX_AGE_MS);
    expect(post).toHaveBeenCalledTimes(1);
    expect(onError).toHaveBeenCalledTimes(1);
  });

  it('a refusal on the retry itself is reported once and stops the ladder', async () => {
    post.mockRejectedValueOnce(network()).mockRejectedValue({
      success: false,
      error: { code: 'MEDICATION_DISCONTINUED', message: 'x' },
    });
    const onError = vi.fn();
    const { result } = setup({ onError });
    act(() => result.current.log(entry));
    await advance(MEDICATION_UNDO_DELAY_MS);
    await advance(2100);
    expect(onError).toHaveBeenCalledTimes(1);
    await advance(WRITE_RETRY_MAX_AGE_MS);
    expect(post).toHaveBeenCalledTimes(2);
    expect(result.current.pending['prn-1']).toBeUndefined();
  });

  it('gives up quietly (no per-dose error): the card offers the dose again and the notice takes over', async () => {
    post.mockRejectedValue(network());
    const onError = vi.fn();
    const { result } = setup({ onError });
    act(() => result.current.log(entry));
    await advance(MEDICATION_UNDO_DELAY_MS);
    await advance(WRITE_RETRY_MAX_AGE_MS + 60_000);
    expect(onError).not.toHaveBeenCalled();
    expect(getFailedCount()).toBe(1);
    expect(result.current.pending['prn-1']).toBeUndefined();
  });
});
