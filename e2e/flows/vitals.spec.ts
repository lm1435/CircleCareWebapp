import { test, expect, uniqueLabel } from '../fixtures';

// Vitals write flow: log a manual heart-rate reading → verify it appears in the
// history list → edit its value → verify the change → delete it. The reading we
// create is source 'manual', so it's the one we can edit/delete (synced readings
// render read-only). The delete is the cleanup, so parallel/repeat runs never
// accumulate state. Values are neutral numerics (PHI-safe).
//
// We pick heart-rate values in a high, uncommon-but-valid band (range 20-300 bpm)
// so the rendered "<value> bpm" row text is unique and won't collide with any
// pre-existing default/synced readings on the demo circle.

function randomHeartRate(min: number, max: number): number {
  return Math.floor(Math.random() * (max - min + 1)) + min;
}

test('log, edit, and delete a manual vital reading', async ({ page, circleId }) => {
  // A run-unique note ties the reading to this run; the bpm value drives the
  // visible row text we assert on.
  const note = uniqueLabel('Vital');
  const bpm = randomHeartRate(240, 290);
  const editedBpm = randomHeartRate(200, 239);

  const valueText = `${bpm} bpm`;
  const editedValueText = `${editedBpm} bpm`;
  const esc = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

  await page.goto(`/circles/${circleId}/vitals`, { waitUntil: 'domcontentloaded' });
  await expect(page.getByRole('button', { name: 'Add reading' })).toBeVisible({ timeout: 15_000 });

  // --- Log (create) ---
  await page.getByRole('button', { name: 'Add reading' }).click();
  const dialog = page.getByRole('dialog');
  await expect(dialog).toBeVisible();

  await dialog.locator('#vital_type').selectOption('heart_rate');
  await dialog.locator('#value1').fill(String(bpm));
  await dialog.locator('#notes').fill(note);
  await dialog.getByRole('button', { name: 'Save reading' }).click();

  await expect(dialog).toBeHidden({ timeout: 20_000 });
  const row = page.getByText(new RegExp(esc(valueText)));
  await expect(row.first()).toBeVisible({ timeout: 20_000 });

  // --- Edit ---
  // Edit the reading we just created (matched by our unique note in its subtext).
  await page.getByRole('button', { name: new RegExp(`Edit reading .*${esc(valueText)}`) }).click();
  const editDialog = page.getByRole('dialog');
  await expect(editDialog).toBeVisible();
  await editDialog.locator('#value1').fill(String(editedBpm));
  await editDialog.getByRole('button', { name: 'Save changes' }).click();
  await expect(editDialog).toBeHidden({ timeout: 20_000 });

  const editedRow = page.getByText(new RegExp(esc(editedValueText)));
  await expect(editedRow.first()).toBeVisible({ timeout: 20_000 });

  // --- Delete (cleanup) ---
  await page
    .getByRole('button', { name: new RegExp(`Delete reading .*${esc(editedValueText)}`) })
    .click();
  const confirm = page.getByRole('dialog');
  await expect(confirm).toBeVisible();
  await confirm.getByRole('button', { name: 'Delete', exact: true }).click();

  await expect(editedRow).toHaveCount(0, { timeout: 20_000 });
});
