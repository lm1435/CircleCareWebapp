import { test, expect } from '../fixtures';

// Tasks page filter + sort controls — NON-DESTRUCTIVE.
//
// Both are MoreMenu pills now (spec §6.4), not native <select>s: a button
// whose accessible name is "Status: <current>" / "Sort: <current>" (dynamic —
// TasksPage.tsx filter.statusPillLabel / filter.sortPillLabel), opening a menu
// of menuitems. We only flip the controls and assert the list region
// re-renders cleanly — no tasks are created, completed, edited, or deleted.
// After each change we assert the page heading survives, the list OR an
// empty-state is shown, and the ErrorBoundary fallback ("Something went
// wrong") is absent.

// Status menuitem labels (matches STATUS_OPTIONS + tasks:filter.status.* in TasksPage.tsx).
const STATUS_LABELS = ['Open', 'Completed', 'All'] as const;
// Sort menuitem labels (matches SORT_OPTIONS + tasks:filter.sort.* in TasksPage.tsx).
const SORT_LABELS = ['Due date', 'Assignee', 'Recently added'] as const;

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

  const statusTrigger = page.getByRole('button', { name: /^Status:/ });
  await expect(statusTrigger).toBeVisible({ timeout: 15_000 });
  await assertHealthy(page);

  for (const label of STATUS_LABELS) {
    await page.getByRole('button', { name: /^Status:/ }).click();
    const menu = page.getByRole('menu');
    await expect(menu).toBeVisible({ timeout: 10_000 });
    await menu.getByRole('menuitem', { name: label, exact: true }).click();
    await expect(menu).toHaveCount(0, { timeout: 10_000 });
    await expect(
      page.getByRole('button', { name: new RegExp(`^Status: ${label}$`) })
    ).toBeVisible({ timeout: 10_000 });
    await assertHealthy(page);
  }
});

test('sort control cycles through every option without error', async ({ page, circleId }) => {
  await page.goto(`/circles/${circleId}/tasks`, { waitUntil: 'domcontentloaded' });

  const sortTrigger = page.getByRole('button', { name: /^Sort:/ });
  await expect(sortTrigger).toBeVisible({ timeout: 15_000 });
  await assertHealthy(page);

  for (const label of SORT_LABELS) {
    await page.getByRole('button', { name: /^Sort:/ }).click();
    const menu = page.getByRole('menu');
    await expect(menu).toBeVisible({ timeout: 10_000 });
    await menu.getByRole('menuitem', { name: label, exact: true }).click();
    await expect(menu).toHaveCount(0, { timeout: 10_000 });
    await expect(
      page.getByRole('button', { name: new RegExp(`^Sort: ${label}$`) })
    ).toBeVisible({ timeout: 10_000 });
    await assertHealthy(page);
  }
});
