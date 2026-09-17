import { fileURLToPath } from 'node:url';
import { defineConfig, loadEnv } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';

// `mode`-aware so we can read VITE_API_URL for the dev proxy below.
export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), '');

  // DEV ONLY: proxy `/api` to the backend (VITE_API_URL — the LOCAL backend by
  // default; a Cloudflare tunnel or other remote is opt-in via
  // `.env.development.local` or a shell var, see the comment in
  // `.env.development`. A URL that churns every session must never be the
  // committed one). The browser only ever talks to the Vite origin
  // (localhost:5173), so the httpOnly session cookies are same-origin and
  // survive page reloads. In a production build the client calls the same-site
  // api host directly (see API_ORIGIN in src/lib/api.ts), so this proxy is
  // never used. `cookieDomainRewrite: ''` strips any cookie Domain attribute so
  // cookies bind to localhost.
  //
  // NO PATH REWRITE, deliberately: `/api/x` reaches the backend as `/api/x`, so
  // ONLY routes the backend mounts under `/api` are reachable through the dev
  // server. Every client call already is — `apiClient`'s baseURL is
  // `${API_ORIGIN}/api` and nothing in `src/` fetches the backend any other way
  // — so this is complete, not a gap. The surprise to expect: the backend also
  // serves `/health` OUTSIDE `/api`, so probing `/api/health` through :5173 404s
  // while `/health` on the backend directly returns 200. That is the proxy
  // working, not failing. Adding a rewrite to "fix" it would break every real
  // route; if a non-`/api` backend route ever IS needed from the browser, add a
  // SECOND proxy entry for that exact path instead.
  const apiTarget = env.VITE_API_URL;

  return {
    plugins: [react(), tailwindcss()],
    resolve: {
      alias: {
        '@': fileURLToPath(new URL('./src', import.meta.url)),
      },
    },
    server: {
      port: 5173,
      proxy: apiTarget
        ? {
            '/api': {
              target: apiTarget,
              changeOrigin: true,
              secure: false, // tunnel certs vary — don't verify upstream TLS in dev
              cookieDomainRewrite: '',
            },
          }
        : undefined,
    },
    build: {
      // SECURITY: never ship source maps to production (plan: Security section).
      sourcemap: false,
    },
  };
});
