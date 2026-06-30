import { defineConfig, devices } from '@playwright/test';

// E2E config for the CircleCare web companion.
//
// These tests drive a REAL browser against the running app + the LIVE backend
// (the API URL the Vite dev server is configured with in .env.development),
// authenticating as the demo account. That's deliberate: the vitest suite mocks
// the API, so it can't catch real contract drift, routing failures, white
// screens, or a11y issues. This suite does.
//
// Run:  npm run test:e2e            (headless)
//       npm run test:e2e:ui         (Playwright UI mode)
//       npm run test:e2e:headed     (watch the browser)
//
// Requires: the backend reachable at VITE_API_URL (see .env.development) and the
// demo account seeded. Override the target with PW_BASE_URL / demo creds via
// PW_DEMO_EMAIL / PW_DEMO_PASSWORD env vars.

const BASE_URL = process.env.PW_BASE_URL ?? 'http://localhost:5173';

export default defineConfig({
  testDir: './e2e',
  // Stop on first failure locally is annoying; let the whole crawl report.
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  // 1 retry even locally: the suite hits a live backend over a dev tunnel, so a
  // transient upstream 5xx self-heals on retry while a CONSISTENT error (fails
  // both attempts) still fails the run — that's the real signal we want.
  retries: 1,
  // The crawl hits the live backend; keep workers modest so we don't hammer it.
  workers: process.env.CI ? 2 : 4,
  reporter: [['list'], ['html', { open: 'never' }]],
  timeout: 30_000,
  expect: { timeout: 10_000 },

  use: {
    baseURL: BASE_URL,
    trace: 'on-first-retry',
    screenshot: 'only-on-failure',
    video: 'retain-on-failure',
    // Opt-in slow motion for watching a headed run: PW_SLOMO=400 npx playwright …
    launchOptions: { slowMo: Number(process.env.PW_SLOMO) || 0 },
  },

  projects: [
    // 0) Backend-FREE accessibility crawl of the PUBLIC (logged-out) routes.
    //    No `setup` dependency and no stored session, so it runs anywhere —
    //    including CI without demo credentials or a reachable backend (the auth
    //    pages render client-side; visitAndCheck tolerates the bootstrap 401).
    //    Driven by `npm run test:a11y`. The AUTHENTICATED routes' a11y is
    //    covered by smoke.spec.ts under the chromium/mobile-chrome projects
    //    (i.e. `npm run test:e2e`), which does require the live backend.
    {
      name: 'a11y-public',
      use: { ...devices['Desktop Chrome'] },
      testMatch: /public-smoke\.spec\.ts/,
    },

    // 1) Log in once via the UI and persist the session (cookie-mode auth: the
    //    httpOnly refresh cookie is captured in storageState; the app
    //    re-bootstraps an access token from it on load).
    { name: 'setup', testMatch: /auth\.setup\.ts/ },

    // 2) Desktop — runs every spec EXCEPT the mobile-only ones (which assume the
    //    hamburger-drawer chrome).
    {
      name: 'chromium',
      use: { ...devices['Desktop Chrome'], storageState: 'e2e/.auth/user.json' },
      dependencies: ['setup'],
      testIgnore: /e2e\/mobile\//,
    },

    // 3) Mobile (Pixel 5 viewport) — runs the route crawl (render + a11y at
    //    mobile width, catching drawer/overflow/responsive regressions the
    //    desktop run can't) plus the mobile-only specs in e2e/mobile/ (hamburger
    //    nav). The CRUD flows stay desktop-only — their chrome differs on mobile.
    {
      name: 'mobile-chrome',
      use: { ...devices['Pixel 5'], storageState: 'e2e/.auth/user.json' },
      dependencies: ['setup'],
      testMatch: [/smoke\.spec\.ts/, /public-smoke\.spec\.ts/, /e2e\/mobile\//],
    },
  ],

  // Start the Vite dev server for the tests (reuse one if it's already up).
  webServer: {
    command: 'npm run dev',
    url: BASE_URL,
    reuseExistingServer: !process.env.CI,
    timeout: 120_000,
  },
});
