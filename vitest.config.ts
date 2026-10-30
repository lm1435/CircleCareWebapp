import { fileURLToPath } from 'node:url';
import { defineConfig, configDefaults } from 'vitest/config';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      '@': fileURLToPath(new URL('./src', import.meta.url)),
    },
  },
  test: {
    environment: 'jsdom',
    globals: true,
    setupFiles: ['./src/test/setup.ts'],
    css: false,
    // The Playwright E2E specs under e2e/ are *.spec.ts too — keep them out of
    // the vitest (jsdom) run; they only execute under `npm run test:e2e`.
    exclude: [...configDefaults.exclude, 'e2e/**'],
    // Test-only env values so `src/lib/env.ts` Zod validation passes.
    // Real values live in `.env` (gitignored) — see `.env.example`.
    env: {
      VITE_SUPABASE_URL: 'https://test-project.supabase.co',
      VITE_SUPABASE_ANON_KEY: 'test-anon-key',
      VITE_API_URL: 'http://localhost:3000',
      // Dark mode ON in tests (the flag-off path stubs it per test).
      VITE_DARK_MODE: 'true',
      // Notifications inbox OFF by default in tests (so the header bell makes no request in
      // unrelated suites); the inbox suites stub it 'on' per test.
      VITE_NOTIFICATIONS_INBOX: 'off',
    },
  },
});
