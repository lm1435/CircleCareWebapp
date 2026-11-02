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

// Mobile 1.4.0 (8) bug: a Today tile, then the iOS edge swipe, landed on the circle list instead of
// Today. The web twin of that question: from every Quick access tile and quiet link, the BROWSER
// Back returns to Today (each is a history PUSH, and no destination REPLACES its way off Today:
// a redirect with `replace` on arrival would make Back skip Today).
test('browser Back from every Quick access tile and link returns to Today', async ({ page, circleId }) => {
  const today = new RegExp(`/circles/${circleId}/?(?:[?#]|$)`);
  const entries: Array<{ name: RegExp; inGrid: boolean; path: string }> = [
    { name: /^Notes/, inGrid: true, path: 'notes' },
    { name: /^Tasks/, inGrid: true, path: 'tasks' },
    { name: /^Calendar/, inGrid: true, path: 'calendar' },
    { name: /^Meds/, inGrid: true, path: 'meds' },
    { name: /^Shifts$/, inGrid: false, path: 'calendar' },
    { name: /^Vitals$/, inGrid: false, path: 'vitals' },
    { name: /^Health info$/, inGrid: false, path: 'emergency' },
    { name: /^Activity$/, inGrid: false, path: 'activity' },
  ];
  for (const entry of entries) {
    await page.goto(`/circles/${circleId}`, { waitUntil: 'domcontentloaded' });
    const grid = page.getByTestId('quick-access-grid');
    await expect(grid).toBeVisible({ timeout: NAV_TIMEOUT });
    const scope = entry.inGrid ? grid : page.getByRole('region', { name: 'Quick access' });
    const link = scope.getByRole('link', { name: entry.name });
    // Shifts shows only where shifts exist for the viewer.
    if (!entry.inGrid && (await link.count()) === 0) continue;
    await link.first().click();
    await expect(page).toHaveURL(new RegExp(`/circles/${circleId}/${entry.path}(?:[/?#]|$)`), {
      timeout: NAV_TIMEOUT,
    });
    await expect(page.getByRole('heading', { level: 1 }).first()).toBeVisible({ timeout: NAV_TIMEOUT });
    await page.goBack();
    await expect(page, `Back from ${entry.path} lands on Today`).toHaveURL(today, { timeout: NAV_TIMEOUT });
    await expect(page.getByTestId('quick-access-grid')).toBeVisible({ timeout: NAV_TIMEOUT });
  }
});
