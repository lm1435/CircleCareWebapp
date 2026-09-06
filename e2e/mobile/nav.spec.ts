import { test, expect } from '../fixtures';

// Mobile-only nav. Below the xl breakpoint the sidebar is hidden and the
// FloatingNavBar pill is the whole navigation surface (spec §5.3): five cells,
// HOME · CARE · NEW · HEALTH · AI. The hamburger drawer this file used to drive
// no longer exists — it was deleted alongside `AppDownloadBanner` in Task 11.
//
// Runs under the `mobile-chrome` (Pixel 5) Playwright project.
//
// Gotchas accounted for:
//  - The desktop sidebar is still in the DOM at mobile width (CSS-hidden) and
//    carries a "New" button of its own, so every pill lookup is scoped to
//    `[data-testid="floating-nav"]`.
//  - Both navs are labelled "Main navigation"; only one is ever visible, which
//    is why the pill is addressed by testid rather than by role + name.
//  - The AddMenu options are named by their FULL word (`addMenu.medication` →
//    "Medication"); the 10px label under each disc is the short form and is
//    aria-hidden, so it never reaches an accessible name.

function pill(page: import('@playwright/test').Page) {
  return page.getByTestId('floating-nav');
}

test('the pill shows five cells and the active one follows the route', async ({
  page,
  circleId,
}) => {
  await page.goto(`/circles/${circleId}/calendar`, { waitUntil: 'domcontentloaded' });
  await expect(page.getByRole('grid')).toBeVisible({ timeout: 15_000 });

  const nav = pill(page);
  await expect(nav).toBeVisible({ timeout: 15_000 });

  // Three route cells and two control cells, in mobile's order.
  for (const name of ['Home', 'Care', 'Health']) {
    await expect(nav.getByRole('link', { name, exact: true })).toBeVisible();
  }
  for (const name of ['New', 'AI']) {
    await expect(nav.getByRole('button', { name, exact: true })).toBeVisible();
  }
  // The pill holds nothing else.
  await expect(nav.getByRole('link')).toHaveCount(3);
  await expect(nav.getByRole('button')).toHaveCount(2);

  // /calendar is a CARE section, so CARE is the current cell.
  await expect(nav.getByRole('link', { name: 'Care' })).toHaveAttribute('aria-current', 'page');
  await expect(nav.getByRole('link', { name: 'Home' })).not.toHaveAttribute('aria-current', 'page');
});

test('HEALTH and HOME cells navigate and take the active state with them', async ({
  page,
  circleId,
}) => {
  await page.goto(`/circles/${circleId}/calendar`, { waitUntil: 'domcontentloaded' });
  const nav = pill(page);
  await expect(nav).toBeVisible({ timeout: 15_000 });

  // CARE → HEALTH lands on Emergency (spec §5.3).
  await nav.getByRole('link', { name: 'Health' }).click();
  await expect(page).toHaveURL(new RegExp(`/circles/${circleId}/emergency`), { timeout: 20_000 });
  await expect(nav.getByRole('link', { name: 'Health' })).toHaveAttribute('aria-current', 'page');
  await expect(nav.getByRole('link', { name: 'Care' })).not.toHaveAttribute('aria-current', 'page');

  // HOME → the circle overview (the index route, no section segment).
  await nav.getByRole('link', { name: 'Home' }).click();
  await expect(page).toHaveURL(new RegExp(`/circles/${circleId}$`), { timeout: 20_000 });
  await expect(nav.getByRole('link', { name: 'Home' })).toHaveAttribute('aria-current', 'page');
});

test('NEW opens the AddMenu and Escape closes it', async ({ page, circleId }) => {
  await page.goto(`/circles/${circleId}`, { waitUntil: 'domcontentloaded' });
  const nav = pill(page);
  await expect(nav).toBeVisible({ timeout: 15_000 });

  const newCell = nav.getByRole('button', { name: 'New' });
  await expect(newCell).toHaveAttribute('aria-haspopup', 'menu');
  await expect(newCell).toHaveAttribute('aria-expanded', 'false');

  await newCell.click();

  const menu = page.getByRole('menu');
  await expect(menu).toBeVisible({ timeout: 10_000 });
  await expect(newCell).toHaveAttribute('aria-expanded', 'true');
  // Four options only — document upload and invite live on their own pages now.
  await expect(menu.getByRole('menuitem')).toHaveCount(4);

  await page.keyboard.press('Escape');
  await expect(page.getByRole('menu')).toHaveCount(0, { timeout: 10_000 });
  await expect(newCell).toHaveAttribute('aria-expanded', 'false');
});

test('AI opens the assistant modal', async ({ page, circleId }) => {
  await page.goto(`/circles/${circleId}`, { waitUntil: 'domcontentloaded' });
  const nav = pill(page);
  await expect(nav).toBeVisible({ timeout: 15_000 });

  await nav.getByRole('button', { name: 'AI' }).click();

  const modal = page.getByRole('dialog', { name: 'Care Assistant' });
  await expect(modal).toBeVisible({ timeout: 20_000 });

  // Close without sending anything — no assistant call is made (net-zero).
  await page.keyboard.press('Escape');
  await expect(modal).toBeHidden({ timeout: 10_000 });
});
