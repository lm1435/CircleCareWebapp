import { test, expect, uniqueLabel } from '../fixtures';
import { expandAllDayOverflow } from '../helpers';

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
  // Task chips are all-day; heavy re-run traffic can push ours past the week
  // view's per-day overflow cap (WeekView.tsx MAX_ALL_DAY_VISIBLE).
  await expandAllDayOverflow(page);
  const chip = page.getByRole('button', { name: new RegExp(title.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')) });
  await expect(chip.first()).toBeVisible({ timeout: 20_000 });

  // --- Edit ---
  // Edit lives behind the footer's overflow menu (Edit + Delete, per the M2
  // modal-footer convention) alongside the primary "Mark complete" button.
  // `exact: true` is load-bearing: getByRole's `name` is a SUBSTRING match, and
  // the week view's per-day overflow toggle is labelled "N more all-day
  // event(s) on <day>" — which contains "more" and so also matched the
  // non-exact locator, failing with a strict-mode violation whenever that day
  // had an overflow. (tasks-recurring.spec.ts already documents the same trap.)
  await chip.first().click();
  await expect(page.getByRole('dialog')).toBeVisible();
  await page.getByRole('button', { name: 'More', exact: true }).click();
  await page.getByRole('menuitem', { name: 'Edit event' }).click();
  const editDialog = page.getByRole('dialog');
  await editDialog.locator('#title').fill(editedTitle);
  await editDialog.getByRole('button', { name: 'Save changes' }).click();
  await expect(editDialog).toBeHidden({ timeout: 20_000 });

  await expandAllDayOverflow(page);
  const editedChip = page.getByRole('button', {
    name: new RegExp(editedTitle.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')),
  });
  await expect(editedChip.first()).toBeVisible({ timeout: 20_000 });

  // --- Delete (cleanup) ---
  // Delete is the sole danger item in the same overflow menu.
  await editedChip.first().click();
  await expect(page.getByRole('dialog')).toBeVisible();
  await page.getByRole('button', { name: 'More', exact: true }).click();
  await page.getByRole('menuitem', { name: 'Delete', exact: true }).click();
  // Non-recurring → simple confirm dialog with a Delete button.
  const confirm = page.getByRole('dialog');
  await confirm.getByRole('button', { name: 'Delete', exact: true }).click();

  await expect(editedChip).toHaveCount(0, { timeout: 20_000 });
});
