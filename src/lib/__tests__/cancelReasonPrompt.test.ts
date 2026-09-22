import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import {
  CANCEL_ASK_WINDOW_MS,
  cancelAskKey,
  evaluateCancelReasonEligibility,
  hasAskedCancelReason,
  markCancelReasonAsked,
} from '@/lib/cancelReasonPrompt';
import type { CancelPromptStatus } from '@/api/subscriptionStatus';

const NOW = Date.UTC(2026, 8, 21, 12, 0, 0);
const DAY = 24 * 3600 * 1000;
const USER = 'user-1';

/** Backend `GET /subscription-status` shape — see api/subscriptionStatus.ts. */
function cancelPrompt(overrides: Partial<CancelPromptStatus> = {}): CancelPromptStatus {
  return {
    renewalOffAt: new Date(NOW - 2 * DAY).toISOString(),
    accessEndsAt: new Date(NOW + 20 * DAY).toISOString(),
    periodType: 'trial',
    entitlementActive: true,
    isSandbox: false,
    ...overrides,
  };
}

describe('evaluateCancelReasonEligibility', () => {
  it('is eligible for a real cache entry inside the window, and reports millis', () => {
    const result = evaluateCancelReasonEligibility(cancelPrompt(), USER, NOW);
    expect(result).toEqual({
      eligible: true,
      entitlementActive: true,
      expirationDateMs: NOW + 20 * DAY,
      periodType: 'trial',
      unsubscribeDetectedAtMs: NOW - 2 * DAY,
      isSandbox: false,
    });
  });

  it('isSandbox is surfaced, not filtered (dropped 2026-09-21) — a sandbox cache entry is still eligible', () => {
    const result = evaluateCancelReasonEligibility(cancelPrompt({ isSandbox: true }), USER, NOW);
    expect(result).toEqual({
      eligible: true,
      entitlementActive: true,
      expirationDateMs: NOW + 20 * DAY,
      periodType: 'trial',
      unsubscribeDetectedAtMs: NOW - 2 * DAY,
      isSandbox: true,
    });
  });

  it('null cancelPrompt (never cancelled, or server already outside the window) is NOT eligible', () => {
    expect(evaluateCancelReasonEligibility(null, USER, NOW).eligible).toBe(false);
    expect(evaluateCancelReasonEligibility(undefined, USER, NOW).eligible).toBe(false);
  });

  it('29 days after unsubscribe is eligible; 31 days is not (client-side re-check)', () => {
    expect(
      evaluateCancelReasonEligibility(
        cancelPrompt({ renewalOffAt: new Date(NOW - 29 * DAY).toISOString() }),
        USER,
        NOW
      ).eligible
    ).toBe(true);
    expect(
      evaluateCancelReasonEligibility(
        cancelPrompt({ renewalOffAt: new Date(NOW - 31 * DAY).toISOString() }),
        USER,
        NOW
      ).eligible
    ).toBe(false);
  });

  it('the window edge is inclusive', () => {
    expect(
      evaluateCancelReasonEligibility(
        cancelPrompt({ renewalOffAt: new Date(NOW - CANCEL_ASK_WINDOW_MS).toISOString() }),
        USER,
        NOW
      ).eligible
    ).toBe(true);
  });

  it('expired but inside the window is eligible with entitlementActive=false', () => {
    const result = evaluateCancelReasonEligibility(
      cancelPrompt({
        entitlementActive: false,
        accessEndsAt: new Date(NOW - 3 * DAY).toISOString(),
      }),
      USER,
      NOW
    );
    expect(result).toMatchObject({ eligible: true, entitlementActive: false });
  });

  it('a null periodType (RevenueCat sent no period_type) reports an empty string, not a crash', () => {
    const result = evaluateCancelReasonEligibility(cancelPrompt({ periodType: null }), USER, NOW);
    expect(result).toMatchObject({ eligible: true, periodType: '' });
  });

  it('an unparseable timestamp is not eligible', () => {
    expect(
      evaluateCancelReasonEligibility(cancelPrompt({ renewalOffAt: 'not-a-date' }), USER, NOW).eligible
    ).toBe(false);
    expect(
      evaluateCancelReasonEligibility(cancelPrompt({ accessEndsAt: 'not-a-date' }), USER, NOW).eligible
    ).toBe(false);
  });

  it('no user is not eligible even with a real cache entry', () => {
    expect(evaluateCancelReasonEligibility(cancelPrompt(), null, NOW).eligible).toBe(false);
    expect(evaluateCancelReasonEligibility(cancelPrompt(), undefined, NOW).eligible).toBe(false);
  });

  // FAMILY_SHARED / billing-issue / cancel_reason are not this function's job
  // to filter — the webhook (backend/src/routes/webhooks.ts, the CANCELLATION
  // case) already filtered them BEFORE writing the cache, so a non-null
  // `cancelPrompt` reaching this function is already a real, in-scope
  // cancellation. Those cases are covered by the backend's own webhook tests,
  // not here. SANDBOX is deliberately NOT in that list any more (dropped
  // 2026-09-21) — see the `isSandbox` test above: a sandbox cache entry is
  // still eligible, just tagged.
});

