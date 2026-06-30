import { test, expect } from '../fixtures';
import { checkA11y } from '../helpers';

// Keyboard accessibility / ARIA / validation for the global "Create" menu.
//
// The authenticated shell renders a terracotta "Create" button (accessible name
// exactly "Create") that implements the WAI-ARIA menu-button pattern (see
// src/components/layout/useMenu.ts + CreateMenu.tsx):
//   - trigger has aria-haspopup="menu" + aria-expanded
//   - opens a role="menu" of role="menuitem" options
//   - Enter / Space / ArrowDown open + focus the FIRST item; ArrowUp the last
//   - ArrowDown / ArrowUp cycle (wrap), Home / End jump
//   - Escape closes + returns focus to the trigger; outside-click + Tab close
//
// The demo account is the circle owner, so all six options render in order:
// Appointment, Medication, Task, Vitals, Document, Invite member (first =
// Appointment, last = Invite member).
//
// This suite asserts the ARIA wiring, keyboard focus management, and that the
// open menu has no moderate+ axe violations — and that submitting the Task modal
// with an empty title is BLOCKED (validation error shown, dialog stays open, the
// event is NOT created → net-zero, nothing to clean up).
//
// Gotchas: the sidebar trigger ("Create") and the AddEventModal submit button
// ("Create") share an accessible name — use { exact: true } for the trigger and
// dialog-scoped queries for the submit. The "Task" menuitem needs exact:true
// (otherwise it also matches "Tasks"-style names). Desktop sidebar only renders
// at the xl breakpoint, so widen the viewport above it.

test.use({ viewport: { width: 1440, height: 900 } });

const FIRST_ITEM = 'Appointment';
const SECOND_ITEM = 'Medication';
const LAST_ITEM = 'Invite member';

function createTrigger(page: import('@playwright/test').Page) {
  return page.getByRole('button', { name: 'Create', exact: true });
}

