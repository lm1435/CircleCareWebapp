import { test, expect } from '../fixtures';

// Calendar secondary-controls flow (READ-ONLY): exercises the week/month view
// toggle and the prev / next / today navigation, asserting the heading range
// label responds and that no action trips the ErrorBoundary fallback. This spec
// creates/edits/deletes NOTHING — it only drives view + navigation controls.

const ERROR_FALLBACK = 'Something went wrong';

// The page renders either the calendar grid (events present) or the
// "No events this week/month" empty-state card. Both mean the calendar mounted
// without error — the only failure we care about is the ErrorBoundary fallback.
async function expectNoErrorFallback(page: import('@playwright/test').Page): Promise<void> {
  await expect(page.getByText(ERROR_FALLBACK)).toHaveCount(0);
}

// Wait for the calendar body to settle: grid (has events) OR empty-state card.
async function waitForCalendarBody(page: import('@playwright/test').Page): Promise<void> {
  const grid = page.getByRole('grid');
  const empty = page.getByText(/No events this (week|month)/);
  await expect(grid.or(empty).first()).toBeVisible({ timeout: 20_000 });
}

test('week navigation: prev / next / today', async ({ page, circleId }) => {
  await page.goto(`/circles/${circleId}/calendar`, { waitUntil: 'domcontentloaded' });
  await waitForCalendarBody(page);
  await expectNoErrorFallback(page);

  // The range heading is the page's <h1> (e.g. "Jun 7 – Jun 13, 2026").
  const heading = page.getByRole('heading', { level: 1 });
  await expect(heading).toBeVisible({ timeout: 15_000 });
  const original = (await heading.textContent())?.trim() ?? '';
  expect(original.length).toBeGreaterThan(0);

  // --- Next ---
  await page.getByRole('button', { name: 'Next week' }).click();
  await waitForCalendarBody(page);
  await expect(heading).not.toHaveText(original, { timeout: 15_000 });
  await expectNoErrorFallback(page);
  const afterNext = (await heading.textContent())?.trim() ?? '';

  // --- Prev (returns to the original week) ---
  await page.getByRole('button', { name: 'Previous week' }).click();
  await waitForCalendarBody(page);
  await expect(heading).toHaveText(original, { timeout: 15_000 });
  expect(afterNext).not.toBe(original);
  await expectNoErrorFallback(page);

  // --- Next then Today (Today snaps back to the current week) ---
  await page.getByRole('button', { name: 'Next week' }).click();
  await waitForCalendarBody(page);
  await expect(heading).not.toHaveText(original, { timeout: 15_000 });

  await page.getByRole('button', { name: 'Today' }).click();
  await waitForCalendarBody(page);
  await expect(heading).toHaveText(original, { timeout: 15_000 });
  await expectNoErrorFallback(page);
});

test('week ↔ month toggle', async ({ page, circleId }) => {
  await page.goto(`/circles/${circleId}/calendar`, { waitUntil: 'domcontentloaded' });
  await waitForCalendarBody(page);
  await expectNoErrorFallback(page);

  const viewGroup = page.getByRole('group', { name: 'Calendar view' });
  const weekBtn = viewGroup.getByRole('button', { name: 'Week' });
  const monthBtn = viewGroup.getByRole('button', { name: 'Month' });

  // Default view is Week.
  await expect(weekBtn).toHaveAttribute('aria-pressed', 'true', { timeout: 15_000 });

  // --- Switch to Month ---
  await monthBtn.click();
  await expect(monthBtn).toHaveAttribute('aria-pressed', 'true', { timeout: 15_000 });
  await expect(weekBtn).toHaveAttribute('aria-pressed', 'false');
  await waitForCalendarBody(page);
  await expectNoErrorFallback(page);
  // Month view either shows the month grid or the month empty-state copy.
  const monthGrid = page.getByRole('grid', { name: 'Month view calendar' });
  const monthEmpty = page.getByText('No events this month');
  await expect(monthGrid.or(monthEmpty).first()).toBeVisible({ timeout: 20_000 });

  // --- Switch back to Week ---
  await weekBtn.click();
  await expect(weekBtn).toHaveAttribute('aria-pressed', 'true', { timeout: 15_000 });
  await expect(monthBtn).toHaveAttribute('aria-pressed', 'false');
  await waitForCalendarBody(page);
  await expectNoErrorFallback(page);
  const weekGrid = page.getByRole('grid', { name: 'Week view calendar' });
  const weekEmpty = page.getByText('No events this week');
  await expect(weekGrid.or(weekEmpty).first()).toBeVisible({ timeout: 20_000 });
});
