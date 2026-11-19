import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { onlineManager } from '@tanstack/react-query';

vi.mock('@/lib/analytics', () => ({
  Analytics: {
    writeRetryScheduled: vi.fn(),
    writeRetrySucceeded: vi.fn(),
    writeRetryGaveUp: vi.fn(),
  },
}));

import { Analytics } from '@/lib/analytics';
import {
  WRITE_RETRY_MAX_AGE_MS,
  __resetWriteRetryForTests,
  cancelWriteRetry,
  clearWriteRetryQueue,
  dismissFailedWrites,
  enqueueWriteRetry,
  getFailedCount,
  hasWriteRetry,
  pendingCount,
  retryFailedWrites,
  sendWithQuietRetry,
  SessionEndedError,
  type WriteRetryEntry,
} from '@/lib/writeRetryQueue';

// 1.4.3 item 7 (web): the quiet retry queue. Named cases mirror mobile's
// (docs/plans/purchase-trial-gaps-1-4-3.md "Tests (both platforms)").

const network = () => ({ isAxiosError: true, code: 'ERR_NETWORK', message: 'Network Error' });
const timeout = () => ({ isAxiosError: true, code: 'ECONNABORTED', message: 'timeout of 15000ms exceeded' });
const refusal = (code: string) => ({ success: false, error: { code, message: code } });

function entry(key: string, over: Partial<WriteRetryEntry> = {}): WriteRetryEntry {
  return { key, kind: 'task_complete', circleId: 'c1', send: vi.fn().mockResolvedValue({}), ...over };
}

beforeEach(() => {
  vi.useFakeTimers();
  __resetWriteRetryForTests();
  vi.clearAllMocks();
  onlineManager.setOnline(true);
});
afterEach(() => {
  vi.useRealTimers();
  onlineManager.setOnline(true);
});

/** Advance `ms` and let every promise settle. */
const tick = (ms: number) => vi.advanceTimersByTimeAsync(ms);

describe('backoff', () => {
  it('P7-3 backoff retry succeeds at the 5 s step', async () => {
    const send = vi.fn().mockRejectedValueOnce(network()).mockResolvedValue({ ok: true });
    const onSettled = vi.fn();
    enqueueWriteRetry(entry('k', { send, onSettled }));
    expect(Analytics.writeRetryScheduled).toHaveBeenCalledWith('task_complete', 1);
    await tick(2000); // first step: fails again
    expect(send).toHaveBeenCalledTimes(1);
    expect(onSettled).not.toHaveBeenCalled();
    await tick(4900);
    expect(send).toHaveBeenCalledTimes(1);
    await tick(200); // the 5 s step
    expect(send).toHaveBeenCalledTimes(2);
    expect(onSettled).toHaveBeenCalledTimes(1);
    expect(Analytics.writeRetrySucceeded).toHaveBeenCalledWith('task_complete', 1, 'backoff');
    expect(pendingCount()).toBe(0);
  });

  it('a timeout is retried like a network error', async () => {
    const send = vi.fn().mockRejectedValueOnce(timeout()).mockResolvedValue({});
    enqueueWriteRetry(entry('k', { send }));
    await tick(2100);
    expect(send).toHaveBeenCalledTimes(1);
    await tick(5100);
    expect(send).toHaveBeenCalledTimes(2);
    expect(hasWriteRetry('k')).toBe(false);
  });
});

