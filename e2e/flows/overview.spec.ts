import { test, expect } from '../fixtures';

// The circle root (`/circles/:id`) now lands on the Overview — the circle's
// "home" surface (mirrors mobile's home tab), not the calendar. Non-destructive:
// this spec only navigates and asserts.

const NAV_TIMEOUT = 20_000;

test('circle root lands on the overview with at-a-glance cards', async ({ page, circleId }) => {
  await page.goto(`/circles/${circleId}`, { waitUntil: 'domcontentloaded' });

  // Hero — the eyebrow renders regardless of setup/loading state.
  await expect(page.getByText('Care home')).toBeVisible({ timeout: NAV_TIMEOUT });
  await expect(page.getByRole('heading', { level: 1 }).first()).toBeVisible({
    timeout: NAV_TIMEOUT,
  });

  // At-a-glance cards.
  await expect(page.getByRole('heading', { name: 'Open tasks' })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Recent activity' })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Care team' })).toBeVisible();

  // No ErrorBoundary fallback.
  await expect(page.getByText('Something went wrong')).toHaveCount(0);
});

test('overview cards drill into their full sections', async ({ page, circleId }) => {
  await page.goto(`/circles/${circleId}`, { waitUntil: 'domcontentloaded' });
  await expect(page.getByRole('heading', { name: 'Open tasks' })).toBeVisible({
    timeout: NAV_TIMEOUT,
  });

  await page.getByRole('link', { name: 'View all tasks' }).click();
  await expect(page).toHaveURL(new RegExp(`/circles/${circleId}/tasks(?:[/?#]|$)`), {
    timeout: NAV_TIMEOUT,
  });
  await expect(page.getByRole('heading', { level: 1 }).first()).toBeVisible({
    timeout: NAV_TIMEOUT,
  });
});
