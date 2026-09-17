import { test, expect } from '../fixtures';

// Public invite landing page (`/invite/:code`). The page is a PUBLIC route that
// previews an invite by code and offers an accept / sign-in action plus
// app-download CTAs. Email recipients tap the link in their invitation email,
// land here, and accept.
//
//   • Logged OUT + valid code → PRIMARY "Create an account to join" CTA routing to
//     /signup, plus a secondary "I already have an account" routing to /login —
//     both preserving `/invite/:code` as the return destination.
//     NOTE: this spec previously asserted the single old CTA landed the invitee on
//     /login ("Welcome back") and passed happily while that flow converted 0 of 17
//     real web invitees. Assert what the INVITEE needs (a way to join), not merely
//     that the button goes where the implementation happens to send it.
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
// token via the login API for the direct API calls, using THIS WORKER's isolated
// account (the `account` fixture) — the invite is created in that account's own
// circle, so no other worker can see or cancel it.
const APP_ORIGIN = process.env.PW_BASE_URL ?? 'http://localhost:5173';

/**
 * Where the auth page the invitee just reached will send them afterwards:
 * React Router's location state (`history.state.usr`, what
 * `navigate(..., { state })` writes) and the invite code parked in
 * sessionStorage by InviteLandingPage (src/lib/pendingInviteCode.ts).
 */
async function returnDestination(
  page: import('@playwright/test').Page
): Promise<{ statePath: string | null; parkedCode: string | null }> {
  return page.evaluate(() => {
    const usr = (window.history.state as { usr?: { from?: { pathname?: string } } } | null)?.usr;
    return {
      statePath: usr?.from?.pathname ?? null,
      parkedCode: sessionStorage.getItem('cc_pending_invite_code'),
    };
  });
}

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
    await expect(page.getByRole('button', { name: 'Create an account to join' })).toHaveCount(0);
    await expect(page.getByRole('button', { name: 'I already have an account' })).toHaveCount(0);
  });

  test('valid code: logged-out create-account + sign-in CTAs + logged-in "Accept invitation" CTA (created then canceled — net-zero, never accepted)', async ({
    page,
    context,
    circleId,
    browser,
    account,
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
      data: { email: account.email, password: account.password },
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
      await expect(page.getByRole('button', { name: 'Create an account to join' })).toHaveCount(0);
      await expect(page.getByRole('button', { name: 'I already have an account' })).toHaveCount(0);

      // --- LOGGED-OUT: a FRESH anonymous context (no fixture login) sees BOTH
      // CTAs. The primary routes to /signup (an invitee usually has no account
      // yet); the secondary routes to /login. Both preserve the invite as the
      // return destination. ---
      // Force a genuinely logged-out session: pass an explicit empty storageState
      // so this context can never inherit the project's authenticated state.
      const anonContext = await browser.newContext({
        storageState: { cookies: [], origins: [] },
      });
      const anonPage = await anonContext.newPage();
      try {
        await anonPage.goto(`/invite/${code}`, { waitUntil: 'domcontentloaded' });
        await anonPage.waitForLoadState('networkidle', { timeout: 8_000 }).catch(() => {});

        const createCta = anonPage.getByRole('button', { name: 'Create an account to join' });
        const signInCta = anonPage.getByRole('button', { name: 'I already have an account' });
        await expect(createCta).toBeVisible({ timeout: 20_000 });
        await expect(signInCta).toBeVisible({ timeout: 20_000 });
        // Authenticated CTA must NOT show to a logged-out visitor.
        await expect(anonPage.getByRole('button', { name: 'Accept invitation' })).toHaveCount(0);

        // Secondary path: an invitee who already has an account reaches /login.
        await signInCta.click();
        await expect(anonPage).toHaveURL(/\/login$/, { timeout: 20_000 });
        await expect(anonPage.getByRole('heading', { name: 'Welcome back' })).toBeVisible({
          timeout: 20_000,
        });
        // ...carrying the invite as its return destination, both ways the app
        // preserves it: router state (LoginPage honours `state.from.pathname`
        // after an email/password login) and the parked sessionStorage code
        // (what survives OAuth and login -> signup -> verify-email).
        //
        // Read, not exercised by signing in: the landing page AUTO-ACCEPTS a
        // parked code once authenticated, and an accept is not reversible here.
        expect(await returnDestination(anonPage), 'login carries the invite return path').toEqual({
          statePath: `/invite/${code}`,
          parkedCode: code,
        });

        // Primary path: a brand-new invitee reaches the signup form. This is the
        // assertion whose absence let 17 web invitees dead-end on a password
        // prompt — a new invitee must be able to REACH account creation.
        await anonPage.goto(`/invite/${code}`, { waitUntil: 'domcontentloaded' });
        await anonPage.waitForLoadState('networkidle', { timeout: 8_000 }).catch(() => {});
        // Clear the code the sign-in CTA parked, so the signup assertion below
        // can only pass if the CREATE CTA parks it again itself.
        await anonPage.evaluate(() => sessionStorage.removeItem('cc_pending_invite_code'));
        await createCta.click();
        await expect(anonPage).toHaveURL(/\/signup$/, { timeout: 20_000 });
        await expect(anonPage.getByRole('heading', { name: 'Create account' })).toBeVisible({
          timeout: 20_000,
        });
        // Signup always hands off to /verify-email, which has no router state to
        // honour — the parked code is what brings a new invitee back to accept.
        expect(await returnDestination(anonPage), 'signup carries the invite return path').toEqual({
          statePath: `/invite/${code}`,
          parkedCode: code,
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
