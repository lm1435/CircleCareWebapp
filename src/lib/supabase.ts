import { AuthClient } from '@supabase/auth-js';
import { env } from './env';
import { PKCE_STORAGE_KEY, pkceVerifierStorage } from './pkceVerifierStorage';

// Supabase client used as an OAuth handshake BROKER ONLY (mirrors
// mobile/src/lib/supabase.ts + mobile/src/lib/oauth.ts pattern):
// - Google/Apple sign-in redirects go through Supabase; the resulting tokens
//   are immediately exchanged with our backend (`POST /api/auth/oauth-session`)
//   and discarded client-side.
// - NEVER use this client for session management or data queries. All data
//   goes through the Express backend API (src/lib/api.ts).
//
// SAFE: only the public anon key is used here (never service_role).
//
// BUNDLE NOTE: only `auth.signInWithOAuth` (LoginPage.tsx / SignUpPage.tsx)
// and `auth.exchangeCodeForSession` (AuthCallbackPage.tsx) are ever called on
// this client — the OAuth handshake broker role above
// needs nothing but the Auth sub-client. The full `@supabase/supabase-js`
// package bundles Postgrest/Realtime/Storage clients this app never touches
// (~27 KB gzip of dead weight for a webapp that never queries Supabase
// directly — see the "NEVER use this client for data queries" note above).
// `@supabase/auth-js`'s `AuthClient` IS the exact class `supabase-js` builds
// `.auth` from internally (`SupabaseAuthClient extends AuthClient`), so this
// is the same OAuth behavior with none of the rest of the SDK. Since 2026-09-04
// `@supabase/auth-js` is a DIRECT dependency (pinned 2.108.1 in package.json) and
// `@supabase/supabase-js` was removed — do not delete auth-js as "unused".
//
// `url`/`headers` mirror what `createClient` builds internally:
// `${VITE_SUPABASE_URL}/auth/v1` plus the anon key as both `apikey` and a
// Bearer `Authorization` header (supabase-js's `SupabaseClient._initSupabaseAuthClient`).
// `VITE_SUPABASE_URL` is stripped of trailing slashes first — Vite env values
// come straight from `.env`/hosting config with no normalization, and an
// operator-supplied trailing slash would otherwise produce a double slash
// (`.../v1//auth/v1`) that some proxies/CDNs treat as a different path.
//
// `X-Client-Info` is set explicitly to a name for THIS client, not copied
// from either upstream package's own version string: passing a `headers`
// object to `AuthClient` REPLACES its default headers wholesale (no merge),
// so without this the requests would carry no client-info header at all,
// unlike supabase-js's own default (`supabase-js/<version>; ...`) — a
// distinct string is more honest here anyway, since this isn't supabase-js.
//
// PKCE (2026-10-01, security audit O1): the implicit flow returned the access
// AND refresh token in the callback URL fragment, and Chrome's global history
// kept that URL even after the replaceState scrub. With `flowType: 'pkce'` the
// provider returns only a one-time `?code=` that is useless without the
// verifier parked in THIS tab's sessionStorage; the callback trades it for the
// tokens over a POST (`/token?grant_type=pkce`) and hands them to the backend.
// `persistSession: true` is required ONLY because auth-js ignores a custom
// `storage` otherwise (the verifier would live in memory and die with the
// redirect); `pkceVerifierStorage` drops every key except the verifier, so the
// session itself is still never persisted anywhere client-side.
class OAuthBrokerClient extends AuthClient {
  constructor(options: ConstructorParameters<typeof AuthClient>[0]) {
    super(options);
    // `persistSession: true` also opens a cross-tab BroadcastChannel that posts
    // every SIGNED_IN session (tokens included) to other tabs of this origin.
    // Nothing here needs multi-tab auth state — close it so the exchanged
    // tokens never leave the callback's own call.
    this.broadcastChannel?.close();
    this.broadcastChannel = null;
  }
}

export const supabase = {
  auth: new OAuthBrokerClient({
    url: `${env.VITE_SUPABASE_URL.replace(/\/+$/, '')}/auth/v1`,
    headers: {
      apikey: env.VITE_SUPABASE_ANON_KEY,
      Authorization: `Bearer ${env.VITE_SUPABASE_ANON_KEY}`,
      'X-Client-Info': 'circlecare-web',
    },
    flowType: 'pkce',
    autoRefreshToken: false,
    persistSession: true, // see PKCE note above — storage drops the session
    storage: pkceVerifierStorage,
    storageKey: PKCE_STORAGE_KEY,
    detectSessionInUrl: false, // we handle the /auth/callback redirect ourselves
  }),
};
