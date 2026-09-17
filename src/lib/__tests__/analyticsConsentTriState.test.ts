import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  getAnalyticsConsent,
  getAnalyticsConsentState,
  hasAnsweredAnalyticsConsent,
  setAnalyticsConsent,
  __resetAnalyticsConsentCache,
} from '../analyticsConsent';

/**
 * THE COMPLIANCE GAP: "never asked" used to be indistinguishable from "declined".
 *
 * `getAnalyticsConsent()` returned a BOOLEAN that defaulted false, so an absent
 * key — a visitor nobody had ever put the question to — read exactly the same
 * as a visitor who had been asked and said no. That is fine as a COLLECTION
 * posture (both must fail closed) and useless as a RECORD: it cannot answer
 * "did this person decline, or did we never ask?", which is the question a
 * consent regime actually puts to you, and it cannot tell the signup flow
 * whether it still owes someone the question.
 *
 * The fix widens the READ into three states without widening what is WRITTEN:
 * the key is still the same `cc_analytics_enabled` holding 'true' | 'false', so
 * a build of this app from before the change reads a new decision correctly and
 * vice versa. The third state is the ABSENCE of the key, which was always
 * there — it was just being collapsed on the way out.
 */

const KEY = 'cc_analytics_enabled';

beforeEach(() => {
  localStorage.clear();
  __resetAnalyticsConsentCache();
});

describe('three states, not two', () => {
  it('an absent key is UNASKED — not declined', () => {
    expect(getAnalyticsConsentState()).toBe('unasked');
    expect(hasAnsweredAnalyticsConsent()).toBe(false);
  });

  it('an explicit false is DECLINED — a recorded answer, not an absence', () => {
    localStorage.setItem(KEY, 'false');
    expect(getAnalyticsConsentState()).toBe('declined');
    expect(hasAnsweredAnalyticsConsent()).toBe(true);
  });

  it('an explicit true is GRANTED', () => {
    localStorage.setItem(KEY, 'true');
    expect(getAnalyticsConsentState()).toBe('granted');
    expect(hasAnsweredAnalyticsConsent()).toBe(true);
  });

  /**
   * The whole point, stated as one assertion: the two "we are not collecting
   * under an identity" cases are DIFFERENT VALUES now. If this ever collapses
   * again, the signup flow re-asks people who already answered and the
   * compliance gap reopens.
   */
  it('DECLINED and UNASKED are distinguishable', () => {
    localStorage.setItem(KEY, 'false');
    __resetAnalyticsConsentCache();
    const declined = getAnalyticsConsentState();
    localStorage.clear();
    __resetAnalyticsConsentCache();
    const unasked = getAnalyticsConsentState();
    expect(declined).not.toBe(unasked);
  });
});

describe('the boolean read still means exactly what it meant', () => {
  it.each([
    ['unasked (absent key)', null, false],
    ['declined', 'false', false],
    ['granted', 'true', true],
  ])('%s (stored %s) -> getAnalyticsConsent() === %s', (_label, stored, expected) => {
    if (stored !== null) localStorage.setItem(KEY, stored);
    expect(getAnalyticsConsent()).toBe(expected);
  });

  it('only "granted" is consent — "unasked" is never treated as a yes', () => {
    expect(getAnalyticsConsent()).toBe(false);
    expect(getAnalyticsConsentState()).toBe('unasked');
  });
});

describe('recording an answer', () => {
  /**
   * The signup flow's job. Before it existed, a decliner was written nowhere:
   * they simply stayed at the default, so the app could never tell them from
   * someone who had never seen the question.
   */
  it('setAnalyticsConsent(false) moves UNASKED to DECLINED', () => {
    expect(getAnalyticsConsentState()).toBe('unasked');
    setAnalyticsConsent(false);
    expect(getAnalyticsConsentState()).toBe('declined');
    expect(hasAnsweredAnalyticsConsent()).toBe(true);
  });

  it('setAnalyticsConsent(true) moves UNASKED to GRANTED', () => {
    setAnalyticsConsent(true);
    expect(getAnalyticsConsentState()).toBe('granted');
  });

  /**
   * WIRE FORMAT UNCHANGED. A build without the tri-state read must still parse
   * what this writes (`=== 'true'`), and this must still parse what that wrote.
   */
  it('writes the same two strings the boolean version always wrote', () => {
    setAnalyticsConsent(true);
    expect(localStorage.getItem(KEY)).toBe('true');
    setAnalyticsConsent(false);
    expect(localStorage.getItem(KEY)).toBe('false');
  });

  it('the choice survives a reload — a fresh module cache re-reads it', () => {
    setAnalyticsConsent(true);
    __resetAnalyticsConsentCache(); // stand-in for a new page load
    expect(getAnalyticsConsentState()).toBe('granted');
    expect(hasAnsweredAnalyticsConsent()).toBe(true);

    setAnalyticsConsent(false);
    __resetAnalyticsConsentCache();
    expect(getAnalyticsConsentState()).toBe('declined');
    expect(hasAnsweredAnalyticsConsent()).toBe(true);
  });
});

describe('storage that cannot be trusted', () => {
  /**
   * Unreadable storage must fail closed on COLLECTION (never 'granted') and
   * ALSO fail closed on the record: we do not get to claim someone answered
   * when we could not read whether they did. 'unasked' is both.
   */
  it('an unreadable store reads as UNASKED, and never throws', () => {
    const spy = vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
      throw new Error('SecurityError');
    });

    expect(() => getAnalyticsConsentState()).not.toThrow();
    expect(getAnalyticsConsentState()).toBe('unasked');
    expect(hasAnsweredAnalyticsConsent()).toBe(false);
    expect(getAnalyticsConsent()).toBe(false);
    spy.mockRestore();
  });

  it('a value that is neither "true" nor "false" reads as UNASKED', () => {
    // Corrupted, hand-edited, or written by a future build. Anything we cannot
    // interpret is an answer we do not have.
    localStorage.setItem(KEY, 'yes');
    expect(getAnalyticsConsentState()).toBe('unasked');
    expect(getAnalyticsConsent()).toBe(false);
  });

  it('an in-memory choice survives a store that refuses to persist', () => {
    const spy = vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new Error('QuotaExceeded');
    });

    expect(() => setAnalyticsConsent(false)).not.toThrow();
    // The answer was given; only the durability was lost. It must not read
    // back as "still owed an answer" for the rest of this session.
    expect(getAnalyticsConsentState()).toBe('declined');
    expect(hasAnsweredAnalyticsConsent()).toBe(true);
    spy.mockRestore();
  });
});
