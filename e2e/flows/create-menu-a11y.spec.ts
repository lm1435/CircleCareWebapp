import { test, expect } from '../fixtures';
import { checkA11y } from '../helpers';

// Keyboard accessibility / ARIA / validation for the global create menu.
//
// The authenticated shell renders a moss "New" button (accessible name exactly
// "New") in the sidebar that implements the WAI-ARIA menu-button pattern (see
// src/components/layout/Sidebar.tsx + AddMenu.tsx):
//   - trigger has aria-haspopup="menu" + aria-expanded
//   - opens a role="menu" of role="menuitem" options, focusing the FIRST
//   - ArrowRight/ArrowDown and ArrowLeft/ArrowUp cycle (wrap), Home / End jump
//   - Escape closes + returns focus to the trigger; a backdrop click closes
//
// The pill lays its four options out in a ROW, which is why both axes move the
// focus — a horizontal menu is arrowed left/right, and the vertical keys are
// kept as the familiar menu-button affordance.
//
// The menu carries mobile's four options in mobile's order, addressed by the
// VISIBLE short label that is also their accessible name — "Med", "Appt",
// "Task", "Note" (first = Med, last = Note); a full-word aria-label over a
// short visible label fails WCAG 2.5.3, so the full word is the `title`.
// Document upload and Invite member left this menu in Task 11 (spec §5.2) and
// are covered on their own pages (documents.spec.ts, members.spec.ts).
//
// This suite asserts the ARIA wiring, keyboard focus management, and that the
// open menu has no moderate+ axe violations — and that submitting the Task modal
// with an empty title is BLOCKED (validation error shown, dialog stays open, the
// event is NOT created → net-zero, nothing to clean up).
//
// Gotchas: the FloatingNavBar also has a "New" button (CSS-hidden at this
// width), so the trigger is scoped to `<aside>`. The AddEventModal submit button
// reads "Create", which no longer collides with the trigger's "New", but stays
// dialog-scoped anyway. The "Task" menuitem needs exact:true (otherwise it also
// matches "Tasks"-style names). The desktop sidebar only renders at the xl
// breakpoint, so widen the viewport above it.

test.use({ viewport: { width: 1440, height: 900 } });

const FIRST_ITEM = 'Med';
const SECOND_ITEM = 'Appt';
const LAST_ITEM = 'Note';

function newTrigger(page: import('@playwright/test').Page) {
  return page.locator('aside').getByRole('button', { name: 'New', exact: true });
}

