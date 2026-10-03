import type { SupportedStorage } from '@supabase/auth-js';

// Storage adapter for the OAuth broker client (lib/supabase.ts) under the PKCE
// flow.
//
// PKCE needs exactly ONE value to survive the full-page provider redirect: the
// code verifier auth-js generates in `signInWithOAuth` and reads back in
// `exchangeCodeForSession`. auth-js only consults a custom `storage` when
// `persistSession: true`, and with that flag it ALSO writes the whole session
// (access + refresh token) to the same storage after the exchange. So this
// adapter is a whitelist:
//
// - `<storageKey>-code-verifier` → sessionStorage (tab-scoped, gone when the
//   tab closes; auth-js removes it itself after every exchange, success or
//   failure, and `clearPkceVerifier` below is the belt-and-braces call).
// - EVERY other key (the session, `-user`) → dropped. `setItem` is a no-op and
//   `getItem` returns null, so tokens never reach any Web Storage and the
//   client never "recovers" a session it should not hold. The backend owns the
//   session (httpOnly refresh cookie); this client is a handshake broker only.
//
// Safari private mode / blocked storage throws on access — degrade to a no-op;
// the exchange then fails with "verifier missing" and the callback shows the
// existing error copy (same outcome as a handshake started in another tab).

export const PKCE_STORAGE_KEY = 'cc-oauth-pkce';
export const PKCE_VERIFIER_KEY = `${PKCE_STORAGE_KEY}-code-verifier`;

function isVerifierKey(key: string): boolean {
  return key === PKCE_VERIFIER_KEY;
}

export const pkceVerifierStorage: SupportedStorage = {
  getItem(key: string): string | null {
    if (!isVerifierKey(key)) return null;
    try {
      return sessionStorage.getItem(key);
    } catch {
      return null;
    }
  },
  setItem(key: string, value: string): void {
    if (!isVerifierKey(key)) return;
    try {
      sessionStorage.setItem(key, value);
    } catch {
      // Storage unavailable — degrade silently (see header).
    }
  },
  removeItem(key: string): void {
    if (!isVerifierKey(key)) return;
    try {
      sessionStorage.removeItem(key);
    } catch {
      // Storage unavailable — nothing to remove.
    }
  },
};

/** Remove any parked PKCE verifier. Safe to call when none is stored. */
export function clearPkceVerifier(): void {
  pkceVerifierStorage.removeItem(PKCE_VERIFIER_KEY);
}
