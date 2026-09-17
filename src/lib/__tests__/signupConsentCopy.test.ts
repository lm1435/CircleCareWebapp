import { afterEach, describe, it, expect, vi } from 'vitest';
import enAuth from '@/i18n/en/auth.json';
import esAuth from '@/i18n/es/auth.json';
import enProfile from '@/i18n/en/profile.json';
import esProfile from '@/i18n/es/profile.json';
import {
  ANONYMOUS_ANALYTICS_WHEN_DECLINED,
  identifyAllowed,
  resolveAnalyticsModeForState,
} from '../analyticsMode';
import {
  CARVE_OUT,
  expectAccountLinkDisclosed,
  splitOffSentence,
  stringLeaves,
} from './consentCopyClaims';

/**
 * THE SIGNUP CONSENT COPY MUST MATCH WHAT THE CODE ACTUALLY DOES.
 *
 * Same contract as consentCopyHonesty.test.ts, applied to the new signup
 * checkbox: this is the sentence someone reads at the moment they decide, so
 * it is the one sentence that must not overstate the privacy of saying yes or
 * understate what saying no still collects.
 */

const ANONYMITY_CLAIMS = [/anonymous/i, /anónim/i, /anonim/i];

/**
 * The off-state sentence starts here and ends at the end of THAT sentence
 * (`splitOffSentence`); every other sentence describes saying YES.
 */
const OFF_STATE_MARKER = {
  en: 'If you leave this unchecked',
  es: 'Si lo dejas sin marcar',
} as const;

const EN = enAuth.signup.analytics;
const ES = esAuth.signup.analytics;

const identifyFn = vi.fn();

