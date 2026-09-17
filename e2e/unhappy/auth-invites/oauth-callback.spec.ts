import type { Page } from '@playwright/test';
import { test, expect } from '../../fixtures';
import { countRequests } from '../../unhappy';
import {
  CONSENT_LOCAL_KEYS,
  PARKED,
  backdateAuthUser,
  captureJson,
  consentRow,
  createScopedAccount,
  expiredAccessToken,
  hasRefreshCookie,
  localItems,
  passwordGrant,
  rewriteJson,
  sessionItems,
  stubJson,
  type ScopedAccount,
} from './_helpers';

// OAUTH CALLBACK unhappy paths (src/pages/AuthCallbackPage.tsx, backend
// POST /api/auth/oauth-session). No real provider: provider returns are
// simulated by navigating to /auth/callback with the fragment/query a provider
// (via Supabase) would produce, and the "returning user" case intercepts the
// Supabase /authorize redirect that SignUpPage's real button starts.

test.use({ storageState: { cookies: [], origins: [] } });

const EXCHANGE = '/api/auth/oauth-session';
const WITHDRAW = '/api/users/me/withdraw-analytics-consent';
const ERROR_COPY = "We couldn't complete your sign-in. Please try again.";
const CANCEL_COPY = "No problem — you can sign in whenever you're ready.";

/** Park answers exactly as SignUpPage.startOAuth does (terms, analytics DECLINE, provider). */
async function parkLikeSignup(page: Page): Promise<void> {
  await page.goto('/signup', { waitUntil: 'domcontentloaded' });
  await expect(page.getByRole('heading', { name: 'Create account' })).toBeVisible({ timeout: 20_000 });
  await page.evaluate((k) => {
    sessionStorage.setItem(k.terms, '1');
    sessionStorage.setItem(k.analytics, '0');
    sessionStorage.setItem(k.authMethod, 'google');
  }, PARKED);
}

async function expectErrorState(page: Page): Promise<void> {
  await expect(page.getByRole('heading', { name: "Sign-in didn't complete" })).toBeVisible({ timeout: 20_000 });
  await expect(page.getByRole('alert')).toHaveText(ERROR_COPY);
  await expect(page.getByRole('link', { name: 'Back to Sign In' })).toHaveAttribute('href', '/login');
}

test('no tokens in the hash: error state, no exchange, no session, parked analytics answer cleared', async ({
  page,
  context,
}) => {
  await parkLikeSignup(page);
  const exchanges = countRequests(page, 'POST', EXCHANGE);
  await page.goto('/auth/callback#token_type=bearer', { waitUntil: 'domcontentloaded' });

  await expectErrorState(page);
  expect(new URL(page.url()).hash, 'fragment scrubbed').toBe('');
  await exchanges.expectCount(0);
  expect(await hasRefreshCookie(context)).toBe(false);
  const parked = await sessionItems(page, [PARKED.analytics, PARKED.authMethod]);
  expect(parked).toEqual({ [PARKED.analytics]: null, [PARKED.authMethod]: null });
  expect(await localItems(page, CONSENT_LOCAL_KEYS)).toEqual({
    cc_analytics_enabled: null,
    cc_analytics_consent_user: null,
    analytics_consent_pending_sync: null,
  });
});

for (const kind of ['malformed', 'expired'] as const) {
  test(`${kind} access token: backend rejects it (401 INVALID_TOKEN), error state, everything parked cleared`, async ({
    page,
    context,
    account,
  }) => {
    const token = kind === 'malformed' ? 'not.a.jwt' : expiredAccessToken(account.userId, account.email);
    await parkLikeSignup(page);
    const exchanges = countRequests(page, 'POST', EXCHANGE);
    const withdraws = countRequests(page, 'POST', WITHDRAW);
    const captured = await captureJson(page, 'POST', EXCHANGE);
    await page.goto(`/auth/callback#access_token=${token}&refresh_token=e2e-refresh&token_type=bearer`, {
      waitUntil: 'domcontentloaded',
    });
    const res = await captured.next();
    expect(res.status).toBe(401);
    expect(res.json.error.code).toBe('INVALID_TOKEN');

    await expectErrorState(page);
    await exchanges.expectCount(1);
    await withdraws.expectCount(0);
    expect(await hasRefreshCookie(context)).toBe(false);
    expect(await sessionItems(page, [PARKED.terms, PARKED.analytics, PARKED.authMethod])).toEqual({
      [PARKED.terms]: null,
      [PARKED.analytics]: null,
      [PARKED.authMethod]: null,
    });
  });
}

