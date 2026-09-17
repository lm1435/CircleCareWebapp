import type { Page } from '@playwright/test';
import { test, expect } from '../../fixtures';
import { runScopedEmail } from '../../isolation';
import { API_ERRORS, countRequests, dbQuery, generateSignupOtp, holdRequest, sqlStr } from '../../unhappy';
import {
  CONSENT_LOCAL_KEYS,
  PARKED,
  authUser,
  captureJson,
  authUserCount,
  hasRefreshCookie,
  localItems,
  sessionItems,
  stubJson,
  typeOtp,
  uniq,
} from './_helpers';

// SIGNUP unhappy paths (src/pages/SignUpPage.tsx, backend POST /api/auth/signup).
//
// LOCAL STACK: GoTrue's send_email hook points at :3001 (not running), so a real
// signup of a NEW address answers 400 SIGNUP_FAILED after ~4s and creates no
// user; an EXISTING confirmed address answers 400 SIGNUP_FAILED immediately.
// POST /signup never emits USER_EXISTS, so the "email exists" copy is reached
// here by stub only (see the report).

test.use({ storageState: { cookies: [], origins: [] } });

const SIGNUP = '/api/auth/signup';
const COPY = {
  failed: "We couldn't create your account. Please try again.",
  exists: 'An account with this email already exists. Please sign in instead.',
  rules:
    'Password must be at least 8 characters with an uppercase letter, a lowercase letter, a number, and a special character.',
  mismatch: "Passwords don't match.",
  terms: 'Please confirm you are 18 or older and agree to the Terms of Service and Privacy Policy.',
};
const GOOD_PASSWORD = 'Str0ng!Passw0rd';

async function openSignup(page: Page): Promise<void> {
  await page.goto('/signup', { waitUntil: 'domcontentloaded' });
  await expect(page.getByRole('heading', { name: 'Create account' })).toBeVisible({ timeout: 20_000 });
}

async function fillSignup(
  page: Page,
  v: { email: string; password?: string; confirm?: string; terms?: boolean }
): Promise<void> {
  const password = v.password ?? GOOD_PASSWORD;
  await page.locator('#first_name').fill('Ada');
  await page.locator('#last_name').fill('Unhappy');
  await page.locator('#email').fill(v.email);
  await page.locator('#password').fill(password);
  await page.locator('#confirmPassword').fill(v.confirm ?? password);
  if (v.terms ?? true) {
    const terms = page.locator('#termsAccepted');
    await terms.check({ force: true });
    await expect(terms).toBeChecked();
  }
}

/** Nothing about analytics consent may be written by a signup that created no account. */
async function expectNoConsentRecorded(page: Page): Promise<void> {
  expect(await localItems(page, CONSENT_LOCAL_KEYS)).toEqual({
    cc_analytics_enabled: null,
    cc_analytics_consent_user: null,
    analytics_consent_pending_sync: null,
  });
  expect(await sessionItems(page, [PARKED.analytics, PARKED.terms])).toEqual({
    [PARKED.analytics]: null,
    [PARKED.terms]: null,
  });
}

test('existing email (real backend): failure copy, no navigation, nothing recorded, account untouched', async ({
  page,
  account,
}) => {
  const before = dbQuery<{ first_name: string | null; last_name: string | null; terms_accepted_at: string | null }>(
    `select first_name, last_name, terms_accepted_at::text as terms_accepted_at from public.users where id = ${sqlStr(account.userId)}::uuid`
  )[0];
  const passwordBefore = authUser(account.email).encrypted_password;

  await openSignup(page);
  const posts = countRequests(page, 'POST', SIGNUP);
  await fillSignup(page, { email: account.email });
  const captured = await captureJson(page, 'POST', SIGNUP);
  await page.getByRole('button', { name: 'Create account' }).click();
  const res = await captured.next();
  expect(res.status).toBe(400);
  expect(res.json.error.code).toBe('SIGNUP_FAILED');

  await expect(page.getByRole('alert')).toHaveText(COPY.failed);
  await expect(page).toHaveURL(/\/signup$/);
  await posts.expectCount(1);
  await expectNoConsentRecorded(page);
  expect(
    dbQuery(
      `select first_name, last_name, terms_accepted_at::text as terms_accepted_at from public.users where id = ${sqlStr(account.userId)}::uuid`
    )[0]
  ).toEqual(before);
  expect(authUser(account.email).encrypted_password, 'the existing password was not replaced').toBe(passwordBefore);
});

test('USER_EXISTS: exact copy, no navigation, no consent answer stored', async ({ page }) => {
  await openSignup(page);
  const stub = await stubJson(page, 'POST', SIGNUP, {
    status: 400,
    body: { success: false, error: { code: 'USER_EXISTS', message: 'An account with this email already exists.' } },
  });
  const posts = countRequests(page, 'POST', SIGNUP);
  // Tick the OPTIONAL analytics box too: a failed attempt must record neither answer.
  await fillSignup(page, { email: runScopedEmail(uniq('signup-exists')) });
  await page.locator('#analyticsAccepted').check({ force: true });
  await page.getByRole('button', { name: 'Create account' }).click();

  await expect(page.getByRole('alert')).toHaveText(COPY.exists);
  await expect(page).toHaveURL(/\/signup$/);
  await posts.expectCount(1);
  expect(stub.requests).toHaveLength(1);
  await expectNoConsentRecorded(page);
});