describe('resume', () => {
  it('P7-2 a retry after a resume succeeds (tab visible again)', async () => {
    const send = vi.fn().mockResolvedValue({});
    const onSettled = vi.fn();
    enqueueWriteRetry(entry('k', { send, onSettled }));
    // Long before the 2 s step: the tab comes back.
    document.dispatchEvent(new Event('visibilitychange'));
    await tick(0);
    expect(send).toHaveBeenCalledTimes(1);
    expect(onSettled).toHaveBeenCalledWith('resume', {});
    expect(Analytics.writeRetrySucceeded).toHaveBeenCalledWith('task_complete', 1, 'resume');
  });

  it('the browser coming back online runs everything waiting at once', async () => {
    const sends = [1, 2, 3, 4, 5].map(() => vi.fn().mockResolvedValue({}));
    sends.forEach((send, i) => enqueueWriteRetry(entry(`k${i}`, { send })));
    window.dispatchEvent(new Event('online'));
    await tick(0);
    sends.forEach((send) => expect(send).toHaveBeenCalledTimes(1));
    expect(Analytics.writeRetrySucceeded).toHaveBeenCalledWith('task_complete', 1, 'online');
  });

  it('nothing is sent while the browser is offline; it goes when it is back', async () => {
    const send = vi.fn().mockResolvedValue({});
    enqueueWriteRetry(entry('k', { send }));
    onlineManager.setOnline(false);
    await tick(3000);
    expect(send).not.toHaveBeenCalled();
    onlineManager.setOnline(true);
    window.dispatchEvent(new Event('online'));
    await tick(0);
    expect(send).toHaveBeenCalledTimes(1);
  });

  it('concurrency: a forced pass sends 3 at a time', async () => {
    let active = 0;
    let peak = 0;
    const slow = () =>
      vi.fn().mockImplementation(async () => {
        active += 1;
        peak = Math.max(peak, active);
        await new Promise((r) => setTimeout(r, 100));
        active -= 1;
      });
    for (let i = 0; i < 8; i++) enqueueWriteRetry(entry(`k${i}`, { send: slow() }));
    window.dispatchEvent(new Event('online'));
    await tick(1000);
    expect(peak).toBe(3);
    expect(pendingCount()).toBe(0);
  });
});

describe('supersede: the latest intent wins', () => {
  it('N7-1 complete, network fail, undo, then the retry timer fires: nothing is sent (the undo wins)', async () => {
    const send = vi.fn().mockResolvedValue({});
    enqueueWriteRetry(entry('task_complete:c1:t1', { send }));
    expect(cancelWriteRetry('task_complete:c1:t1')).toBe(true);
    await tick(WRITE_RETRY_MAX_AGE_MS);
    expect(send).not.toHaveBeenCalled();
    expect(pendingCount()).toBe(0);
  });

  it('an undo that lands while the re-read is in flight stops the resend', async () => {
    let releaseLanded!: (v: boolean) => void;
    const landed = vi.fn().mockReturnValue(new Promise<boolean>((r) => (releaseLanded = r)));
    const send = vi.fn().mockResolvedValue({});
    enqueueWriteRetry(entry('k', { send, landed }));
    await tick(2100); // the retry started: waiting on the re-read
    expect(landed).toHaveBeenCalledTimes(1);
    cancelWriteRetry('k');
    releaseLanded(false);
    await tick(0);
    expect(send).not.toHaveBeenCalled();
  });

  it('a new enqueue for the same key replaces the old entry (one entry, the newest send)', async () => {
    const oldSend = vi.fn().mockResolvedValue({});
    const newSend = vi.fn().mockResolvedValue({});
    enqueueWriteRetry(entry('k', { send: oldSend }));
    enqueueWriteRetry(entry('k', { send: newSend }));
    expect(pendingCount()).toBe(1);
    await tick(2100);
    expect(oldSend).not.toHaveBeenCalled();
    expect(newSend).toHaveBeenCalledTimes(1);
  });
});

