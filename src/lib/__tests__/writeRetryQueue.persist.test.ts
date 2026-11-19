import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@/lib/analytics', () => ({
  Analytics: {
    writeRetryScheduled: vi.fn(),
    writeRetrySucceeded: vi.fn(),
    writeRetryGaveUp: vi.fn(),
  },
}));

import {
  WRITE_RETRY_MAX_AGE_MS,
  WRITE_RETRY_STORAGE_KEY,
  __resetWriteRetryForTests,
  clearWriteRetryQueue,
  dismissFailedWrites,
  enqueueWriteRetry,
  getNoticeCount,
  hydrateWriteRetryQueue,
  isQueueableFailure,
  isRetryableTransportFailure,
} from '@/lib/writeRetryQueue';
import { OFFLINE_WRITE_CODE } from '@/lib/offlineWrite';

const network = () => ({ isAxiosError: true, code: 'ERR_NETWORK', message: 'Network Error' });
const offlineRejection = () => ({ success: false, error: { code: OFFLINE_WRITE_CODE, message: 'offline' } });

beforeEach(() => {
  vi.useFakeTimers();
  __resetWriteRetryForTests();
  localStorage.clear();
  sessionStorage.clear();
});
afterEach(() => vi.useRealTimers());

describe('1.4.3 item 12: queue max age is 5 minutes (mobile parity)', () => {
  it('the max age is 5 min', () => {
    expect(WRITE_RETRY_MAX_AGE_MS).toBe(5 * 60_000);
  });
  it('NEGATIVE: still retrying at 4 min 30 s, not given up', async () => {
    const send = vi.fn().mockRejectedValue(network());
    enqueueWriteRetry({ key: 'k', kind: 'task_complete', circleId: 'c', send });
    await vi.advanceTimersByTimeAsync(4 * 60_000 + 30_000);
    expect(getNoticeCount()).toBe(0);
    await vi.advanceTimersByTimeAsync(60_000);
    expect(getNoticeCount()).toBe(1);
  });
});

describe('1.4.3 item 8: an OFFLINE rejection is queueable like a transport failure', () => {
  it('queueable: offline rejection and transport failure', () => {
    expect(isQueueableFailure(offlineRejection())).toBe(true);
    expect(isQueueableFailure(network())).toBe(true);
  });
  it('NEGATIVE: a real refusal is not queueable; offline rejection is not a transport failure (in-call retry unchanged)', () => {
    expect(isQueueableFailure({ success: false, error: { code: 'VIEW_ONLY' } })).toBe(false);
    expect(isRetryableTransportFailure(offlineRejection())).toBe(false);
  });
  it('a resend answered with an offline rejection keeps waiting, never reported as refused', async () => {
    const onRefused = vi.fn();
    const send = vi.fn().mockRejectedValueOnce(offlineRejection()).mockResolvedValue({});
    enqueueWriteRetry({ key: 'k', kind: 'task_complete', circleId: 'c', send, onRefused });
    await vi.advanceTimersByTimeAsync(2_000);
    expect(onRefused).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(5_000);
    expect(send).toHaveBeenCalledTimes(2);
  });
});

describe('1.4.3 item 13: outstanding count survives a reload (kind + tap time only)', () => {
  it('persists kind and tap time, never a payload or id', () => {
    enqueueWriteRetry({
      key: 'task_complete:secret-event-id',
      kind: 'task_complete',
      circleId: 'secret-circle-id',
      send: vi.fn().mockRejectedValue(network()),
    });
    const raw = localStorage.getItem(WRITE_RETRY_STORAGE_KEY) ?? '';
    expect(raw).toContain('task_complete');
    expect(raw).not.toContain('secret-event-id');
    expect(raw).not.toContain('secret-circle-id');
  });

  it('after a reload the lost save is counted once, then dismissed from storage', () => {
    enqueueWriteRetry({
      key: 'k',
      kind: 'task_complete',
      circleId: 'c',
      send: vi.fn().mockRejectedValue(network()),
    });
    // Reload: memory gone, storage (and this tab's sessionStorage id) remain.
    const saved = localStorage.getItem(WRITE_RETRY_STORAGE_KEY);
    __resetWriteRetryForTests();
    localStorage.setItem(WRITE_RETRY_STORAGE_KEY, saved ?? '');
    expect(getNoticeCount()).toBe(0);
    hydrateWriteRetryQueue();
    expect(getNoticeCount()).toBe(1);
    dismissFailedWrites();
    expect(getNoticeCount()).toBe(0);
    expect(localStorage.getItem(WRITE_RETRY_STORAGE_KEY)).toBeNull();
  });

  it('NEGATIVE: a save that landed leaves nothing behind to report', async () => {
    enqueueWriteRetry({ key: 'k', kind: 'task_complete', circleId: 'c', send: vi.fn().mockResolvedValue({}) });
    await vi.advanceTimersByTimeAsync(2_000);
    expect(localStorage.getItem(WRITE_RETRY_STORAGE_KEY)).toBeNull();
    hydrateWriteRetryQueue();
    expect(getNoticeCount()).toBe(0);
  });

  it('NEGATIVE: sign-out wipes storage, a later hydrate reports nothing', () => {
    enqueueWriteRetry({ key: 'k', kind: 'task_complete', circleId: 'c', send: vi.fn().mockRejectedValue(network()) });
    clearWriteRetryQueue();
    expect(localStorage.getItem(WRITE_RETRY_STORAGE_KEY)).toBeNull();
    hydrateWriteRetryQueue();
    expect(getNoticeCount()).toBe(0);
  });

  it('NEGATIVE: rows older than the failed max age (10 min) are not reported', () => {
    enqueueWriteRetry(
      { key: 'k', kind: 'task_complete', circleId: 'c', send: vi.fn().mockRejectedValue(network()) },
      { tapAt: Date.now() - 11 * 60_000 }
    );
    const saved = localStorage.getItem(WRITE_RETRY_STORAGE_KEY);
    __resetWriteRetryForTests();
    localStorage.setItem(WRITE_RETRY_STORAGE_KEY, saved ?? '');
    hydrateWriteRetryQueue();
    expect(getNoticeCount()).toBe(0);
  });

  it('NEGATIVE: blocked storage never throws and the queue still works', () => {
    const spy = vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new Error('blocked');
    });
    expect(() =>
      enqueueWriteRetry({ key: 'k', kind: 'task_complete', circleId: 'c', send: vi.fn().mockRejectedValue(network()) })
    ).not.toThrow();
    expect(() => hydrateWriteRetryQueue()).not.toThrow();
    spy.mockRestore();
  });
});
