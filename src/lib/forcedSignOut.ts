// A FORCED sign-out (401 whose refresh failed -> api.ts onAuthFailure) leaves
// in-flight writes whose error handlers would toast "couldn't save" over the
// /login page. The form is gone and its draft is restored after re-login
// (lib/sessionDraft), so nothing should be said. Mirrors
// mobile/src/utils/forcedSignOut.ts.
//
// A consumer captures a guard when it MOUNTS; the guard suppresses only while a
// forced sign-out happened AFTER that mount and nobody has signed in since.
// Components mounted afterwards (the login page) and every other failure
// (refreshed-and-retried 401, 4xx/5xx) are untouched.

let epoch = 0;
let active = false;

export function markForcedSignOut(): void {
  epoch += 1;
  active = true;
}

export function clearForcedSignOut(): void {
  active = false;
}

/** Returns a function: true while toasts from this consumer must be dropped. */
export function captureSessionGuard(): () => boolean {
  const mountedAt = epoch;
  return () => active && epoch !== mountedAt;
}

/** Test helper. */
export function __resetForcedSignOutForTests(): void {
  epoch = 0;
  active = false;
}
