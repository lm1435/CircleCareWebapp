// Pending signup terms consent — survives the full-page OAuth redirect that
// router state cannot (mirrors lib/pendingAuthMethod.ts).
//
// The signup page's OAuth buttons are gated on the required Terms/Privacy
// consent checkbox, but the browser then does a full-page redirect to the
// provider and returns to /auth/callback — where the checkbox state is gone.
// We park the acceptance in sessionStorage so the callback can relay
// `termsAccepted: true` to POST /auth/oauth-session, letting the backend
// record `users.terms_accepted_at` for OAuth signups too.
//
// LoginPage's OAuth buttons never set this (returning users aren't signing
// up), so OAuth logins send nothing — and the backend only ever fills a NULL
// terms_accepted_at, never overwrites one.
//
// sessionStorage (not localStorage): tab-scoped and gone when the tab closes,
// matching the lifetime of "I ticked the checkbox and clicked an OAuth button".
//
// PRIVACY: the stored value is the literal string '1' — no PII.

const STORAGE_KEY = 'cc_pending_terms_consent';

/**
 * Park the checkbox acceptance before handing off to the provider redirect.
 * Safari private mode throws on storage access — degrade to a no-op (the
 * consent simply isn't relayed; the column stays NULL like a legacy signup).
 */
export function setPendingTermsConsent(): void {
  try {
    sessionStorage.setItem(STORAGE_KEY, '1');
  } catch {
    // Storage unavailable — degrade silently.
  }
}

/**
 * Read AND clear the pending consent (atomic get-then-clear so a stale value
 * can never be attributed to a later, unrelated sign-in). Returns false when
 * nothing is stored (e.g. OAuth started from LoginPage) or storage is
 * unavailable.
 */
export function consumePendingTermsConsent(): boolean {
  try {
    const stored = sessionStorage.getItem(STORAGE_KEY);
    if (stored === null) return false;
    sessionStorage.removeItem(STORAGE_KEY);
    return stored === '1';
  } catch {
    return false;
  }
}
