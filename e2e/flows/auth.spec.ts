import { test, expect } from '../fixtures';

// Auth flows: logging out from the account menu, and the bad-credentials error
// path. (The happy-path login is exercised by auth.setup.ts.)

test('log out from the account menu returns to /login', async ({ page, circleId }) => {
  // Stub the logout endpoint: the real backend does a GLOBAL admin.signOut that
  // revokes ALL of the demo user's refresh tokens — which would break every
  // other test sharing this session. We only want to verify the CLIENT logout
  // path here (menu → redirect to /login + local state cleared); the server-side
  // revoke is covered by backend tests. Stubbing keeps the shared session alive.
  await page.route('**/auth/logout', (route) =>
    route.fulfill({ status: 200, contentType: 'application/json', body: '{"success":true}' })
  );

  await page.goto(`/circles/${circleId}/calendar`, { waitUntil: 'domcontentloaded' });
  await expect(page.getByRole('grid')).toBeVisible({ timeout: 15_000 });

  await page.getByRole('button', { name: 'Account' }).click();
  await page.getByRole('menuitem', { name: 'Log out' }).click();

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
