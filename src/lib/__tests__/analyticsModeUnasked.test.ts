import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import * as ts from 'typescript';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  ANONYMOUS_ANALYTICS_WHEN_DECLINED,
  GRANDFATHER_UNASKED_WEB_USERS,
  identifyAllowed,
  resolveAnalyticsMode,
  resolveAnalyticsModeForState,
} from '../analyticsMode';

/**
 * WHAT AN UNANSWERED QUESTION RESOLVES TO — the grandfathering decision.
 *
 * Mobile grandfathers: an install that predates its consent gate is switched ON
 * automatically, detected by a persisted auth session. Web does NOT, and the
 * difference is deliberate rather than an oversight — see the constant's doc
 * comment. Both platforms apply the SAME principle (a consent gate must not
 * change what is already happening to people who were never asked); they land
 * on opposite booleans because their status quos were opposite.
 *
 * These tests are deliberately brittle. Flipping either constant is a decision
 * that shows up in this file's diff.
 */

describe('the grandfathering decision', () => {
  it('DECISION: web does NOT grandfather an unasked visitor into full analytics', () => {
    expect(GRANDFATHER_UNASKED_WEB_USERS).toBe(false);
  });

  it('an UNASKED visitor gets whatever a decliner gets — never "full"', () => {
    expect(resolveAnalyticsModeForState('unasked')).toBe(resolveAnalyticsModeForState('declined'));
    expect(resolveAnalyticsModeForState('unasked')).not.toBe('full');
  });

  /**
   * The single line that makes "nothing is captured under their identity before
   * they answer" true. `identifyUser` on web joins events to the account id
   * (id only since 2026-09-10 — no email, but a named PostHog person all the same).
   */
  it('an UNASKED visitor is never identified', () => {
    expect(identifyAllowed(resolveAnalyticsModeForState('unasked'))).toBe(false);
  });

  it('GRANTED is the only state that resolves to full analytics', () => {
    expect(resolveAnalyticsModeForState('granted')).toBe('full');
    expect(resolveAnalyticsModeForState('declined')).not.toBe('full');
    expect(resolveAnalyticsModeForState('unasked')).not.toBe('full');
  });

  it('declining still means the anonymous client while that flag is on', () => {
    expect(ANONYMOUS_ANALYTICS_WHEN_DECLINED).toBe(true);
    expect(resolveAnalyticsModeForState('declined')).toBe('anonymous');
    expect(resolveAnalyticsModeForState('unasked')).toBe('anonymous');
  });

  /** The boolean resolver still exists and still agrees, so nothing drifts. */
  it('agrees with the boolean resolver on the two states it can express', () => {
    expect(resolveAnalyticsModeForState('granted')).toBe(resolveAnalyticsMode(true));
    expect(resolveAnalyticsModeForState('declined')).toBe(resolveAnalyticsMode(false));
  });
});

type AnalyticsModeModule = typeof import('../analyticsMode');

/**
 * The REAL lib/analyticsMode.ts with exactly one literal flipped:
 * `GRANDFATHER_UNASKED_WEB_USERS = false` -> `true`.
 *
 * Why a source-patched copy: the flag is a same-module `const` read by
 * `resolveAnalyticsModeForState`, so `vi.doMock` of the module would have to
 * REIMPLEMENT the resolvers and `currentAnalyticsMode` — testing the mock, not
 * the code. Transpiling the real file with only the literal changed runs every
 * other line as shipped, and `./analyticsConsent` is the real module too.
 */
async function analyticsModeWithGrandfatheringOn(): Promise<AnalyticsModeModule> {
  const source = readFileSync(join(__dirname, '..', 'analyticsMode.ts'), 'utf8');
  const flag = /export const GRANDFATHER_UNASKED_WEB_USERS = false;/g;
  expect(source.match(flag)?.length, 'the flag declaration must appear exactly once').toBe(1);
  const patched = source.replace(flag, 'export const GRANDFATHER_UNASKED_WEB_USERS = true;');
  const js = ts.transpileModule(patched, {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 },
  }).outputText;
  const consent = await import('../analyticsConsent');
  const requireShim = (id: string): unknown => {
    if (id === './analyticsConsent' || id === '@/lib/analyticsConsent') return consent;
    throw new Error(`analyticsMode.ts gained an import this harness does not provide: ${id}`);
  };
  const mod: { exports: Record<string, unknown> } = { exports: {} };
  new Function('require', 'module', 'exports', js)(requireShim, mod, mod.exports);
  return mod.exports as unknown as AnalyticsModeModule;
}

