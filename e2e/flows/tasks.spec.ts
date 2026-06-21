import { test, expect, uniqueLabel } from '../fixtures';

// Tasks write flow: create a task on the Tasks page → verify it appears in the
// list → mark it complete (the control is a role="checkbox" toggle with a 5s
// undo grace period; switching the status filter flushes/commits the pending
// completion) and assert the completed state → delete it (cleanup) via the
// calendar EventDetailModal, since the Tasks page edit affordance opens
// AddEventModal which has no delete. Run-unique title; self-cleaning; PHI-safe.

function todayISO(): string {
  // Local date as YYYY-MM-DD; the created task lands in the current views.
  const d = new Date();
  const mm = String(d.getMonth() + 1).padStart(2, '0');
  const dd = String(d.getDate()).padStart(2, '0');
  return `${d.getFullYear()}-${mm}-${dd}`;
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

test('create, complete, and delete a task', async ({ page, circleId }) => {
  const title = uniqueLabel('Task');
  const titleRe = new RegExp(escapeRegExp(title));

  await page.goto(`/circles/${circleId}/tasks`, { waitUntil: 'domcontentloaded' });
  await expect(page.getByRole('heading', { name: 'Tasks' })).toBeVisible({ timeout: 15_000 });

  // --- Create ---
  await page.getByRole('button', { name: 'Add task' }).first().click();
  const dialog = page.getByRole('dialog');
  await expect(dialog).toBeVisible();

  // Tasks page opens AddEventModal pre-typed as 'task'. Fill title + due date.
  await dialog.locator('#title').fill(title);
  await dialog.locator('#scheduled_date').fill(todayISO());
  await dialog.getByRole('button', { name: 'Create' }).click();
  await expect(dialog).toBeHidden({ timeout: 20_000 });

  // The new task appears in the (default: Open) list. The complete control is a
  // role="checkbox" toggle labelled `Mark "<title>" complete`.
  const completeBox = page.getByRole('checkbox', { name: `Mark "${title}" complete` });
  await expect(completeBox).toBeVisible({ timeout: 20_000 });

  // --- Complete (toggle the checkbox) ---
  // Toggling starts a 5s undo grace period; once it elapses the completion
  // commits and the completed task drops out of the default "Open" filter. We
  // assert via the stable per-row edit control (`Edit "<title>"`) leaving the
  // list — a reliable "it committed" signal that doesn't depend on the long,
  // limited "All"/"Completed" lists.
  await completeBox.click();
  const editBtn = page.getByRole('button', { name: `Edit "${title}"` });
  await expect(editBtn).toHaveCount(0, { timeout: 25_000 });

  // --- Delete (cleanup) ---
  // The Tasks edit modal has no delete control; delete via the calendar's
  // EventDetailModal, which the calendar chip opens.
  await page.goto(`/circles/${circleId}/calendar`, { waitUntil: 'domcontentloaded' });
  await expect(page.getByRole('grid')).toBeVisible({ timeout: 15_000 });

  const chip = page.getByRole('button', { name: titleRe });
  await expect(chip.first()).toBeVisible({ timeout: 20_000 });

  await chip.first().click();
  await expect(page.getByRole('dialog')).toBeVisible();
  await page.getByRole('button', { name: 'Delete', exact: true }).click();
  // Non-recurring → simple confirm dialog with a Delete button.
  const confirm = page.getByRole('dialog');
  await confirm.getByRole('button', { name: 'Delete', exact: true }).click();

  await expect(chip).toHaveCount(0, { timeout: 20_000 });
});
