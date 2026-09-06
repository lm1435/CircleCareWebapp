// Display formatting for an invite's `expires_at`.
//
// Web port of the deadline line mobile shows on its invite preview
// (mobile/src/screens/auth/JoinCircleScreen.tsx — `Expires · September 3`).
// Neither the public invite landing page nor the pending-invites list showed a
// deadline at all, so an invitee had no way to know how long they had.
//
// TIMEZONE NOTE: `expires_at` is a real INSTANT (a Postgres timestamptz sent as
// an ISO string with a zone), NOT one of the naive care-recipient-local
// wall-clock values that must go through utils/timezone.ts. Formatting an
// instant in the reader's own zone is correct here, and is exactly what mobile
// does on the same field — so `toLocaleDateString` without an explicit
// `timeZone` is deliberate, not the bug that helper file warns about.
//
// The owner-facing countdown ("Expires in 3 days" on MembersPage) is a separate
// rule and lives in api/circleMembers.ts `getInviteExpiryState` — that one is a
// DURATION, this one is a date. They are not interchangeable.

/**
 * Locale to format dates in — web port of mobile's `getFormattingLocale`.
 *
 * Prefer the browser's own locale when it agrees with the language the UI is
 * rendered in, so a Spanish-reading user in Mexico gets `es-MX` conventions
 * rather than bare `es`. When the two disagree (UI switched to Spanish on an
 * en-US browser) the UI language wins — the date must match the words around it.
 */
function getFormattingLocale(i18nLanguage: string): string {
  const browserLocale = typeof navigator !== 'undefined' ? navigator.language : '';
  if (browserLocale && browserLocale.startsWith(i18nLanguage)) return browserLocale;
  return i18nLanguage;
}

/**
 * `expires_at` as a localized month + day, or `null` when there is nothing
 * honest to show (missing or unparseable value).
 *
 * Returning null rather than a placeholder is the point: callers omit the whole
 * line, so a formatting problem can never render "Expires · Invalid Date" on an
 * invite that is perfectly usable.
 */
export function formatInviteExpiryDate(
  expiresAt: string | null | undefined,
  i18nLanguage: string
): string | null {
  if (!expiresAt) return null;
  const at = new Date(expiresAt);
  if (Number.isNaN(at.getTime())) return null;
  return at.toLocaleDateString(getFormattingLocale(i18nLanguage), {
    month: 'long',
    day: 'numeric',
  });
}