describe('landed and replayed', () => {
  it('N7-2 first attempt actually landed (lost response): landed() says so, NO second send', async () => {
    const send = vi.fn().mockResolvedValue({});
    const landed = vi.fn().mockResolvedValue(true);
    const onSettled = vi.fn();
    enqueueWriteRetry(entry('k', { send, landed, onSettled }));
    await tick(2100);
    expect(landed).toHaveBeenCalledTimes(1);
    expect(send).not.toHaveBeenCalled();
    expect(onSettled).toHaveBeenCalledWith('landed', undefined);
    expect(pendingCount()).toBe(0);
  });

  it('B1 NEGATIVE: a failing or unverified re-read sends NOTHING that round (next rung decides)', async () => {
    const send = vi.fn().mockResolvedValue({});
    const landed = vi.fn().mockRejectedValueOnce(network()).mockResolvedValueOnce('unverified').mockResolvedValue('not_recorded');
    enqueueWriteRetry(entry('k', { send, landed }));
    await tick(2100);
    expect(send).not.toHaveBeenCalled();
    await tick(5100);
    expect(send).not.toHaveBeenCalled();
    await tick(10100);
    expect(send).toHaveBeenCalledTimes(1); // a readable "not recorded" round sends
  });

  it('S1: a superseded verdict drops the entry quietly and never sends', async () => {
    const send = vi.fn().mockResolvedValue({});
    const onCancelled = vi.fn();
    enqueueWriteRetry(entry('k', { send, onCancelled, landed: vi.fn().mockResolvedValue('superseded') }));
    await tick(2100);
    expect(send).not.toHaveBeenCalled();
    expect(onCancelled).toHaveBeenCalledTimes(1);
    expect(pendingCount()).toBe(0);
  });

  it('a server replayed:true answer is success like any other', async () => {
    const send = vi.fn().mockResolvedValue({ data: { replayed: true } });
    const onSettled = vi.fn();
    const onRefused = vi.fn();
    enqueueWriteRetry(entry('k', { send, onSettled, onRefused }));
    await tick(2100);
    expect(onSettled).toHaveBeenCalledWith('backoff', { data: { replayed: true } });
    expect(onRefused).not.toHaveBeenCalled();
  });
});

describe('what is NOT retried', () => {
  it.each(['VIEW_ONLY', 'AS_NEEDED_DOSE_RECENTLY_LOGGED', 'NOT_FOUND', 'SUBSCRIPTION_REQUIRED', 'SERVER_ERROR'])(
    'N7-3 a non-network error (%s) is not retried: reported once, today\'s copy',
    async (code) => {
      const send = vi.fn().mockRejectedValue(refusal(code));
      const onRefused = vi.fn();
      enqueueWriteRetry(entry('k', { send, onRefused }));
      await tick(2100);
      expect(onRefused).toHaveBeenCalledTimes(1);
      expect(onRefused).toHaveBeenCalledWith(refusal(code));
      await tick(120_000);
      expect(send).toHaveBeenCalledTimes(1);
      expect(getFailedCount()).toBe(0);
    }
  );

  it('a refusal on the second retry stops the ladder there', async () => {
    const send = vi.fn().mockRejectedValueOnce(network()).mockRejectedValue(refusal('VIEW_ONLY'));
    const onRefused = vi.fn();
    enqueueWriteRetry(entry('k', { send, onRefused }));
    await tick(2100);
    await tick(5100);
    expect(send).toHaveBeenCalledTimes(2);
    expect(onRefused).toHaveBeenCalledTimes(1);
    await tick(120_000);
    expect(send).toHaveBeenCalledTimes(2);
  });
});

