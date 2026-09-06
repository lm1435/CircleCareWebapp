import { test, expect } from '../fixtures';

// Auth flows: logging out from the account menu, and the bad-credentials error
// path. (The happy-path login is exercised by auth.setup.ts.)

test('log out from the account menu returns to /login', async ({ page, circleId }) => {
  // Stub the logout endpoint. The backend revoke is now scoped 'local' (it no
  // longer nukes every device — see backend auth.ts /logout), but 'local' still
  // revokes THIS session's refresh token, and every worker in this suite shares
  // one storageState. A real logout here would still cascade the others to
  // /login. We only want to verify the CLIENT logout path (menu → redirect to
  // /login + local state cleared); the server-side revoke and its scope are
  // covered by backend tests. Stubbing keeps the shared session alive.
  await page.route('**/auth/logout', (route) =>
    route.fulfill({ status: 200, contentType: 'application/json', body: '{"success":true}' })
  );

  await page.goto(`/circles/${circleId}/calendar`, { waitUntil: 'domcontentloaded' });
  await expect(page.getByRole('grid')).toBeVisible({ timeout: 15_000 });

  await page.getByRole('button', { name: 'Account' }).click();
  await page.getByRole('menuitem', { name: 'Sign out' }).click();

  // Signing out asks first (spec §5.6) — confirm the dialog.
  const confirm = page.getByRole('dialog');
  await expect(confirm).toBeVisible({ timeout: 10_000 });
  await confirm.getByRole('button', { name: 'Sign out', exact: true }).click();

  await expect(page).toHaveURL(/\/login/, { timeout: 20_000 });
});

test.describe('invalid login', () => {
  // This path must run logged OUT — drop the stored session for these tests.
  test.use({ storageState: { cookies: [], origins: [] } });

  test('shows an error and stays on /login for bad credentials', async ({ page }) => {
    await page.goto('/login', { waitUntil: 'domcontentloaded' });

    await page.locator('#login-email').fill('nobody@circlecare.test');
    await page.locator('#login-password').fill('definitely-the-wrong-password');
    await page.getByRole('button', { name: /sign in/i }).click();

    // The form surfaces the failure in a role="alert" and does not navigate away.
    await expect(page.getByRole('alert')).toBeVisible({ timeout: 20_000 });
    await expect(page).toHaveURL(/\/login/);
  });
});
