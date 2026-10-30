// Post-login return path: where to send the user after they sign in.
//
// AuthGuard parks the intended location in router state, which survives the
// email/password login but NOT the full-page Google/Apple OAuth redirect. The
// path (pathname + search + hash, so an email deep link's `?date=&eventId=&src=`
// survives) is therefore also parked in sessionStorage across the redirect and
// consumed by /auth/callback — mirroring lib/pendingInviteCode.ts.
//
// OPEN-REDIRECT SAFE: only a same-origin relative path is ever accepted — one
// leading `/`, never `//` or `/\` (protocol-relative), no scheme, no control
// characters. Anything else is dropped and the caller falls back to its default.
//
// PRIVACY: a path can carry ids and dates, so it is never logged or sent to
// analytics.

const STORAGE_KEY = 'cc_pending_return_path';
const MAX_LENGTH = 2048;
// The login / OAuth plumbing must never be a post-login destination (loop).
const AUTH_PATHS = /^\/(login|signup|auth\/callback|verify-email|reset-password|forgot-password)(?:[/?#]|$)/;

/** True for a same-origin relative path that is safe to hand to `navigate()`. */
export function isSafeReturnPath(value: unknown): value is string {
  if (typeof value !== 'string' || value.length === 0 || value.length > MAX_LENGTH) return false;
  if (value[0] !== '/') return false;
  // `//host` and `/\host` are read by browsers as protocol-relative URLs.
  if (value[1] === '/' || value[1] === '\\') return false;
  // Control characters, whitespace tricks and backslashes anywhere in the path.
  // eslint-disable-next-line no-control-regex
  if (/[\u0000-\u001f\u007f\\]/.test(value)) return false;
  if (AUTH_PATHS.test(value)) return false;
  try {
    // Must resolve to the same origin as a probe base: catches anything the
    // checks above missed.
    const base = 'http://return-path.invalid';
    return new URL(value, base).origin === base;
  } catch {
    return false;
  }
}

/** pathname + search + hash of a router/`window` location, or null when unsafe. */
export function toReturnPath(
  location: { pathname?: string; search?: string; hash?: string } | null | undefined
): string | null {
  if (!location?.pathname) return null;
  const path = `${location.pathname}${location.search ?? ''}${location.hash ?? ''}`;
  return isSafeReturnPath(path) ? path : null;
}

/** Park the path before the OAuth redirect. Unsafe / null input CLEARS any stale value. */
export function setPendingReturnPath(path: string | null | undefined): void {
  try {
    if (path && isSafeReturnPath(path)) sessionStorage.setItem(STORAGE_KEY, path);
    else sessionStorage.removeItem(STORAGE_KEY);
  } catch {
    // Storage unavailable (Safari private mode) — degrade to the default landing.
  }
}

/** Read AND clear the parked path. Null when nothing safe is stored. */
export function consumePendingReturnPath(): string | null {
  try {
    const stored = sessionStorage.getItem(STORAGE_KEY);
    if (stored === null) return null;
    sessionStorage.removeItem(STORAGE_KEY);
    return isSafeReturnPath(stored) ? stored : null;
  } catch {
    return null;
  }
}
