import { describe, it, expect } from 'vitest';
import enProfile from '@/i18n/en/profile.json';
import esProfile from '@/i18n/es/profile.json';
import { identifyUser } from '../posthog';

/**
 * THE CONSENT COPY MUST MATCH WHAT THE CODE ACTUALLY DOES.
 *
 * The analytics toggle used to read "Share anonymous usage data" while the app
 * called `posthog.identify(userId, { email })` on sign-in AND on opt-in. The
 * data is linked to the account and carries the email address; calling it
 * anonymous was a misstatement in the SHIPPED app, not a future risk.
 * (Found on mobile first — the same contradiction existed there.)
 *
 * This is a copy test rather than a behaviour test on purpose: the behaviour is
 * correct and deliberate. What drifted was the sentence describing it, and a
 * privacy claim is the one kind of copy where drift is a compliance problem
 * rather than a polish problem.
 *
 * If analytics ever genuinely becomes anonymous — no `identify`, memory-only
 * persistence so no id is written to the device — then this test SHOULD be
 * changed, deliberately, in the same commit that changes the behaviour.
 */

const ANONYMITY_CLAIMS = [/anonymous/i, /anónim/i, /anonim/i];

describe('analytics consent copy', () => {
  it('exports identifyUser, so the analytics identity is NOT anonymous', () => {
    // Guards the premise: if this ever stops existing, revisit the copy.
    expect(typeof identifyUser).toBe('function');
  });

  it.each([
    ['en', enProfile.analytics],
    ['es', esProfile.analytics],
  ])('%s copy does not claim anonymity', (_lang, analytics) => {
    const text = Object.values(analytics).join(' ');
    for (const claim of ANONYMITY_CLAIMS) {
      expect(
        claim.test(text),
        `Consent copy claims anonymity while identifyUser(userId, { email }) is called: "${text}"`
      ).toBe(false);
    }
  });

  it.each([
    ['en', enProfile.analytics, /account/i],
    ['es', esProfile.analytics, /cuenta/i],
  ])('%s copy discloses that it is linked to the account', (_lang, analytics, needle) => {
    expect(needle.test(Object.values(analytics).join(' '))).toBe(true);
  });

  it('keeps the claims that ARE true', () => {
    // Values, medication names and message content genuinely never reach
    // PostHog — see the per-event property lists in lib/analytics.ts.
    expect(enProfile.analytics.hint).toMatch(/never includes/i);
    expect(esProfile.analytics.hint).toMatch(/nunca incluye/i);
  });

  /**
   * DOES NOT CLAIM TO EXCLUDE HEALTH INFORMATION.
   *
   * The copy used to say "never includes health information". It is not true:
   * `Analytics.vitalLogged` sends `vital_type` ('blood_pressure', 'glucose',
   * 'heart_rate', 'weight') and `medicationConfirmed` sends `status`
   * ('taken' | 'taken_late' | 'skipped') — both on a profile identified by
   * email. WHICH vitals a circle tracks, and whether doses are being taken, is
   * health information about the care recipient even though no value or drug
   * name is attached.
   *
   * The first version of this test asserted only `toMatch(/never includes/i)`,
   * which certified the sentence without checking the claim inside it — the
   * same failure mode as a test that cannot fail. It now checks the claim.
   */
  it.each([
    ['en', enProfile.analytics],
    ['es', esProfile.analytics],
  ])('%s copy does not claim to exclude health information', (_lang, analytics) => {
    const text = Object.values(analytics).join(' ');
    for (const claim of [/health information/i, /información de salud/i]) {
      expect(
        claim.test(text),
        'vital_type and medication status ARE sent, so this claim is false'
      ).toBe(false);
    }
  });
});
