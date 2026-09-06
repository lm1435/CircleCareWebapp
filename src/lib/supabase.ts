import { AuthClient } from '@supabase/auth-js';
import { env } from './env';

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
// BUNDLE NOTE: only `auth.signInWithOAuth` is ever called on this client (see
// LoginPage.tsx / SignUpPage.tsx) — the OAuth handshake broker role above
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
export const supabase = {
  auth: new AuthClient({
    url: `${env.VITE_SUPABASE_URL.replace(/\/+$/, '')}/auth/v1`,
    headers: {
      apikey: env.VITE_SUPABASE_ANON_KEY,
      Authorization: `Bearer ${env.VITE_SUPABASE_ANON_KEY}`,
      'X-Client-Info': 'circlecare-web',
    },
    autoRefreshToken: false,
    persistSession: false,
    detectSessionInUrl: false, // we handle the /auth/callback redirect ourselves
  }),
};
