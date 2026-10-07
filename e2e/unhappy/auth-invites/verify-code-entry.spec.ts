import type { Page } from '@playwright/test';
import { test, expect } from '../../fixtures';
import { runScopedEmail } from '../../isolation';
import { checkA11y } from '../../helpers';
import { countRequests, generateSignupOtp } from '../../unhappy';
import { authUser, hasRefreshCookie, stubJson, typeOtp, uniq } from './_helpers';

// "HAVE A VERIFICATION CODE?" — the way back to an unentered email code
// (src/pages/VerifyRequestPage.tsx; mobile twin: .maestro/parity/auth/verify-code-entry*.yaml).
// Codes come from generateSignupOtp (admin generate_link: a REAL unconfirmed user,
// no mail). That call also opens GoTrue's per-address send cooldown, so a real
// POST /resend-otp for the same address answers 429 EMAIL_RATE_LIMIT — the
// deterministic "we just sent one" path. A successful resend needs the (unreachable
// locally) send-email hook, so that one answer is stubbed, like verify-email.spec.ts.

test.use({ storageState: { cookies: [], origins: [] } });

const RESEND = '/api/auth/resend-otp';
const LINK = 'Have a verification code?';
const NEUTRAL = "If that email has an account waiting for verification, we've sent a new code.";
const JUST_SENT =
  'We just sent one — check your inbox (and spam). You can request another in a minute.';

async function openLogin(page: Page): Promise<void> {
  await page.goto('/login', { waitUntil: 'domcontentloaded' });
  await expect(page.getByRole('heading', { name: 'Welcome back' })).toBeVisible({ timeout: 20_000 });
}

test('Sign in link -> email step (prefilled) -> real 429 "we just sent one" -> code screen -> verified into the app', async ({
  page,
  context,
}) => {
  const email = runScopedEmail(uniq('verify-entry'));
  const otp = await generateSignupOtp(email);

  await openLogin(page);
  await page.locator('#login-email').fill(email);
  const link = page.getByRole('link', { name: LINK });
  await expect(link).toBeVisible();
  await link.click();

  await expect(page).toHaveURL(/\/verify-email\/start$/);
  await expect(page.getByRole('heading', { name: 'Finish verifying your email' })).toBeVisible();
  // Address carried over from Login (router state, never the URL).
  await expect(page.locator('#verify-request-email')).toHaveValue(email);
  expect(page.url()).not.toContain(encodeURIComponent(email));

  const resends = countRequests(page, 'POST', RESEND);
  const [res] = await Promise.all([
    page.waitForResponse((r) => new URL(r.url()).pathname === RESEND),
    page.getByRole('button', { name: 'Send a new code' }).click(),
  ]);
  expect(res.status()).toBe(429);
  await resends.expectCount(1);

  // Code screen, address carried over, "just sent" notice + hint + visible cooldown.
  await expect(page).toHaveURL(/\/verify-email$/);
  await expect(page.getByText(`We sent a 6-digit code to ${email}`)).toBeVisible();
  await expect(page.getByRole('status')).toHaveText(JUST_SENT);
  await expect(page.getByText('Codes expire — use the newest email.')).toBeVisible();
  await expect(page.getByRole('button', { name: /^Send a new code in \d+s$/ })).toBeDisabled();

  // Falsifier of the carry-over: the real code verifies THIS account and the user
  // lands exactly where signup would put them.
  expect(authUser(email).email_confirmed_at).toBeNull();
  await typeOtp(page, otp);
  await expect(page).toHaveURL(/\/circles/, { timeout: 20_000 });
  expect(await hasRefreshCookie(context)).toBe(true);
  expect(authUser(email).email_confirmed_at).not.toBeNull();
});

test('success answer (stubbed 200): neutral copy on the code screen, cooldown armed; unknown address gets the same page', async ({
  page,
}) => {
  await stubJson(page, 'POST', RESEND, {
    body: { success: true, data: { message: 'Verification code sent. Please check your email.' } },
  });
  for (const email of [runScopedEmail(uniq('verify-known')), runScopedEmail(uniq('verify-nobody'))]) {
    await page.goto('/verify-email/start', { waitUntil: 'domcontentloaded' });
    await page.locator('#verify-request-email').fill(email);
    await page.getByRole('button', { name: 'Send a new code' }).click();
    await expect(page).toHaveURL(/\/verify-email$/);
    await expect(page.getByRole('status')).toHaveText(NEUTRAL);
    await expect(page.getByRole('button', { name: /^Send a new code in \d+s$/ })).toBeDisabled();
  }
});

test('validation: empty and invalid address send nothing; a failure is retryable', async ({ page }) => {
  await page.goto('/verify-email/start', { waitUntil: 'domcontentloaded' });
  const resends = countRequests(page, 'POST', RESEND);
  const send = page.getByRole('button', { name: 'Send a new code' });

  await send.click();
  await expect(page.locator('#verify-request-email')).toHaveAccessibleDescription(/Email is required/);
  await page.locator('#verify-request-email').fill('nope');
  await send.click();
  await expect(page.getByText('Please enter a valid email address.')).toBeVisible();
  await resends.expectCount(0);

  await stubJson(page, 'POST', RESEND, {
    status: 400,
    body: { success: false, error: { code: 'RESEND_FAILED', message: 'Unable to resend' } },
  });
  await page.locator('#verify-request-email').fill(runScopedEmail(uniq('verify-fail')));
  await send.click();
  await expect(page.getByRole('alert')).toHaveText("We couldn't send a code. Please try again.");
  await expect(page).toHaveURL(/\/verify-email\/start$/);
  await expect(send).toBeEnabled();
});

test('keyboard + axe: link is reachable by Tab, activates with Enter; both pages pass axe', async ({
  page,
}, testInfo) => {
  await openLogin(page);
  await checkA11y(page, '/login', testInfo, { wcag22: true });

  const link = page.getByRole('link', { name: LINK });
  const box = await link.boundingBox();
  expect(box?.height ?? 0, '44px target').toBeGreaterThanOrEqual(44);
  await link.focus();
  await expect(link).toBeFocused();
  await page.keyboard.press('Enter');
  await expect(page).toHaveURL(/\/verify-email\/start$/);
  await checkA11y(page, '/verify-email/start', testInfo, { wcag22: true });

  // Focus order: back control, email field, send button.
  await page.locator('#verify-request-email').focus();
  await page.keyboard.press('Tab');
  await expect(page.getByRole('button', { name: 'Send a new code' })).toBeFocused();
});

test.describe('Spanish', () => {
  test.use({ locale: 'es' });

  test('Spanish: link, email step and notices are Latin American Spanish', async ({ page }) => {
    await page.route('**/api/auth/resend-otp', (route) =>
      route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ success: true, data: {} }) })
    );
    await page.goto('/login', { waitUntil: 'domcontentloaded' });
    await page.getByRole('link', { name: '¿Tienes un código de verificación?' }).click();
    await expect(page.getByRole('heading', { name: 'Termina de verificar tu correo' })).toBeVisible();
    await page.locator('#verify-request-email').fill(runScopedEmail(uniq('verify-es')));
    await page.getByRole('button', { name: 'Enviar un código nuevo' }).click();
    await expect(page.getByRole('status')).toHaveText(
      'Si ese correo tiene una cuenta pendiente de verificación, enviamos un código nuevo.'
    );
    await expect(page.getByText('Los códigos caducan: usa el correo más reciente.')).toBeVisible();
  });

});
