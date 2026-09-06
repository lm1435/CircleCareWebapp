import { test, expect, uniqueLabel } from '../fixtures';
import { expandAllDayOverflow } from '../helpers';

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
  // "Done" button labelled `Mark "<title>" complete` (1.1.9 redesign — was a
  // role="checkbox" toggle).
  const completeBox = page.getByRole('button', { name: `Mark "${title}" complete` });
  await expect(completeBox).toBeVisible({ timeout: 20_000 });

  // --- Complete (toggle the checkbox) ---
  await completeBox.click();
  // Toggling starts a 5s undo grace period, and swaps the row into its
  // pending "Completing… Undo" state IMMEDIATELY — before any network call.
  // The per-row Edit control disappears at that same instant, so asserting
  // only "Edit is gone" (the old check here) passed even if the eventual
  // commit request silently failed: it never proved the completion reached
  // the server (WB9).
  const editBtn = page.getByRole('button', { name: `Edit "${title}"` });
  await expect(editBtn).toHaveCount(0);
  // Real proof of commit: switch to the Completed filter, a server-backed
  // query. The task only appears here once the completion actually persisted
  // — this is what would fail if the 5s-later commit request broke.
  // NOTE: persisted-completed rows deliberately render as static text with no
  // Edit affordance (TasksPage row gate on completed_at), so assert on the
  // row's text — "<title> (done)" — not on an Edit button that no longer exists.
  // The status filter is a MoreMenu pill now (spec §6.4), not a <select>: a
  // "Status: <current>" trigger that opens a menu of menuitems.
  await page.getByRole('button', { name: /^Status:/ }).click();
  const statusMenu = page.getByRole('menu');
  await expect(statusMenu).toBeVisible({ timeout: 10_000 });
  await statusMenu.getByRole('menuitem', { name: 'Completed', exact: true }).click();
  await expect(page.getByText(title)).toBeVisible({ timeout: 25_000 });

  // --- Delete (cleanup) ---
  // The Tasks edit modal has no delete control; delete via the calendar's
  // EventDetailModal, which the calendar chip opens.
  await page.goto(`/circles/${circleId}/calendar`, { waitUntil: 'domcontentloaded' });
  await expect(page.getByRole('grid')).toBeVisible({ timeout: 15_000 });
  // Task chips are all-day; heavy re-run traffic can push ours past the week
  // view's per-day overflow cap (WeekView.tsx MAX_ALL_DAY_VISIBLE).
  await expandAllDayOverflow(page);

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
