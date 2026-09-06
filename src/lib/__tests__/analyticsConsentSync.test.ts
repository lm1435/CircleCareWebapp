import { beforeEach, describe, expect, it, vi } from 'vitest';

// `analyticsConsentSync` mediates between the settings toggle (which must
// never surface an error) and the two consent endpoints (which never throw,
// but DO report success/failure). These tests guard the retry marker's
// lifecycle: written before delivery, kept on failure, dropped on success,
// and never delivered under the wrong account.

const withdrawAnalyticsConsent = vi.fn();
const restoreAnalyticsConsent = vi.fn();

vi.mock('@/api/users', () => ({
  withdrawAnalyticsConsent: (...args: unknown[]) => withdrawAnalyticsConsent(...args),
  restoreAnalyticsConsent: (...args: unknown[]) => restoreAnalyticsConsent(...args),
}));

import {
  syncAnalyticsConsent,
  flushAnalyticsConsentSync,
  clearAnalyticsConsentSync,
} from '../analyticsConsentSync';

const KEY = 'analytics_consent_pending_sync';

beforeEach(() => {
  localStorage.clear();
  vi.clearAllMocks();
});

describe('syncAnalyticsConsent', () => {
  it('serialises deliveries so a fast off→on flip reaches the server in order', async () => {
    // The withdraw is held open; the restore fired behind it must NOT start
    // until the withdraw settles, or the server could apply them reversed and
    // leave the account withdrawn while the toggle reads ON.
    let releaseWithdraw!: (value: boolean) => void;
    withdrawAnalyticsConsent.mockReturnValue(
      new Promise<boolean>((resolve) => {
        releaseWithdraw = resolve;
      })
    );
    restoreAnalyticsConsent.mockResolvedValue(true);

    const off = syncAnalyticsConsent(false, 'user-1');
    const on = syncAnalyticsConsent(true, 'user-1');
    await Promise.resolve();
    await Promise.resolve();

    expect(withdrawAnalyticsConsent).toHaveBeenCalledTimes(1);
    expect(restoreAnalyticsConsent).not.toHaveBeenCalled();

    releaseWithdraw(true);
    await Promise.all([off, on]);

    expect(restoreAnalyticsConsent).toHaveBeenCalledTimes(1);
    expect(localStorage.getItem(KEY)).toBeNull();
  });

  it('delivers a withdrawal and removes the marker on success', async () => {
    withdrawAnalyticsConsent.mockResolvedValue(true);

    await syncAnalyticsConsent(false, 'user-1');

    expect(withdrawAnalyticsConsent).toHaveBeenCalledTimes(1);
    expect(restoreAnalyticsConsent).not.toHaveBeenCalled();
    expect(localStorage.getItem(KEY)).toBeNull();
  });

  it('keeps the marker when delivery fails', async () => {
    withdrawAnalyticsConsent.mockResolvedValue(false);

    await syncAnalyticsConsent(false, 'user-1');

    expect(withdrawAnalyticsConsent).toHaveBeenCalledTimes(1);
    const stored = localStorage.getItem(KEY);
    expect(stored).not.toBeNull();
    const parsed = JSON.parse(stored as string);
    expect(parsed).toMatchObject({ enabled: false, userId: 'user-1' });
    expect(typeof parsed.seq).toBe('number');
  });

  it('an ON-then-OFF flip where restore succeeds first and withdraw fails leaves the OFF decision pending', async () => {
    // The exact interleaving from the finding: user flips ON then quickly
    // back OFF. Restore (ON) is delivered FIRST in the chain and succeeds;
    // withdraw (OFF) — the user's actual, final, current decision — is
    // delivered second and fails (e.g. the backend rate limiter 429s the
    // withdraw direction). The marker on disk is already the OFF marker by
    // the time restore's success handler runs (OFF's write happened
    // synchronously right after ON's). Without the seq check, restore's
    // `removePending()` would delete that OFF marker anyway — losing the
    // user's actual decision with nothing left to retry.
    restoreAnalyticsConsent.mockResolvedValue(true);
    withdrawAnalyticsConsent.mockResolvedValue(false);

    const on = syncAnalyticsConsent(true, 'user-1');
    const off = syncAnalyticsConsent(false, 'user-1');
    await Promise.all([on, off]);

    expect(restoreAnalyticsConsent).toHaveBeenCalledTimes(1);
    expect(withdrawAnalyticsConsent).toHaveBeenCalledTimes(1);
    const stored = localStorage.getItem(KEY);
    expect(stored).not.toBeNull();
    expect(JSON.parse(stored as string)).toMatchObject({ enabled: false, userId: 'user-1' });
  });

  it('an ON-then-OFF flip where both deliveries succeed clears the marker', async () => {
    restoreAnalyticsConsent.mockResolvedValue(true);
    withdrawAnalyticsConsent.mockResolvedValue(true);

    const on = syncAnalyticsConsent(true, 'user-1');
    const off = syncAnalyticsConsent(false, 'user-1');
    await Promise.all([on, off]);

    expect(localStorage.getItem(KEY)).toBeNull();
  });

  it('a later flush retries the OFF decision left pending by the interleaving above', async () => {
    restoreAnalyticsConsent.mockResolvedValue(true);
    withdrawAnalyticsConsent.mockResolvedValueOnce(false);

    const on = syncAnalyticsConsent(true, 'user-1');
    const off = syncAnalyticsConsent(false, 'user-1');
    await Promise.all([on, off]);
    expect(localStorage.getItem(KEY)).not.toBeNull();

    withdrawAnalyticsConsent.mockResolvedValueOnce(true);
    await flushAnalyticsConsentSync('user-1');

    expect(withdrawAnalyticsConsent).toHaveBeenCalledTimes(2);
    expect(localStorage.getItem(KEY)).toBeNull();
  });

  it('routes enabled=true to restoreAnalyticsConsent, not withdraw', async () => {
    restoreAnalyticsConsent.mockResolvedValue(true);

    await syncAnalyticsConsent(true, 'user-1');

    expect(restoreAnalyticsConsent).toHaveBeenCalledTimes(1);
    expect(withdrawAnalyticsConsent).not.toHaveBeenCalled();
    expect(localStorage.getItem(KEY)).toBeNull();
  });
});

