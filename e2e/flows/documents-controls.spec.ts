import { test, expect } from '../fixtures';

// Documents page control flow: cycle through the CategoryFilter chips and assert
// the list region re-renders cleanly each time. NON-DESTRUCTIVE — only the
// category filter is exercised; no upload / rename / delete happens here.
//
// The CategoryFilter is a `role="group"` of toggle buttons (aria-pressed),
// labelled by the i18n category names. After each selection we assert:
//   - the page heading stays visible (no crash / blank page),
//   - the selected chip reports aria-pressed="true",
//   - the list region shows either a document list OR an empty-state message,
//   - the ErrorBoundary fallback "Something went wrong" is absent.

const CATEGORY_LABELS = [
  'All',
  'Medical Records',
  'Insurance',
  'Legal',
  'Prescriptions',
  'Other',
] as const;

test('category filter', async ({ page, circleId }) => {
  await page.goto(`/circles/${circleId}/documents`, { waitUntil: 'domcontentloaded' });

  // Page shell + heading render.
  const heading = page.getByRole('heading', { name: 'Documents', exact: true });
  await expect(heading).toBeVisible({ timeout: 20_000 });

  // The filter chip group is present.
  const filterGroup = page.getByRole('group', { name: 'Filter by category' });
  await expect(filterGroup).toBeVisible({ timeout: 20_000 });

  for (const label of CATEGORY_LABELS) {
    const chip = filterGroup.getByRole('button', { name: label, exact: true });
    await expect(chip).toBeVisible({ timeout: 15_000 });
    await chip.click();

    // Selected chip is reflected as active via aria-pressed.
    await expect(chip).toHaveAttribute('aria-pressed', 'true', { timeout: 15_000 });

    // Heading survives the re-render (no white-screen crash).
    await expect(heading).toBeVisible({ timeout: 15_000 });

    // The list region settles into one of the valid resolved states: a document
    // list, the "no documents" empty state, or the per-category empty state.
    // Loading skeletons are transient — wait them out via one of these.
    const documentList = page.locator('ul.list-none li').first();
    const emptyAll = page.getByText('No documents yet', { exact: true });
    const emptyCategory = page.getByText('No documents in this category', { exact: true });
    const loadError = page.getByText("We couldn't load the documents.", { exact: true });

    await expect
      .poll(
        async () =>
          (await documentList.count()) > 0 ||
          (await emptyAll.count()) > 0 ||
          (await emptyCategory.count()) > 0 ||
          (await loadError.count()) > 0,
        { timeout: 15_000 }
      )
      .toBe(true);

    // The ErrorBoundary fallback must never appear.
    await expect(page.getByText('Something went wrong', { exact: false })).toHaveCount(0);
  }
});
