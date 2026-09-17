import { defineConfig, devices } from '@playwright/test';
import { ensureRunId, includeConsentProject } from './e2e/runId';

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
// Requires: the backend reachable at VITE_API_URL (see .env.development, which
// commits the LOCAL backend — a tunnel goes in .env.development.local or a shell
// var, never in the tracked file) and the demo account seeded. Override the app
// target with PW_BASE_URL / demo creds via PW_DEMO_EMAIL / PW_DEMO_PASSWORD.

const BASE_URL = process.env.PW_BASE_URL ?? 'http://localhost:5173';

// One id per `playwright test` invocation, minted HERE because the config is
// evaluated in the runner before globalSetup and before any worker, and workers
// inherit the runner's env. Every isolated account, the manifest and this run's
// test-results folder are keyed on it, which is what lets two runs execute at
// the same time without deleting each other's accounts (e2e/runId.ts).
const RUN_ID = ensureRunId();

// The consent project's server: a second Vite with VITE_POSTHOG_KEY=phc_e2e_fake
// (e2e/consent.ts). Unset → the project FAILS in its guard fixture; the
// placeholder only keeps this config loadable for every other project.
const CONSENT_BASE_URL = process.env.PW_CONSENT_BASE_URL || 'http://pw-consent-base-url-unset.invalid';
// In the run only when PW_CONSENT_BASE_URL is set or `--project=consent` is
// named (then an unset URL FAILS the project in its guard). A bare full run
// without a consent server leaves it out rather than going red.
const INCLUDE_CONSENT = includeConsentProject();

