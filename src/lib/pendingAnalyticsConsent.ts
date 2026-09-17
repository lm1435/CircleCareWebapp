// Pending signup ANALYTICS consent — survives the full-page OAuth redirect
// that router state cannot (mirrors lib/pendingTermsConsent.ts and
// lib/pendingAuthMethod.ts).
//
// Most signups are Google/Apple, so if the consent moment only worked on the
// email form the majority of new accounts would skip the question entirely.
// SignUpPage parks the checkbox answer here before handing off to the
// provider; AuthCallbackPage records it once the sign-in actually completes.
//
// WHY THIS IS NOT A FLAG THE WAY pendingTermsConsent IS. Terms are REQUIRED,
// so there "parked" and "accepted" are the same thing and absence just means
// "this OAuth run did not start at the signup page". Analytics consent is
// OPTIONAL, so all THREE outcomes have to survive the redirect: accepted,
// declined, and nothing-parked. Collapsing the last two would either lose
// every OAuth decline (leaving them indistinguishable from never-asked, which
// is the exact gap this whole change closes) or let an OAuth LOGIN stamp a
// decline onto a returning user who was never asked anything.
//
// sessionStorage (not localStorage): tab-scoped and gone when the tab closes,
// matching the lifetime of "I answered the question and clicked an OAuth
// button". The durable record lives in lib/analyticsConsent.
//
// PRIVACY: the stored value is the literal string '1' or '0' — no PII.

const STORAGE_KEY = 'cc_pending_analytics_consent';

/**
 * Park the answer before handing off to the provider redirect.
 *
 * Safari private mode throws on storage access — degrade to a no-op. The
 * consent simply isn't relayed, so the visitor stays 'unasked' rather than
 * being recorded as having given an answer we could not carry.
 */
export function setPendingAnalyticsConsent(accepted: boolean): void {
  try {
    sessionStorage.setItem(STORAGE_KEY, accepted ? '1' : '0');
  } catch {
    // Storage unavailable — degrade silently.
  }
}

/**
 * Read AND clear the parked answer (atomic get-then-clear so a stale value can
 * never be attributed to a later, unrelated sign-in — this browser can be
 * signed in as a different account minutes later).
 *
 * Returns null when nothing was parked (an OAuth LOGIN, a cancelled handshake
 * retried from /login), when storage is unavailable, or when the stored value
 * is not one we wrote. null means "record nothing", never "record a decline".
 */
export function consumePendingAnalyticsConsent(): boolean | null {
  try {
    const stored = sessionStorage.getItem(STORAGE_KEY);
    if (stored === null) return null;
    sessionStorage.removeItem(STORAGE_KEY);
    if (stored === '1') return true;
    if (stored === '0') return false;
    return null;
  } catch {
    return null;
  }
}

/**
 * Drop the parked answer without reading it — for the paths where the
 * handshake this answer was parked FOR never started.
 *
 * WHY THIS IS NOT COVERED BY `consumePendingAnalyticsConsent`'s read-and-clear.
 * That contract only protects the paths that reach /auth/callback. If
 * `signInWithOAuth` fails BEFORE the redirect (offline, a Supabase 5xx, a
 * blocked popup), the browser never leaves the signup page, no callback runs,
 * and the parked value survives for the life of the TAB — across SPA
 * navigation to /login, where an OAuth sign-in for a completely different
 * (and possibly RETURNING) account would consume it.
 *
 * The stale answer that does the damage is '0', which is the DEFAULT: the
 * callback would record a decline, and the server half of a decline deletes
 * the PostHog person AND their events. Irreversible, from a box the user
 * never touched. Clearing on the failure paths is what keeps the parked value
 * scoped to the handshake that parked it.
 */
export function clearPendingAnalyticsConsent(): void {
  try {
    sessionStorage.removeItem(STORAGE_KEY);
  } catch {
    // Storage unavailable — nothing was stored either, so nothing to clear.
  }
}
