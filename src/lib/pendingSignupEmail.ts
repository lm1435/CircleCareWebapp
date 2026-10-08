// Pending signup email — survives the browser-back that router state cannot.
//
// A successful email/password signup navigates to /verify-email with the
// address in router STATE. Pressing the browser Back button returns to /signup
// showing a blank form (the state belonged to the /verify-email history entry),
// and re-submitting it calls signup again, which trips Supabase's 60 s
// per-address send cooldown (EMAIL_RATE_LIMIT). So the address is parked in
// sessionStorage on success: SignUpPage redirects straight back to
// /verify-email while one is parked, and VerifyEmailPage falls back to it when
// it arrives without router state.
//
// sessionStorage (not localStorage): tab-scoped and gone when the tab closes,
// which matches the lifetime of "I just signed up and am about to enter my
// code" (mirrors lib/pendingInviteCode.ts and lib/pendingAuthMethod.ts).
//
// PRIVACY: this is PII — never log it or send it to analytics/error reporting.
// It is cleared once the email is verified (VerifyEmailPage).

const STORAGE_KEY = 'cc_pending_signup_email';

// Permissive on purpose (same shape VerifyEmailPage validates with): garbage
// must never round-trip into a navigation target or a visible subtitle.
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const MAX_LENGTH = 320;

function normalize(email: string): string {
  return email.trim();
}

function isValid(email: string): boolean {
  return email.length > 0 && email.length <= MAX_LENGTH && EMAIL_RE.test(email);
}

/**
 * Park the address a signup just created an account for. Trims; invalid values
 * are ignored. Safari private mode throws on storage access — degrade to a
 * no-op (the router-state hand-off to /verify-email still works without it).
 */
export function setPendingSignupEmail(email: string): void {
  const normalized = normalize(email);
  if (!isValid(normalized)) return;
  try {
    sessionStorage.setItem(STORAGE_KEY, normalized);
  } catch {
    // Storage unavailable — degrade silently.
  }
}

/**
 * Read the parked address WITHOUT clearing it. Both SignUpPage (redirect
 * decision) and VerifyEmailPage (fallback when router state is missing) only
 * need to know WHETHER one is parked; it is cleared exactly once, after a
 * successful verification. Returns null when nothing valid is stored.
 */
export function peekPendingSignupEmail(): string | null {
  try {
    const stored = sessionStorage.getItem(STORAGE_KEY);
    if (stored === null) return null;
    const normalized = normalize(stored);
    return isValid(normalized) ? normalized : null;
  } catch {
    return null;
  }
}

/** Drop the parked address (verification succeeded, or it is otherwise stale). */
export function clearPendingSignupEmail(): void {
  try {
    sessionStorage.removeItem(STORAGE_KEY);
  } catch {
    // Storage unavailable — nothing to clear.
  }
}