test.describe('Create menu — keyboard a11y, ARIA, validation', () => {
  test('ARIA wiring: haspopup/expanded toggle and role="menu" with menuitem children', async ({
    page,
    circleId,
  }) => {
    await page.goto(`/circles/${circleId}`, { waitUntil: 'domcontentloaded' });

    const createBtn = createTrigger(page);
    await expect(createBtn).toBeVisible({ timeout: 15_000 });

    // Closed state: announces a menu popup, collapsed, and no menu rendered.
    await expect(createBtn).toHaveAttribute('aria-haspopup', 'menu');
    await expect(createBtn).toHaveAttribute('aria-expanded', 'false');
    await expect(page.getByRole('menu')).toHaveCount(0);

    await createBtn.click();

    // Open state: expanded + a labelled menu with menuitem children.
    await expect(createBtn).toHaveAttribute('aria-expanded', 'true');
    const menu = page.getByRole('menu');
    await expect(menu).toBeVisible({ timeout: 10_000 });
    await expect(menu.getByRole('menuitem')).toHaveCount(6);
    await expect(menu.getByRole('menuitem', { name: FIRST_ITEM })).toBeVisible();
    await expect(menu.getByRole('menuitem', { name: LAST_ITEM })).toBeVisible();
  });

  test('keyboard open focuses the first item; arrows cycle/wrap', async ({ page, circleId }) => {
    await page.goto(`/circles/${circleId}`, { waitUntil: 'domcontentloaded' });

    const createBtn = createTrigger(page);
    await expect(createBtn).toBeVisible({ timeout: 15_000 });

    // Focus the trigger and open with Enter — the FIRST item must receive focus.
    await createBtn.focus();
    await expect(createBtn).toBeFocused();
    await page.keyboard.press('Enter');

    await expect(page.getByRole('menu')).toBeVisible({ timeout: 10_000 });
    await expect(page.getByRole('menuitem', { name: FIRST_ITEM })).toBeFocused({ timeout: 10_000 });

    // ArrowDown → next item.
    await page.keyboard.press('ArrowDown');
    await expect(page.getByRole('menuitem', { name: SECOND_ITEM })).toBeFocused();

    // ArrowUp → back to the first item.
    await page.keyboard.press('ArrowUp');
    await expect(page.getByRole('menuitem', { name: FIRST_ITEM })).toBeFocused();

    // ArrowUp from the first item wraps to the LAST item.
    await page.keyboard.press('ArrowUp');
    await expect(page.getByRole('menuitem', { name: LAST_ITEM })).toBeFocused();

    // ArrowDown from the last item wraps back to the FIRST item.
    await page.keyboard.press('ArrowDown');
    await expect(page.getByRole('menuitem', { name: FIRST_ITEM })).toBeFocused();
  });

  test('Escape closes the menu and returns focus to the trigger', async ({ page, circleId }) => {
    await page.goto(`/circles/${circleId}`, { waitUntil: 'domcontentloaded' });

    const createBtn = createTrigger(page);
    await expect(createBtn).toBeVisible({ timeout: 15_000 });

    await createBtn.focus();
    await page.keyboard.press('Enter');
    await expect(page.getByRole('menu')).toBeVisible({ timeout: 10_000 });
    await expect(page.getByRole('menuitem', { name: FIRST_ITEM })).toBeFocused({ timeout: 10_000 });

    await page.keyboard.press('Escape');

    // Menu gone, trigger collapsed, focus back on the trigger.
    await expect(page.getByRole('menu')).toHaveCount(0, { timeout: 10_000 });
    await expect(createBtn).toHaveAttribute('aria-expanded', 'false');
    await expect(createBtn).toBeFocused();
  });

  test('outside click closes the menu', async ({ page, circleId }) => {
    await page.goto(`/circles/${circleId}`, { waitUntil: 'domcontentloaded' });

    const createBtn = createTrigger(page);
    await expect(createBtn).toBeVisible({ timeout: 15_000 });

    await createBtn.click();
    await expect(page.getByRole('menu')).toBeVisible({ timeout: 10_000 });

    // Click far from the menu/trigger (main content area) — useMenu closes on a
    // mousedown outside the menu and the button.
    await page.mouse.click(1200, 750);

    await expect(page.getByRole('menu')).toHaveCount(0, { timeout: 10_000 });
    await expect(createBtn).toHaveAttribute('aria-expanded', 'false');
  });

  test('axe scan with the menu OPEN has no moderate+ violations', async ({
    page,
    circleId,
  }, testInfo) => {
    await page.goto(`/circles/${circleId}`, { waitUntil: 'domcontentloaded' });

    const createBtn = createTrigger(page);
    await expect(createBtn).toBeVisible({ timeout: 15_000 });
    await createBtn.click();
    await expect(page.getByRole('menu')).toBeVisible({ timeout: 10_000 });

    await checkA11y(page, 'create-menu-open', testInfo);
  });

  test('Task modal blocks an empty-title submit (no silent create)', async ({ page, circleId }) => {
    await page.goto(`/circles/${circleId}`, { waitUntil: 'domcontentloaded' });

    const createBtn = createTrigger(page);
    await expect(createBtn).toBeVisible({ timeout: 15_000 });
    await createBtn.click();
    await expect(page.getByRole('menu')).toBeVisible({ timeout: 10_000 });

    // 'Task' needs exact to avoid matching other names.
    await page.getByRole('menuitem', { name: 'Task', exact: true }).click();

    const dialog = page.getByRole('dialog');
    await expect(dialog).toBeVisible({ timeout: 10_000 });
    await expect(dialog.locator('#event_type')).toHaveValue('task');

    // Title is empty by default — submit via the dialog's own Create button.
    await dialog.getByRole('button', { name: 'Create', exact: true }).click();

    // Validation error is shown and the title input is flagged invalid (WCAG 3.3.1).
    await expect(dialog.getByText('Please enter a title.')).toBeVisible({ timeout: 10_000 });
    await expect(dialog.locator('#title')).toHaveAttribute('aria-invalid', 'true');

    // The dialog must STAY OPEN — nothing was created.
    await expect(dialog).toBeVisible();

    // Close without creating (net-zero).
    await dialog.getByRole('button', { name: 'Cancel', exact: true }).click();
    await expect(dialog).toBeHidden({ timeout: 10_000 });
  });
});
