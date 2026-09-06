import { describe, it, expect, beforeEach, vi } from 'vitest';
import {
  ANONYMOUS_ANALYTICS_WHEN_DECLINED,
  collectionAllowed,
  identifyAllowed,
  resolveAnalyticsMode,
} from '../analyticsMode';

/**
 * The dual-mode consent gate, pinned at the ways it fails QUIETLY.
 *
 * Mirrors mobile's suite so the two clients cannot drift on consent behaviour.
 * Every case here turns red under mutation — a gate nobody has watched fail is
 * not a gate.
 */
describe('analytics mode', () => {
  it('SAFETY: the anonymous flag ships OFF', () => {
    // Deliberately brittle. If this ever fails, a build is measuring people who
    // said no — and it must be a DECISION taken with counsel, recorded in this
    // test's diff, not a default someone drifted into.
    expect(ANONYMOUS_ANALYTICS_WHEN_DECLINED).toBe(false);
  });

  it('consent always means full analytics, whatever the flag says', () => {
    expect(resolveAnalyticsMode(true)).toBe('full');
  });

  it('declining means OFF while the flag is off', () => {
    expect(resolveAnalyticsMode(false)).toBe(ANONYMOUS_ANALYTICS_WHEN_DECLINED ? 'anonymous' : 'off');
    // Given the safety test above, this is the shipped behaviour:
    expect(resolveAnalyticsMode(false)).toBe('off');
  });

  it('never identifies without consent — in EITHER declined mode', () => {
    // The single most important line in this file. identify() is what joins
    // data to a named account, and on web it carries the EMAIL.
    expect(identifyAllowed('off')).toBe(false);
    expect(identifyAllowed('anonymous')).toBe(false);
    expect(identifyAllowed('full')).toBe(true);
  });

  it('collects nothing at all when off, and events (only) when anonymous', () => {
    expect(collectionAllowed('off')).toBe(false);
    expect(collectionAllowed('anonymous')).toBe(true);
    expect(collectionAllowed('full')).toBe(true);
  });
});

/**
 * The consent read is synchronous here (localStorage), but it can be
 * UNAVAILABLE — private mode, cleared site data, a browser blocking storage.
 * `getAnalyticsConsent` swallows that and returns false, so the failure mode is
 * "collect nothing", never "collect from someone who never answered".
 */
describe('unreadable consent storage', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it('falls closed when localStorage throws', async () => {
    vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
      throw new Error('storage blocked');
    });
    const consent = await import('../analyticsConsent');
    consent.__resetAnalyticsConsentCache();
    const mode = await import('../analyticsMode');
    expect(mode.currentAnalyticsMode()).toBe('off');
    expect(mode.analyticsCollectionAllowed()).toBe(false);
  });
});
