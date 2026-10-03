import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test, expect, uniqueLabel } from '../fixtures';

// PK19 (approved-recs-2026-09-30, B7): a file whose bytes do not match its
// declared type (here: plain text renamed .pdf) is refused by the backend with
// 400 VALIDATION_ERROR + `error.details.reason` (B2). The upload modal's toast
// names the problem ("unsupported or damaged") instead of the generic
// "couldn't save", and the modal stays open so the user can pick another file.
const UNSUPPORTED_COPY =
  "This file type isn't supported, or the file is damaged. Try a different file.";

test('a renamed non-PDF upload shows the specific unsupported-or-damaged message', async ({
  page,
  circleId,
}) => {
  const dir = mkdtempSync(join(tmpdir(), 'e2e-badfile-'));
  const filePath = join(dir, `e2e-bad-${Date.now()}.pdf`);
  writeFileSync(filePath, 'MZ this is not a pdf, it is plain filler text\n'.repeat(4));

  try {
    await page.goto(`/circles/${circleId}/documents`, { waitUntil: 'domcontentloaded' });
    await expect(page.getByRole('heading', { name: 'Documents', exact: true })).toBeVisible({
      timeout: 15_000,
    });

    await page.getByRole('button', { name: 'Upload document' }).first().click();
    const uploadDialog = page.getByRole('dialog');
    await expect(uploadDialog).toBeVisible();
    await uploadDialog.locator('input[type="file"]').setInputFiles(filePath);
    await uploadDialog.locator('#document-upload-label').fill(uniqueLabel('BadDoc'));
    await uploadDialog.locator('#document-upload-category').selectOption('medical_records');
    await uploadDialog.getByRole('button', { name: 'Upload', exact: true }).click();

    await expect(page.getByText(UNSUPPORTED_COPY)).toBeVisible({ timeout: 30_000 });
    // Not the generic failure, and the modal stays open for another attempt.
    await expect(page.getByText('Something went wrong. Please try again.')).toHaveCount(0);
    await expect(uploadDialog).toBeVisible();
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
