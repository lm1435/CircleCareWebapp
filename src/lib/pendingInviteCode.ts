// Pending invite code — survives the auth boundary that router state cannot.
//
// The public invite landing page (/invite/:code) sends unauthenticated
// visitors to /login with `state.from`, but router state only survives the
// email/password login of an existing account. Sign-up (login → signup →
// verify-email) and OAuth (full-page provider redirect → /auth/callback) both
// lose it, so the code is parked in sessionStorage instead and consumed at the
// post-auth landing decision (LoginPage / AuthCallbackPage / VerifyEmailPage).
//
// sessionStorage (not localStorage): tab-scoped and gone when the tab closes,
// which matches the lifetime of "I clicked an invite link and am signing in".
//
// PRIVACY: possession of the code grants circle access — never log it or send
// it to analytics/error reporting.

const STORAGE_KEY = 'cc_pending_invite_code';

// Backend codes are 6 chars (8 on collision fallback) from A-Z + 2-9
// (backend/src/routes/invites.ts generateInviteCode). Validate permissively —
// any uppercase alphanumeric up to a sane length — so a format tweak
// backend-side doesn't strand invitees, while garbage never round-trips into
// a navigation target.
const CODE_RE = /^[A-Z0-9]{1,32}$/;

function normalize(code: string): string {
  return code.trim().toUpperCase();
}

function isValid(code: string): boolean {
  return CODE_RE.test(code);
}

/**
 * Park a pending invite code before handing off to the auth flow.
 * Normalizes (trim + uppercase); invalid codes are ignored.
 * Safari private mode throws on storage access — degrade to a no-op
 * (the email/password `state.from` path still works without storage).
 */
export function setPendingInviteCode(code: string): void {
  const normalized = normalize(code);
  if (!isValid(normalized)) return;
  try {
    sessionStorage.setItem(STORAGE_KEY, normalized);
  } catch {
    // Storage unavailable — degrade silently.
  }
}

/**
 * Read AND clear the pending invite code (atomic get-then-clear so a stale
 * code can never redirect twice). Returns null when nothing valid is stored.
 */
export function consumePendingInviteCode(): string | null {
  try {
    const stored = sessionStorage.getItem(STORAGE_KEY);
    if (stored === null) return null;
    sessionStorage.removeItem(STORAGE_KEY);
    const normalized = normalize(stored);
    return isValid(normalized) ? normalized : null;
  } catch {
    return null;
  }
}

/**
 * Read the pending invite code WITHOUT clearing it. For post-auth landing
 * decisions (AuthCallbackPage, VerifyEmailPage) that only need to decide
 * WHETHER to detour through `/invite/:code` on the way to `/circles` — they
 * must NOT consume the code themselves, or InviteLandingPage's own
 * consume-and-auto-accept effect (`:133-140`) finds nothing parked and the
 * visitor lands on a card they have to tap "Accept" on a second time. The
 * actual consume-and-clear happens exactly once, on InviteLandingPage.
 * Returns null when nothing valid is stored.
 */
export function peekPendingInviteCode(): string | null {
  try {
    const stored = sessionStorage.getItem(STORAGE_KEY);
    if (stored === null) return null;
    const normalized = normalize(stored);
    return isValid(normalized) ? normalized : null;
  } catch {
    return null;
  }
}

/** Drop the pending code without reading it (e.g. the user is already at the destination). */
export function clearPendingInviteCode(): void {
  try {
    sessionStorage.removeItem(STORAGE_KEY);
  } catch {
    // Storage unavailable — nothing to clear.
  }
}
