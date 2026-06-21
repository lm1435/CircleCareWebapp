import { test, expect, uniqueLabel } from '../fixtures';

// Profile write flow: edit the first name (capture → change → save → reload &
// assert → RESTORE) and toggle a notification preference (flip → assert → flip
// back → assert). PHI-safe display fields/settings only — never touches email or
// password. Every change is restored so the demo account is left exactly as found.

function esc(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

test('edit & restore first name and a notification toggle', async ({ page }) => {
  await page.goto('/profile', { waitUntil: 'domcontentloaded' });
  await expect(page.getByRole('heading', { name: 'Profile & settings' })).toBeVisible({
    timeout: 15_000,
  });

  // ── First name: capture → change → save → reload & assert → restore ──────
  // Open the inline name editor and read the current first name so we can
  // restore it verbatim at the end.
  await page.getByRole('button', { name: 'Edit', exact: true }).click();
  const firstNameInput = page.locator('#profile-first-name');
  await expect(firstNameInput).toBeVisible({ timeout: 15_000 });
  const originalFirstName = await firstNameInput.inputValue();

  const newFirstName = uniqueLabel('Name');
  await firstNameInput.fill(newFirstName);
  await page.getByRole('button', { name: 'Save', exact: true }).click();

  // Editor collapses on success; the display row now shows the new name.
  await expect(firstNameInput).toBeHidden({ timeout: 20_000 });
  await expect(page.getByText(new RegExp(esc(newFirstName))).first()).toBeVisible({
    timeout: 20_000,
  });

  // Reload to prove it persisted on the backend, not just in local state.
  await page.reload({ waitUntil: 'domcontentloaded' });
  await expect(page.getByText(new RegExp(esc(newFirstName))).first()).toBeVisible({
    timeout: 20_000,
  });

  // Restore the original first name (cleanup).
  await page.getByRole('button', { name: 'Edit', exact: true }).click();
  const restoreInput = page.locator('#profile-first-name');
  await expect(restoreInput).toBeVisible({ timeout: 15_000 });
  await restoreInput.fill(originalFirstName);
  await page.getByRole('button', { name: 'Save', exact: true }).click();
  await expect(restoreInput).toBeHidden({ timeout: 20_000 });

  // ── Notification toggle: flip → assert → flip back → assert ──────────────
  // "Tips & suggestions" is a safe notification preference (role="switch").
  const tipsToggle = page.getByRole('switch', { name: 'Tips & suggestions' });
  await expect(tipsToggle).toBeVisible({ timeout: 15_000 });
  const originalChecked = (await tipsToggle.getAttribute('aria-checked')) === 'true';

  await tipsToggle.click();
  await expect(tipsToggle).toHaveAttribute('aria-checked', String(!originalChecked), {
    timeout: 20_000,
  });

  // Flip back to the original state (cleanup).
  await tipsToggle.click();
  await expect(tipsToggle).toHaveAttribute('aria-checked', String(originalChecked), {
    timeout: 20_000,
  });
});
