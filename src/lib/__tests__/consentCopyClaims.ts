import { expect } from 'vitest';

/**
 * Shared sentence-level checks for the analytics consent copy (signup checkbox
 * detail + Profile > Privacy hint). Used by signupConsentCopy.test.ts,
 * consentCopyHonesty.test.ts and SignUpPage.analyticsConsent.test.tsx.
 *
 * WHY SENTENCE-LEVEL. Bare keyword checks (`/account/`, `/never includes/`)
 * certify the word and not the claim: "never linked to your account" contains
 * "account", and "never includes your password" contains "never includes".
 * Each helper here locates the ONE sentence that carries a claim and inspects
 * what that sentence actually says.
 */

export type Lang = 'en' | 'es';

/**
 * Split copy into its OFF-state sentence and everything else.
 *
 * The OFF sentence runs from `marker` to the end of THAT sentence only — not to
 * the end of the string. Treating "everything after the marker" as OFF-state
 * copy let a false "stays anonymous" claim about the ON state hide in a later
 * sentence. Returns null when the marker is absent.
 */
export function splitOffSentence(text: string, marker: string): { off: string; rest: string } | null {
  const start = text.indexOf(marker);
  if (start < 0) return null;
  const terminator = /[.!?](?=\s|$)/.exec(text.slice(start));
  const end = terminator ? start + terminator.index + 1 : text.length;
  return {
    off: text.slice(start, end),
    rest: `${text.slice(0, start)} ${text.slice(end)}`.trim(),
  };
}

export function sentencesOf(text: string): string[] {
  return text
    .split(/(?<=[.!?])\s+/)
    .map((sentence) => sentence.trim())
    .filter(Boolean);
}

/** The ON-state disclosure. Letter lookbehind so "unlinked"/"desvinculados" do not count. */
export const ACCOUNT_LINK_PHRASE: Record<Lang, RegExp> = {
  en: /(?<!\p{L})linked to your account/iu,
  es: /(?<!\p{L})vinculad[oa]s? a tu cuenta/iu,
};

/** Words that invert a disclosure when they precede it in the same sentence. */
export const NEGATOR =
  /(?<!\p{L})(?:not|never|no|nothing|none|without|nunca|jam[aá]s|sin|ni|nada|ning[uú]n[oa]?)(?!\p{L})|n't(?!\p{L})/iu;

/** Words that turn an exclusion list into "excluded, except…". */
export const CARVE_OUT =
  /(?<!\p{L})(?:except|excepting|unless|other than|apart from|excepto|salvo|a menos|a no ser)(?!\p{L})/iu;

/**
 * Assert the ON-state copy POSITIVELY discloses that the data is linked to the
 * account: at least one sentence carries the phrase, and no sentence carrying
 * it negates it before the phrase.
 *
 * Pass ON-state text only (i.e. `splitOffSentence(...).rest` plus labels): the
 * OFF sentence legitimately says anonymous data is "never linked to you".
 */
export function expectAccountLinkDisclosed(onStateText: string, lang: Lang): void {
  const phrase = ACCOUNT_LINK_PHRASE[lang];
  const carrying = sentencesOf(onStateText).filter((sentence) => phrase.test(sentence));
  expect(
    carrying.length,
    `ON-state copy must say the data is linked to the account (${phrase}): "${onStateText}"`
  ).toBeGreaterThan(0);
  for (const sentence of carrying) {
    const prefix = sentence.slice(0, sentence.search(phrase));
    expect(
      NEGATOR.test(prefix),
      `ON-state account disclosure is negated — identify(userId) DOES link it: "${sentence}"`
    ).toBe(false);
  }
}

/** Every string leaf under a copy object, with its key path. */
export function stringLeaves(value: unknown, path = ''): [string, string][] {
  if (typeof value === 'string') return [[path, value]];
  if (value && typeof value === 'object') {
    return Object.entries(value as Record<string, unknown>).flatMap(([key, inner]) =>
      stringLeaves(inner, path ? `${path}.${key}` : key)
    );
  }
  return [];
}