describe('one in flight per key, max age, give up', () => {
  it('a resume while an attempt is still in flight does not send a second one', async () => {
    let release!: () => void;
    const send = vi.fn().mockReturnValue(new Promise<void>((r) => (release = r)));
    enqueueWriteRetry(entry('k', { send }));
    await tick(2100);
    expect(send).toHaveBeenCalledTimes(1);
    window.dispatchEvent(new Event('online'));
    document.dispatchEvent(new Event('visibilitychange'));
    await tick(10);
    expect(send).toHaveBeenCalledTimes(1);
    release();
    await tick(0);
    expect(hasWriteRetry('k')).toBe(false);
  });

  it('stale resume: an entry older than the max age is given up on, never resent', async () => {
    const send = vi.fn().mockResolvedValue({});
    const onGaveUp = vi.fn();
    onlineManager.setOnline(false); // the tab sat offline for hours
    enqueueWriteRetry(entry('k', { send, onGaveUp }), { tapAt: Date.now() - WRITE_RETRY_MAX_AGE_MS - 1000 });
    onlineManager.setOnline(true);
    document.dispatchEvent(new Event('visibilitychange'));
    await tick(0);
    expect(send).not.toHaveBeenCalled();
    expect(onGaveUp).toHaveBeenCalledTimes(1);
    expect(getFailedCount()).toBe(1);
    expect(Analytics.writeRetryGaveUp).toHaveBeenCalledWith('task_complete', 1);
  });

  it('keeps failing on the network: gives up within the max age, then Retry sends once more', async () => {
    const send = vi.fn().mockRejectedValue(network());
    const onGaveUp = vi.fn();
    enqueueWriteRetry(entry('k', { send, onGaveUp }));
    await tick(WRITE_RETRY_MAX_AGE_MS + 60_000);
    expect(onGaveUp).toHaveBeenCalledTimes(1);
    expect(getFailedCount()).toBe(1);
    const callsBefore = send.mock.calls.length;
    send.mockResolvedValue({});
    retryFailedWrites();
    await tick(0);
    expect(send).toHaveBeenCalledTimes(callsBefore + 1);
    expect(getFailedCount()).toBe(0);
    expect(Analytics.writeRetrySucceeded).toHaveBeenCalledWith('task_complete', 1, 'manual');
  });

  it('P7-4 Retry re-sends every given-up entry', async () => {
    const sends = [0, 1, 2].map(() => vi.fn().mockRejectedValue(network()));
    sends.forEach((send, i) => enqueueWriteRetry(entry(`k${i}`, { send })));
    await tick(WRITE_RETRY_MAX_AGE_MS + 60_000);
    expect(getFailedCount()).toBe(3);
    sends.forEach((s) => s.mockResolvedValue({}));
    const before = sends.map((s) => s.mock.calls.length);
    retryFailedWrites();
    await tick(0);
    sends.forEach((s, i) => expect(s.mock.calls.length).toBe(before[i] + 1));
    expect(getFailedCount()).toBe(0);
  });

  it('dismissing forgets what gave up', async () => {
    enqueueWriteRetry(entry('k', { send: vi.fn().mockRejectedValue(network()) }));
    await tick(WRITE_RETRY_MAX_AGE_MS + 60_000);
    expect(getFailedCount()).toBe(1);
    dismissFailedWrites();
    expect(getFailedCount()).toBe(0);
  });
});

describe('sign-out', () => {
  it('N7-7 logout with queued entries: the queue is cleared, nothing is sent under the next account', async () => {
    const send = vi.fn().mockResolvedValue({});
    enqueueWriteRetry(entry('a', { send }));
    enqueueWriteRetry(entry('b', { send }));
    clearWriteRetryQueue();
    expect(pendingCount()).toBe(0);
    window.dispatchEvent(new Event('online'));
    await tick(WRITE_RETRY_MAX_AGE_MS);
    expect(send).not.toHaveBeenCalled();
  });
});

