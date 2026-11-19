import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, render } from '@testing-library/react';
import '@/i18n';

const showToast = vi.hoisted(() => vi.fn());
vi.mock('@/components/ui', () => ({ useToast: () => ({ showToast }) }));
vi.mock('@/lib/analytics', () => ({
  Analytics: {
    writeRetryScheduled: vi.fn(),
    writeRetrySucceeded: vi.fn(),
    writeRetryGaveUp: vi.fn(),
  },
}));

import { NOTICE_SETTLE_MS, WriteRetryNoticeHost } from '@/components/WriteRetryNoticeHost';
import {
  WRITE_RETRY_MAX_AGE_MS,
  __resetWriteRetryForTests,
  enqueueWriteRetry,
  getFailedCount,
} from '@/lib/writeRetryQueue';

const network = () => ({ isAxiosError: true, code: 'ERR_NETWORK', message: 'Network Error' });

beforeEach(() => {
  vi.useFakeTimers();
  __resetWriteRetryForTests();
  showToast.mockClear();
});
afterEach(() => vi.useRealTimers());

/** Run the ladder to its end, then let the notice's settle window pass. */
async function giveUp(): Promise<void> {
  await act(async () => {
    await vi.advanceTimersByTimeAsync(WRITE_RETRY_MAX_AGE_MS + 60_000);
  });
  await act(async () => {
    await vi.advanceTimersByTimeAsync(NOTICE_SETTLE_MS + 50);
  });
}

describe('WriteRetryNoticeHost', () => {
  it('P7-1 eleven failures give one notice: one toast, N = 11, no per-item report', async () => {
    render(<WriteRetryNoticeHost />);
    const onRefused = vi.fn();
    for (let i = 0; i < 11; i++) {
      enqueueWriteRetry({
        key: `task_complete:c1:t${i}`,
        kind: 'task_complete',
        circleId: 'c1',
        send: vi.fn().mockRejectedValue(network()),
        onRefused,
      });
    }
    await giveUp();
    expect(getFailedCount()).toBe(11);
    expect(showToast).toHaveBeenCalledTimes(1);
    const [message, type, action] = showToast.mock.calls[0];
    expect(message).toBe("Couldn't save 11 updates");
    expect(type).toBe('error');
    expect(action.label).toBe('Retry');
    expect(onRefused).not.toHaveBeenCalled();
  });

  it('the singular reads "1 update"', async () => {
    render(<WriteRetryNoticeHost />);
    enqueueWriteRetry({
      key: 'k',
      kind: 'task_complete',
      circleId: 'c1',
      send: vi.fn().mockRejectedValue(network()),
    });
    await giveUp();
    expect(showToast.mock.calls[0][0]).toBe("Couldn't save 1 update");
  });

  it('the Retry action re-sends what gave up, and nothing else is shown', async () => {
    render(<WriteRetryNoticeHost />);
    const send = vi.fn().mockRejectedValue(network());
    enqueueWriteRetry({ key: 'k', kind: 'task_complete', circleId: 'c1', send });
    await giveUp();
    const calls = send.mock.calls.length;
    send.mockResolvedValue({});
    await act(async () => {
      showToast.mock.calls[0][2].onClick();
      await vi.advanceTimersByTimeAsync(0);
    });
    expect(send).toHaveBeenCalledTimes(calls + 1);
    expect(getFailedCount()).toBe(0);
    expect(showToast).toHaveBeenCalledTimes(1);
  });

  it('a save that lands on a retry shows no notice at all', async () => {
    render(<WriteRetryNoticeHost />);
    enqueueWriteRetry({
      key: 'k',
      kind: 'task_complete',
      circleId: 'c1',
      send: vi.fn().mockResolvedValue({}),
    });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(10_000);
    });
    expect(showToast).not.toHaveBeenCalled();
  });

  it('W2 the toast closing without Retry dismisses what gave up; using Retry does not', async () => {
    render(<WriteRetryNoticeHost />);
    enqueueWriteRetry({
      key: 'k',
      kind: 'task_complete',
      circleId: 'c1',
      send: vi.fn().mockRejectedValue(network()),
    });
    await giveUp();
    expect(getFailedCount()).toBe(1);
    act(() => showToast.mock.calls[0][2].onClose());
    expect(getFailedCount()).toBe(0);
  });

  it('N-W2 a toast replaced by a newer notice does not dismiss the newer give-ups', async () => {
    render(<WriteRetryNoticeHost />);
    const add = (k: string) =>
      enqueueWriteRetry({
        key: k,
        kind: 'task_complete',
        circleId: 'c1',
        send: vi.fn().mockRejectedValue(network()),
      });
    add('a');
    await giveUp();
    add('b');
    await giveUp();
    expect(showToast).toHaveBeenCalledTimes(2);
    act(() => showToast.mock.calls[0][2].onClose()); // the replaced one closing
    expect(getFailedCount()).toBe(2);
  });
});
