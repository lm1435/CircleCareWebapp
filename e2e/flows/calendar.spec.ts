import { test, expect, uniqueLabel } from '../fixtures';

// Calendar write flow: create a task event → verify it appears → edit its title
// → delete it. Uses a run-unique title so parallel/repeat runs never collide and
// the test cleans up after itself (the delete is the cleanup).

function todayISO(): string {
  // Local date as YYYY-MM-DD; the created event lands in the current week view.
  const d = new Date();
  const mm = String(d.getMonth() + 1).padStart(2, '0');
  const dd = String(d.getDate()).padStart(2, '0');
  return `${d.getFullYear()}-${mm}-${dd}`;
}

test('create, edit, and delete a calendar task', async ({ page, circleId }) => {
  const title = uniqueLabel('Task');
  const editedTitle = `${title} edited`;

  await page.goto(`/circles/${circleId}/calendar`, { waitUntil: 'domcontentloaded' });
  await expect(page.getByRole('grid')).toBeVisible({ timeout: 15_000 });

  // --- Create ---
  await page.getByRole('button', { name: 'Add event' }).first().click();
  const dialog = page.getByRole('dialog');
  await expect(dialog).toBeVisible();

  await dialog.locator('#event_type').selectOption('task');
  await dialog.locator('#title').fill(title);
  await dialog.locator('#scheduled_date').fill(todayISO());
  await dialog.getByRole('button', { name: 'Create' }).click();

  await expect(dialog).toBeHidden({ timeout: 20_000 });
  const chip = page.getByRole('button', { name: new RegExp(title.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')) });
  await expect(chip.first()).toBeVisible({ timeout: 20_000 });

  // --- Edit ---
  await chip.first().click();
  await expect(page.getByRole('dialog')).toBeVisible();
  await page.getByRole('button', { name: 'Edit event' }).click();
  const editDialog = page.getByRole('dialog');
  await editDialog.locator('#title').fill(editedTitle);
  await editDialog.getByRole('button', { name: 'Save changes' }).click();
  await expect(editDialog).toBeHidden({ timeout: 20_000 });

  const editedChip = page.getByRole('button', {
    name: new RegExp(editedTitle.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')),
  });
  await expect(editedChip.first()).toBeVisible({ timeout: 20_000 });

  // --- Delete (cleanup) ---
  await editedChip.first().click();
  await expect(page.getByRole('dialog')).toBeVisible();
  await page.getByRole('button', { name: 'Delete', exact: true }).click();
  // Non-recurring → simple confirm dialog with a Delete button.
  const confirm = page.getByRole('dialog');
  await confirm.getByRole('button', { name: 'Delete', exact: true }).click();

  await expect(editedChip).toHaveCount(0, { timeout: 20_000 });
});
