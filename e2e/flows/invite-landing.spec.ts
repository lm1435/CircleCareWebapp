import { test, expect } from '../fixtures';

// Public invite landing page (`/invite/:code`). The page is a PUBLIC route that
// previews an invite by code and offers an accept / sign-in action plus
// app-download CTAs. Email recipients tap the link in their invitation email,
// land here, and accept.
//
//   • Logged OUT + valid code → "Sign in to accept" CTA; clicking it routes to
//     /login preserving `/invite/:code` as the return destination.
//   • Logged IN  + valid code → "Accept invitation" CTA (present + enabled). We
//     STOP SHORT of clicking it: accepting joins the circle, which is not cleanly
//     reversible from the web (there is no inviter-side "un-accept"), so we only
//     assert the button — preserving net-zero discipline.
//   • Invalid / nonexistent code → localized error state (a pure read).
//
// MUTATION/CLEANUP: the "valid code" test creates ONE real email invite via the
// authenticated API (which returns the invite_code) to get a live code,
// exercises both the logged-in and logged-out CTAs against it, then CANCELS the
// invite via the API. Create → cancel is net-zero. We go through the API rather
// than the UI because the web no longer surfaces the code anywhere.

// A bogus 6-char code the backend rejects as not-found → the page shows its
// localized error state. Pure read; any non-existent code is safe.
const INVALID_CODE = 'ZZZZZZ';

// Cookie-mode keeps the access token in JS memory (not the cookie jar), so a raw
// APIRequestContext call carries no bearer and `requireAuth` 401s. Mint a fresh
// token via the login API (mirrors auth.setup defaults) for the direct API calls.
const DEMO_EMAIL = process.env.PW_DEMO_EMAIL ?? 'demo@circlecare.app';
const DEMO_PASSWORD = process.env.PW_DEMO_PASSWORD ?? 'DemoPass123!';
const APP_ORIGIN = process.env.PW_BASE_URL ?? 'http://localhost:5173';

test.describe('invite landing page', () => {
  test('invalid / nonexistent code shows the localized error state (no mutation)', async ({
    page,
  }) => {
    // The preview query 404s regardless of auth, so an authenticated visit to a
    // bogus code still lands on the error state.
    await page.goto(`/invite/${INVALID_CODE}`, { waitUntil: 'domcontentloaded' });
    await page.waitForLoadState('networkidle', { timeout: 8_000 }).catch(() => {});

    // Brand wordmark renders on every state.
    await expect(page.getByText('CircleCare', { exact: true }).first()).toBeVisible({
      timeout: 20_000,
    });
    await expect(
      page.getByRole('heading', { name: 'This invite has expired or is invalid' })
    ).toBeVisible({ timeout: 20_000 });
    // The recovery suggestion copy is shown too.
    await expect(page.getByText('Ask the person who invited you', { exact: false })).toBeVisible();
    // No accept / sign-in CTA on an invalid code.
    await expect(page.getByRole('button', { name: 'Accept invitation' })).toHaveCount(0);
    await expect(page.getByRole('button', { name: 'Sign in to accept' })).toHaveCount(0);
  });

  test('valid code: logged-out "Sign in to accept" redirect + logged-in "Accept invitation" CTA (created then canceled — net-zero, never accepted)', async ({
    page,
    context,
    circleId,
    browser,
  }) => {
    // --- Create ONE real email invite via the authenticated API to obtain a
    // valid code. The create response carries `invite_code`. We use a unique
    // throwaway address so the invite is isolated and easy to clean up. The
    // `page` fixture has already established a cookie-mode session in `context`,
    // so context.request is authenticated. ---
    const email = `e2e-landing-${Date.now()}@example.com`;

    // Mint a fresh access token for the direct API calls (cookies alone don't
    // carry the in-memory bearer; /auth/login is Web-Origin gated).
    const loginRes = await context.request.post('/api/auth/login', {
      data: { email: DEMO_EMAIL, password: DEMO_PASSWORD },
      headers: { Origin: APP_ORIGIN },
    });
    expect(loginRes.ok(), `api login failed: ${loginRes.status()}`).toBeTruthy();
    const token = (
      (await loginRes.json()) as { data: { session: { access_token: string } } }
    ).data.session.access_token;
    const authHeaders = { Authorization: `Bearer ${token}` };

    const createRes = await context.request.post(`/api/circles/${circleId}/invites`, {
      data: { email, member_type: 'caregiver' },
      headers: authHeaders,
    });
    expect(createRes.ok(), `invite create failed: ${createRes.status()}`).toBeTruthy();
    const created = (await createRes.json()) as {
      data: { invite: { id: string; invite_code: string } };
    };
    const inviteId = created.data.invite.id;
    const code = created.data.invite.invite_code;
    expect(code, 'create response did not return an invite_code').toBeTruthy();

    try {
      // --- LOGGED-IN: authenticated visitor sees "Accept invitation", enabled.
      // We do NOT click it (accepting is not cleanly reversible from the web). ---
      await page.goto(`/invite/${code}`, { waitUntil: 'domcontentloaded' });
      await page.waitForLoadState('networkidle', { timeout: 8_000 }).catch(() => {});
      const acceptBtn = page.getByRole('button', { name: 'Accept invitation' });
      await expect(acceptBtn).toBeVisible({ timeout: 20_000 });
      await expect(acceptBtn).toBeEnabled();
      await expect(page.getByRole('button', { name: 'Sign in to accept' })).toHaveCount(0);

      // --- LOGGED-OUT: a FRESH anonymous context (no fixture login) sees the
      // "Sign in to accept" CTA; clicking it routes to /login while preserving
      // the invite as the return destination. ---
      // Force a genuinely logged-out session: pass an explicit empty storageState
      // so this context can never inherit the project's authenticated state.
      const anonContext = await browser.newContext({
        storageState: { cookies: [], origins: [] },
      });
      const anonPage = await anonContext.newPage();
      try {
        await anonPage.goto(`/invite/${code}`, { waitUntil: 'domcontentloaded' });
        await anonPage.waitForLoadState('networkidle', { timeout: 8_000 }).catch(() => {});

        const signInCta = anonPage.getByRole('button', { name: 'Sign in to accept' });
        await expect(signInCta).toBeVisible({ timeout: 20_000 });
        // Authenticated CTA must NOT show to a logged-out visitor.
        await expect(anonPage.getByRole('button', { name: 'Accept invitation' })).toHaveCount(0);

        await signInCta.click();
        // Routed to /login (return path preserved via router location.state).
        await expect(anonPage).toHaveURL(/\/login$/, { timeout: 20_000 });
        await expect(anonPage.getByRole('heading', { name: 'Welcome Back' })).toBeVisible({
          timeout: 20_000,
        });
      } finally {
        await anonContext.close();
      }
    } finally {
      // --- Cleanup → net-zero: cancel the invite we created (via the API). ---
      const del = await context.request.delete(`/api/invites/${inviteId}`, {
        headers: authHeaders,
      });
      expect(del.ok(), `invite cancel failed: ${del.status()}`).toBeTruthy();
    }
  });
});