test('client-side validation sends no request: weak password, mismatch, missing terms', async ({ page }) => {
  await openSignup(page);
  const posts = countRequests(page, 'POST', SIGNUP);
  const email = runScopedEmail(uniq('signup-invalid'));
  const submit = page.getByRole('button', { name: 'Create account' });

  await fillSignup(page, { email, password: 'weakpass', confirm: 'weakpass' });
  await submit.click();
  await expect(page.getByText(COPY.rules)).toBeVisible();

  await page.locator('#password').fill(GOOD_PASSWORD);
  await page.locator('#confirmPassword').fill(`${GOOD_PASSWORD}x`);
  await submit.click();
  await expect(page.getByText(COPY.mismatch)).toBeVisible();
  await expect(page.getByText(COPY.rules)).toHaveCount(0);

  // Terms unticked: the button disables, and a programmatic submit hits the form guard.
  await page.locator('#confirmPassword').fill(GOOD_PASSWORD);
  await page.locator('#termsAccepted').uncheck({ force: true });
  await expect(submit).toBeDisabled();
  await page.locator('form').evaluate((form: HTMLFormElement) => form.requestSubmit());
  await expect(page.getByRole('alert')).toHaveText(COPY.terms);

  await posts.expectCount(0);
  expect(authUserCount(email)).toBe(0);
});

test('real backend 400 SIGNUP_FAILED is surfaced and the form recovers', async ({ page }) => {
  const email = runScopedEmail(uniq('signup-real400'));
  await openSignup(page);
  const posts = countRequests(page, 'POST', SIGNUP);
  await fillSignup(page, { email });
  const captured = await captureJson(page, 'POST', SIGNUP);
  await page.getByRole('button', { name: 'Create account' }).click();
  const res = await captured.next();
  expect(res.status, 'local GoTrue refuses the signup (send_email hook unreachable)').toBe(400);
  expect(res.json.error.code).toBe('SIGNUP_FAILED');

  await expect(page.getByRole('alert')).toHaveText(COPY.failed);
  await expect(page.getByRole('button', { name: 'Create account' })).toBeEnabled();
  await expect(page).toHaveURL(/\/signup$/);
  await posts.expectCount(1);
  expect(authUserCount(email), 'no auth user was created').toBe(0);
  await expectNoConsentRecorded(page);
});

test('double submit while the signup is in flight sends exactly one request', async ({ page }) => {
  await openSignup(page);
  const hold = await holdRequest(page, 'POST', SIGNUP);
  const posts = countRequests(page, 'POST', SIGNUP);
  await fillSignup(page, { email: runScopedEmail(uniq('signup-double')) });

  await page.locator('form').evaluate((form: HTMLFormElement) => {
    form.requestSubmit();
    form.requestSubmit();
  });
  await hold.waitForHeld();
  await expect(page.getByRole('button', { name: 'Creating account...' })).toBeDisabled();
  await page.locator('#confirmPassword').press('Enter');
  await hold.releaseWith(API_ERRORS.validation);

  await expect(page.getByRole('alert')).toHaveText(COPY.failed);
  await posts.expectCount(1);
});

test('successful signup (stubbed 201) → /verify-email with the email in router STATE only → real verify signs in', async ({
  page,
  context,
}) => {
  // The account the stub describes really exists (unconfirmed), so the verify
  // step runs against the REAL /api/auth/verify-otp.
  const email = runScopedEmail(uniq('signup-ok'));
  const otp = await generateSignupOtp(email);
  const userId = authUser(email).id;

  await openSignup(page);
  await stubJson(page, 'POST', SIGNUP, {
    status: 201,
    body: {
      success: true,
      data: {
        user: { id: userId, email, first_name: 'Ada', last_name: 'Unhappy' },
        message: 'Please check your email for a verification code.',
      },
    },
  });
  // The recorded DECLINE is delivered after sign-in; answer it locally so no
  // outbound PostHog deletion runs from the backend.
  const withdraw = await stubJson(page, 'POST', '/api/users/me/withdraw-analytics-consent', {
    body: { success: true },
  });
  await fillSignup(page, { email });
  await page.getByRole('button', { name: 'Create account' }).click();

  await expect(page).toHaveURL(/\/verify-email$/, { timeout: 20_000 });
  await expect(page.getByText(`We sent a 6-digit code to ${email}`)).toBeVisible();
  const url = new URL(page.url());
  expect(url.search, 'no query string').toBe('');
  expect(url.hash).toBe('');
  expect(decodeURIComponent(page.url())).not.toContain(email);
  expect(await page.evaluate(() => (window.history.state as { usr?: { email?: string } } | null)?.usr?.email)).toBe(
    email
  );
  // Only a signup that CREATED an account records the answer — and under its id.
  const local = await localItems(page, CONSENT_LOCAL_KEYS);
  expect(local.cc_analytics_enabled).toBe('false');
  expect(local.cc_analytics_consent_user).toBe(userId);

  const oauthExchanges = countRequests(page, 'POST', '/api/auth/oauth-session');
  await typeOtp(page, otp);
  await expect(page).toHaveURL(/\/circles/, { timeout: 20_000 });
  await expect(page.getByRole('button', { name: 'Join with an invite code' })).toBeVisible({ timeout: 20_000 });
  await oauthExchanges.expectCount(1);
  expect(await hasRefreshCookie(context)).toBe(true);
  expect(authUser(email).email_confirmed_at).not.toBeNull();
  await expect.poll(() => withdraw.requests.length, { timeout: 10_000 }).toBe(1);
});
