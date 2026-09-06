import { test, expect } from '../fixtures';

// The circle root (`/circles/:id`) now lands on the Overview — the circle's
// "home" surface (mirrors mobile's home tab), not the calendar. Non-destructive:
// this spec only navigates and asserts.

const NAV_TIMEOUT = 20_000;

test('circle root lands on the overview with at-a-glance cards', async ({ page, circleId }) => {
  await page.goto(`/circles/${circleId}`, { waitUntil: 'domcontentloaded' });

  // Hero — the recipient name renders as the page's <h1> (components/overview/Hero.tsx).
  // The DOB eyebrow above it is conditional on the recipient having a DOB on
  // file, so it isn't a reliable "the hero rendered" signal on its own.
  await expect(page.getByRole('heading', { level: 1 }).first()).toBeVisible({
    timeout: NAV_TIMEOUT,
  });

  // At-a-glance cards. There is no "Recent activity" card any more — mobile's
  // home has no activity list, and the feed is one Quick Access row instead
  // (components/overview/QuickAccess.tsx).
  await expect(page.getByRole('heading', { name: 'Quick access' })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Open tasks' })).toBeVisible();
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
