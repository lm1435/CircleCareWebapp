import { test, expect, uniqueLabel } from '../fixtures';
import type { Page } from '@playwright/test';

// Real circle CREATE + DELETE lifecycle (local testing-ground DB — destructive
// is fine). Net-zero: it creates a circle and deletes the one it created.
//
// The demo account can sit at the premium circle cap (5), where create returns
// 402. beforeAll frees one slot if needed by deleting the LAST circle (never the
// first — that's what other specs resolve as `circleId`). It also clears any
// leftover "E2E …" circles from interrupted prior runs.
//
// (circle.spec.ts still covers the non-destructive rename+restore and the
// create-modal validation; this spec adds the real write/delete paths.)

const CIRCLE_CAP = 5;

async function gotoCircles(page: Page) {
  await page.goto('/circles', { waitUntil: 'domcontentloaded' });
  await page.waitForLoadState('networkidle', { timeout: 8_000 }).catch(() => {});
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
  await dialog.getByRole('button', { name: 'Delete circle' }).click();
  await page.waitForURL(/\/circles(\/)?$/, { timeout: 20_000 }).catch(() => {});
}

test.beforeAll(async ({ browser }) => {
  const context = await browser.newContext({ storageState: 'e2e/.auth/user.json' });
  const page = await context.newPage();
  try {
    await gotoCircles(page);
    const links = page.locator('a[href*="/circles/"]');

    // 1) Clear leftover E2E circles from interrupted runs.
    const e2eLeftovers = links.filter({ hasText: 'E2E' });
    for (let i = (await e2eLeftovers.count()) - 1; i >= 0; i -= 1) {
      const id = idFromHref(await e2eLeftovers.nth(i).getAttribute('href'));
      if (id) await deleteCircle(page, id);
      await gotoCircles(page);
    }

    // 2) If still at the cap, free one slot by deleting the LAST circle (never
    //    the first — other specs resolve that as circleId).
    if ((await links.count()) >= CIRCLE_CAP) {
      const count = await links.count();
      const id = idFromHref(await links.nth(count - 1).getAttribute('href'));
      if (id) await deleteCircle(page, id);
    }
  } finally {
    await context.close();
  }
});

test('create a new circle, then delete it', async ({ page }) => {
  const name = uniqueLabel('Circle');

  // --- Create ---
  await gotoCircles(page);
  await page.getByRole('button', { name: 'Create circle' }).first().click();
  const dialog = page.getByRole('dialog');
  await expect(dialog).toBeVisible({ timeout: 15_000 });
  await dialog.locator('#recipient_name').fill(name);
  await dialog.getByRole('button', { name: 'Create circle' }).click();

  // Success navigates to the new circle's overview.
  await page.waitForURL(/\/circles\/[0-9a-f-]+(?:[/?#]|$)/, { timeout: 20_000 });
  const id = idFromHref(page.url());
  expect(id, 'new circle id parsed from URL').toBeTruthy();

  // It shows in the picker.
  await gotoCircles(page);
  await expect(page.getByText(name)).toBeVisible({ timeout: 20_000 });

  // --- Delete (cleanup → net-zero) ---
  await deleteCircle(page, id!);
  await gotoCircles(page);
  await expect(page.getByText(name)).toHaveCount(0, { timeout: 20_000 });
});
