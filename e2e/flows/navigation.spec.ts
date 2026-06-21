import { test, expect } from '../fixtures';
import type { Page } from '@playwright/test';

// Navigation click-through: exercise every primary navigation control by actually
// CLICKING it (never deep-linking via goto) and assert each one navigates to the
// expected URL and renders its page without tripping the ErrorBoundary fallback.
// Strictly non-destructive — this spec only navigates and asserts. It never logs
// out (that revokes the shared demo session) and never mutates data.

const NAV_TIMEOUT = 20_000;

// The ErrorBoundary renders role="alert" with this exact text from
// common.json → errorBoundary.title. Its absence proves the page rendered.
async function expectNoErrorBoundary(page: Page): Promise<void> {
  await expect(page.getByText('Something went wrong')).toHaveCount(0);
}

test('sidebar links navigate', async ({ page, circleId }) => {
  await page.goto(`/circles/${circleId}/calendar`, { waitUntil: 'domcontentloaded' });
  // Wait for the calendar grid so the desktop sidebar is mounted and stable.
  await expect(page.getByRole('grid')).toBeVisible({ timeout: NAV_TIMEOUT });

  const base = `/circles/${circleId}`;

  // The desktop sidebar lives in a complementary <aside>; scope link lookups to
  // it so we don't match same-named links elsewhere (e.g. circle switcher).
  const sidebar = page.locator('aside').first();

  // Home is the index route (no segment), so it's checked on its own first.
  await sidebar.getByRole('link', { name: 'Home' }).click();
  await expect(page).toHaveURL(new RegExp(`${base}(?:[?#]|$)`), { timeout: NAV_TIMEOUT });
  await expect(page.getByRole('heading', { level: 1 }).first()).toBeVisible({
    timeout: NAV_TIMEOUT,
  });
  await expectNoErrorBoundary(page);

  // name → expected route segment. Order mirrors the sidebar top-to-bottom.
  const links: Array<{ name: string; segment: string }> = [
    { name: 'Calendar', segment: 'calendar' },
    { name: 'Tasks', segment: 'tasks' },
    { name: 'Activity', segment: 'activity' },
    { name: 'Emergency Info', segment: 'emergency' },
    { name: 'Documents', segment: 'documents' },
    { name: 'Vitals', segment: 'vitals' },
    { name: 'Members', segment: 'members' },
    { name: 'Circle Settings', segment: 'settings' },
  ];

  for (const { name, segment } of links) {
    await sidebar.getByRole('link', { name }).click();
    await expect(page).toHaveURL(new RegExp(`${base}/${segment}(?:[/?#]|$)`), {
      timeout: NAV_TIMEOUT,
    });
    // Every circle-scoped page renders a top-level <h1>; assert it appears so we
    // know the route's content mounted, not just the URL changed.
    await expect(page.getByRole('heading', { level: 1 }).first()).toBeVisible({
      timeout: NAV_TIMEOUT,
    });
    await expectNoErrorBoundary(page);
  }
});

test('header menus navigate', async ({ page, circleId }) => {
  const base = `/circles/${circleId}`;

  await page.goto(`${base}/calendar`, { waitUntil: 'domcontentloaded' });
  await expect(page.getByRole('grid')).toBeVisible({ timeout: NAV_TIMEOUT });

  // --- Account menu → Profile ---
  await page.getByRole('button', { name: 'Account' }).click();
  await page.getByRole('menuitem', { name: 'Profile' }).click();
  await expect(page).toHaveURL(/\/profile(?:[/?#]|$)/, { timeout: NAV_TIMEOUT });
  await expect(page.getByRole('heading', { level: 1 }).first()).toBeVisible({
    timeout: NAV_TIMEOUT,
  });
  await expectNoErrorBoundary(page);

  // --- Back to a circle page, then Account menu → Help ---
  await page.goto(`${base}/calendar`, { waitUntil: 'domcontentloaded' });
  await expect(page.getByRole('grid')).toBeVisible({ timeout: NAV_TIMEOUT });

  await page.getByRole('button', { name: 'Account' }).click();
  await page.getByRole('menuitem', { name: 'Help & FAQ' }).click();
  await expect(page).toHaveURL(/\/help(?:[/?#]|$)/, { timeout: NAV_TIMEOUT });
  await expect(page.getByRole('heading', { level: 1 }).first()).toBeVisible({
    timeout: NAV_TIMEOUT,
  });
  await expectNoErrorBoundary(page);

  // --- Circle switcher menu → My Circles ---
  await page.goto(`${base}/calendar`, { waitUntil: 'domcontentloaded' });
  await expect(page.getByRole('grid')).toBeVisible({ timeout: NAV_TIMEOUT });

  // The switcher button's aria-label is "Switch circle" (possibly suffixed with
  // ": <circle name>"), so match by prefix.
  await page.getByRole('button', { name: /^Switch circle/ }).click();
  await page.getByRole('menuitem', { name: 'My Circles' }).click();
  await expect(page).toHaveURL(/\/circles(?:[/?#]|$)/, { timeout: NAV_TIMEOUT });
  await expect(page.getByRole('heading', { level: 1 }).first()).toBeVisible({
    timeout: NAV_TIMEOUT,
  });
  await expectNoErrorBoundary(page);
});