export default defineConfig({
  testDir: './e2e',
  // Run-scoped so a concurrent run's start-of-run cleanup of its output folder
  // cannot delete this run's traces/videos mid-flight.
  outputDir: process.env.PW_OUTPUT_DIR ?? `test-results/${RUN_ID}`,
  // Provision one ISOLATED account per parallel worker slot (plus a read-only
  // one for the route crawl) before any worker starts, and remove them all
  // afterwards. This is what makes `fullyParallel` honest: see e2e/isolation.ts
  // for the full rationale. globalTeardown runs even when the run fails, so a
  // spec that dies mid-mutation still leaves nothing behind.
  globalSetup: './e2e/global-setup.ts',
  globalTeardown: './e2e/global-teardown.ts',
  // Stop on first failure locally is annoying; let the whole crawl report.
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  // 1 retry even locally. The retry is NOT there to make the suite look green:
  // Playwright reports a test that failed then passed as FLAKY, distinctly from
  // both "passed" and "failed", so the retry converts a transient into a
  // visible, countable signal instead of hiding it. Read the run as a gate on
  // BOTH numbers — zero failed AND zero flaky. A consistent error still fails
  // the run, because it fails both attempts.
  retries: 1,
  // The suite hits the live backend; keep workers modest so we don't hammer it.
  // The account isolation in e2e/isolation.ts is keyed on this number
  // (globalSetup provisions one account per worker slot), so raising it is
  // safe — nothing is shared between workers.
  workers: process.env.CI ? 2 : 4,
  reporter: [
    ['list'],
    ['html', { open: 'never', outputFolder: process.env.PW_HTML_REPORT_DIR ?? 'playwright-report' }],
  ],
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
    // 0) Backend-FREE accessibility crawl of the PUBLIC (logged-out) routes, at
    //    desktop width. No `setup` dependency and no session, so it runs
    //    anywhere — including CI without demo credentials, without a database
    //    and without a reachable backend (the auth pages render client-side;
    //    visitAndCheck tolerates the bootstrap 401). globalSetup detects an
    //    a11y-only run and provisions nothing, which is what keeps that true.
    //    Driven by `npm run test:a11y`, together with `a11y-tablet` and
    //    `a11y-mobile` below (same spec, three viewports, all equally
    //    backend-free). The AUTHENTICATED routes' a11y is covered by
    //    smoke.spec.ts under the chromium/tablet/mobile-chrome projects (i.e.
    //    `npm run test:e2e`), which DO require the live backend and an isolated
    //    account, so they must stay out of the backend-free `test:a11y` run.
    {
      name: 'a11y-public',
      use: { ...devices['Desktop Chrome'] },
      testMatch: /public-smoke\.spec\.ts/,
    },

    // 0b/0c) Same backend-free public crawl at the tablet and mobile
    //    viewports — modelled on `a11y-public` (no `setup` dependency, no
    //    storageState), NOT on `tablet`/`mobile-chrome` below, which need a
    //    live backend + demo creds to log in. These exist purely so
    //    `npm run test:a11y` exercises all three breakpoints without ever
    //    requiring a backend.
    {
      name: 'a11y-tablet',
      use: { ...devices['Desktop Chrome'], viewport: { width: 1024, height: 768 } },
      testMatch: /public-smoke\.spec\.ts/,
    },
    {
      name: 'a11y-mobile',
      use: { ...devices['Pixel 5'] },
      testMatch: /public-smoke\.spec\.ts/,
    },

    // 0d) The picker's SCROLL ARITHMETIC, measured in real pixels. Backend-free
    //    for the same reason as the `a11y-*` projects above — it drives
    //    e2e/harness/, a page with one field on it and no session — and it is
    //    listed here rather than folded into `chromium` precisely so it keeps
    //    running on a machine with no database (it is also the only spec whose
    //    subject jsdom cannot express at all; see the file header). `locale` is
    //    pinned because the signed-out hour cycle falls back to it.
    {
      name: 'picker-geometry',
      use: {
        ...devices['Desktop Chrome'],
        locale: 'en-US',
        timezoneId: 'America/Denver',
      },
      testMatch: /picker-geometry\.spec\.ts/,
    },

    // 0d-bis) THE SAME SPEC, ON A TOUCH ENGINE — the sheet's geometry.
    //    `picker-geometry` above is Desktop Chrome, i.e. a FINE pointer, which
    //    is the only pointer class that gets the anchored panel. The sheet
    //    presentation has its own measurable claims (flush with the viewport
    //    floor, capped at 85% of its height, 44px rows, a calendar that shows
    //    four week rows at 390x360 where the anchored panel showed about 1.5 of
    //    6, no break-out at 320px), and none of them can be observed from a
    //    project whose pointer is a mouse. The two halves live in one spec file
    //    and skip each other on `isMobile`.
    //
    //    Backend-free like its sibling: same Vite-served harness, one field, no
    //    session and no request.
    {
      name: 'picker-geometry-sheet',
      use: {
        ...devices['Pixel 5'],
        locale: 'en-US',
        timezoneId: 'America/Denver',
      },
      testMatch: /picker-geometry\.spec\.ts/,
    },

    // 0e/0f/0g) THE COARSE-POINTER PRESENTATION, on engines that really report
    //    one.
    //    `DateField`/`TimeField` render their own picker on EVERY pointer
    //    class — as a bottom sheet where the pointer is coarse — and make the
    //    input `readOnly` there, which is the only thing that stops WebKit
    //    summoning its own picker from the focused input
    //    (`PICKER_INDICATOR_HIDDEN` is a Chromium affordance and a measured
    //    no-op in WebKit). That behaviour is otherwise proved only against
    //    jsdom with a stubbed `matchMedia` — i.e. against our own stub of the
    //    media query in question — so these three run the same spec on two
    //    touch engines and one desktop control, and pin the width measurement
    //    per engine. That measurement is now the EVIDENCE FOR `readOnly`, not
    //    for a gate; do not retire it with the gate.
    //
    //    WEBKIT IS REQUIRED for `coarse-pointer-webkit` (`npx playwright
    //    install webkit`); it is the only project in this config that is not
    //    Chromium. The spec is explicit in its header that Playwright's WebKit
    //    is not iOS Safari and draws no native picker UI at all, so what it
    //    pins is the STRUCTURAL half of the claim.
    //
    //    Backend-free for the same reason as `picker-geometry` above: same
    //    Vite-served harness, one field and four bare inputs, no session and no
    //    request. `locale`/`timezoneId` pinned for the same reason too.
    {
      name: 'coarse-pointer-webkit',
      use: {
        ...devices['iPhone 13'],
        locale: 'en-US',
        timezoneId: 'America/Denver',
      },
      testMatch: /coarse-pointer\.spec\.ts/,
    },
    {
      name: 'coarse-pointer-chromium',
      use: {
        ...devices['Pixel 5'],
        locale: 'en-US',
        timezoneId: 'America/Denver',
      },
      testMatch: /coarse-pointer\.spec\.ts/,
    },
    // The control, and not an optional one: every touch expectation in that
    // spec is an ABSENCE, and a page that never mounted satisfies all of them.
    // This is the project that proves the trigger, the popover and the lazy
    // chunk exist at all when the pointer is fine.
    {
      name: 'coarse-pointer-control',
      use: {
        ...devices['Desktop Chrome'],
        locale: 'en-US',
        timezoneId: 'America/Denver',
      },
      testMatch: /coarse-pointer\.spec\.ts/,
    },

    // 1) Environment preflight, run first and alone: assert globalSetup really
    //    provisioned the isolated accounts, then log in through the REAL login
    //    form to prove that path works. It persists NO session — every
    //    authenticated spec mints its own per test (e2e/fixtures.ts) against
    //    its worker's own account, which is what replaced the single shared
    //    `e2e/.auth/user.json` that four workers used to invalidate for each
    //    other via single-use refresh-token rotation.
    //
    //    A failure here fails the run with exit code 1 and reports THIS test as
    //    the cause; the dependent projects then show as "did not run". Read the
    //    named failure, not the count under it.
    { name: 'setup', testMatch: /auth\.setup\.ts/ },

    // 2) Desktop — runs every spec EXCEPT the mobile-only ones (which assume the
    //    FloatingNavBar pill chrome below the `xl` (1024px) breakpoint; at this
    //    project's width the sidebar owns navigation instead).
    {
      name: 'chromium',
      use: { ...devices['Desktop Chrome'] },
      dependencies: ['setup'],
      // `picker-geometry.spec.ts` and `coarse-pointer.spec.ts` are excluded as
      // well as the mobile-only specs: each has its own backend-free project
      // above, and running them here too would make specs that need neither a
      // database nor a session depend on both (and report twice). This project
      // is the only one with a `testIgnore` rather than a `testMatch`, so it
      // picks up every new file in `e2e/` by DEFAULT — a backend-free spec must
      // be named here or it silently acquires a backend dependency.
      testIgnore: [
        /e2e\/mobile\//,
        /picker-geometry\.spec\.ts/,
        /coarse-pointer\.spec\.ts/,
        /\.consent\.spec\.ts$/,
      ],
    },

    // 2b) ANALYTICS CONSENT — `*.consent.spec.ts` against a SECOND Vite server
    //    started with VITE_POSTHOG_KEY=phc_e2e_fake, whose PostHog traffic is
    //    intercepted and decoded by `posthogCapture` (e2e/unhappy.ts) and never
    //    sent. baseURL comes from PW_CONSENT_BASE_URL; when it is unset, or the
    //    server serves any other key, the guard fixture FAILS the project
    //    rather than skipping it. That server needs its own backend whose
    //    WEB_ORIGIN is the consent server's origin. See e2e/consent.ts.
    //    Present only when INCLUDE_CONSENT (see above).
    ...(INCLUDE_CONSENT
      ? [
          {
            name: 'consent',
            use: { ...devices['Desktop Chrome'], baseURL: CONSENT_BASE_URL },
            dependencies: ['setup'],
            testMatch: /\.consent\.spec\.ts$/,
          },
        ]
      : []),

    // 3) Tablet — 1024×768, exactly the `xl` breakpoint where the sidebar
    //    replaces the FloatingNavBar pill (spec §5.3). Runs the same
    //    AUTHENTICATED route + a11y crawl as `chromium`/`mobile-chrome` (not
    //    the CRUD flows) so axe exercises the shell right at that boundary —
    //    a width neither the 1280 desktop nor the ~390 mobile viewport ever
    //    lands on. Requires the live backend and the isolated read-only account
    //    (see `a11y-tablet` above for the backend-free public-only equivalent).
    {
      name: 'tablet',
      use: {
        ...devices['Desktop Chrome'],
        viewport: { width: 1024, height: 768 },
      },
      dependencies: ['setup'],
      testMatch: [/smoke\.spec\.ts/, /public-smoke\.spec\.ts/],
    },

    // 4) Mobile (Pixel 5 viewport) — runs the route crawl (render + a11y at
    //    mobile width, catching overflow/responsive regressions the desktop
    //    run can't) plus the mobile-only specs in e2e/mobile/ (the
    //    FloatingNavBar pill + its AddMenu — there is no drawer). The CRUD
    //    flows stay desktop-only — their chrome differs on mobile.
    {
      name: 'mobile-chrome',
      use: { ...devices['Pixel 5'] },
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
