import { test, expect, uniqueLabel } from '../fixtures';

// Mobile-only global "Create" menu. On desktop (xl+) the sidebar is always
// visible and its terracotta "Create" button opens a role="menu" flying right.
// Below xl the sidebar collapses into a hamburger drawer (AppLayout renders
// <Sidebar variant="drawer"> inside a focus-trapped role="dialog" opened by the
// header "Navigation menu" button). The Create menu lives in the drawer too, but
// its flyout positioning differs (it drops below the button). This suite proves
// the Create menu works END-TO-END *from inside the mobile drawer*.
//
// Runs under the `mobile-chrome` (Pixel 5) Playwright project. Conventions mirror
// e2e/mobile/nav.spec.ts (open the drawer via the "Navigation menu" hamburger)
// and e2e/flows/create-menu.spec.ts + tasks.spec.ts (task create + cleanup via
// the calendar EventDetailModal). Self-cleaning, run-unique, generous backend
// timeouts.
//
// Gotchas accounted for:
//  - The desktop sidebar is still in the DOM at mobile width (CSS-hidden), and
//    its "Create" trigger shares the name with the drawer one. We scope every
//    Create lookup to the drawer dialog to avoid ambiguity.
//  - The sidebar "Create" trigger and the modal submit button both read
//    "Create": exact:true for the trigger, dialog-scoped for the submit.
//  - The "Task" menuitem needs exact:true (collides with "Tasks").
//  - Selecting an option closes the drawer (AppLayout's openCreate calls
//    setNavOpen(false)) AND opens the modal — so the only remaining role="dialog"
//    after selecting is the modal.

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

test('drawer Create menu opens with all six options', async ({ page, circleId }) => {
  await page.goto(`/circles/${circleId}`, { waitUntil: 'domcontentloaded' });

  // Open the hamburger drawer (same control nav.spec uses).
  await page.getByRole('button', { name: 'Navigation menu' }).click();
  const drawer = page.getByRole('dialog');
  await expect(drawer).toBeVisible({ timeout: 10_000 });

  // Open the Create menu from inside the drawer (scoped: the hidden desktop
  // sidebar also has a "Create" button; exact:true avoids the modal submit).
  const createBtn = drawer.getByRole('button', { name: 'Create', exact: true });
  await expect(createBtn).toBeVisible({ timeout: 15_000 });
  await createBtn.click();

  const menu = drawer.getByRole('menu');
  await expect(menu).toBeVisible();

  // All six options are present (the demo account is the circle owner).
  await expect(menu.getByRole('menuitem', { name: 'Appointment' })).toBeVisible();
  await expect(menu.getByRole('menuitem', { name: 'Medication' })).toBeVisible();
  await expect(menu.getByRole('menuitem', { name: 'Task', exact: true })).toBeVisible();
  await expect(menu.getByRole('menuitem', { name: 'Vitals' })).toBeVisible();
  await expect(menu.getByRole('menuitem', { name: 'Document' })).toBeVisible();
  await expect(menu.getByRole('menuitem', { name: 'Invite member' })).toBeVisible();
});

test('create a task end-to-end via the drawer Create menu', async ({ page, circleId }) => {
  const title = uniqueLabel('MobileTask');
  const titleRe = new RegExp(escapeRegExp(title));

  await page.goto(`/circles/${circleId}`, { waitUntil: 'domcontentloaded' });

  // --- Open drawer → Create → Task ---
  await page.getByRole('button', { name: 'Navigation menu' }).click();
  const drawer = page.getByRole('dialog');
  await expect(drawer).toBeVisible({ timeout: 10_000 });

  const createBtn = drawer.getByRole('button', { name: 'Create', exact: true });
  await expect(createBtn).toBeVisible({ timeout: 15_000 });
  await createBtn.click();
  await expect(drawer.getByRole('menu')).toBeVisible();
  await drawer.getByRole('menuitem', { name: 'Task', exact: true }).click();

  // Selecting closes the drawer and opens the AddEventModal — the only dialog now.
  const dialog = page.getByRole('dialog');
  await expect(dialog).toBeVisible({ timeout: 15_000 });
  // The menu pre-selects 'task' as the event type.
  await expect(dialog.locator('#event_type')).toHaveValue('task');

  await dialog.locator('#title').fill(title);
  await dialog.locator('#scheduled_date').fill(todayISO());
  // The modal's own Create button (dialog-scoped, not the sidebar trigger).
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

  const chip = page.getByRole('button', { name: titleRe });
  await expect(chip.first()).toBeVisible({ timeout: 20_000 });

  await chip.first().click();
  await expect(page.getByRole('dialog')).toBeVisible();
  await page.getByRole('button', { name: 'Delete', exact: true }).click();
  const confirm = page.getByRole('dialog');
  await confirm.getByRole('button', { name: 'Delete', exact: true }).click();

  await expect(chip).toHaveCount(0, { timeout: 20_000 });
});
