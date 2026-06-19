import { z } from 'zod';

/**
 * Zod-validated environment configuration (fail fast at startup).
 * Only VITE_-prefixed PUBLIC values — these are bundled into the client.
 * The Supabase anon key is public by design; RLS + backend auth are the boundary.
 */
const envSchema = z.object({
  VITE_SUPABASE_URL: z.url(),
  VITE_SUPABASE_ANON_KEY: z.string().min(1),
  VITE_API_URL: z.url(),
  // Optional — when unset, analytics silently degrades (never crashes).
  VITE_POSTHOG_KEY: z.string().min(1).optional(),
});

const parsed = envSchema.safeParse({
  VITE_SUPABASE_URL: import.meta.env.VITE_SUPABASE_URL,
  VITE_SUPABASE_ANON_KEY: import.meta.env.VITE_SUPABASE_ANON_KEY,
  VITE_API_URL: import.meta.env.VITE_API_URL,
  // Treat empty string as unset so `.env` files can leave the key blank.
  VITE_POSTHOG_KEY: import.meta.env.VITE_POSTHOG_KEY || undefined,
});

if (!parsed.success) {
  // Never log values — variable names only.
  const invalid = parsed.error.issues.map((issue) => issue.path.join('.')).join(', ');
  throw new Error(`Invalid or missing environment variables: ${invalid}`);
}

export const env = parsed.data;
