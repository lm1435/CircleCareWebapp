// Pending OAuth provider — survives the full-page OAuth redirect that router
// state cannot.
//
// The provider (google/apple) is known when the user clicks the button on
// /login or /signup, but the browser then does a full-page redirect to the
// provider and returns to /auth/callback — where the provider is no longer in
// scope. We park it in sessionStorage (mirroring lib/pendingInviteCode.ts) so
// the callback can fire an accurate `login_completed` / `signup_completed`
// analytics event with the correct `method`.
//
// sessionStorage (not localStorage): tab-scoped and gone when the tab closes,
// matching the lifetime of "I clicked an OAuth button and am signing in".
//
// PRIVACY: the provider is a non-PII enum ('google' | 'apple') — safe to store
// and send to analytics. NEVER put email or any PII here.

const STORAGE_KEY = 'cc_pending_auth_method';

export type PendingAuthMethod = 'google' | 'apple';

function isValid(value: string): value is PendingAuthMethod {
  return value === 'google' || value === 'apple';
}

/**
 * Park the chosen OAuth provider before handing off to the provider redirect.
 * Only 'google' | 'apple' are accepted; anything else is ignored.
 * Safari private mode throws on storage access — degrade to a no-op (analytics
 * simply falls back to a generic method at the callback).
 */
export function setPendingAuthMethod(method: PendingAuthMethod): void {
  if (!isValid(method)) return;
  try {
    sessionStorage.setItem(STORAGE_KEY, method);
  } catch {
    // Storage unavailable — degrade silently.
  }
}

/**
 * Read AND clear the pending provider (atomic get-then-clear so a stale value
 * can never be attributed to a later, unrelated sign-in). Returns null when
 * nothing valid is stored (e.g. the user deep-linked straight to /auth/callback
 * or storage is unavailable).
 */
export function consumePendingAuthMethod(): PendingAuthMethod | null {
  try {
    const stored = sessionStorage.getItem(STORAGE_KEY);
    if (stored === null) return null;
    sessionStorage.removeItem(STORAGE_KEY);
    return isValid(stored) ? stored : null;
  } catch {
    return null;
  }
}
