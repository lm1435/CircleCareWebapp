import type { APIRequestContext, Page } from '@playwright/test';
import { test, expect } from '../../fixtures';
import { runScopedEmail } from '../../isolation';
import { API_ERRORS, countRequests, failRequest } from '../../unhappy';
import {
  authUser,
  captureJson,
  createScopedAccount,
  expireRecoveryOtp,
  gotoWithRouterState,
  recoveryOtp,
  typeOtp,
  uniq,
  type ScopedAccount,
} from './_helpers';

// FORGOT / RESET PASSWORD unhappy paths (src/pages/ForgotPasswordPage.tsx,
// ResetPasswordPage.tsx; backend POST /api/auth/forgot-password + /reset-password).
// The web flow is OTP-based (no link token): "invalid/expired link" = a wrong or
// expired recovery CODE. Password changes are proven in auth.users.

test.use({ storageState: { cookies: [], origins: [] } });

const FORGOT = '/api/auth/forgot-password';
const RESET = '/api/auth/reset-password';
const RESET_FAILED = "That code didn't work — it may have expired. Double-check it, or request a new one below.";
const NEW_PASSWORD = 'N3w!Password9';

async function requestCode(page: Page, email: string): Promise<string> {
  await page.goto('/forgot-password', { waitUntil: 'domcontentloaded' });
  await expect(page.getByRole('heading', { name: 'Forgot password?' })).toBeVisible({ timeout: 20_000 });
  await page.locator('#forgot-email').fill(email);
  await page.getByRole('button', { name: 'Send reset code' }).click();
  await expect(page.getByRole('heading', { name: 'Check your email' })).toBeVisible({ timeout: 25_000 });
  return (await page.locator('main, body').first().innerText()).replace(email, '<EMAIL>');
}

async function submitReset(page: Page, code: string, password = NEW_PASSWORD, confirm = password): Promise<void> {
  await typeOtp(page, code);
  await page.locator('#reset-password').fill(password);
  await page.locator('#reset-confirm-password').fill(confirm);
  await page.getByRole('button', { name: 'Reset password' }).click();
}

async function canLogIn(request: APIRequestContext, acct: { email: string }, password: string): Promise<number> {
  return (await request.post('/api/auth/login', { data: { email: acct.email, password } })).status();
}

test('unknown email: the same neutral copy as a real account, one request each', async ({ page }) => {
  const known: ScopedAccount = await createScopedAccount('reset-known');
  const forgots = countRequests(page, 'POST', FORGOT);

  const unknownText = await requestCode(page, runScopedEmail(uniq('reset-nobody')));
  await forgots.expectCount(1);
  await expect(page.getByRole('alert')).toHaveCount(0);

  const knownText = await requestCode(page, known.email);
  await forgots.expectCount(2);
  await expect(page.getByRole('alert')).toHaveCount(0);
  expect(knownText, 'no account enumeration: identical page for known and unknown').toBe(unknownText);
});

test('proof: a failing forgot-password request is NOT the neutral copy', async ({ page }) => {
  // Falsifies the neutral-copy assertion above: the page CAN render something else.
  const fault = await failRequest(page, 'POST', FORGOT, API_ERRORS.serverError);
  await page.goto('/forgot-password', { waitUntil: 'domcontentloaded' });
  await page.locator('#forgot-email').fill(runScopedEmail(uniq('reset-fault')));
  await page.getByRole('button', { name: 'Send reset code' }).click();
  await expect(page.getByRole('alert')).toHaveText("We couldn't send the reset code. Please try again.");
  await expect(page.getByRole('heading', { name: 'Check your email' })).toHaveCount(0);
  await fault.expectHits(1);
});

