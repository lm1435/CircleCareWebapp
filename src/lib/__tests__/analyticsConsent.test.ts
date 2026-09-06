/**
 * Web analytics consent.
 *
 * The web companion emits to the SAME PostHog project as mobile, and until this
 * existed it initialised on nothing but the presence of an API key. The
 * marketing site has required an explicit "accepted" since launch; this closes
 * the gap between the two siblings.
 *
 * DEFAULTS OFF, with no grandfathering — see the module note. `authStore`
 * persists nothing by design, so there is no local marker that could tell a
 * returning user from a first-time visitor.
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  getAnalyticsConsent,
  setAnalyticsConsent,
  subscribeToAnalyticsConsent,
  __resetAnalyticsConsentCache,
} from '../analyticsConsent';

const KEY = 'cc_analytics_enabled';

beforeEach(() => {
  localStorage.clear();
  __resetAnalyticsConsentCache();
});

describe('default posture', () => {
  it('is OFF when the visitor has never been asked', () => {
    expect(getAnalyticsConsent()).toBe(false);
  });

  it('is OFF for an explicit false, not just an absent key', () => {
    localStorage.setItem(KEY, 'false');
    expect(getAnalyticsConsent()).toBe(false);
  });

  it('is ON only for an explicit opt-in', () => {
    localStorage.setItem(KEY, 'true');
    expect(getAnalyticsConsent()).toBe(true);
  });

  /**
   * localStorage throws in private mode on some browsers and under certain
   * enterprise policies. An unreadable store must fail CLOSED — and must never
   * break the app over an analytics preference.
   */
  it('fails CLOSED when localStorage is unavailable', () => {
    const spy = vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
      throw new Error('SecurityError');
    });

    expect(() => getAnalyticsConsent()).not.toThrow();
    expect(getAnalyticsConsent()).toBe(false);
    spy.mockRestore();
  });
});

describe('setting consent', () => {
  it('persists and notifies subscribers', () => {
    const seen: boolean[] = [];
    subscribeToAnalyticsConsent((v) => seen.push(v));

    setAnalyticsConsent(true);
    expect(localStorage.getItem(KEY)).toBe('true');
    setAnalyticsConsent(false);
    expect(localStorage.getItem(KEY)).toBe('false');

    expect(seen).toEqual([true, false]);
  });

  it('honours the choice in-memory even when persistence fails', () => {
    const spy = vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new Error('QuotaExceeded');
    });

    expect(() => setAnalyticsConsent(true)).not.toThrow();
    expect(getAnalyticsConsent()).toBe(true);
    spy.mockRestore();
  });
});
