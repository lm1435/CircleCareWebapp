import type { Page } from '@playwright/test';
import { test, expect } from '../../fixtures';
import { runScopedEmail } from '../../isolation';
import { countRequests, generateSignupOtp, holdRequest } from '../../unhappy';
import { authUser, gotoWithRouterState, hasRefreshCookie, stubJson, typeOtp, uniq } from './_helpers';

// VERIFY-EMAIL unhappy paths (src/pages/VerifyEmailPage.tsx, backend
// POST /api/auth/verify-otp + /resend-otp). Codes come from generateSignupOtp
// (admin generate_link: real, unconfirmed user, no mail).

test.use({ storageState: { cookies: [], origins: [] } });

const VERIFY = '/api/auth/verify-otp';
const RESEND = '/api/auth/resend-otp';
const EXCHANGE = '/api/auth/oauth-session';
const INVALID_CODE =
  "That code didn't work. It may have expired — tap Resend Code below to get a fresh one.";

async function expectVerifyPage(page: Page): Promise<void> {
  await expect(page.getByRole('heading', { name: 'Verify your email' })).toBeVisible({ timeout: 20_000 });
}

test('wrong code: error copy, no session, account stays unconfirmed', async ({ page, context }) => {
  const email = runScopedEmail(uniq('signup-wrongcode'));
  const otp = await generateSignupOtp(email);
  const wrong = otp === '000000' ? '111111' : '000000';

  await gotoWithRouterState(page, '/verify-email', { email });
  await expectVerifyPage(page);
  await expect(page.getByText(`We sent a 6-digit code to ${email}`)).toBeVisible();
  const verifies = countRequests(page, 'POST', VERIFY);
  const exchanges = countRequests(page, 'POST', EXCHANGE);

  const [res] = await Promise.all([
    page.waitForResponse((r) => new URL(r.url()).pathname === VERIFY),
    typeOtp(page, wrong), // auto-submits on the sixth digit (email known from state)
  ]);
  expect(res.status()).toBe(400);

  await expect(page.getByRole('alert')).toHaveText(INVALID_CODE);
  await expect(page).toHaveURL(/\/verify-email$/);
  await verifies.expectCount(1);
  await exchanges.expectCount(0);
  expect(await hasRefreshCookie(context)).toBe(false);
  expect(authUser(email).email_confirmed_at).toBeNull();

  // Falsifies the "no session" checks above on the SAME account: the real code
  // (typed fresh into the same page with the same state) does sign in.
  await gotoWithRouterState(page, '/verify-email', { email });
  await expectVerifyPage(page);
  await typeOtp(page, otp);
  await expect(page).toHaveURL(/\/circles/, { timeout: 20_000 });
  expect(await hasRefreshCookie(context)).toBe(true);
  expect(authUser(email).email_confirmed_at).not.toBeNull();
});

test('correct code (real endpoint): exchanged once, signed in, lands on /circles', async ({ page, context }) => {
  const email = runScopedEmail(uniq('signup-rightcode'));
  const otp = await generateSignupOtp(email);

  await gotoWithRouterState(page, '/verify-email', { email });
  await expectVerifyPage(page);
  const verifies = countRequests(page, 'POST', VERIFY);
  const exchanges = countRequests(page, 'POST', EXCHANGE);

  await typeOtp(page, otp);
  await expect(page).toHaveURL(/\/circles$/, { timeout: 20_000 });
  await expect(page.getByRole('button', { name: 'Join with an invite code' })).toBeVisible({ timeout: 20_000 });
  await verifies.expectCount(1);
  await exchanges.expectCount(1);
  expect(await hasRefreshCookie(context)).toBe(true);
  expect(authUser(email).email_confirmed_at).not.toBeNull();
});

test('resend is guarded (same-task double click → 1 request) and shows the cooldown', async ({ page }) => {
  const email = runScopedEmail(uniq('signup-resend'));
  await generateSignupOtp(email);

  await gotoWithRouterState(page, '/verify-email', { email });
  await expectVerifyPage(page);
  // Stubbed success: a real resend right after generate_link hits GoTrue's
  // 60s per-address cooldown (429 EMAIL_RATE_LIMIT), and would send mail.
  // Registration order matters: Playwright runs the LAST-registered route
  // first, so the hold goes on top and falls back to the stub on release.
  await stubJson(page, 'POST', RESEND, {
    body: { success: true, data: { message: 'Verification code sent. Please check your email.' } },
  });
  const hold = await holdRequest(page, 'POST', RESEND);
  const resends = countRequests(page, 'POST', RESEND);

  const resend = page.getByRole('button', { name: 'Resend Code' });
  await resend.evaluate((b: HTMLButtonElement) => {
    b.click();
    b.click();
  });
  await hold.waitForHeld();
  await expect(resend).toBeDisabled();
  await resend.click({ force: true });
  await hold.release();

  await expect(page.getByRole('status')).toHaveText('A new verification code has been sent to your email.');
  const cooldown = page.getByRole('button', { name: /^Resend in \d+s$/ });
  await expect(cooldown).toBeVisible();
  await expect(cooldown).toBeDisabled();
  await resends.expectCount(1);
});

test('resend failure (real 429 EMAIL_RATE_LIMIT) shows the resend error, no cooldown', async ({ page }) => {
  const email = runScopedEmail(uniq('signup-resend429'));
  await generateSignupOtp(email); // starts GoTrue's per-address send cooldown

  await gotoWithRouterState(page, '/verify-email', { email });
  await expectVerifyPage(page);
  const resends = countRequests(page, 'POST', RESEND);
  const [res] = await Promise.all([
    page.waitForResponse((r) => new URL(r.url()).pathname === RESEND),
    page.getByRole('button', { name: 'Resend Code' }).click(),
  ]);
  expect(res.status()).toBe(429);
  await expect(page.getByRole('alert')).toHaveText("We couldn't resend the code. Please try again.");
  await expect(page.getByRole('button', { name: 'Resend Code' })).toBeEnabled();
  await resends.expectCount(1);
});

test('direct visit with no router state: no crash, asks for the email, sends nothing until valid', async ({
  page,
}) => {
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  const verifies = countRequests(page, 'POST', VERIFY);

  await page.goto('/verify-email', { waitUntil: 'domcontentloaded' });
  await expectVerifyPage(page);
  await expect(
    page.getByText('Enter the email you signed up with and the 6-digit code we sent you')
  ).toBeVisible();
  const emailField = page.locator('#verify-email');
  await expect(emailField).toBeVisible();

  await page.getByRole('button', { name: 'Verify email' }).click();
  await expect(page.getByRole('alert')).toHaveText('Email is required.');
  await emailField.fill(runScopedEmail(uniq('signup-nostate')));
  await page.getByRole('button', { name: 'Verify email' }).click();
  await expect(page.getByRole('alert')).toHaveText('Please enter the complete verification code.');

  await expect(page).toHaveURL(/\/verify-email$/);
  await verifies.expectCount(0);
  expect(errors, 'no uncaught page errors').toEqual([]);
});
