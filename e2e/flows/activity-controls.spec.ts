import { test, expect } from '../fixtures';

// Activity feed pagination flow (read-only / non-destructive). Exercises the
// "Load more" button on the activity feed and asserts pagination grows the list
// without surfacing the ErrorBoundary fallback. If the demo circle's activity
// fits on a single page (no "Load more" button), the test asserts the feed
// rendered (items or empty-state) and explicitly skips the pagination assertion
// rather than failing — see the annotation below.

test('load more pagination (graceful)', async ({ page, circleId }) => {
  await page.goto(`/circles/${circleId}/activity`, { waitUntil: 'domcontentloaded' });

  // Each activity entry renders a <time> element (ActivityItem timestamp), so
  // the count of <time> elements is a stable proxy for the number of items.
  // The "Latest" hero also renders, but counting <time> is consistent before
  // and after pagination so the delta is what matters.
  const items = page.locator('ul time');
  const loadMore = page.getByRole('button', { name: 'Load more' });
  const emptyState = page.getByText('No Activity Yet');

  // Wait for the feed to settle: either items rendered or the empty-state shown.
  await expect
    .poll(async () => (await items.count()) > 0 || (await emptyState.isVisible()), {
      timeout: 20_000,
    })
    .toBe(true);

  // ErrorBoundary fallback must not be present after the initial render.
  await expect(page.getByText('Something went wrong')).toHaveCount(0);

  if (await loadMore.isVisible().catch(() => false)) {
    const before = await items.count();

    await loadMore.click();

    // After fetching the next page, more items should appear.
    await expect
      .poll(async () => items.count(), { timeout: 20_000 })
      .toBeGreaterThan(before);

    const after = await items.count();
    expect(after).toBeGreaterThan(before);

    test.info().annotations.push({
      type: 'pagination',
      description: `load-more exercised: ${before} -> ${after} items`,
    });
  } else {
    // Single page: the feed fit one page, so there is nothing to paginate.
    // Assert the feed rendered (items OR empty-state) and skip the pagination
    // assertion. This is NOT a failure — pagination simply wasn't exercised.
    const itemCount = await items.count();
    const emptyVisible = await emptyState.isVisible().catch(() => false);
    expect(itemCount > 0 || emptyVisible).toBe(true);

    const note = `load-more NOT exercised (single page): ${itemCount} item(s), empty-state=${emptyVisible}`;
    // eslint-disable-next-line no-console
    console.log(`[activity-controls] ${note}`);
    test.info().annotations.push({ type: 'pagination-skipped', description: note });
  }

  // ErrorBoundary fallback must still be absent after any interaction.
  await expect(page.getByText('Something went wrong')).toHaveCount(0);
});
