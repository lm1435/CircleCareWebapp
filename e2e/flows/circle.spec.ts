import { test, expect, uniqueLabel } from '../fixtures';

// Circle settings + create-circle modal flows.
//
// SAFETY: the demo circle is shared, so this spec NEVER deletes a circle and
// NEVER actually creates one. Test 1 edits the recipient name and restores the
// original captured value (leaving data exactly as found). Test 2 only exercises
// the create modal's inline validation + cancel — it does not submit a real
// circle (the demo account may sit at the freemium circle limit).

const escapeRe = (s: string): string => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

test('edit circle settings (name) and restore', async ({ page, circleId }) => {
  await page.goto(`/circles/${circleId}/settings`, { waitUntil: 'domcontentloaded' });

  const nameField = page.locator('#recipient_name');
  await expect(nameField).toBeVisible({ timeout: 20_000 });

  // Capture the original value so we can restore it as cleanup.
  const original = await nameField.inputValue();

  // The rename + restore are wrapped in try/finally so that if the assertion
  // (or the run) is interrupted AFTER the rename but BEFORE the restore, the
  // `finally` block still puts the original value back — leaving the shared demo
  // circle exactly as found and preventing leftover "E2E Circle …" pollution.
  try {
    const newName = uniqueLabel('Circle');
    await nameField.fill(newName);
    await page.getByRole('button', { name: 'Save changes' }).click();

    // Persisted toast confirms the write; reload and assert it stuck.
    await expect(page.getByText('Circle updated.')).toBeVisible({ timeout: 20_000 });
    await page.reload({ waitUntil: 'domcontentloaded' });
    await expect(page.locator('#recipient_name')).toHaveValue(newName, { timeout: 20_000 });
  } finally {
    // --- Restore (cleanup): put the original value back and save. ---
    await page.locator('#recipient_name').fill(original);
    await page.getByRole('button', { name: 'Save changes' }).click();
    await expect(page.getByText('Circle updated.')).toBeVisible({ timeout: 20_000 });
    await page.reload({ waitUntil: 'domcontentloaded' });
    await expect(page.locator('#recipient_name')).toHaveValue(original, { timeout: 20_000 });
  }
});

test('create-circle modal validation', async ({ page }) => {
  await page.goto('/circles', { waitUntil: 'domcontentloaded' });

  // Open the create-circle modal (header CTA or empty-state CTA — both are
  // labelled "Create circle").
  await page.getByRole('button', { name: 'Create circle' }).first().click();

  const dialog = page.getByRole('dialog');
  await expect(dialog).toBeVisible({ timeout: 15_000 });
  await expect(dialog.getByText('New care circle')).toBeVisible();

  // Submit with an effectively-empty required name. A single space satisfies the
  // input's native `required` guard but the form trims it to '' → Zod min(1)
  // fails → the inline error renders. (An empty value would only trip the native
  // popup and never reach the JS validation.)
  await dialog.locator('#recipient_name').fill(' ');
  await dialog.getByRole('button', { name: 'Create circle' }).click();

  // Inline validation error appears and no navigation/creation happens.
  await expect(dialog.locator('#recipient_name-error')).toBeVisible({ timeout: 20_000 });
  await expect(page).toHaveURL(new RegExp(`${escapeRe('/circles')}$`));

  // --- Cancel/close (no circle created). ---
  await dialog.getByRole('button', { name: 'Cancel' }).first().click();
  await expect(dialog).toBeHidden({ timeout: 20_000 });
});
