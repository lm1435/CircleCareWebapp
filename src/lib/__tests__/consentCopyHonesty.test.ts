import { afterEach, describe, it, expect, vi } from 'vitest';
import enProfile from '@/i18n/en/profile.json';
import esProfile from '@/i18n/es/profile.json';
import { ANONYMOUS_ANALYTICS_WHEN_DECLINED, identifyAllowed } from '../analyticsMode';
import { CARVE_OUT, expectAccountLinkDisclosed, splitOffSentence } from './consentCopyClaims';

/**
 * THE CONSENT COPY MUST MATCH WHAT THE CODE ACTUALLY DOES.
 *
 * The analytics toggle used to read "Share anonymous usage data" while the app
 * called `posthog.identify(userId, { email })` on sign-in AND on opt-in. The
 * data was linked to the account and carried the email address; calling it
 * anonymous was a misstatement in the SHIPPED app, not a future risk.
 * (Found on mobile first — the same contradiction existed there.)
 *
 * This is a copy test rather than a behaviour test on purpose: the behaviour is
 * correct and deliberate. What drifted was the sentence describing it, and a
 * privacy claim is the one kind of copy where drift is a compliance problem
 * rather than a polish problem.
 *
 * 2026-09-07: the OFF state genuinely IS anonymous now (ANONYMOUS_ANALYTICS_
 * WHEN_DECLINED on: no `identify`, memory-only persistence, stable ids
 * stripped in `before_send`), so the hint gained ONE sentence describing it —
 * and that sentence is the only place the word is allowed. The ON-state copy
 * still may not claim it: ON still calls identify(userId) — by opaque id only
 * since 2026-09-10, but identified all the same.
 *
 * The PREMISES below are behavioural, not `typeof` checks: they boot the real
 * lib/posthog.ts + lazy loader with a key configured and only posthog-js
 * mocked, and look at what actually reaches the SDK.
 */

const ANONYMITY_CLAIMS = [/anonymous/i, /anónim/i, /anonim/i];

/**
 * The hint's off-state sentence starts here and ends at the end of THAT
 * sentence (`splitOffSentence`). Every other sentence — before OR after it —
 * describes ON.
 */
const OFF_STATE_MARKER = { en: 'With this off', es: 'Con esto desactivado' } as const;

/** ON-state copy: description + toggle label + the hint minus its one OFF sentence. */
function onStateCopy(analytics: typeof enProfile.analytics, marker: string): string {
  const split = splitOffSentence(analytics.hint, marker);
  expect(split, `hint must carry the off-state sentence starting "${marker}"`).not.toBeNull();
  return [analytics.description, analytics.enable, split?.rest ?? ''].join(' ');
}

const init = vi.fn();
const identifyFn = vi.fn();

vi.mock('posthog-js', () => ({
  default: {
    init,
    register: vi.fn(),
    capture: vi.fn(),
    reset: vi.fn(),
    opt_in_capturing: vi.fn(),
    opt_out_capturing: vi.fn(),
    identify: identifyFn,
    captureException: vi.fn(),
  },
}));

afterEach(() => {
  vi.doUnmock('@/lib/env');
});

/** Boot a fresh real posthog.ts for a visitor with this answer, and let `configure()` run. */
async function bootWithConsent(consented: boolean) {
  init.mockClear();
  identifyFn.mockClear();
  localStorage.clear();
  vi.resetModules();
  vi.doMock('@/lib/env', () => ({
    env: {
      VITE_SUPABASE_URL: 'https://test.supabase.co',
      VITE_SUPABASE_ANON_KEY: 'anon',
      VITE_API_URL: 'http://localhost:3000',
      VITE_POSTHOG_KEY: 'phc_test_key',
    },
  }));
  const consent = await import('@/lib/analyticsConsent');
  const posthog = await import('@/lib/posthog');
  const loader = await import('@/lib/posthogLoader');
  consent.setAnalyticsConsent(consented);
  posthog.initAnalytics();
  await loader.loadPosthogModule();
  await new Promise((resolve) => setTimeout(resolve, 0));
  return posthog;
}

