import { test, expect } from '../fixtures';

// Tasks page filter + sort controls — NON-DESTRUCTIVE.
//
// Exercises the status filter (#tasks-status-filter: open | completed | all)
// and the sort control (#tasks-sort: due_date | assignee | created_at). Both
// drive useTasks(circleId, { status, sort }). We only flip the controls and
// assert the list region re-renders cleanly — no tasks are created, completed,
// edited, or deleted. After each change we assert the page heading survives,
// the list OR an empty-state is shown, and the ErrorBoundary fallback
// ("Something went wrong") is absent.

const STATUS_OPTIONS = ['open', 'completed', 'all'] as const;
const SORT_OPTIONS = ['due_date', 'assignee', 'created_at'] as const;

/**
 * After a control change, assert the page is healthy: heading visible, no error
 * fallback, and the list region settled into a list or an empty-state. The
 * tasks query may briefly show skeletons (aria-busy) — wait for it to settle.
 */
async function assertHealthy(page: import('@playwright/test').Page): Promise<void> {
  // ErrorBoundary fallback must never appear.
  await expect(page.getByText('Something went wrong')).toHaveCount(0);

  // The page heading stays mounted across re-renders.
  await expect(page.getByRole('heading', { name: 'Tasks' })).toBeVisible({ timeout: 15_000 });

  // Wait for the loading skeletons to clear, then assert the body resolved into
  // either a populated list or an empty-state message.
  await expect(page.locator('ul[aria-busy="true"]')).toHaveCount(0, { timeout: 20_000 });

  const list = page.locator('ul:not([aria-busy])').first();
  const emptyState = page.getByText(/^No (open|completed )?tasks/);
  await expect(list.or(emptyState).first()).toBeVisible({ timeout: 20_000 });

  // Re-confirm no error fallback crept in while the list resolved.
  await expect(page.getByText('Something went wrong')).toHaveCount(0);
}

test('status filter cycles through every option without error', async ({ page, circleId }) => {
  await page.goto(`/circles/${circleId}/tasks`, { waitUntil: 'domcontentloaded' });

  const statusFilter = page.locator('#tasks-status-filter');
  await expect(statusFilter).toBeVisible({ timeout: 15_000 });
  await assertHealthy(page);

  for (const status of STATUS_OPTIONS) {
    await statusFilter.selectOption(status);
    await expect(statusFilter).toHaveValue(status);
    await assertHealthy(page);
  }
});

test('sort control cycles through every option without error', async ({ page, circleId }) => {
  await page.goto(`/circles/${circleId}/tasks`, { waitUntil: 'domcontentloaded' });

  const sortControl = page.locator('#tasks-sort');
  await expect(sortControl).toBeVisible({ timeout: 15_000 });
  await assertHealthy(page);

  for (const sort of SORT_OPTIONS) {
    await sortControl.selectOption(sort);
    await expect(sortControl).toHaveValue(sort);
    await assertHealthy(page);
  }
});
