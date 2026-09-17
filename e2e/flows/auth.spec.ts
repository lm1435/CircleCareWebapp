import { test, expect } from '../fixtures';

// Auth flows: logging out from the account menu, and the bad-credentials error
// path. (The happy-path login is exercised by auth.setup.ts.)

test('log out from the account menu returns to /login', async ({
  page,
  circleId,
  playwright,
  baseURL,
}) => {
  // The app origin under test, from the project's own `baseURL` — never
  // re-derived from an env var, which let a run against one dev server send
  // its replay to a DIFFERENT one (another checkout's :5173).
  if (!baseURL) throw new Error('auth.spec: the project has no baseURL');
  const ORIGIN = new URL(baseURL).origin;

  // The logout endpoint is NO LONGER STUBBED, and that is the point: this now
  // exercises the real POST /auth/logout end to end.
  //
  // The stub existed for one reason — every worker replayed a single shared
  // storageState, so a real revoke (even the correctly-scoped 'local' one, see
  // backend auth.ts /logout) would have cascaded the other workers to /login.
  // Sessions are minted per test now (fixtures.ts) against a per-worker
  // account, so this test's revoke reaches only this test's own session and
  // can touch nothing else. Keeping the stub after its reason expired would
  // have left a test that claims to cover "sign out" while never letting the
  // request reach the server.
  //
  // THE URL ALONE PROVES NOTHING. authStore.signOut swallows a failed
  // POST /auth/logout ("best-effort") and clears local state and redirects to
  // /login regardless — so a logout that never reached the server, or that
  // 500'd and left the httpOnly refresh cookie in place, still lands here. Both
  // halves are asserted: the request succeeded, and the session is really gone
  // (a fresh load of an authenticated route bootstraps from that cookie and
  // must bounce).
  await page.goto(`/circles/${circleId}/calendar`, { waitUntil: 'domcontentloaded' });
  await expect(page.getByRole('grid')).toBeVisible({ timeout: 15_000 });

  // Capture the LIVE refresh token before signing out. The name is the
  // backend's REFRESH_COOKIE_NAME (backend/src/middleware/webSession.ts), an
  // httpOnly cookie scoped to /api/auth — readable here through the context,
  // never by page script. Taken after the grid renders, i.e. after the boot
  // refresh has rotated it, so this is the token the session holds right now.
  const refreshCookie = (await page.context().cookies()).find((c) => c.name === 'cc_refresh');
  expect(refreshCookie?.value, 'the signed-in context holds a cc_refresh cookie').toBeTruthy();

  await page.getByRole('button', { name: 'Account' }).click();
  await page.getByRole('menuitem', { name: 'Sign out' }).click();

  // Signing out asks first (spec §5.6) — confirm the dialog.
  const confirm = page.getByRole('dialog');
  await expect(confirm).toBeVisible({ timeout: 10_000 });
  const [logout] = await Promise.all([
    page.waitForResponse(
      (r) => r.request().method() === 'POST' && new URL(r.url()).pathname.endsWith('/auth/logout'),
      { timeout: 20_000 }
    ),
    confirm.getByRole('button', { name: 'Sign out', exact: true }).click(),
  ]);
  expect(logout.status(), 'POST /auth/logout status').toBe(200);
  expect(await logout.json(), 'POST /auth/logout body').toMatchObject({ success: true });

  await expect(page).toHaveURL(/\/login/, { timeout: 20_000 });

  // THE REFRESH TOKEN IS REVOKED SERVER-SIDE — not merely dropped by the
  // browser. A cleared cookie only proves the Set-Cookie header arrived; a
  // stolen or copied token would still mint sessions if the server never
  // revoked it. So REPLAY the token captured before logout, from a separate,
  // cookie-less request context (nothing from the browser jar can leak in or
  // mask it), with the explicit Cookie header and the headers the route's CSRF
  // guard requires (`X-Session-Mode: cookie` + an allowlisted Origin,
  // requireWebOrigin). Exactly 401 REFRESH_FAILED is required: 400 would mean
  // the token never reached the server (no cookie parsed), and 403 would mean
  // the Origin guard rejected the request before the token was ever tried —
  // neither proves revocation.
  //
  // This is a SECURITY assertion. If it ever fails against the real app (not a
  // stubbed logout), POST /auth/logout is not revoking the session — a product
  // bug in backend/src/routes/auth.ts, not something to relax here.
  const replayContext = await playwright.request.newContext({
    baseURL: ORIGIN,
    storageState: { cookies: [], origins: [] },
  });
  try {
    const replay = await replayContext.post('/api/auth/refresh', {
      headers: {
        'X-Session-Mode': 'cookie',
        Origin: ORIGIN,
        Cookie: `cc_refresh=${refreshCookie?.value ?? ''}`,
      },
      data: {},
    });
    const replayBody = await replay.json().catch(() => null);
    expect(
      replay.status(),
      `replaying the pre-logout refresh token returned ${replay.status()} ` +
        `${JSON.stringify(replayBody)} — 200 means logout did NOT revoke the session`
    ).toBe(401);
    expect(replayBody).toMatchObject({ success: false, error: { code: 'REFRESH_FAILED' } });
  } finally {
    await replayContext.dispose();
  }

  // And the browser's own jar no longer carries a usable cookie either (the
  // weaker, client-side half: 400 no cookie sent / 401 rejected).
  const refresh = await page.request.post('/api/auth/refresh', {
    headers: { 'X-Session-Mode': 'cookie', Origin: ORIGIN },
    data: {},
  });
  expect(
    [400, 401],
    `POST /auth/refresh after logout returned ${refresh.status()} — the refresh cookie survived`
  ).toContain(refresh.status());

  // And the UI agrees: reloading an authenticated route ends on the login form.
  await page.goto(`/circles/${circleId}/calendar`, { waitUntil: 'domcontentloaded' });
  await expect(page).toHaveURL(/\/login/, { timeout: 20_000 });
  await expect(page.locator('#login-email')).toBeVisible();
  await expect(page.getByRole('grid')).toHaveCount(0);
});

test.describe('invalid login', () => {
  // This path must run logged OUT — drop the stored session for these tests.
  test.use({ storageState: { cookies: [], origins: [] } });

  test('shows an error and stays on /login for bad credentials', async ({ page }) => {
    await page.goto('/login', { waitUntil: 'domcontentloaded' });

    await page.locator('#login-email').fill('nobody@circlecare.test');
    await page.locator('#login-password').fill('definitely-the-wrong-password');
    await page.getByRole('button', { name: /sign in/i }).click();

    // The form surfaces the failure in a role="alert" and does not navigate
    // away. The MESSAGE is asserted, not just the alert — but know what that
    // does and does not distinguish. POST /auth/login maps EVERY error that
    // Supabase's signInWithPassword returns to LOGIN_FAILED "Invalid email or
    // password." (backend/src/routes/auth.ts, the `if (error)` branch), so a
    // Supabase auth outage reads exactly like bad credentials here. What the
    // message DOES rule out is a response that never got that far: a 429 from
    // the login rate limiter, a 403 from the origin guard, or an unreachable
    // backend, none of which is LOGIN_FAILED
    // (LoginPage.tsx: LOGIN_FAILED -> login.errors.invalidCredentials).
    await expect(page.getByRole('alert')).toContainText('Invalid email or password.', {
      timeout: 20_000,
    });
    await expect(page).toHaveURL(/\/login/);
  });
});
