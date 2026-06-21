import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test, expect, uniqueLabel } from '../fixtures';

// Documents write flow: upload a document (unique Name + a real temp .pdf file)
// → verify it appears in the list → rename it via the edit modal and verify →
// delete it (cleanup) and verify it's gone. A run-unique Name keeps parallel/
// repeat runs from colliding, and the delete is the cleanup. The uploaded
// payload is a minimal PHI-free PDF (only jpg/jpeg/png/heic/pdf are accepted);
// the temp file is removed in `finally`.

// Smallest valid one-page PDF — PHI-free placeholder bytes.
const MINIMAL_PDF =
  '%PDF-1.1\n1 0 obj<</Type/Catalog/Pages 2 0 R>>endobj\n' +
  '2 0 obj<</Type/Pages/Kids[3 0 R]/Count 1>>endobj\n' +
  '3 0 obj<</Type/Page/Parent 2 0 R/MediaBox[0 0 100 100]>>endobj\n' +
  'trailer<</Root 1 0 R>>\n%%EOF\n';

// Escape a dynamic label for safe use inside a RegExp.
function rx(value: string): RegExp {
  return new RegExp(value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'));
}

test('upload, rename, and delete a document', async ({ page, circleId }) => {
  const name = uniqueLabel('Doc');
  const renamed = `${name} renamed`;

  // A tiny real file for the <input type=file>. Only jpg/jpeg/png/heic/pdf are
  // accepted, so write a minimal valid PDF. PHI-free filler only.
  const dir = mkdtempSync(join(tmpdir(), 'e2e-doc-'));
  const filePath = join(dir, `e2e-doc-${Date.now()}.pdf`);
  writeFileSync(filePath, MINIMAL_PDF);

  try {
    await page.goto(`/circles/${circleId}/documents`, { waitUntil: 'domcontentloaded' });
    await expect(page.getByRole('heading', { name: 'Documents' })).toBeVisible({ timeout: 15_000 });

    // --- Upload ---
    await page.getByRole('button', { name: 'Upload document' }).click();
    const uploadDialog = page.getByRole('dialog');
    await expect(uploadDialog).toBeVisible();

    await uploadDialog.locator('input[type="file"]').setInputFiles(filePath);
    // setInputFiles pre-fills the Name from the file name; overwrite with ours.
    await uploadDialog.locator('#document-upload-label').fill(name);
    await uploadDialog.locator('#document-upload-category').selectOption('medical_records');
    await uploadDialog.getByRole('button', { name: 'Upload', exact: true }).click();

    // Uploads route through a live dev tunnel — be generous.
    await expect(uploadDialog).toBeHidden({ timeout: 30_000 });
    const row = page.getByText(rx(name), { exact: false });
    await expect(row.first()).toBeVisible({ timeout: 30_000 });

    // --- Rename ---
    await page.getByRole('button', { name: rx(`Edit ${name}`) }).click();
    const editDialog = page.getByRole('dialog');
    await expect(editDialog).toBeVisible();
    await editDialog.locator('#document-edit-label').fill(renamed);
    await editDialog.getByRole('button', { name: 'Save', exact: true }).click();

    await expect(editDialog).toBeHidden({ timeout: 20_000 });
    await expect(page.getByText(rx(renamed), { exact: false }).first()).toBeVisible({
      timeout: 20_000,
    });

    // --- Delete (cleanup) ---
    await page.getByRole('button', { name: rx(`Delete ${renamed}`) }).click();
    const confirm = page.getByRole('dialog');
    await expect(confirm).toBeVisible();
    await confirm.getByRole('button', { name: 'Delete', exact: true }).click();

    await expect(page.getByText(rx(renamed), { exact: false })).toHaveCount(0, { timeout: 20_000 });
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
