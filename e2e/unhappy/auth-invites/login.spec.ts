import type { Page } from '@playwright/test';
import { test, expect } from '../../fixtures';
import { generateSignupOtp, API_ERRORS, countRequests, failRequest, holdRequest } from '../../unhappy';
import { runScopedEmail } from '../../isolation';
import { captureJson, hasRefreshCookie, uniq } from './_helpers';

// LOGIN unhappy paths (src/pages/LoginPage.tsx, backend POST /api/auth/login).
// Logged-out context throughout; the worker account supplies REAL credentials.

test.use({ storageState: { cookies: [], origins: [] } });

const INVALID = 'Invalid email or password.';
const GENERIC = "We couldn't sign you in. Please try again.";
const RATE_LIMITED = 'Too many attempts. Please wait a few minutes before trying again.';
const LOGIN = '/api/auth/login';

async function openLogin(page: Page): Promise<void> {
  await page.goto('/login', { waitUntil: 'domcontentloaded' });
  await expect(page.getByRole('heading', { name: 'Welcome back' })).toBeVisible({ timeout: 20_000 });
}

function signInButton(page: Page) {
  return page.getByRole('button', { name: 'Sign in', exact: true });
}

test('wrong password: exact error copy, no navigation, no session, the form stays usable', async ({
  page,
  context,
  account,
}) => {
  await openLogin(page);
  const logins = countRequests(page, 'POST', LOGIN);

  await page.locator('#login-email').fill(account.email);
  await page.locator('#login-password').fill('Wrong-password-1!');
  const captured = await captureJson(page, 'POST', LOGIN);
  await signInButton(page).click();
  const res = await captured.next();
  expect(res.status).toBe(401);
  expect(res.json.error.code).toBe('LOGIN_FAILED');
  await captured.dispose();

  await expect(page.getByRole('alert')).toHaveText(INVALID);
  await expect(page).toHaveURL(/\/login$/);
  await logins.expectCount(1);
  expect(await hasRefreshCookie(context), 'a failed login sets no refresh cookie').toBe(false);

  // Usable: enabled, keeps focus-able input, and the corrected password signs in.
  const password = page.locator('#login-password');
  await expect(password).toBeEditable();
  await expect(signInButton(page)).toBeEnabled();
  await password.fill(account.password);
  await signInButton(page).click();
  await expect(page).toHaveURL(/\/circles/, { timeout: 20_000 });
  await logins.expectCount(2);
  expect(await hasRefreshCookie(context)).toBe(true);
});

test('429 from the limiter: no navigation, one request, never "invalid credentials"', async ({ page, account }) => {
  await openLogin(page);
  const fault = await failRequest(page, 'POST', LOGIN, API_ERRORS.rateLimit);
  const logins = countRequests(page, 'POST', LOGIN);

  await page.locator('#login-email').fill(account.email);
  await page.locator('#login-password').fill(account.password);
  await signInButton(page).click();

  await expect(page.getByRole('alert')).toBeVisible();
  await expect(page.getByText(INVALID)).toHaveCount(0);
  await expect(page).toHaveURL(/\/login$/);
  await fault.expectHits(1);
  await logins.expectCount(1);
});

test('a 429 tells the user to wait, never the generic "try again" copy', async ({ page, account }) => {
  // LoginPage used to map RATE_LIMIT to login.errors.loginFailed ("Please try
  // again."), so a locked-out user was told to retry — each retry burns the
  // limiter and extends the lockout (see useGuardedSubmit header).
  await openLogin(page);
  await failRequest(page, 'POST', LOGIN, API_ERRORS.rateLimit);
  await page.locator('#login-email').fill(account.email);
  await page.locator('#login-password').fill(account.password);
  await signInButton(page).click();
  await expect(page.getByRole('alert')).toBeVisible();
  await expect(page.getByRole('alert')).toHaveText(RATE_LIMITED, { timeout: 2_000 });
});

for (const [label, fault] of [
  ['503', API_ERRORS.serviceUnavailable],
  ['network abort', { abort: true as const }],
] as const) {
  test(`${label}: generic error and the button re-enables`, async ({ page, context, account }) => {
    await openLogin(page);
    const hold = await holdRequest(page, 'POST', LOGIN);
    const logins = countRequests(page, 'POST', LOGIN);

    await page.locator('#login-email').fill(account.email);
    await page.locator('#login-password').fill(account.password);
    await signInButton(page).click();
    await hold.waitForHeld();
    await expect(page.getByRole('button', { name: 'Signing in...' })).toBeDisabled();
    await hold.releaseWith(fault);

    await expect(page.getByRole('alert')).toHaveText(GENERIC);
    await expect(signInButton(page)).toBeEnabled();
    await expect(page).toHaveURL(/\/login$/);
    await logins.expectCount(1);
    expect(await hasRefreshCookie(context)).toBe(false);
  });
}

test('double submit while the login is in flight sends exactly one request', async ({ page, account }) => {
  await openLogin(page);
  const hold = await holdRequest(page, 'POST', LOGIN);
  const logins = countRequests(page, 'POST', LOGIN);

  await page.locator('#login-email').fill(account.email);
  await page.locator('#login-password').fill('Wrong-password-1!');
  // Two submits in ONE task — before React can commit `isSubmitting` — the
  // window the ref guard exists for (three login_started in 52 ms, 2026-09-03).
  await page.locator('form').evaluate((form: HTMLFormElement) => {
    form.requestSubmit();
    form.requestSubmit();
  });
  await hold.waitForHeld();
  // And again once the pending render has landed: Enter (implicit submission)
  // plus a real click on the disabled button.
  await expect(page.getByRole('button', { name: 'Signing in...' })).toBeDisabled();
  await page.locator('#login-password').press('Enter');
  await page.locator('form').evaluate((form: HTMLFormElement) => form.requestSubmit());
  await hold.release();

  await expect(page.getByRole('alert')).toHaveText(INVALID);
  await logins.expectCount(1);
});

test('an unverified account is routed to verification, never told "Invalid email or password."', async ({
  page,
}) => {
  // Regression: backend POST /login used to let GoTrue's email_not_confirmed
  // fall into the generic 401 LOGIN_FAILED, so LoginPage's /verify-email
  // handoff never ran. Not faked with a stub — this drives a REAL unconfirmed user.
  const email = runScopedEmail(uniq('signup-unverified'));
  await generateSignupOtp(email); // creates the unconfirmed user (password = ACCOUNT_PASSWORD), sends nothing
  await openLogin(page);
  await page.locator('#login-email').fill(email);
  await page.locator('#login-password').fill(process.env.PW_DEMO_PASSWORD ?? 'DemoPass123!');
  const captured = await captureJson(page, 'POST', LOGIN);
  await signInButton(page).click();
  const res = await captured.next();
  const code: unknown = res.json?.error?.code;
  test.info().annotations.push({ type: 'observed', description: `POST ${LOGIN} -> ${res.status} ${String(code)}` });

  // The load-bearing assertion: the user reaches verification.
  await expect(page).toHaveURL(/\/verify-email$/, { timeout: 3_000 });
  await expect(page.getByText(INVALID)).toHaveCount(0);
  expect({ status: res.status, code }).toEqual({ status: 403, code: 'EMAIL_NOT_VERIFIED' });
  await captured.dispose();
});
