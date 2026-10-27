import { getDateInTimezone } from './timezone';

/**
 * Age in whole years from a `YYYY-MM-DD` date of birth, counted against the
 * CARE RECIPIENT's today.
 *
 * A birthday is a calendar fact in the recipient's life, so "has it happened
 * yet" is answered on the recipient's calendar — the same rule as the PDF
 * exports (`pdf/shared/pdfBranding.computeAge`). The old Hero version read UTC
 * getters, which made an APAC recipient a year short on the morning of their
 * birthday and aged an Americas recipient the evening before.
 *
 * Both sides are compared as plain Y/M/D numbers: no `Date` getter touches the
 * DOB, so no zone can shift it. Returns null for anything that is not a real
 * calendar date, or an age outside 0..130, so a malformed value hides the age
 * rather than rendering "age NaN".
 *
 * Mirrored by `mobile/src/utils/recipientAge.ts` — change both together.
 */
export function computeRecipientAge(
  dob: string,
  recipientTimezone: string,
  now: Date = new Date()
): number | null {
  const match = /^(\d{4})-(\d{2})-(\d{2})/.exec(dob.trim());
  if (!match) return null;
  const [by, bm, bd] = [Number(match[1]), Number(match[2]), Number(match[3])];
  const check = new Date(Date.UTC(by, bm - 1, bd));
  if (check.getUTCFullYear() !== by || check.getUTCMonth() !== bm - 1 || check.getUTCDate() !== bd) {
    return null;
  }

  const [ty, tm, td] = getDateInTimezone(recipientTimezone, now).split('-').map(Number);
  let age = ty - by;
  if (tm < bm || (tm === bm && td < bd)) age -= 1;
  if (age < 0 || age > 130) return null;
  return age;
}
