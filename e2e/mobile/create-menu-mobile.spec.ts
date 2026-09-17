import { test, expect, uniqueLabel } from '../fixtures';
import { expandAllDayOverflow } from '../helpers';

// Mobile-only create flow. From xl up the create surface is the sidebar's "New"
// button; below it, it is the NEW cell in the FloatingNavBar pill, which raises
// the same `AddMenu` from the bottom of the screen (spec §5.3). This suite
// proves that path END-TO-END from the pill.
//
// Runs under the `mobile-chrome` (Pixel 5) Playwright project. Conventions
// mirror e2e/mobile/nav.spec.ts (scope every pill lookup to the testid) and
// e2e/flows/create-menu.spec.ts + tasks.spec.ts (task create + cleanup via the
// calendar EventDetailModal). Self-cleaning, run-unique, generous backend
// timeouts.
//
// Gotchas accounted for:
//  - The desktop sidebar is still in the DOM at mobile width (CSS-hidden) and
//    has a "New" button of its own — hence the testid scope on the pill.
//  - The sidebar/pill "New" trigger and the modal submit button read
//    differently ("New" vs "Create"), but the modal submit is still queried
//    dialog-scoped so it can never collide.
//  - Menu options are named by their VISIBLE short label ("Med", "Appt",
//    "Task", "Note") — that label IS the accessible name, because a full-word
//    aria-label over a short visible label fails WCAG 2.5.3. The full word is
//    the `title`. Every lookup is exact:true so "Task" cannot also match
//    "Tasks"-shaped names.
//  - Document upload and Invite member are NOT in this menu any more (spec
//    §5.2). Those flows are covered by e2e/flows/documents.spec.ts and
//    e2e/flows/members.spec.ts, which drive the page-level controls that
//    replaced them.

