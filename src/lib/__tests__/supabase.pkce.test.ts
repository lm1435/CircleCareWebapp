import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { PKCE_VERIFIER_KEY } from '@/lib/pkceVerifierStorage';

// The REAL auth-js broker client (src/test/setup.ts mocks '@/lib/supabase' for
// every other test). Unit tests of the callback page only prove WE call
// `exchangeCodeForSession`; these prove the configured client actually runs the
// PKCE flow: a challenge on /authorize, the verifier surviving in
// sessionStorage, a grant_type=pkce POST carrying it, and NO token persisted or
// broadcast anywhere afterwards. Network is a stubbed `fetch`.

type BrokerModule = typeof import('@/lib/supabase');

const SESSION = {
  access_token: 'at-secret',
  refresh_token: 'rt-secret',
  token_type: 'bearer',
  expires_in: 3600,
  user: { id: 'user-1', aud: 'authenticated', email: 'pat@example.com' },
};

async function loadBroker(): Promise<BrokerModule> {
  vi.resetModules();
  return vi.importActual<BrokerModule>('@/lib/supabase');
}

describe('OAuth broker client (real auth-js, PKCE)', () => {
  let fetchMock: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    sessionStorage.clear();
    localStorage.clear();
    fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.includes('/token?grant_type=pkce')) {
        return new Response(JSON.stringify(SESSION), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        });
      }
      return new Response('{}', { status: 404, headers: { 'Content-Type': 'application/json' } });
    });
    vi.stubGlobal('fetch', fetchMock);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it('starts a PKCE handshake: s256 challenge on /authorize, verifier parked in sessionStorage only', async () => {
    const { supabase } = await loadBroker();
    const { data, error } = await supabase.auth.signInWithOAuth({
      provider: 'google',
      options: { redirectTo: 'http://localhost/auth/callback', skipBrowserRedirect: true },
    });
    expect(error).toBeNull();
    const authorize = new URL(data.url as string);
    expect(authorize.pathname).toBe('/auth/v1/authorize');
    expect(authorize.searchParams.get('code_challenge')).toBeTruthy();
    expect(authorize.searchParams.get('code_challenge_method')).toBe('s256');
    expect(authorize.searchParams.get('redirect_to')).toBe('http://localhost/auth/callback');

    const verifier = JSON.parse(sessionStorage.getItem(PKCE_VERIFIER_KEY) ?? 'null') as string | null;
    expect(verifier, 'verifier survives a full-page redirect').toBeTruthy();
    expect(authorize.searchParams.get('code_challenge')).not.toBe(verifier);
    expect(localStorage.length).toBe(0);
  });

  it('redeems the code with the parked verifier, then persists and broadcasts NOTHING', async () => {
    const postMessage = vi.spyOn(BroadcastChannel.prototype, 'postMessage');
    const { supabase } = await loadBroker();
    await supabase.auth.signInWithOAuth({
      provider: 'apple',
      options: { redirectTo: 'http://localhost/auth/callback', skipBrowserRedirect: true },
    });
    // auth-js stores values JSON-encoded.
    const verifier = JSON.parse(sessionStorage.getItem(PKCE_VERIFIER_KEY) as string) as string;

    // Simulates the post-redirect page load: a FRESH module instance (the old
    // one died with the navigation) reading the verifier back from storage.
    const { supabase: afterRedirect } = await loadBroker();
    const { data, error } = await afterRedirect.auth.exchangeCodeForSession('the-code');

    expect(error).toBeNull();
    expect(data.session?.access_token).toBe('at-secret');
    expect(data.session?.refresh_token).toBe('rt-secret');

    const call = fetchMock.mock.calls.find(([u]) => String(u).includes('grant_type=pkce'));
    expect(call, 'exchanged over POST /token?grant_type=pkce').toBeTruthy();
    const init = call![1] as RequestInit;
    expect(init.method).toBe('POST');
    expect(JSON.parse(String(init.body))).toEqual({ auth_code: 'the-code', code_verifier: verifier });

    // Verifier spent; session NOT written to any Web Storage; nothing posted
    // to other tabs.
    expect(sessionStorage.length).toBe(0);
    expect(localStorage.length).toBe(0);
    expect(postMessage).not.toHaveBeenCalled();
    const { data: held } = await afterRedirect.auth.getSession();
    expect(held.session, 'the broker never holds the session').toBeNull();
  });

  it('refuses to redeem a code without a parked verifier (no token request)', async () => {
    const { supabase } = await loadBroker();
    const { data, error } = await supabase.auth.exchangeCodeForSession('orphan');
    expect(error).not.toBeNull();
    expect(data.session).toBeNull();
    expect(fetchMock.mock.calls.some(([u]) => String(u).includes('/token'))).toBe(false);
  });
});