describe('show-once key', () => {
  beforeEach(() => {
    window.localStorage.clear();
  });
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('key shape: install prefix + 16-hex user hash + unsubscribe millis', async () => {
    const key = await cancelAskKey('u1', 1234);
    expect(key).toMatch(/^circlecare_install:cancel_ask:[0-9a-f]{16}:1234$/);
  });

  it('hashes the user id: SHA-256 of "cancel_ask:<userId>", hex, first 16 chars', async () => {
    const { createHash } = await import('node:crypto');
    const expected = createHash('sha256').update('cancel_ask:u1').digest('hex').slice(0, 16);
    expect(await cancelAskKey('u1', 1234)).toBe(`circlecare_install:cancel_ask:${expected}:1234`);
  });

  it('same user -> same key; different users -> different keys', async () => {
    expect(await cancelAskKey('u1', 1)).toBe(await cancelAskKey('u1', 1));
    expect(await cancelAskKey('u1', 1)).not.toBe(await cancelAskKey('u2', 1));
  });

  it('never writes the raw user id into any localStorage key', async () => {
    const userId = '8f3c2a10-5b7e-4d21-9c0a-1e2f3a4b5c6d';
    await markCancelReasonAsked(userId, 1);
    const keys = Object.keys(window.localStorage);
    expect(keys).toHaveLength(1);
    expect(keys[0]).toMatch(/^circlecare_install:cancel_ask:[0-9a-f]{16}:1$/);
    for (const key of keys) {
      expect(key).not.toContain(userId);
      expect(window.localStorage.getItem(key)).not.toContain(userId);
    }
  });

  it('round-trips through localStorage, per user and per unsubscribe instant', async () => {
    expect(await hasAskedCancelReason('u1', 1)).toBe(false);
    await markCancelReasonAsked('u1', 1);
    expect(await hasAskedCancelReason('u1', 1)).toBe(true);
    expect(await hasAskedCancelReason('u2', 1)).toBe(false);
    expect(await hasAskedCancelReason('u1', 2)).toBe(false);
  });

  it('a storage read that throws is treated as already asked', async () => {
    vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
      throw new Error('SecurityError');
    });
    expect(await hasAskedCancelReason('u1', 1)).toBe(true);
  });

  it('hashing that fails is treated as already asked, and the write is swallowed', async () => {
    vi.spyOn(globalThis.crypto.subtle, 'digest').mockRejectedValue(new Error('no WebCrypto'));
    const setItem = vi.spyOn(Storage.prototype, 'setItem');
    expect(await hasAskedCancelReason('u1', 1)).toBe(true);
    await expect(markCancelReasonAsked('u1', 1)).resolves.toBeUndefined();
    expect(setItem).not.toHaveBeenCalled();
  });

  it('a storage write that throws is swallowed', async () => {
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new Error('QuotaExceeded');
    });
    await expect(markCancelReasonAsked('u1', 1)).resolves.toBeUndefined();
  });
});
