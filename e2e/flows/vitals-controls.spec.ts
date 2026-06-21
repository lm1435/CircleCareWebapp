import { test, expect } from '../fixtures';

// Vitals filter controls — NON-DESTRUCTIVE. We only drive the read-only filter
// Selects (type + range) and assert the page keeps rendering without tripping the
// ErrorBoundary. We never log, edit, or delete a vital. The vitals list re-fetches
// on every filter change, so each selectOption exercises a fresh query.

const PAGE_HEADING = 'Vitals';
const ERROR_FALLBACK = 'Something went wrong';

// Type filter <select> values (matches TYPE_FILTERS in VitalsPage.tsx).
const TYPE_VALUES = ['all', 'blood_pressure', 'heart_rate', 'glucose', 'weight', 'all'];
// Range filter <select> values (matches RANGE_CHOICES in VitalsPage.tsx).
const RANGE_VALUES = ['7d', '30d', '90d', '30d'];

// The body is one of: a grouped list (<ul>) of readings, or the empty-state copy
// ("No readings yet"). Either proves the page rendered a non-error result.
async function expectHealthyBody(page: import('@playwright/test').Page): Promise<void> {
  // ErrorBoundary must not have replaced the page.
  await expect(page.getByText(ERROR_FALLBACK)).toHaveCount(0);
  // Heading stays mounted.
  await expect(page.getByRole('heading', { name: PAGE_HEADING, level: 1 })).toBeVisible({
    timeout: 15_000,
  });
  // A readings list OR the empty-state message is present.
  const list = page.locator('ul.list-none');
  const emptyState = page.getByText('No readings yet');
  await expect(async () => {
    const listCount = await list.count();
    const emptyVisible = await emptyState.isVisible().catch(() => false);
    expect(listCount > 0 || emptyVisible).toBe(true);
  }).toPass({ timeout: 15_000 });
}

test('type filter cycles through options without error', async ({ page, circleId }) => {
  await page.goto(`/circles/${circleId}/vitals`, { waitUntil: 'domcontentloaded' });

  const typeFilter = page.locator('#vitals-type-filter');
  await expect(typeFilter).toBeVisible({ timeout: 20_000 });
  await expectHealthyBody(page);

  for (const value of TYPE_VALUES) {
    await typeFilter.selectOption(value);
    await expect(typeFilter).toHaveValue(value, { timeout: 15_000 });
    await expectHealthyBody(page);
  }
});

test('range filter cycles through options without error', async ({ page, circleId }) => {
  await page.goto(`/circles/${circleId}/vitals`, { waitUntil: 'domcontentloaded' });

  const rangeFilter = page.locator('#vitals-range-filter');
  await expect(rangeFilter).toBeVisible({ timeout: 20_000 });
  await expectHealthyBody(page);

  for (const value of RANGE_VALUES) {
    await rangeFilter.selectOption(value);
    await expect(rangeFilter).toHaveValue(value, { timeout: 15_000 });
    await expectHealthyBody(page);
  }
});
