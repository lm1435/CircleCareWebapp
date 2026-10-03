import { describe, expect, it, beforeEach } from 'vitest';
import {
  PKCE_STORAGE_KEY,
  PKCE_VERIFIER_KEY,
  clearPkceVerifier,
  pkceVerifierStorage,
} from '@/lib/pkceVerifierStorage';

// The OAuth broker runs auth-js with `persistSession: true` ONLY so the PKCE
// verifier survives the provider redirect. auth-js writes the whole session
// (access + refresh token) to the same storage after the exchange — this
// adapter must persist the verifier and NOTHING else.

describe('pkceVerifierStorage', () => {
  beforeEach(() => {
    sessionStorage.clear();
    localStorage.clear();
  });

  it('persists the code verifier in sessionStorage (survives the redirect), never localStorage', async () => {
    await pkceVerifierStorage.setItem(PKCE_VERIFIER_KEY, 'verifier-123');
    expect(sessionStorage.getItem(PKCE_VERIFIER_KEY)).toBe('verifier-123');
    expect(localStorage.length).toBe(0);
    expect(await pkceVerifierStorage.getItem(PKCE_VERIFIER_KEY)).toBe('verifier-123');
  });

  it('drops the session and user writes auth-js makes after an exchange', async () => {
    const session = JSON.stringify({ access_token: 'at', refresh_token: 'rt' });
    await pkceVerifierStorage.setItem(PKCE_STORAGE_KEY, session);
    await pkceVerifierStorage.setItem(`${PKCE_STORAGE_KEY}-user`, '{"user":{}}');
    expect(sessionStorage.length).toBe(0);
    expect(localStorage.length).toBe(0);
    expect(await pkceVerifierStorage.getItem(PKCE_STORAGE_KEY)).toBeNull();
  });

  it('never reads back a non-verifier key even if one exists in sessionStorage', async () => {
    sessionStorage.setItem(PKCE_STORAGE_KEY, '{"access_token":"planted"}');
    expect(await pkceVerifierStorage.getItem(PKCE_STORAGE_KEY)).toBeNull();
  });

  it('clearPkceVerifier removes the parked verifier', async () => {
    await pkceVerifierStorage.setItem(PKCE_VERIFIER_KEY, 'v');
    clearPkceVerifier();
    expect(sessionStorage.getItem(PKCE_VERIFIER_KEY)).toBeNull();
  });
});
