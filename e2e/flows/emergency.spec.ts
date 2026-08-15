import { test, expect, uniqueLabel } from '../fixtures';

// Emergency Info edit flow (edit-only surface — the page itself is never
// created/deleted). The medical fields are TagInput chip editors (Condition
// Tags): pills with "Remove <tag>" buttons + a search/add input (#allergies-input).
// We ADD one unique custom allergy pill, assert it persists across a reload and
// renders as a pill in the read view, then REMOVE it (restore) so the demo data
// is left exactly as we found it.

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

  // --- Open the medical-info edit modal (affordance lives on the at-a-glance header).
  await page.getByRole('button', { name: 'Edit medical information' }).first().click();
  let dialog = page.getByRole('dialog');
  await expect(dialog).toBeVisible({ timeout: 20_000 });

  // --- Add a unique custom pill via the Other Allergies TagInput.
  const input = dialog.locator('#allergies-input');
  await expect(input).toBeVisible();
  await input.fill(newValue);
  await input.press('Enter');
  // The new pill renders as a removable button.
  await expect(dialog.getByRole('button', { name: `Remove ${newValue}` })).toBeVisible();
  await dialog.getByRole('button', { name: 'Save', exact: true }).click();
  await expect(dialog).toBeHidden({ timeout: 20_000 });

  // New value renders as a pill in the read view (glance tiles).
  await expect(page.getByText(new RegExp(escapeRe(newValue))).first()).toBeVisible({
    timeout: 20_000,
  });

  // --- Reload and assert the value persisted to the backend.
  await page.reload({ waitUntil: 'domcontentloaded' });
  await expect(page.getByText(new RegExp(escapeRe(newValue))).first()).toBeVisible({
    timeout: 20_000,
  });

  // --- Restore (cleanup): remove the pill we added; demo data unchanged.
  await page.getByRole('button', { name: 'Edit medical information' }).first().click();
  dialog = page.getByRole('dialog');
  await expect(dialog).toBeVisible({ timeout: 20_000 });
  const pill = dialog.getByRole('button', { name: `Remove ${newValue}` });
  await expect(pill).toBeVisible();
  await pill.click();
  await expect(dialog.getByRole('button', { name: `Remove ${newValue}` })).toHaveCount(0);
  await dialog.getByRole('button', { name: 'Save', exact: true }).click();
  await expect(dialog).toBeHidden({ timeout: 20_000 });

  // Our unique value must no longer be present after restore.
  await page.reload({ waitUntil: 'domcontentloaded' });
  await expect(page.getByText(new RegExp(escapeRe(newValue)))).toHaveCount(0, {
    timeout: 20_000,
  });
});