describe('sendWithQuietRetry (the foreground form, for the note composers)', () => {
  it('retries a network failure with the SAME closure and resolves', async () => {
    const send = vi.fn().mockRejectedValueOnce(network()).mockResolvedValue('note');
    const p = sendWithQuietRetry('n1', 'event_note', send);
    await tick(2100);
    await expect(p).resolves.toBe('note');
    expect(send).toHaveBeenCalledTimes(2);
    expect(Analytics.writeRetrySucceeded).toHaveBeenCalledWith('event_note', 1, 'backoff');
  });

  it('a non-network error is rethrown at once, no retry', async () => {
    const send = vi.fn().mockRejectedValue(refusal('OCCURRENCE_REMOVED'));
    await expect(sendWithQuietRetry('n2', 'event_note', send)).rejects.toEqual(refusal('OCCURRENCE_REMOVED'));
    expect(send).toHaveBeenCalledTimes(1);
  });

  it('every attempt failing rejects with the last error, and a gave_up event', async () => {
    const send = vi.fn().mockRejectedValue(network());
    const p = sendWithQuietRetry('n3', 'care_note', send);
    p.catch(() => {});
    await tick(60_000);
    await expect(p).rejects.toEqual(network());
    expect(send).toHaveBeenCalledTimes(4); // first + 2, 5, 10 s steps
    expect(Analytics.writeRetryGaveUp).toHaveBeenCalledWith('care_note', 1);
  });

  it('one in-flight run per key: a second run of the same key is refused', async () => {
    let release!: () => void;
    const first = sendWithQuietRetry('n4', 'care_note', () => new Promise<void>((r) => (release = r)));
    await expect(sendWithQuietRetry('n4', 'care_note', vi.fn())).rejects.toThrow('already in flight');
    release();
    await first;
  });

  it('the max age stops the ladder', async () => {
    const send = vi.fn().mockRejectedValue(network());
    const p = sendWithQuietRetry('n5', 'event_note', send, { delaysMs: [1000, 1000, 1000], maxAgeMs: 1500 });
    p.catch(() => {});
    await tick(10_000);
    await expect(p).rejects.toEqual(network());
    expect(send).toHaveBeenCalledTimes(2);
  });
});

// Review W1-W3.
describe('offline timer and expiry (W1)', () => {
  it('P-W1 offline past the max age gives up and shows the notice; timer fires stay bounded', async () => {
    vi.useRealTimers();
    const realSet = globalThis.setTimeout;
    let fires = 0;
    vi.spyOn(globalThis, 'setTimeout').mockImplementation(((fn: () => void, ms?: number) =>
      realSet(() => {
        fires += 1;
        fn();
      }, ms)) as typeof setTimeout);
    const send = vi.fn().mockResolvedValue({});
    const onGaveUp = vi.fn();
    onlineManager.setOnline(false);
    enqueueWriteRetry(entry('k', { send, onGaveUp }), { tapAt: Date.now() - WRITE_RETRY_MAX_AGE_MS + 1100 });
    await new Promise((r) => realSet(r, 2600));
    expect(send).not.toHaveBeenCalled();
    expect(onGaveUp).toHaveBeenCalledTimes(1);
    expect(getFailedCount()).toBe(1);
    expect(fires).toBeLessThan(5); // a 0 ms spin would fire thousands of times
    vi.restoreAllMocks();
  });

  it('N-W1 offline within the max age: no timer spin and nothing sent', async () => {
    const send = vi.fn().mockResolvedValue({});
    onlineManager.setOnline(false);
    enqueueWriteRetry(entry('k', { send }));
    const setSpy = vi.spyOn(globalThis, 'setTimeout');
    await tick(60_000);
    expect(send).not.toHaveBeenCalled();
    expect(setSpy.mock.calls.length).toBeLessThan(5); // a 0 ms spin sets a timer per pass
    setSpy.mockRestore();
    expect(getFailedCount()).toBe(0);
    expect(pendingCount()).toBe(1);
  });
});

describe('given-up entries expire (W2)', () => {
  it('P-W2 a fresh failed entry is counted and Retry resends it', async () => {
    const send = vi.fn().mockRejectedValue(network());
    enqueueWriteRetry(entry('k', { send }));
    await tick(WRITE_RETRY_MAX_AGE_MS + 60_000);
    expect(getFailedCount()).toBe(1);
    const before = send.mock.calls.length;
    retryFailedWrites();
    await tick(0);
    expect(send.mock.calls.length).toBe(before + 1);
  });

  it('N-W2 a failed entry older than 10 minutes is not counted and Retry does not resend it', async () => {
    const send = vi.fn().mockRejectedValue(network());
    enqueueWriteRetry(entry('k', { send }));
    await tick(WRITE_RETRY_MAX_AGE_MS + 60_000);
    expect(getFailedCount()).toBe(1);
    const before = send.mock.calls.length;
    await tick(10 * 60_000);
    expect(getFailedCount()).toBe(0);
    retryFailedWrites();
    await tick(0);
    expect(send.mock.calls.length).toBe(before);
    expect(pendingCount()).toBe(0);
  });
});