function todayISO(): string {
  // Local date as YYYY-MM-DD; the created item lands in the current views.
  const d = new Date();
  const mm = String(d.getMonth() + 1).padStart(2, '0');
  const dd = String(d.getDate()).padStart(2, '0');
  return `${d.getFullYear()}-${mm}-${dd}`;
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function pill(page: import('@playwright/test').Page) {
  return page.getByTestId('floating-nav');
}

test('the pill AddMenu offers exactly the four create options', async ({ page, circleId }) => {
  await page.goto(`/circles/${circleId}`, { waitUntil: 'domcontentloaded' });

  const newCell = pill(page).getByRole('button', { name: 'New' });
  await expect(newCell).toBeVisible({ timeout: 15_000 });
  await newCell.click();

  const menu = page.getByRole('menu');
  await expect(menu).toBeVisible();

  await expect(menu.getByRole('menuitem', { name: 'Med', exact: true })).toBeVisible();
  await expect(menu.getByRole('menuitem', { name: 'Appt', exact: true })).toBeVisible();
  await expect(menu.getByRole('menuitem', { name: 'Task', exact: true })).toBeVisible();
  await expect(menu.getByRole('menuitem', { name: 'Note', exact: true })).toBeVisible();
  await expect(menu.getByRole('menuitem')).toHaveCount(4);

  // The two options that used to live here now belong to their own pages.
  await expect(menu.getByRole('menuitem', { name: 'Document' })).toHaveCount(0);
  await expect(menu.getByRole('menuitem', { name: 'Invite member' })).toHaveCount(0);
});

test('create a task end-to-end from the pill NEW cell', async ({ page, circleId }) => {
  const title = uniqueLabel('MobileTask');
  const titleRe = new RegExp(escapeRegExp(title));

  await page.goto(`/circles/${circleId}`, { waitUntil: 'domcontentloaded' });

  // --- NEW → Task ---
  const newCell = pill(page).getByRole('button', { name: 'New' });
  await expect(newCell).toBeVisible({ timeout: 15_000 });
  await newCell.click();
  await expect(page.getByRole('menu')).toBeVisible();
  await page.getByRole('menuitem', { name: 'Task', exact: true }).click();

  // Selecting closes the menu and opens the AddEventModal — the only dialog now.
  const dialog = page.getByRole('dialog');
  await expect(dialog).toBeVisible({ timeout: 15_000 });
  // The menu pre-selects 'task' as the event type.
  await expect(dialog.locator('#event_type')).toHaveValue('task');

  await dialog.locator('#title').fill(title);

  // THE DATE IS PICKED, NOT TYPED — this is a Pixel 5, i.e. a coarse pointer,
  // and `DateField` makes its `<input>` `readOnly` there. That is not an
  // obstacle the test is routing around: it is the change under test. The
  // input is readOnly precisely because WebKit summons its own picker from a
  // focused, editable date input and `PICKER_INDICATOR_HIDDEN` provably cannot
  // stop it (97px -> 97px; see `e2e/coarse-pointer.spec.ts`), so a caregiver on
  // a phone taps the field and gets OUR sheet. `.fill()` would throw here, and
  // it should: a passing `fill` would mean touch had been handed back to the
  // OS picker. The desktop flows in `e2e/flows/` still type, correctly — they
  // run under a fine pointer, where the field is still a text control.
  await dialog.locator('#scheduled_date').tap();
  const datePicker = page.getByRole('dialog', { name: 'Date picker' });
  await expect(datePicker).toBeVisible();
  // The sheet opens on today when the field is empty, so the cell is on screen.
  // Committing a day also dismisses, which is what leaves ONE dialog again for
  // the `dialog` locator below — it is `getByRole('dialog')` and would be
  // ambiguous while both are open.
  await datePicker.locator(`[data-day="${todayISO()}"]`).tap();
  await expect(datePicker).toBeHidden();
  await expect(dialog.locator('#scheduled_date')).toHaveValue(todayISO());

  // The modal's own Create button (dialog-scoped, never the nav trigger).
  await dialog.getByRole('button', { name: 'Create' }).click();
  await expect(dialog).toBeHidden({ timeout: 20_000 });

  // --- Verify it was really created (Tasks page) ---
  await page.goto(`/circles/${circleId}/tasks`, { waitUntil: 'domcontentloaded' });
  await expect(page.getByRole('heading', { name: 'Tasks' })).toBeVisible({ timeout: 15_000 });
  await expect(page.getByRole('button', { name: `Edit "${title}"` })).toBeVisible({
    timeout: 20_000,
  });

  // --- Delete (cleanup) via the calendar's EventDetailModal ---
  await page.goto(`/circles/${circleId}/calendar`, { waitUntil: 'domcontentloaded' });
  await expect(page.getByRole('grid')).toBeVisible({ timeout: 15_000 });
  // Task chips are all-day; at the 390px Pixel 5 width the week view collapses
  // today's all-day chips behind a "+N more" toggle well before the desktop
  // cap (WeekView.tsx MAX_ALL_DAY_VISIBLE) — expand it before searching by title.
  await expandAllDayOverflow(page);

  const chip = page.getByRole('button', { name: titleRe });
  await expect(chip.first()).toBeVisible({ timeout: 20_000 });

  await chip.first().click();
  await expect(page.getByRole('dialog')).toBeVisible();
  // Edit/Discontinue/Delete live behind one "More" MoreMenu trigger now
  // (EventDetailActions.tsx spec §M2) whenever 2+ secondary actions apply —
  // true for this fresh (non-completed) task.
  await page.getByRole('button', { name: 'More', exact: true }).click();
  const actionsMenu = page.getByRole('menu');
  await expect(actionsMenu).toBeVisible();
  await actionsMenu.getByRole('menuitem', { name: 'Delete', exact: true }).click();
  const confirm = page.getByRole('dialog');
  await confirm.getByRole('button', { name: 'Delete', exact: true }).click();

  await expect(chip).toHaveCount(0, { timeout: 20_000 });
});

test('a note from the pill navigates to the Notes composer', async ({ page, circleId }) => {
  // Note is the one option with no modal — it lands on the Notes page, where
  // the composer lives (mirrors mobile's New-menu note entry).
  await page.goto(`/circles/${circleId}`, { waitUntil: 'domcontentloaded' });

  const newCell = pill(page).getByRole('button', { name: 'New' });
  await expect(newCell).toBeVisible({ timeout: 15_000 });
  await newCell.click();
  await page.getByRole('menuitem', { name: 'Note', exact: true }).click();

  await expect(page).toHaveURL(new RegExp(`/circles/${circleId}/notes$`), { timeout: 20_000 });
  await expect(page.getByLabel(/^Add a note/)).toBeVisible({ timeout: 20_000 });
});
