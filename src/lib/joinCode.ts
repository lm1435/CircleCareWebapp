// Round 4 (R4-2) — invite/join code normalization helpers
// (docs/plans/condition-tags.md, "Round 4: Onboarding friction").
//
// Invite codes are 6 alphanumeric characters, but people paste them from
// emails with stray spaces, dashes, or lowercase. These pure helpers keep the
// normalization in one place so the form input, submit gating, and the
// clipboard-assist button all agree.

/** Canonical invite-code length. */
export const JOIN_CODE_LENGTH = 6;

/** Matches a fully-normalized, complete code: exactly 6 alphanumerics. */
const COMPLETE_CODE_RE = /^[A-Z0-9]{6}$/;

/**
 * Normalize raw typed/pasted input: uppercase and strip spaces (any
 * whitespace) and dashes. Other characters are kept — the user should SEE
 * that something unexpected is in the field rather than have it vanish.
 */
export function normalizeJoinCode(raw: string): string {
  return raw.replace(/[\s-]/g, '').toUpperCase();
}

/**
 * True when a normalized code is submit-ready: exactly 6 characters AND
 * every character is an uppercase alphanumeric (A-Z0-9) — the same charset
 * `extractJoinCode` already enforces. WB10: length alone let a 6-char string
 * containing stray punctuation (e.g. a mis-paste) enable Submit, guaranteeing
 * a round-trip to the backend just to learn it was never a valid code.
 */
export function isCompleteJoinCode(code: string): boolean {
  return COMPLETE_CODE_RE.test(code);
}

/**
 * Clipboard-assist extraction: normalize the clipboard text and return the
 * code ONLY if the whole normalized value is exactly 6 alphanumerics.
 * Anything else (sentences, URLs, partial codes) returns null — we never
 * guess at a substring of arbitrary clipboard content.
 */
export function extractJoinCode(text: string): string | null {
  const normalized = normalizeJoinCode(text);
  return COMPLETE_CODE_RE.test(normalized) ? normalized : null;
}