test('provider access_denied: calm cancelled state, no exchange, parked analytics answer cleared', async ({
  page,
  context,
}) => {
  await parkLikeSignup(page);
  const exchanges = countRequests(page, 'POST', EXCHANGE);
  await page.goto('/auth/callback?error=access_denied&error_description=The+user+denied+the+request', {
    waitUntil: 'domcontentloaded',
  });

  await expect(page.getByRole('status')).toHaveText(CANCEL_COPY, { timeout: 20_000 });
  await expect(page.getByRole('alert')).toHaveCount(0);
  await expect(page.getByRole('link', { name: 'Back to Sign In' })).toBeVisible();
  expect(new URL(page.url()).search, 'query scrubbed').toBe('');
  await exchanges.expectCount(0);
  expect(await hasRefreshCookie(context)).toBe(false);
  expect(await sessionItems(page, [PARKED.analytics, PARKED.authMethod])).toEqual({
    [PARKED.analytics]: null,
    [PARKED.authMethod]: null,
  });
});

test('provider error (non-cancel) with a description: error state, the provider prose is not rendered', async ({
  page,
}) => {
  await parkLikeSignup(page);
  const exchanges = countRequests(page, 'POST', EXCHANGE);
  await page.goto('/auth/callback#error=server_error&error_description=jane.doe%40gmail.com+is+blocked', {
    waitUntil: 'domcontentloaded',
  });
  await expectErrorState(page);
  await expect(page.getByText('jane.doe@gmail.com')).toHaveCount(0);
  await exchanges.expectCount(0);
  expect((await sessionItems(page, [PARKED.analytics]))[PARKED.analytics]).toBeNull();
});

// ---------------------------------------------------------------------------
// Returning user through SignUpPage's real Google button
// ---------------------------------------------------------------------------

/**
 * Drive SignUpPage's real "Continue with Google" (terms ticked, analytics box
 * left UNTICKED → parks a decline), and answer Supabase's /authorize navigation
 * with the redirect a completed provider handshake produces: back to
 * /auth/callback with a REAL password-grant session for `acct` in the fragment.
 */
async function oauthViaSignupButton(page: Page, acct: ScopedAccount, baseURL: string): Promise<void> {
  const session = await passwordGrant(acct.email, acct.password);
  await page.route(/\/auth\/v1\/authorize/, async (route) => {
    await route.fulfill({
      status: 302,
      headers: {
        location:
          `${new URL(baseURL).origin}/auth/callback#access_token=${session.access_token}` +
          `&refresh_token=${session.refresh_token}&token_type=bearer&expires_in=3600`,
      },
    });
  });
  await page.goto('/signup', { waitUntil: 'domcontentloaded' });
  await expect(page.getByRole('heading', { name: 'Create account' })).toBeVisible({ timeout: 20_000 });
  const terms = page.locator('#termsAccepted');
  await terms.check({ force: true });
  await expect(page.locator('#analyticsAccepted')).not.toBeChecked();
  await page.getByRole('button', { name: 'Continue with Google' }).click();
}

test('RETURNING user via Sign-up Google: signed in, parked DECLINE is NOT applied, cleared', async ({
  page,
  context,
  baseURL,
}) => {
  const acct = await createScopedAccount('oauth-returning');
  backdateAuthUser(acct.userId); // an account that existed before this sign-in
  const consentBefore = consentRow(acct.userId);

  const withdraws = countRequests(page, 'POST', WITHDRAW);
  const exchange = await captureJson(page, 'POST', EXCHANGE);
  await oauthViaSignupButton(page, acct, baseURL ?? 'http://localhost:5173');

  const res = await exchange.next(30_000);
  expect(res.status).toBe(200);
  const body = res.json as { data: { is_new_user?: boolean; user: { id: string } } };
  expect(body.data.user.id).toBe(acct.userId);
  expect(body.data.is_new_user, 'backend classifies the backdated account as RETURNING').toBe(false);

  await expect(page).toHaveURL(/\/circles$/, { timeout: 20_000 });
  await expect(page.getByRole('button', { name: 'Join with an invite code' })).toBeVisible({ timeout: 20_000 });
  expect(await hasRefreshCookie(context)).toBe(true);
  await withdraws.expectCount(0, { settleMs: 2_000 });
  expect(consentRow(acct.userId)).toEqual(consentBefore);
  expect(await sessionItems(page, [PARKED.terms, PARKED.analytics, PARKED.authMethod])).toEqual({
    [PARKED.terms]: null,
    [PARKED.analytics]: null,
    [PARKED.authMethod]: null,
  });
  expect((await localItems(page, CONSENT_LOCAL_KEYS)).analytics_consent_pending_sync).toBeNull();
});

