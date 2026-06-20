import { fileURLToPath } from 'node:url';
import { defineConfig, loadEnv } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';

// `mode`-aware so we can read VITE_API_URL for the dev proxy below.
export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), '');

  // DEV ONLY: proxy `/api` to the backend (VITE_API_URL — often a Cloudflare
  // tunnel that changes URL each session). The browser only ever talks to the
  // Vite origin (localhost:5173), so the httpOnly session cookies are
  // same-origin and survive page reloads. In a production build the client
  // calls the same-site api host directly (see API_ORIGIN in src/lib/api.ts),
  // so this proxy is never used. `cookieDomainRewrite: ''` strips any cookie
  // Domain attribute so cookies bind to localhost.
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