async function storeConsent(stored: string | null): Promise<void> {
  if (stored !== null) localStorage.setItem('cc_analytics_enabled', stored);
  const consent = await import('../analyticsConsent');
  consent.__resetAnalyticsConsentCache();
}

describe('the live mode (currentAnalyticsMode) as shipped — flag OFF', () => {
  beforeEach(() => {
    localStorage.clear();
    vi.restoreAllMocks();
  });

  it('resolves synchronously — there is no window in which consent is "still loading"', async () => {
    // Mobile needs a `consentLoaded` gate because AsyncStorage is async and an
    // event fired before the read resolves would escape the gate. localStorage
    // is synchronous, so on web the answer is known before the first capture
    // can possibly run. This pins that property: reading the mode must not
    // return a promise or a sentinel.
    const mode = await import('../analyticsMode');
    const value = mode.currentAnalyticsMode();
    expect(['full', 'anonymous', 'off']).toContain(value);
  });

  /**
   * With grandfathering OFF, unasked and declined BOTH resolve to anonymous, so
   * these rows alone cannot tell a tri-state read from a collapsed boolean —
   * the describe below is what can.
   */
  it.each([
    ['absent (unasked)', null, 'anonymous'],
    ['false (declined)', 'false', 'anonymous'],
    ['true (granted)', 'true', 'full'],
  ])('%s (stored %s) -> %s', async (_label, stored, expected) => {
    await storeConsent(stored);
    const mode = await import('../analyticsMode');
    expect(mode.currentAnalyticsMode()).toBe(expected);
  });
});

/**
 * THE LIVE MODE READS THE TRI-STATE, NOT A COLLAPSED BOOLEAN.
 *
 * Observable only with grandfathering ON, where unasked -> 'full' but declined
 * -> 'anonymous'. A `currentAnalyticsMode` that collapses consent to a boolean
 * (`getAnalyticsConsent()`, or `state === 'granted'`) sends unasked to
 * 'anonymous' and fails here.
 */
describe('the live mode reads the tri-state, not a collapsed boolean (grandfathering flipped ON in a source-patched copy)', () => {
  beforeEach(() => {
    localStorage.clear();
    vi.restoreAllMocks();
  });

  it('the patched copy really has the flag on, and nothing else changed', async () => {
    const patched = await analyticsModeWithGrandfatheringOn();
    expect(patched.GRANDFATHER_UNASKED_WEB_USERS).toBe(true);
    expect(patched.ANONYMOUS_ANALYTICS_WHEN_DECLINED).toBe(ANONYMOUS_ANALYTICS_WHEN_DECLINED);
    expect(patched.resolveAnalyticsModeForState('unasked')).toBe('full');
  });

  it.each([
    ['absent (unasked)', null, 'full'],
    ['false (declined)', 'false', 'anonymous'],
    ['true (granted)', 'true', 'full'],
  ])('%s (stored %s) -> %s', async (_label, stored, expected) => {
    await storeConsent(stored);
    const patched = await analyticsModeWithGrandfatheringOn();
    expect(patched.currentAnalyticsMode()).toBe(expected);
  });

  it('unasked and declined are DIFFERENT live modes — identify-eligible vs anonymous', async () => {
    const patched = await analyticsModeWithGrandfatheringOn();
    await storeConsent(null);
    const unasked = patched.currentAnalyticsMode();
    localStorage.clear();
    await storeConsent('false');
    const declined = patched.currentAnalyticsMode();
    expect(patched.identifyAllowed(unasked)).toBe(true);
    expect(patched.identifyAllowed(declined)).toBe(false);
  });
});