describe('foreground retry honours sign-out and offline (W3)', () => {
  it('N-W3a no resend after sign-out mid-backoff', async () => {
    const send = vi.fn().mockRejectedValue(network());
    const run = sendWithQuietRetry('fk', 'event_note', send);
    const settled = run.catch((e) => e);
    await tick(0);
    expect(send).toHaveBeenCalledTimes(1);
    clearWriteRetryQueue();
    await tick(10_000);
    expect(send).toHaveBeenCalledTimes(1);
    expect((await settled) as Error).toBeInstanceOf(Error);
  });

  it('N-W3b no send while offline after the backoff sleep', async () => {
    const send = vi.fn().mockRejectedValue(network());
    const settled = sendWithQuietRetry('fk', 'event_note', send).catch((e) => e);
    await tick(0);
    onlineManager.setOnline(false);
    await tick(10_000);
    expect(send).toHaveBeenCalledTimes(1);
    await settled;
  });

  it('P-W3 online and same session: the foreground retry still resends', async () => {
    const send = vi.fn().mockRejectedValueOnce(network()).mockResolvedValue('ok');
    const run = sendWithQuietRetry('fk', 'event_note', send);
    await tick(2100);
    await expect(run).resolves.toBe('ok');
    expect(send).toHaveBeenCalledTimes(2);
  });
});

describe('N-W3: foreground exits after the backoff sleep report the give-up', () => {
  it('POSITIVE: a sign-out mid-backoff throws a typed SessionEndedError and fires gave_up once', async () => {
    const send = vi.fn().mockRejectedValue(network());
    const settled = sendWithQuietRetry('sk', 'care_note', send).catch((e) => e);
    await tick(0);
    clearWriteRetryQueue();
    await tick(10_000);
    const error = await settled;
    expect(error).toBeInstanceOf(SessionEndedError);
    expect((error as Error).message).toBe('Write cancelled: session ended');
    expect(Analytics.writeRetryGaveUp).toHaveBeenCalledTimes(1);
    expect(Analytics.writeRetryGaveUp).toHaveBeenCalledWith('care_note', 1);
  });

  it('POSITIVE: going offline during the backoff rethrows the transport error and fires gave_up once', async () => {
    const send = vi.fn().mockRejectedValue(network());
    const settled = sendWithQuietRetry('ok', 'event_note', send).catch((e) => e);
    await tick(0);
    onlineManager.setOnline(false);
    await tick(10_000);
    expect(await settled).toEqual(network());
    expect(Analytics.writeRetryGaveUp).toHaveBeenCalledTimes(1);
    expect(Analytics.writeRetryGaveUp).toHaveBeenCalledWith('event_note', 1);
  });

  it('NEGATIVE: a first-attempt refusal is NOT a give-up (no retry ever happened)', async () => {
    const send = vi.fn().mockRejectedValue(refusal('VIEW_ONLY'));
    await expect(sendWithQuietRetry('nk', 'care_note', send)).rejects.toEqual(refusal('VIEW_ONLY'));
    expect(Analytics.writeRetryGaveUp).not.toHaveBeenCalled();
  });

  it('NEGATIVE: an ordinary transport give-up is not a SessionEndedError', async () => {
    const send = vi.fn().mockRejectedValue(network());
    const settled = sendWithQuietRetry('tk', 'care_note', send).catch((e) => e);
    await tick(60_000);
    const error = await settled;
    expect(error).not.toBeInstanceOf(SessionEndedError);
    expect(Analytics.writeRetryGaveUp).toHaveBeenCalledTimes(1); // the max-age exit, still once
  });
});
