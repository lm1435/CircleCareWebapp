import { test, expect } from '../fixtures';

// Vitals filter controls — NON-DESTRUCTIVE. Type is a ChipSelect
// (`#vitals-type-filter`, a role="radiogroup" of role="radio" chips with
// aria-checked — a11y-audit fix from a role="group" of aria-pressed buttons,
// since only one type is ever selected); range is a MoreMenu pill (a button
// whose accessible name is "Time range: <current selection>", opening a menu
// of range choices). We only drive these read-only filters and assert the
// page keeps rendering without tripping the ErrorBoundary. We never log,
// edit, or delete a vital. The vitals list re-fetches on every filter
// change, so each click exercises a fresh query.

const PAGE_HEADING = 'Vitals';
const ERROR_FALLBACK = 'Something went wrong';

// Chip labels (matches TYPE_FILTERS + vitals:types.* / filter.allTypes in VitalsPage.tsx).
const TYPE_LABELS = [
  'All types',
  'Blood pressure',
  'Heart rate',
  'Glucose',
  'Weight',
  'All types',
];
// Range menu item labels (matches RANGE_CHOICES + vitals:filter.range.* in VitalsPage.tsx).
const RANGE_LABELS = ['Last 7 days', 'Last 30 days', 'Last 90 days', 'Last 30 days'];

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

  for (const label of TYPE_LABELS) {
    const chip = typeFilter.getByRole('radio', { name: label, exact: true });
    await chip.click();
    await expect(chip).toBeChecked();
    await expectHealthyBody(page);
  }
});

test('range filter cycles through options without error', async ({ page, circleId }) => {
  await page.goto(`/circles/${circleId}/vitals`, { waitUntil: 'domcontentloaded' });

  // The range pill's accessible name is "Time range: <current selection>" —
  // dynamic, so the initial lookup matches by prefix.
  const rangeTrigger = page.getByRole('button', { name: /^Time range:/ });
  await expect(rangeTrigger).toBeVisible({ timeout: 20_000 });
  await expectHealthyBody(page);

  for (const label of RANGE_LABELS) {
    await page.getByRole('button', { name: /^Time range:/ }).click();
    const menu = page.getByRole('menu');
    await expect(menu).toBeVisible({ timeout: 10_000 });
    await menu.getByRole('menuitem', { name: label, exact: true }).click();
    await expect(menu).toHaveCount(0, { timeout: 10_000 });
    // The trigger's name updates to reflect the new selection.
    await expect(
      page.getByRole('button', { name: new RegExp(`^Time range: ${label}$`) })
    ).toBeVisible({ timeout: 10_000 });
    await expectHealthyBody(page);
  }
});
