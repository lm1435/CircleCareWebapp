import { test, expect, uniqueLabel } from '../fixtures';
import type { Page } from '@playwright/test';

// Real circle CREATE + DELETE lifecycle (local testing-ground DB — destructive
// is fine). Net-zero: it creates a circle and deletes the one it created.
//
// It runs against THIS WORKER's isolated account, which globalSetup provisions
// with exactly two circles against a premium cap of five — so there is always a
// free slot and this spec's create/delete can never collide with, or be starved
// by, another spec.
//
// The `beforeAll` this file used to carry is gone on purpose. It opened a
// context from the shared `e2e/.auth/user.json`, hunted for leftover "E2E …"
// circles and, if the shared demo account was at the cap, DELETED "the last
// circle" — a destructive sweep of an account that three other workers were
// reading and writing at the same time, and one of the reasons the crawl
// intermittently found no circle to crawl. Nothing replaces it: the account is
// created fresh by globalSetup and removed wholesale by globalTeardown, so
// there is no leftover to clear and no cap to free.
//
// NO SWALLOWED WAITS. The final "the deleted circle is gone" is an absence, and
// an absence is satisfied by a list that has not loaded yet — so it is only
// asserted after a POSITIVE loaded signal (the list GET succeeded and the
// account's two provisioned circles rendered), and only after the DELETE
// request itself is seen to succeed.
//
// (circle.spec.ts still covers the non-destructive rename+restore and the
// create-modal validation; this spec adds the real write/delete paths.)

/** Cards the picker renders — one per live circle. */
function circleCards(page: Page) {
  return page.locator('main a[href^="/circles/"]');
}

/**
 * Open the picker and wait until the circle LIST has loaded: GET /circles
 * returned 200 and at least `minCards` cards rendered.
 */
async function gotoCircles(page: Page, minCards: number) {
  const listed = page.waitForResponse(
    (r) => r.request().method() === 'GET' && new URL(r.url()).pathname === '/api/circles',
    { timeout: 20_000 }
  );
  await page.goto('/circles', { waitUntil: 'domcontentloaded' });
  expect((await listed).status(), 'GET /circles').toBe(200);
  await expect(page).toHaveURL(/\/circles$/);
  await expect
    .poll(() => circleCards(page).count(), { timeout: 20_000, message: 'circle cards rendered' })
    .toBeGreaterThanOrEqual(minCards);
}

function idFromHref(href: string | null): string | undefined {
  return href?.match(/\/circles\/([^/?#]+)/)?.[1];
}

/** Delete a circle via the owner-only danger zone (type-to-confirm "DELETE"). */
async function deleteCircle(page: Page, id: string) {
  await page.goto(`/circles/${id}/settings`, { waitUntil: 'domcontentloaded' });
  await page.getByRole('button', { name: 'Delete circle' }).first().click();
  const dialog = page.getByRole('dialog');
  await expect(dialog).toBeVisible({ timeout: 15_000 });
  await dialog.locator('#delete-confirm-input').fill('DELETE');
  const [deleted] = await Promise.all([
    page.waitForResponse(
      (r) => r.request().method() === 'DELETE' && new URL(r.url()).pathname === `/api/circles/${id}`,
      { timeout: 20_000 }
    ),
    dialog.getByRole('button', { name: 'Delete circle' }).click(),
  ]);
  expect(deleted.ok(), `DELETE /circles/${id} returned ${deleted.status()}`).toBe(true);
  await page.waitForURL(/\/circles(\/)?$/, { timeout: 20_000 });
}

test('create a new circle, then delete it', async ({ page }) => {
  const name = uniqueLabel('Circle');

  // --- Create ---
  await gotoCircles(page, 2);
  await page.getByRole('button', { name: 'Create circle' }).first().click();
  const dialog = page.getByRole('dialog');
  await expect(dialog).toBeVisible({ timeout: 15_000 });
  await dialog.locator('#recipient_name').fill(name);
  await dialog.getByRole('button', { name: 'Create circle' }).click();

  // Success navigates to the new circle's overview.
  await page.waitForURL(/\/circles\/[0-9a-f-]+(?:[/?#]|$)/, { timeout: 20_000 });
  const id = idFromHref(page.url());
  expect(id, 'new circle id parsed from URL').toBeTruthy();

  // It shows in the picker, alongside the two provisioned circles.
  await gotoCircles(page, 3);
  await expect(page.getByText(name)).toBeVisible({ timeout: 20_000 });

  // --- Delete (cleanup → net-zero) ---
  await deleteCircle(page, id!);
  // Loaded list (the two provisioned circles are back to being the whole set),
  // and only then the absence.
  await gotoCircles(page, 2);
  await expect(circleCards(page)).toHaveCount(2);
  await expect(page.getByText(name)).toHaveCount(0);
  await expect(page.locator(`main a[href^="/circles/${id}"]`)).toHaveCount(0);
});