test('proof: if oauth-session said is_new_user:true, the same flow WOULD withdraw consent', async ({
  page,
  baseURL,
}) => {
  // Falsifies the test above: rewrite only the flag (real exchange otherwise).
  // The withdraw is answered locally, so no backend/PostHog side effect.
  const acct = await createScopedAccount('oauth-falsify');
  backdateAuthUser(acct.userId);
  const consentBefore = consentRow(acct.userId);
  await rewriteJson(page, 'POST', EXCHANGE, (json) => ({
    ...json,
    data: { ...(json.data as Record<string, unknown>), is_new_user: true },
  }));
  const withdraw = await stubJson(page, 'POST', WITHDRAW, { body: { success: true } });
  const withdraws = countRequests(page, 'POST', WITHDRAW);

  await oauthViaSignupButton(page, acct, baseURL ?? 'http://localhost:5173');
  await expect(page).toHaveURL(/\/circles$/, { timeout: 20_000 });
  await withdraws.expectCount(1, { settleMs: 2_000 });
  expect(withdraw.requests).toHaveLength(1);
  expect((await localItems(page, CONSENT_LOCAL_KEYS)).cc_analytics_enabled).toBe('false');
  expect(consentRow(acct.userId), 'stubbed: the real row is untouched').toEqual(consentBefore);
});

test(
  'a provider-error callback clears the parked TERMS acceptance, so the next OAuth login relays none',
  async ({ page, baseURL }) => {
    // Regression: AuthCallbackPage's error branch (no tokens / provider error /
    // access_denied) used to clear the auth method and analytics answer but NOT
    // pendingTermsConsent, so the next successful callback (a returning user's
    // OAuth LOGIN from /login, which parks no terms) sent termsAccepted:true.
    // The LAST assertion is the load-bearing one; the leftover is deliberately
    // not asserted between the callbacks so the relay itself stays the proof.
    const acct = await createScopedAccount('oauth-terms-leak');
    backdateAuthUser(acct.userId);
    await parkLikeSignup(page);
    expect((await sessionItems(page, [PARKED.terms]))[PARKED.terms], 'setup: the signup parked a terms acceptance').toBe(
      '1'
    );
    await page.goto('/auth/callback?error=access_denied', { waitUntil: 'domcontentloaded' });
    await expect(page.getByRole('status')).toHaveText(CANCEL_COPY, { timeout: 20_000 });

    // Second handshake: a LOGIN (nothing parked by the login page) for a returning user.
    // Leave the callback route first: a goto that only changes the hash on the same
    // path is a same-document navigation and would not remount the page.
    await page.goto('/login', { waitUntil: 'domcontentloaded' });
    await expect(page.getByRole('heading', { name: 'Welcome back' })).toBeVisible({ timeout: 20_000 });
    const session = await passwordGrant(acct.email, acct.password);
    const exchange = page.waitForRequest((r) => new URL(r.url()).pathname === EXCHANGE, { timeout: 20_000 });
    await page.goto(
      `${new URL(baseURL ?? 'http://localhost:5173').origin}/auth/callback#access_token=${session.access_token}` +
        `&refresh_token=${session.refresh_token}&token_type=bearer`,
      { waitUntil: 'domcontentloaded' }
    );
    const body = (await exchange).postDataJSON() as { termsAccepted?: boolean };
    expect(body.termsAccepted, 'a login must not relay a terms acceptance').toBeUndefined();
  }
);
