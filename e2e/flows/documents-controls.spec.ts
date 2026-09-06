import { test, expect } from '../fixtures';

// Documents page control flow: cycle through the CategoryFilter chips and assert
// the list region re-renders cleanly each time. NON-DESTRUCTIVE — only the
// category filter is exercised; no upload / rename / delete happens here.
//
// The CategoryFilter is a `role="radiogroup"` of `role="radio"` chips
// (aria-checked) — a11y-audit fix from a role="group" of aria-pressed
// buttons, since only one category is ever selected — labelled by the i18n
// category names. After each selection we assert:
//   - the page heading stays visible (no crash / blank page),
//   - the selected chip reports aria-checked="true",
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

  // Let the list settle before deciding whether chips are due.
  const anyRow = page.locator('ul.list-none li').first();
  const starterKit = page.getByRole('heading', { name: 'Start with these four' });
  const emptyAllInitial = page.getByText('No documents yet', { exact: true });
  await expect
    .poll(
      async () =>
        (await anyRow.count()) > 0 ||
        (await starterKit.count()) > 0 ||
        (await emptyAllInitial.count()) > 0,
      { timeout: 20_000 }
    )
    .toBe(true);

  // The chip row is GATED (mobile DocumentsTab parity): it renders only once
  // there is a second category to filter between. Read the categories off the
  // rendered rows' badges and hold the page to that rule either way.
  const filterGroup = page.getByRole('radiogroup', { name: 'Filter by category' });
  // Each row carries its category as a badge, so the row text names it.
  const rowTexts = await page.locator('ul.list-none li').allTextContents();
  const distinct = new Set(
    rowTexts.flatMap((text) =>
      CATEGORY_LABELS.filter((label) => label !== 'All' && text.includes(label))
    )
  );
  if (distinct.size < 2) {
    await expect(filterGroup).toHaveCount(0);
    await expect(page.getByText('Something went wrong', { exact: false })).toHaveCount(0);
    test.info().annotations.push({
      type: 'note',
      description: `chips hidden: ${distinct.size} distinct categor${distinct.size === 1 ? 'y' : 'ies'} in this circle`,
    });
    return;
  }
  await expect(filterGroup).toBeVisible({ timeout: 20_000 });

  for (const label of CATEGORY_LABELS) {
    const chip = filterGroup.getByRole('radio', { name: label, exact: true });
    await expect(chip).toBeVisible({ timeout: 15_000 });
    await chip.click();

    // Selected chip is reflected as active via aria-checked.
    await expect(chip).toBeChecked({ timeout: 15_000 });

    // Heading survives the re-render (no white-screen crash).
    await expect(heading).toBeVisible({ timeout: 15_000 });

    // The list region settles into one of the valid resolved states: a document
    // list, the "no documents" empty state, or the per-category empty state.
    // Loading skeletons are transient — wait them out via one of these.
    const documentList = page.locator('ul.list-none li').first();
    const emptyAll = page.getByText('No documents yet', { exact: true });
    // Per-category empty state names the category: "Nothing in Legal yet."
    const emptyCategory = page.getByText(/^Nothing in .+ yet\.$/);
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
