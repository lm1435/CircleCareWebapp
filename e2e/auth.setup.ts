import { test as setup, expect } from '@playwright/test';
import { READ_ONLY_SLOT, accountFor, readManifest } from './isolation';

// ENVIRONMENT PREFLIGHT + real-UI login check.
//
// This is the `setup` project every authenticated project depends on. It is
// deliberately the FIRST thing that runs and the only thing running while it
// does, so a broken environment produces ONE clear failure instead of ~100
// confusing ones.
//
// WHAT CHANGED. It used to log in as the shared demo account and persist the
// session to `e2e/.auth/user.json`, which every authenticated project then
// replayed. That single shared cookie was the suite's biggest flake source:
// the web rotates refresh tokens single-use, so four workers replaying one
// cookie invalidated it for each other mid-run and the app bounced them to
// /login. Sessions are now minted per test by e2e/fixtures.ts against
// per-worker accounts, and NO project carries a storageState.
//
// What survives — and is worth keeping — is that this exercises the REAL login
// form end to end. That coverage now sits on the read-only isolated account, so
// even the login check writes nothing anyone else can see.
//
// NOTE ON FAILURE REPORTING: if this fails, Playwright does not run the
// dependent projects and exits non-zero, reporting this test as the failure.
// That is the intended behaviour — but read the failure here, not the "did not
// run" count below it.

setup('preflight: isolated accounts exist and the login UI works', async ({ page }) => {
  // 1) globalSetup provisioned the accounts. A missing/short manifest means the
  //    environment is wrong (no local database, or the demo seed is absent) —
  //    fail here with that message rather than 100 timeouts later.
  const manifest = readManifest();
  expect(
    Object.keys(manifest.accounts).length,
    'globalSetup provisioned the read-only account plus one per worker slot'
  ).toBe(manifest.workers + 1);
  const account = accountFor(manifest, READ_ONLY_SLOT);
  expect(account.circleIds.length, 'the read-only account has its cloned circles').toBe(2);

  // 2) The BACKEND behind the app origin answers. The browser only talks to the
  //    Vite origin, which proxies `/api` to VITE_API_URL (vite.config.ts). When
  //    nothing listens there, Vite answers 502 text/plain, the login form shows
  //    its generic "couldn't sign you in" and the only symptom used to be a 20s
  //    waitForURL timeout below. Any `/api` path the backend does not mount
  //    answers its own JSON 404, so a JSON body proves the proxy reached it.
  const probe = await page.request.get('/api/__e2e_preflight_probe', { failOnStatusCode: false });
  const probeType = probe.headers()['content-type'] ?? '';
  expect(
    probeType.includes('application/json'),
    `No backend behind ${probe.url()} (HTTP ${probe.status()} ${probeType || 'no content-type'}). ` +
      'The Vite dev server proxies /api to VITE_API_URL — committed default http://localhost:3001. ' +
      'Start a backend there, or run with VITE_API_URL=http://localhost:<backend-port>. A Vite ' +
      'already on the PW_BASE_URL port is REUSED with whatever VITE_API_URL it was started with.'
  ).toBe(true);

  // 3) The real login form still works.
  await page.goto('/login');
  await page.locator('#login-email').fill(account.email);
  await page.locator('#login-password').fill(account.password);
  const loginResponse = page.waitForResponse(
    (r) => new URL(r.url()).pathname === '/api/auth/login' && r.request().method() === 'POST'
  );
  await page.getByRole('button', { name: /sign in/i }).click();
  // Name a rejected login (403 = this origin is not in the backend's WEB_ORIGIN
  // allowlist; 401 = wrong credentials) instead of timing out on the URL.
  const login = await loginResponse;
  expect(
    login.ok(),
    `POST /api/auth/login answered ${login.status()}: ${(await login.text()).slice(0, 300)}. ` +
      'A 403 from a Vite on a port other than 5173 means the backend needs ' +
      'WEB_ORIGIN=<that Vite origin> (e2e/README.md, "Your own server pair").'
  ).toBe(true);

  // A successful login lands on the circle picker (or a circle, if one is
  // remembered). Either way we leave /login and reach an authed route.
  await page.waitForURL((url) => !url.pathname.startsWith('/login'), { timeout: 20_000 });
  await expect(page).not.toHaveURL(/\/login/);
});