describe('flushAnalyticsConsentSync', () => {
  it('does nothing when there is no pending marker', async () => {
    await flushAnalyticsConsentSync('user-1');

    expect(withdrawAnalyticsConsent).not.toHaveBeenCalled();
    expect(restoreAnalyticsConsent).not.toHaveBeenCalled();
  });

  it('leaves the marker UNTOUCHED and delivers NOTHING when the userId does not match', async () => {
    // C2: this used to delete a different account's marker outright. On a
    // shared browser that destroys user A's undelivered opt-out the instant
    // user B signs in — silently the opposite of what A was told would
    // happen. The marker must survive for A's own sign-out flush (or a later
    // sign-in of A's) to retry.
    localStorage.setItem(KEY, JSON.stringify({ enabled: false, userId: 'user-A', seq: 1 }));

    await flushAnalyticsConsentSync('user-B');

    expect(withdrawAnalyticsConsent).not.toHaveBeenCalled();
    expect(restoreAnalyticsConsent).not.toHaveBeenCalled();
    expect(JSON.parse(localStorage.getItem(KEY) as string)).toEqual({
      enabled: false,
      userId: 'user-A',
      seq: 1,
    });
  });

  it('delivers and removes the marker when the userId matches', async () => {
    localStorage.setItem(KEY, JSON.stringify({ enabled: false, userId: 'user-1', seq: 1 }));
    withdrawAnalyticsConsent.mockResolvedValue(true);

    await flushAnalyticsConsentSync('user-1');

    expect(withdrawAnalyticsConsent).toHaveBeenCalledTimes(1);
    expect(localStorage.getItem(KEY)).toBeNull();
  });

  it('keeps the marker if delivery fails even with a matching userId', async () => {
    localStorage.setItem(KEY, JSON.stringify({ enabled: true, userId: 'user-1', seq: 1 }));
    restoreAnalyticsConsent.mockResolvedValue(false);

    await flushAnalyticsConsentSync('user-1');

    expect(restoreAnalyticsConsent).toHaveBeenCalledTimes(1);
    expect(localStorage.getItem(KEY)).not.toBeNull();
  });
});

describe('clearAnalyticsConsentSync', () => {
  it('removes any pending marker', async () => {
    localStorage.setItem(KEY, JSON.stringify({ enabled: false, userId: 'user-1' }));

    await clearAnalyticsConsentSync();

    expect(localStorage.getItem(KEY)).toBeNull();
  });
});

describe('localStorage failures never throw', () => {
  it('syncAnalyticsConsent survives a throwing setItem/getItem/removeItem', async () => {
    const setSpy = vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new Error('QuotaExceeded');
    });
    withdrawAnalyticsConsent.mockResolvedValue(true);

    await expect(syncAnalyticsConsent(false, 'user-1')).resolves.toBeUndefined();
    setSpy.mockRestore();
  });

  it('flushAnalyticsConsentSync survives a throwing getItem', async () => {
    const getSpy = vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
      throw new Error('SecurityError');
    });

    await expect(flushAnalyticsConsentSync('user-1')).resolves.toBeUndefined();
    expect(withdrawAnalyticsConsent).not.toHaveBeenCalled();
    expect(restoreAnalyticsConsent).not.toHaveBeenCalled();
    getSpy.mockRestore();
  });

  it('clearAnalyticsConsentSync survives a throwing removeItem', async () => {
    const removeSpy = vi.spyOn(Storage.prototype, 'removeItem').mockImplementation(() => {
      throw new Error('SecurityError');
    });

    await expect(clearAnalyticsConsentSync()).resolves.toBeUndefined();
    removeSpy.mockRestore();
  });
});
