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
  queueAnalyticsConsentForSignup,
  hasQueuedAnalyticsConsent,
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
    // Keyed BY ACCOUNT, so another account's undelivered decision sitting in
    // the same store is not collateral damage of this one.
    const parsed = JSON.parse(stored as string);
    expect(parsed['user-1']).toMatchObject({ enabled: false });
    // The write's identity is a per-WRITE token, not a per-tab counter — see
    // the two-tab test below for why that distinction is the whole point.
    expect(typeof parsed['user-1'].token).toBe('string');
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
    expect(JSON.parse(stored as string)['user-1']).toMatchObject({ enabled: false });
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

  /**
   * A FLUSH AND A TOGGLE MUST NOT CROSS. Signup now queues a decision that the
   * sign-in flush delivers, so the flush is no longer a rare retry path — it
   * runs on the way into the app for every new account. If the Profile toggle
   * could jump ahead of an in-flight flush, a signup DECLINE whose withdrawal
   * is still on the wire, followed by an opt-IN in Profile, could reach the
   * server as restore-then-withdraw: the account ends up withdrawn while the
   * toggle reads ON. That is the same reordering `syncAnalyticsConsent`
   * already serialises against — the flush has to share the chain.
   */
  it('holds the delivery chain, so a later toggle cannot overtake it', async () => {
    localStorage.setItem(KEY, JSON.stringify({ enabled: false, userId: 'user-1', seq: 1 }));
    let releaseWithdraw!: (value: boolean) => void;
    withdrawAnalyticsConsent.mockReturnValue(
      new Promise<boolean>((resolve) => {
        releaseWithdraw = resolve;
      })
    );
    restoreAnalyticsConsent.mockResolvedValue(true);

    const flush = flushAnalyticsConsentSync('user-1');
    await Promise.resolve();
    await Promise.resolve();
    const optIn = syncAnalyticsConsent(true, 'user-1');
    await Promise.resolve();
    await Promise.resolve();

    expect(withdrawAnalyticsConsent).toHaveBeenCalledTimes(1);
    expect(restoreAnalyticsConsent).not.toHaveBeenCalled();

    releaseWithdraw(true);
    await Promise.all([flush, optIn]);

    expect(restoreAnalyticsConsent).toHaveBeenCalledTimes(1);
    // The opt-in was the last word and it landed, so nothing is left pending.
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

/**
 * ── THE MARKER IS SHARED BETWEEN TABS; THE THINGS GUARDING IT WERE NOT ──────
 *
 * `nextSeq` was a module variable, so EVERY tab started at 0 and collisions
 * were the norm rather than the exception: two tabs' first decisions both
 * carried `seq: 1`. `removePendingIfCurrent` compares that number to decide
 * whether the marker on disk is still the one THIS delivery wrote — so tab A's
 * success deleted tab B's undelivered decision, which is the exact loss the
 * seq mechanism exists to prevent. Final answer ON, server still withdrawn,
 * PostHog person still deleted, nothing left to retry.
 *
 * Simulated honestly: a second import of the module after `vi.resetModules()`
 * is a genuinely independent module instance — its own counters, the same
 * localStorage — which is what a second tab is.
 */
describe('two tabs share the marker', () => {
  async function twoTabs() {
    // BOTH freshly loaded. Loading only the second one would leave tab A on
    // the module instance every earlier test in this file already advanced,
    // so its next seq would be 13-ish and the collision this test is about
    // could not happen — the test would pass without proving anything.
    vi.resetModules();
    const tabA = await import('../analyticsConsentSync');
    vi.resetModules();
    const tabB = await import('../analyticsConsentSync');
    return { tabA, tabB };
  }

  it("one tab's delivery does not delete the other tab's undelivered decision", async () => {
    const { tabA, tabB } = await twoTabs();
    let releaseWithdraw!: (value: boolean) => void;
    withdrawAnalyticsConsent.mockReturnValue(
      new Promise<boolean>((resolve) => {
        releaseWithdraw = resolve;
      })
    );
    // Tab A: the user turns analytics OFF. Slow request.
    const off = tabA.syncAnalyticsConsent(false, 'user-1');
    await Promise.resolve();

    // Tab B: the same user turns it back ON in another tab, and that request
    // fails outright.
    restoreAnalyticsConsent.mockResolvedValue(false);
    await tabB.syncAnalyticsConsent(true, 'user-1');

    // Tab A's withdraw now succeeds.
    releaseWithdraw(true);
    await off;

    // The user's LAST answer was ON and it never reached the server, so it
    // must still be pending. (Before the fix this key was null: A's success
    // matched B's colliding seq and deleted it.)
    expect(localStorage.getItem(KEY)).not.toBeNull();
    restoreAnalyticsConsent.mockResolvedValue(true);
    await tabB.flushAnalyticsConsentSync('user-1');
    expect(restoreAnalyticsConsent).toHaveBeenCalledTimes(2);
    expect(localStorage.getItem(KEY)).toBeNull();
  });
});

/**
 * ── ONE SLOT PER ACCOUNT, NOT ONE SLOT ─────────────────────────────────────
 *
 * `queueAnalyticsConsentForSignup` justified overwriting whatever was there
 * with: "That account's own next sign-in would not have delivered it either
 * (the flush only fires for a matching userId)". That is circular — BEFORE the
 * overwrite the marker carries A's id, so `flushAnalyticsConsentSync(A)` is
 * exactly what WOULD have delivered it. The overwrite is what makes the
 * premise true.
 *
 * The failure: A's Profile withdrawal fails on a network blip; A signs out; B
 * signs up in the same browser; B's queue overwrites A's marker; A signs back
 * in, and A's explicit withdrawal is gone for good — server never stamped,
 * PostHog person never deleted, and the Profile toggle reads OFF while capture
 * continues.
 */
describe("queueing a signup decision does not discard another account's", () => {
  it("keeps A's undelivered withdrawal while recording B's signup decline", async () => {
    // A's withdrawal never reached the server.
    withdrawAnalyticsConsent.mockResolvedValue(false);
    await syncAnalyticsConsent(false, 'user-A');
    expect(localStorage.getItem(KEY)).not.toBeNull();

    // B signs up on the same browser and declines.
    queueAnalyticsConsentForSignup(false, 'user-B');

    // B's decision is delivered when B signs in…
    withdrawAnalyticsConsent.mockResolvedValue(true);
    await flushAnalyticsConsentSync('user-B');
    expect(withdrawAnalyticsConsent).toHaveBeenCalledTimes(2);

    // …and A's is STILL there to be retried when A comes back.
    await flushAnalyticsConsentSync('user-A');
    expect(withdrawAnalyticsConsent).toHaveBeenCalledTimes(3);
    expect(localStorage.getItem(KEY)).toBeNull();
  });

  it("a signup decision replaces only that same account's earlier one", async () => {
    restoreAnalyticsConsent.mockResolvedValue(false);
    await syncAnalyticsConsent(true, 'user-A');

    // Same account signs up again on this browser (or re-answers) — one slot
    // per account, latest answer wins.
    queueAnalyticsConsentForSignup(false, 'user-A');

    withdrawAnalyticsConsent.mockResolvedValue(true);
    await flushAnalyticsConsentSync('user-A');

    expect(withdrawAnalyticsConsent).toHaveBeenCalledTimes(1);
    expect(restoreAnalyticsConsent).toHaveBeenCalledTimes(1); // the failed one only
    expect(localStorage.getItem(KEY)).toBeNull();
  });
});

// The server consent reconcile reads this to learn that a local decision is
// NEWER than the server's copy. It must stay per-account and strictly read-only.
describe('hasQueuedAnalyticsConsent', () => {
  it('is true only for the account whose delivery failed', async () => {
    withdrawAnalyticsConsent.mockResolvedValue(false);
    await syncAnalyticsConsent(false, 'user-A');

    expect(hasQueuedAnalyticsConsent('user-A')).toBe(true);
    expect(hasQueuedAnalyticsConsent('user-B')).toBe(false);
    expect(hasQueuedAnalyticsConsent('')).toBe(false);
  });

  it('is false once the decision has been delivered', async () => {
    withdrawAnalyticsConsent.mockResolvedValueOnce(false).mockResolvedValue(true);
    await syncAnalyticsConsent(false, 'user-A');
    await flushAnalyticsConsentSync('user-A');

    expect(hasQueuedAnalyticsConsent('user-A')).toBe(false);
  });

  it('only reads — no delivery, and the stored bytes (legacy shape included) are untouched', () => {
    const legacy = JSON.stringify({ enabled: false, userId: 'user-A', seq: 3 });
    localStorage.setItem(KEY, legacy);

    expect(hasQueuedAnalyticsConsent('user-A')).toBe(true);
    expect(hasQueuedAnalyticsConsent('user-B')).toBe(false);

    expect(localStorage.getItem(KEY)).toBe(legacy);
    expect(withdrawAnalyticsConsent).not.toHaveBeenCalled();
    expect(restoreAnalyticsConsent).not.toHaveBeenCalled();
  });

  it('reads unparseable storage as nothing queued, without throwing', () => {
    localStorage.setItem(KEY, '{not json');
    expect(hasQueuedAnalyticsConsent('user-A')).toBe(false);
  });
});