vi.mock('posthog-js', () => ({
  default: {
    init: vi.fn(),
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

/**
 * The PREMISE of the accept-state test, observed rather than assumed: run the
 * real signup acceptance (`recordAnalyticsConsentDecision(true, { id })`)
 * through the real lib/posthog.ts + lazy loader, with a key configured and
 * only posthog-js itself mocked, and return what reached `posthog.identify`.
 */
async function identifyCallsAfterAccepting(userId: string): Promise<unknown[][]> {
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
  const { recordAnalyticsConsentDecision } = await import('../analyticsConsentDecision');
  const { loadPosthogModule } = await import('../posthogLoader');
  recordAnalyticsConsentDecision(true, { id: userId });
  await loadPosthogModule();
  await new Promise((resolve) => setTimeout(resolve, 0));
  return identifyFn.mock.calls;
}

describe('signup analytics consent copy', () => {
  it('exists in both languages', () => {
    for (const copy of [EN, ES]) {
      expect(typeof copy.label).toBe('string');
      expect(typeof copy.detail).toBe('string');
      expect(copy.label.length).toBeGreaterThan(0);
      expect(copy.detail.length).toBeGreaterThan(0);
    }
  });

  it.each([
    ['en', EN, OFF_STATE_MARKER.en],
    ['es', ES, OFF_STATE_MARKER.es],
  ])('%s ACCEPT-state copy does not claim anonymity', async (_lang, copy, marker) => {
    // Guards the premise: accepting really does identify the account in
    // PostHog — `posthog.identify(userId)`, BY ID ONLY since 2026-09-10. If
    // accepting ever stops identifying, this copy test has lost its reason.
    expect(identifyAllowed(resolveAnalyticsModeForState('granted'))).toBe(true);
    expect(await identifyCallsAfterAccepting('user-1')).toEqual([['user-1']]);

    const split = splitOffSentence(copy.detail, marker);
    expect(split, `detail must carry the decline sentence starting "${marker}"`).not.toBeNull();
    // Everything OUTSIDE the one decline sentence — including any sentence
    // after it — is accept-state copy, so an anonymity claim cannot hide
    // behind the marker.
    const acceptState = [copy.label, split?.rest ?? ''].join(' ');
    for (const claim of ANONYMITY_CLAIMS) {
      expect(
        claim.test(acceptState),
        `accept-state copy claims anonymity while accepting calls identify(userId): "${acceptState}"`
      ).toBe(false);
    }
  });

  it.each([
    ['en', EN, OFF_STATE_MARKER.en],
    ['es', ES, OFF_STATE_MARKER.es],
  ])('%s DECLINE sentence claims anonymity, and the code makes that true', (_lang, copy, marker) => {
    const declineState = splitOffSentence(copy.detail, marker)?.off ?? '';
    expect(ANONYMITY_CLAIMS.some((claim) => claim.test(declineState))).toBe(true);
    // Only honest while BOTH hold: decliners ARE still collected, and are
    // never identified.
    expect(ANONYMOUS_ANALYTICS_WHEN_DECLINED).toBe(true);
    expect(resolveAnalyticsModeForState('declined')).toBe('anonymous');
    expect(identifyAllowed('anonymous')).toBe(false);
  });

  /**
   * DOES NOT CLAIM THE EMAIL IS ATTACHED.
   *
   * Both surfaces used to say accepting links the data to the account
   * "including your email address". Since 2026-09-10 that is false:
   * `identifyUser` calls `posthog.identify(userId)` with the opaque id and no
   * traits bag, so no email reaches PostHog. Over-disclosing is still a false
   * privacy statement, so the claim is guarded out of EVERY string under
   * `signup.analytics` (auth.json) and `analytics` (profile.json) — label,
   * detail, description, toggle, hint — in both languages. None of those keys
   * mentions email for any other reason, so no key is exempted.
   *
   * ES covers "correo", "email"/"e-mail" (common in Latin American Spanish) and
   * "dirección electrónica". Accepted gap: an English periphrasis such as "the
   * address you signed up with" is not matched.
   */
  it.each([
    ['en', enAuth.signup.analytics, enProfile.analytics, /e-?mail/i],
    ['es', esAuth.signup.analytics, esProfile.analytics, /correo|e-?mail|direcci[oó]n electr[oó]nica/i],
  ])(
    '%s consent copy does not claim the EMAIL is attached, because identify sends the id only',
    async (_lang, signupCopy, profileCopy, emailClaim) => {
      // The fact that makes the absence honest: accepting identifies by id
      // alone — exactly one argument, no `{ email }` traits.
      expect(await identifyCallsAfterAccepting('user-1')).toEqual([['user-1']]);

      const leaves = [
        ...stringLeaves(signupCopy, 'signup.analytics'),
        ...stringLeaves(profileCopy, 'analytics'),
      ];
      // Anti-vacuity: the walk must actually reach the known keys.
      expect(leaves.map(([path]) => path)).toEqual(
        expect.arrayContaining([
          'signup.analytics.label',
          'signup.analytics.detail',
          'analytics.description',
          'analytics.enable',
          'analytics.hint',
        ])
      );
      for (const [path, text] of leaves) {
        expect(
          emailClaim.test(text),
          `${path} claims the email is attached, but identify sends the user id only: "${text}"`
        ).toBe(false);
      }
    }
  );

  /**
   * DISCLOSES THE LINK, AND DOES NOT NEGATE IT.
   *
   * Accepting calls `identify(userId)`, so the accept-state copy must say the
   * data is linked to the account — positively. A bare /account/ keyword would
   * pass "never linked to your account", which inverts the disclosure. The
   * decline sentence ("never linked to you") is excluded from this check.
   */
  it.each([
    ['en', EN, OFF_STATE_MARKER.en, 'en'],
    ['es', ES, OFF_STATE_MARKER.es, 'es'],
  ] as const)('%s ACCEPT-state copy discloses the account link, un-negated', async (_lang, copy, marker, lang) => {
    expect(await identifyCallsAfterAccepting('user-1')).toEqual([['user-1']]);
    const split = splitOffSentence(copy.detail, marker);
    expect(split, `detail must carry the decline sentence starting "${marker}"`).not.toBeNull();
    expectAccountLinkDisclosed([copy.label, split?.rest ?? ''].join(' '), lang);
  });

  it.each([
    ['en', EN, /session/i],
    ['es', ES, /sesión/i],
  ])('%s says the anonymous data is session-only', (_lang, copy, needle) => {
    // True because persistence is 'memory' in every mode (lib/posthog.ts).
    expect(needle.test(copy.detail)).toBe(true);
  });

  it.each([
    ['en', EN, /Profile/],
    ['es', ES, /Perfil/],
  ])('%s tells people where to change their mind', (_lang, copy, needle) => {
    // The Profile > Privacy toggle is the withdrawal route, and it must be
    // named — a consent you cannot find your way back out of is not one.
    expect(needle.test(copy.detail)).toBe(true);
  });

  /**
   * Same false claim the Profile copy is pinned against: `vital_type` and
   * medication `status` ARE sent, so "never includes health information"
   * would be untrue here too.
   */
  it.each([
    ['en', EN],
    ['es', ES],
  ])('%s does not claim to exclude health information', (_lang, copy) => {
    const text = [copy.label, copy.detail].join(' ');
    for (const claim of [/health information/i, /información de salud/i]) {
      expect(claim.test(text)).toBe(false);
    }
  });

  it.each([
    ['en', EN, /never includes ([^.]*)\./i, [/readings/i, /medication names/i, /notes/i, /message content/i]],
    [
      'es',
      ES,
      /nunca incluyen ([^.]*)\./i,
      [/mediciones/i, /nombres de medicamentos/i, /notas/i, /contenido de los mensajes/i],
    ],
  ])('%s keeps the claims that ARE true about what is excluded', (_lang, copy, sentence, categories) => {
    // No reading VALUE, drug name, note body or message body ever reaches
    // PostHog — see the per-event property lists in lib/analytics.ts. Each
    // excluded category is checked INSIDE the exclusion sentence: a length
    // check would survive deleting the sentence outright.
    const match = sentence.exec(copy.detail);
    expect(match, `detail must carry the exclusion sentence: "${copy.detail}"`).not.toBeNull();
    const excluded = match?.[1] ?? '';
    for (const category of categories) {
      expect(category.test(excluded), `exclusion sentence must name ${category}: "${excluded}"`).toBe(
        true
      );
    }
    // NO CARVE-OUTS. "…message content, except notes you choose to share."
    // names every category and still un-promises one. Checked across ALL
    // accept-state copy, not just up to the first period, so the carve-out
    // cannot move into the next sentence either.
    const marker = _lang === 'en' ? OFF_STATE_MARKER.en : OFF_STATE_MARKER.es;
    const acceptState = [copy.label, splitOffSentence(copy.detail, marker)?.rest ?? copy.detail].join(' ');
    expect(
      CARVE_OUT.test(acceptState),
      `accept-state copy carves an exception out of the exclusion list: "${acceptState}"`
    ).toBe(false);
  });

  it('does not conflate itself with the Terms checkbox', () => {
    // The Terms sentence is a REQUIRED consent; this one is optional. If they
    // ever become the same string, one of them is lying about what ticking it
    // does.
    expect(EN.label).not.toBe(enAuth.signup.termsCheckbox);
    expect(ES.label).not.toBe(esAuth.signup.termsCheckbox);
  });

  it('agrees with the Profile toggle copy — same promise, both surfaces', () => {
    // Both describe the same mechanism; a visitor who accepts at signup and
    // later reads the Profile hint must not find a different story.
    for (const [signup, profile] of [
      [EN.detail, enProfile.analytics.hint],
      [ES.detail, esProfile.analytics.hint],
    ]) {
      const signupClaimsAnonWhenOff = ANONYMITY_CLAIMS.some((c) => c.test(signup));
      const profileClaimsAnonWhenOff = ANONYMITY_CLAIMS.some((c) => c.test(profile));
      expect(signupClaimsAnonWhenOff).toBe(profileClaimsAnonWhenOff);
    }
  });

  it('has no emoji in either language', () => {
    const emoji = /\p{Extended_Pictographic}/u;
    for (const copy of [EN, ES]) {
      expect(emoji.test(copy.label)).toBe(false);
      expect(emoji.test(copy.detail)).toBe(false);
    }
  });

  it('addresses the reader as tú in Spanish, never usted', () => {
    expect(/\busted\b/i.test(ES.detail)).toBe(false);
    expect(/\busted\b/i.test(ES.label)).toBe(false);
  });
});
