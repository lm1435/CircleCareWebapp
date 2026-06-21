import { test, expect, uniqueLabel } from '../fixtures';

// Emergency Info edit flow (edit-only surface — the page itself is never
// created/deleted). We edit ONE medical field ("Other Allergies", which
// round-trips as a comma-joined string and renders verbatim in the read view),
// assert the new value persists across a reload, then RESTORE the original
// captured value so the demo data is left exactly as we found it.

const RE_ESCAPE = /[.*+?^${}()|[\]\\]/g;
function escapeRe(value: string): string {
  return value.replace(RE_ESCAPE, '\\$&');
}

test('edit and restore an emergency medical field', async ({ page, circleId }) => {
  const newValue = uniqueLabel('ER');

  await page.goto(`/circles/${circleId}/emergency`, { waitUntil: 'domcontentloaded' });
  await expect(page.getByRole('heading', { name: 'Emergency Info' })).toBeVisible({
    timeout: 20_000,
  });

  // --- Open the medical-info edit modal and capture the field's current value.
  // The "Edit medical information" affordance shows whether the section has data
  // (button under the card) or is empty (button in the empty-state). Either way
  // there is exactly one such button.
  await page.getByRole('button', { name: 'Edit medical information' }).first().click();
  let dialog = page.getByRole('dialog');
  await expect(dialog).toBeVisible({ timeout: 20_000 });

  const allergies = dialog.locator('#allergies');
  await expect(allergies).toBeVisible();
  // The input's value IS the source of truth (array joined with ", "); capture
  // it so we can restore it verbatim during cleanup.
  const originalValue = await allergies.inputValue();

  // --- Set the field to a unique value and save.
  await allergies.fill(newValue);
  await dialog.getByRole('button', { name: 'Save', exact: true }).click();
  await expect(dialog).toBeHidden({ timeout: 20_000 });

  // New value renders in the read-only Medical Information card.
  await expect(page.getByText(new RegExp(escapeRe(newValue))).first()).toBeVisible({
    timeout: 20_000,
  });

  // --- Reload and assert the value persisted to the backend.
  await page.reload({ waitUntil: 'domcontentloaded' });
  await expect(page.getByText(new RegExp(escapeRe(newValue))).first()).toBeVisible({
    timeout: 20_000,
  });

  // --- Restore the original value (cleanup) so demo data is unchanged.
  await page.getByRole('button', { name: 'Edit medical information' }).first().click();
  dialog = page.getByRole('dialog');
  await expect(dialog).toBeVisible({ timeout: 20_000 });
  const allergiesRestore = dialog.locator('#allergies');
  await expect(allergiesRestore).toBeVisible();
  await allergiesRestore.fill(originalValue);
  await dialog.getByRole('button', { name: 'Save', exact: true }).click();
  await expect(dialog).toBeHidden({ timeout: 20_000 });

  // Our unique value must no longer be present after restore.
  await page.reload({ waitUntil: 'domcontentloaded' });
  await expect(page.getByText(new RegExp(escapeRe(newValue)))).toHaveCount(0, {
    timeout: 20_000,
  });
});