test('/reset-password with no email in state: recovery copy, nothing sent', async ({ page }) => {
  const resets = countRequests(page, 'POST', RESET);
  await page.goto('/reset-password', { waitUntil: 'domcontentloaded' });
  await expect(page.getByRole('heading', { name: "Let's start fresh" })).toBeVisible({ timeout: 20_000 });
  await expect(page.getByRole('button', { name: 'Request a new code' })).toBeVisible();
  await expect(page.locator('#reset-password')).toHaveCount(0);
  await resets.expectCount(0);
});

test('wrong code: error copy, password unchanged in the DB, old password still logs in', async ({ page, request }) => {
  const acct = await createScopedAccount('reset-wrong');
  const before = authUser(acct.email).encrypted_password;
  const real = await recoveryOtp(acct.email);
  const wrong = real === '000000' ? '111111' : '000000';

  await gotoWithRouterState(page, '/reset-password', { email: acct.email });
  await expect(page.getByRole('heading', { name: 'Reset password' })).toBeVisible({ timeout: 20_000 });
  const resets = countRequests(page, 'POST', RESET);
  const captured = await captureJson(page, 'POST', RESET);
  await submitReset(page, wrong);
  const res = await captured.next();
  expect(res.status).toBe(400);
  expect(res.json.error.code).toBe('INVALID_CODE');

  await expect(page.getByRole('alert')).toHaveText(RESET_FAILED);
  await expect(page.getByRole('heading', { name: 'Password reset' })).toHaveCount(0);
  await resets.expectCount(1);
  expect(authUser(acct.email).encrypted_password).toBe(before);
  expect(await canLogIn(request, acct, acct.password)).toBe(200);
  expect(await canLogIn(request, acct, NEW_PASSWORD)).toBe(401);
});

test('expired (real) recovery code: error copy, password unchanged', async ({ page }) => {
  const acct = await createScopedAccount('reset-expired');
  const before = authUser(acct.email).encrypted_password;
  const code = await recoveryOtp(acct.email);
  expireRecoveryOtp(acct.userId);

  await gotoWithRouterState(page, '/reset-password', { email: acct.email });
  await expect(page.getByRole('heading', { name: 'Reset password' })).toBeVisible({ timeout: 20_000 });
  const resets = countRequests(page, 'POST', RESET);
  const [res] = await Promise.all([
    page.waitForResponse((r) => new URL(r.url()).pathname === RESET),
    submitReset(page, code),
  ]);
  expect(res.status()).toBe(400);
  await expect(page.getByRole('alert')).toHaveText(RESET_FAILED);
  await resets.expectCount(1);
  expect(authUser(acct.email).encrypted_password).toBe(before);
});

test('proof: the SAME flow with a fresh code does change the password (the DB check can see it)', async ({
  page,
  request,
}) => {
  const acct = await createScopedAccount('reset-fresh');
  const before = authUser(acct.email).encrypted_password;
  const code = await recoveryOtp(acct.email);

  await gotoWithRouterState(page, '/reset-password', { email: acct.email });
  await expect(page.getByRole('heading', { name: 'Reset password' })).toBeVisible({ timeout: 20_000 });
  await submitReset(page, code);
  await expect(page.getByRole('heading', { name: 'Password reset' })).toBeVisible({ timeout: 20_000 });
  expect(authUser(acct.email).encrypted_password).not.toBe(before);
  expect(await canLogIn(request, acct, NEW_PASSWORD)).toBe(200);
});

test('mismatched new passwords send no request', async ({ page }) => {
  const email = runScopedEmail(uniq('reset-mismatch'));
  await gotoWithRouterState(page, '/reset-password', { email });
  await expect(page.getByRole('heading', { name: 'Reset password' })).toBeVisible({ timeout: 20_000 });
  const resets = countRequests(page, 'POST', RESET);

  await submitReset(page, '123456', NEW_PASSWORD, `${NEW_PASSWORD}x`);
  await expect(page.getByText("Passwords don't match.")).toBeVisible();
  await expect(page.locator('#reset-confirm-password')).toBeFocused();
  await resets.expectCount(0);
});