describe('analytics consent copy', () => {
  it('identifies a consenting visitor by account id, so the ON-state identity is NOT anonymous', async () => {
    // Guards the premise: if ON ever stops identifying, revisit the copy.
    const { identifyUser } = await bootWithConsent(true);
    identifyUser('user-1');
    expect(identifyFn.mock.calls).toEqual([['user-1']]);
  });

  it.each([
    ['en', enProfile.analytics, OFF_STATE_MARKER.en],
    ['es', esProfile.analytics, OFF_STATE_MARKER.es],
  ])('%s ON-state copy (every sentence but the OFF one) does not claim anonymity', (_lang, analytics, marker) => {
    const onState = onStateCopy(analytics, marker);
    for (const claim of ANONYMITY_CLAIMS) {
      expect(
        claim.test(onState),
        `ON-state copy claims anonymity while identifyUser(userId) is called: "${onState}"`
      ).toBe(false);
    }
  });

  it.each([
    ['en', enProfile.analytics, OFF_STATE_MARKER.en],
    ['es', esProfile.analytics, OFF_STATE_MARKER.es],
  ])('%s OFF-state sentence claims anonymity, and the code makes that true', async (_lang, analytics, marker) => {
    const offState = splitOffSentence(analytics.hint, marker)?.off ?? '';
    expect(ANONYMITY_CLAIMS.some((claim) => claim.test(offState))).toBe(true);
    // The sentence is only honest while ALL hold: declined visitors are
    // collected (else "we still collect" is false), never identified, and
    // kept in memory only (else "session-only" is false).
    expect(ANONYMOUS_ANALYTICS_WHEN_DECLINED).toBe(true);
    expect(identifyAllowed('anonymous')).toBe(false);

    const { identifyUser } = await bootWithConsent(false);
    expect(init).toHaveBeenCalledTimes(1);
    const options = init.mock.calls[0][1] as Record<string, unknown>;
    expect(options.persistence).toBe('memory');
    identifyUser('user-1'); // the auth store on sign-in
    expect(identifyFn).not.toHaveBeenCalled();
  });

  /**
   * A bare /account/ keyword passed "never linked to your account" and "Not
   * linked to your account" — the disclosure inverted. The ON-state sentence
   * must carry the phrase with no negator before it. The OFF sentence ("never
   * linked to you") is excluded by `onStateCopy`.
   */
  it.each([
    ['en', enProfile.analytics, OFF_STATE_MARKER.en, 'en'],
    ['es', esProfile.analytics, OFF_STATE_MARKER.es, 'es'],
  ] as const)('%s ON-state copy discloses that it is linked to the account, un-negated', (_lang, analytics, marker, lang) => {
    expectAccountLinkDisclosed(onStateCopy(analytics, marker), lang);
  });

  /**
   * Each excluded category is checked INSIDE the exclusion sentence: matching
   * only /never includes/ let the list be gutted ("never includes your
   * password") and stay green.
   */
  it.each([
    ['en', enProfile.analytics, OFF_STATE_MARKER.en, /never includes ([^.]*)\./i, [/readings/i, /medication names/i, /message content/i]],
    [
      'es',
      esProfile.analytics,
      OFF_STATE_MARKER.es,
      /nunca incluye ([^.]*)\./i,
      [/mediciones/i, /nombres de medicamentos/i, /contenido de los mensajes/i],
    ],
  ])('%s keeps the claims that ARE true, category by category', (_lang, analytics, marker, sentence, categories) => {
    // Values, medication names and message content genuinely never reach
    // PostHog — see the per-event property lists in lib/analytics.ts.
    const match = sentence.exec(analytics.hint);
    expect(match, `hint must carry the exclusion sentence: "${analytics.hint}"`).not.toBeNull();
    const excluded = match?.[1] ?? '';
    for (const category of categories) {
      expect(category.test(excluded), `exclusion sentence must name ${category}: "${excluded}"`).toBe(true);
    }
    const onState = onStateCopy(analytics, marker);
    expect(
      CARVE_OUT.test(onState),
      `ON-state copy carves an exception out of the exclusion list: "${onState}"`
    ).toBe(false);
  });

  /**
   * DOES NOT CLAIM TO EXCLUDE HEALTH INFORMATION.
   *
   * The copy used to say "never includes health information". It is not true:
   * `Analytics.vitalLogged` sends `vital_type` ('blood_pressure', 'glucose',
   * 'heart_rate', 'weight') and `medicationConfirmed` sends `status`
   * ('taken' | 'taken_late' | 'skipped') — both on a profile identified by
   * account id. WHICH vitals a circle tracks, and whether doses are being taken, is
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
