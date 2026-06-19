import { createClient } from '@supabase/supabase-js';
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
export const supabase = createClient(env.VITE_SUPABASE_URL, env.VITE_SUPABASE_ANON_KEY, {
  auth: {
    autoRefreshToken: false,
    persistSession: false,
    detectSessionInUrl: false, // we handle the /auth/callback redirect ourselves
  },
});
