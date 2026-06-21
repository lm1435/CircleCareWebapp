import { test, expect } from '../fixtures';

// Mobile-only nav. Below the lg breakpoint the sidebar collapses into a
// hamburger drawer, so the desktop navigation.spec (which clicks the
// always-visible sidebar) doesn't apply. This verifies the mobile chrome:
// the hamburger opens the drawer and its links navigate + close it.
// Runs under the `mobile-chrome` (Pixel 5) Playwright project.

test('hamburger drawer opens and a nav link navigates + closes it', async ({ page, circleId }) => {
  await page.goto(`/circles/${circleId}/calendar`, { waitUntil: 'domcontentloaded' });
  await expect(page.getByRole('grid')).toBeVisible({ timeout: 15_000 });

  // Open the drawer (the hamburger only shows at mobile widths).
  await page.getByRole('button', { name: 'Navigation menu' }).click();
  const drawer = page.getByRole('dialog');
  await expect(drawer).toBeVisible({ timeout: 10_000 });

  // A nav link inside the drawer navigates and closes the drawer.
  await drawer.getByRole('link', { name: 'Tasks' }).click();
  await expect(page).toHaveURL(new RegExp(`/circles/${circleId}/tasks`), { timeout: 20_000 });
  await expect(page.getByRole('dialog')).toBeHidden({ timeout: 10_000 });
  await expect(page.getByRole('heading', { name: 'Tasks' })).toBeVisible({ timeout: 15_000 });
});
