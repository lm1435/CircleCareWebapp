import { test, expect } from '../fixtures';

// The circle root (`/circles/:id`) lands on TODAY - the circle's landing surface
// (mirrors mobile's Today tab), not the calendar: "Today for {name}", Next up, and
// Quick access. (This file was the Overview spec; the deeper Today flows are in
// today.spec.ts.) Non-destructive: it only navigates and asserts.

const NAV_TIMEOUT = 20_000;

test('circle root lands on Today with Next up and Quick access', async ({ page, circleId }) => {
  await page.goto(`/circles/${circleId}`, { waitUntil: 'domcontentloaded' });

  // Header - "Today for {name}" is the page's <h1> (components/overview/Hero.tsx).
  await expect(page.getByRole('heading', { level: 1 }).first()).toContainText(/^Today/, {
    timeout: NAV_TIMEOUT,
  });

  // The two surfaces that remain: Next up and Quick access (a labelled card of 4 tiles).
  await expect(page.getByRole('region', { name: 'Next up' })).toBeVisible();
  await expect(page.getByTestId('quick-access-grid')).toBeVisible();
  await expect(page.getByRole('region', { name: 'Quick access' })).toBeVisible();

  // What Today no longer carries: the old Overview blocks.
  for (const gone of ['Open tasks', 'Care team', 'Get started', 'Upcoming appointments']) {
    await expect(page.getByRole('heading', { name: gone })).toHaveCount(0);
  }

  // No ErrorBoundary fallback.
  await expect(page.getByText('Something went wrong')).toHaveCount(0);
});

test('Today drills into the full sections through Quick access and "All of today"', async ({ page, circleId }) => {
  await page.goto(`/circles/${circleId}`, { waitUntil: 'domcontentloaded' });
  const grid = page.getByTestId('quick-access-grid');
  await expect(grid).toBeVisible({ timeout: NAV_TIMEOUT });

  await grid.getByRole('link', { name: /^Tasks/ }).click();
  await expect(page).toHaveURL(new RegExp(`/circles/${circleId}/tasks(?:[/?#]|$)`), {
    timeout: NAV_TIMEOUT,
  });
  await expect(page.getByRole('heading', { level: 1 }).first()).toBeVisible({
    timeout: NAV_TIMEOUT,
  });

  await page.goBack();
  await expect(page.getByRole('region', { name: 'Next up' })).toBeVisible({ timeout: NAV_TIMEOUT });
  await page.getByRole('link', { name: /^All of today/ }).click();
  await expect(page).toHaveURL(new RegExp(`/circles/${circleId}/calendar(?:[/?#]|$)`), {
    timeout: NAV_TIMEOUT,
  });
});
