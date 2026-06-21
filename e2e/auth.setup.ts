import { test as setup, expect } from '@playwright/test';
import fs from 'node:fs';
import path from 'node:path';

// Authenticate once via the real login UI and persist the session for the
// authenticated test projects to reuse.
//
// CircleCare web uses cookie-mode auth: the backend sets an httpOnly refresh
// cookie and the SPA holds the access token only in memory. Playwright's
// storageState captures that refresh cookie, and the app re-bootstraps an
// access token from it on every fresh page load — so saving storageState is
// enough to stay logged in across tests without re-typing credentials.

const AUTH_FILE = 'e2e/.auth/user.json';

const DEMO_EMAIL = process.env.PW_DEMO_EMAIL ?? 'demo@circlecare.app';
const DEMO_PASSWORD = process.env.PW_DEMO_PASSWORD ?? 'DemoPass123!';

setup('authenticate as demo account', async ({ page }) => {
  await page.goto('/login');

  await page.locator('#login-email').fill(DEMO_EMAIL);
  await page.locator('#login-password').fill(DEMO_PASSWORD);
  await page.getByRole('button', { name: /sign in/i }).click();

  // A successful login lands on the circle picker (or a circle, if one is
  // remembered). Either way we leave /login and reach an authed route.
  await page.waitForURL((url) => !url.pathname.startsWith('/login'), { timeout: 20_000 });
  await expect(page).not.toHaveURL(/\/login/);

  fs.mkdirSync(path.dirname(AUTH_FILE), { recursive: true });
  await page.context().storageState({ path: AUTH_FILE });
});
