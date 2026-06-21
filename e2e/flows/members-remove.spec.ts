import { test, expect } from '../fixtures';

// Member REMOVAL (destructive, local testing-ground DB).
//
// Unlike invite+cancel (net-zero, in members.spec.ts), removing an accepted
// member can't be cleanly undone in E2E — re-adding needs an invite + accept,
// which requires a second authenticated account. So this consumes one removable
// (non-owner) member per run and SKIPS once none remain (reseed to replenish).
// Kept in its own spec so the non-destructive members flow stays repeatable.

test('remove a non-owner circle member', async ({ page, circleId }) => {
  await page.goto(`/circles/${circleId}/members`, { waitUntil: 'domcontentloaded' });
  await expect(page.getByRole('heading', { name: 'Members' })).toBeVisible({ timeout: 15_000 });
  // Wait for the roster to actually render before counting — otherwise we'd
  // false-skip on an empty pre-load DOM.
  await expect(page.locator('ul li').first()).toBeVisible({ timeout: 15_000 });
  await page.waitForLoadState('networkidle', { timeout: 8_000 }).catch(() => {});

  // Per-member remove buttons are labelled "Remove <name>" (owners have none).
  const removeButtons = page.getByRole('button', { name: /^Remove / });
  const count = await removeButtons.count();
  test.skip(count === 0, 'no removable (non-owner) members left — reseed to replenish');

  const label = await removeButtons.first().getAttribute('aria-label');
  const name = (label ?? '').replace(/^Remove /, '');
  expect(name.length, 'parsed member name from remove-button label').toBeGreaterThan(0);

  // Remove → confirm.
  await removeButtons.first().click();
  const dialog = page.getByRole('dialog');
  await expect(dialog).toBeVisible({ timeout: 10_000 });
  await expect(dialog.getByRole('heading', { name: 'Remove member?' })).toBeVisible();
  await dialog.getByRole('button', { name: 'Remove', exact: true }).click();

  // That member's remove button is gone (they were removed); the roster still
  // renders (the owner remains).
  await expect(page.getByRole('button', { name: `Remove ${name}` })).toHaveCount(0, {
    timeout: 20_000,
  });
  await expect(page.locator('ul li').first()).toBeVisible({ timeout: 10_000 });
});