test.describe('create menu — keyboard a11y, ARIA, validation', () => {
  test('ARIA wiring: haspopup/expanded toggle and role="menu" with menuitem children', async ({
    page,
    circleId,
  }) => {
    await page.goto(`/circles/${circleId}`, { waitUntil: 'domcontentloaded' });

    const trigger = newTrigger(page);
    await expect(trigger).toBeVisible({ timeout: 15_000 });

    // Closed state: announces a menu popup, collapsed, and no menu rendered.
    await expect(trigger).toHaveAttribute('aria-haspopup', 'menu');
    await expect(trigger).toHaveAttribute('aria-expanded', 'false');
    await expect(page.getByRole('menu')).toHaveCount(0);

    await trigger.click();

    // Open state: expanded + a labelled menu with menuitem children.
    await expect(trigger).toHaveAttribute('aria-expanded', 'true');
    const menu = page.getByRole('menu');
    await expect(menu).toBeVisible({ timeout: 10_000 });
    await expect(menu.getByRole('menuitem')).toHaveCount(4);
    await expect(menu.getByRole('menuitem', { name: FIRST_ITEM, exact: true })).toBeVisible();
    await expect(menu.getByRole('menuitem', { name: LAST_ITEM, exact: true })).toBeVisible();
  });

  test('keyboard open focuses the first item; arrows cycle/wrap', async ({ page, circleId }) => {
    await page.goto(`/circles/${circleId}`, { waitUntil: 'domcontentloaded' });

    const trigger = newTrigger(page);
    await expect(trigger).toBeVisible({ timeout: 15_000 });

    // Focus the trigger and open with Enter — the FIRST item must receive focus.
    // The button is `disabled` while the circle query is loading (intended L4
    // behavior, Sidebar.tsx's `disabled={!canCreate}`), and a disabled button
    // cannot take focus — wait for it to enable first so this doesn't race
    // that loading window.
    await expect(trigger).toBeEnabled({ timeout: 15_000 });
    await trigger.focus();
    await expect(trigger).toBeFocused();
    await page.keyboard.press('Enter');

    await expect(page.getByRole('menu')).toBeVisible({ timeout: 10_000 });
    await expect(page.getByRole('menuitem', { name: FIRST_ITEM, exact: true })).toBeFocused({ timeout: 10_000 });

    // ArrowRight → next item (the options sit in a row).
    await page.keyboard.press('ArrowRight');
    await expect(page.getByRole('menuitem', { name: SECOND_ITEM, exact: true })).toBeFocused();

    // ArrowLeft → back to the first item.
    await page.keyboard.press('ArrowLeft');
    await expect(page.getByRole('menuitem', { name: FIRST_ITEM, exact: true })).toBeFocused();

    // ArrowLeft from the first item wraps to the LAST item.
    await page.keyboard.press('ArrowLeft');
    await expect(page.getByRole('menuitem', { name: LAST_ITEM, exact: true })).toBeFocused();

    // ArrowRight from the last item wraps back to the FIRST item.
    await page.keyboard.press('ArrowRight');
    await expect(page.getByRole('menuitem', { name: FIRST_ITEM, exact: true })).toBeFocused();

    // End / Home jump to the ends.
    await page.keyboard.press('End');
    await expect(page.getByRole('menuitem', { name: LAST_ITEM, exact: true })).toBeFocused();
    await page.keyboard.press('Home');
    await expect(page.getByRole('menuitem', { name: FIRST_ITEM, exact: true })).toBeFocused();
  });

  test('Escape closes the menu and returns focus to the trigger', async ({ page, circleId }) => {
    await page.goto(`/circles/${circleId}`, { waitUntil: 'domcontentloaded' });

    const trigger = newTrigger(page);
    await expect(trigger).toBeVisible({ timeout: 15_000 });

    // Same disabled-while-loading race as above — wait for enabled before
    // focusing.
    await expect(trigger).toBeEnabled({ timeout: 15_000 });
    await trigger.focus();
    await page.keyboard.press('Enter');
    await expect(page.getByRole('menu')).toBeVisible({ timeout: 10_000 });
    await expect(page.getByRole('menuitem', { name: FIRST_ITEM, exact: true })).toBeFocused({ timeout: 10_000 });

    await page.keyboard.press('Escape');

    // Menu gone, trigger collapsed, focus back on the trigger.
    await expect(page.getByRole('menu')).toHaveCount(0, { timeout: 10_000 });
    await expect(trigger).toHaveAttribute('aria-expanded', 'false');
    await expect(trigger).toBeFocused();
  });

  test('a backdrop click closes the menu', async ({ page, circleId }) => {
    await page.goto(`/circles/${circleId}`, { waitUntil: 'domcontentloaded' });

    const trigger = newTrigger(page);
    await expect(trigger).toBeVisible({ timeout: 15_000 });

    await trigger.click();
    await expect(page.getByRole('menu')).toBeVisible({ timeout: 10_000 });

    // The pill dims the page behind it; clicking that scrim dismisses the menu.
    await page.getByTestId('add-menu-backdrop').click({ position: { x: 1200, y: 750 } });

    await expect(page.getByRole('menu')).toHaveCount(0, { timeout: 10_000 });
    await expect(trigger).toHaveAttribute('aria-expanded', 'false');
  });

  test('axe scan with the menu OPEN has no moderate+ violations', async ({
    page,
    circleId,
  }, testInfo) => {
    await page.goto(`/circles/${circleId}`, { waitUntil: 'domcontentloaded' });

    const trigger = newTrigger(page);
    await expect(trigger).toBeVisible({ timeout: 15_000 });
    await trigger.click();
    await expect(page.getByRole('menu')).toBeVisible({ timeout: 10_000 });

    await checkA11y(page, 'create-menu-open', testInfo);
  });

  test('Task modal blocks an empty-title submit (no silent create)', async ({ page, circleId }) => {
    await page.goto(`/circles/${circleId}`, { waitUntil: 'domcontentloaded' });

    const trigger = newTrigger(page);
    await expect(trigger).toBeVisible({ timeout: 15_000 });
    await trigger.click();
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
