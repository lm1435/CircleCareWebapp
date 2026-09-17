import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test, expect, uniqueLabel } from '../fixtures';

// Documents write flow: upload a document (unique Name + a real temp .pdf file)
// → verify it appears in the list → preview it → rename it via the edit modal
// and verify → delete it (cleanup) and verify it's gone. A run-unique Name keeps
// parallel/repeat runs from colliding, and the delete is the cleanup. The
// uploaded payload is a minimal PHI-free PDF (only jpg/jpeg/png/heic/pdf are
// accepted); the temp file is removed in `finally`.
//
// PREVIEW REGRESSION GUARD — see the preview step below. PDF previews shipped
// broken in production: the frame carried a `sandbox` attribute, and Chrome
// refuses to run its built-in PDF viewer in ANY sandboxed frame (the attribute's
// presence is the trigger, not its tokens), so every user got "This page has
// been blocked by Chrome" instead of their document. What that failure looks
// like from the outside is an ordinary-looking <iframe> whose contents are a
// Chrome error page — the DOM says nothing is wrong. So this step asserts the
// frame's CONTRACT (no sandbox attribute; the viewer parameters we depend on),
// which is exactly what regressed. Note the limitation: Playwright cannot see
// inside Chrome's PDF viewer, so "pixels actually appeared" is not asserted here
// and stays a manual check.

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

/**
 * Preview/Download/Edit/Delete all live behind one trailing MoreMenu per row
 * now (DocumentRow.tsx spec §6.6), named "Options for <document name>" — not
 * separate inline buttons. Opens it and returns the menu, so the caller only
 * needs to click the menuitem it wants.
 */
async function openDocMenu(page: import('@playwright/test').Page, name: string) {
  await page.getByRole('button', { name: rx(`Options for ${name}`) }).click();
  const menu = page.getByRole('menu');
  await expect(menu).toBeVisible();
  return menu;
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
    // `exact: true` is load-bearing: getByRole's `name` is a SUBSTRING match,
    // so the bare 'Documents' also matched the empty state's own heading, "No
    // documents yet". The two only coexist once the (async) list query has
    // resolved to zero rows, so this raced the fetch — strict-mode violation
    // when the query won, pass when it lost. Exactly the same trap as the
    // week view's "N more all-day event" toggle vs the modal footer's "More"
    // in calendar.spec.ts. documents-controls.spec.ts already pins it.
    await expect(
      page.getByRole('heading', { name: 'Documents', exact: true })
    ).toBeVisible({ timeout: 15_000 });

    // --- Upload ---
    await page.getByRole('button', { name: 'Upload document' }).first().click();
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

    // --- Preview (regression guard, see header) ---
    const previewMenu = await openDocMenu(page, name);
    await previewMenu.getByRole('menuitem', { name: 'Preview', exact: true }).click();
    const previewDialog = page.getByRole('dialog');
    await expect(previewDialog).toBeVisible();

    const frame = previewDialog.locator('iframe');
    await expect(frame).toBeVisible({ timeout: 20_000 });

    // A `sandbox` attribute of ANY value makes Chrome blank the PDF viewer.
    // There is no "minimal safe sandbox" to allow here — assert its absence.
    await expect(frame).not.toHaveAttribute('sandbox', /.*/);

    // The frame points at the signed Storage URL and carries the viewer
    // parameters that collapse Chrome's left-hand thumbnail rail.
    const frameSrc = await frame.getAttribute('src');
    expect(frameSrc, 'preview frame has no src').toBeTruthy();
    expect(frameSrc).toContain('/storage/v1/object/sign/');
    expect(frameSrc).toContain('#navpanes=0');

    // The fragment is a VIEWER-only concern: the new-tab escape hatch must stay
    // the bare signed URL so it opens the file, not a parameterised view.
    const newTabHref = await previewDialog
      .getByRole('link', { name: 'Open in new tab' })
      .getAttribute('href');
    expect(newTabHref).not.toContain('#');
    expect(frameSrc).toBe(`${newTabHref}#navpanes=0`);

    await previewDialog.getByRole('button', { name: 'Close preview' }).click();
    await expect(previewDialog).toBeHidden({ timeout: 10_000 });

    // --- Rename ---
    const editMenu = await openDocMenu(page, name);
    await editMenu.getByRole('menuitem', { name: 'Edit', exact: true }).click();
    const editDialog = page.getByRole('dialog');
    await expect(editDialog).toBeVisible();
    await editDialog.locator('#document-edit-label').fill(renamed);
    await editDialog.getByRole('button', { name: 'Save', exact: true }).click();

    await expect(editDialog).toBeHidden({ timeout: 20_000 });
    await expect(page.getByText(rx(renamed), { exact: false }).first()).toBeVisible({
      timeout: 20_000,
    });

    // --- Delete (cleanup) ---
    const deleteMenu = await openDocMenu(page, renamed);
    await deleteMenu.getByRole('menuitem', { name: 'Delete', exact: true }).click();
    const confirm = page.getByRole('dialog');
    await expect(confirm).toBeVisible();
    await confirm.getByRole('button', { name: 'Delete', exact: true }).click();

    await expect(page.getByText(rx(renamed), { exact: false })).toHaveCount(0, { timeout: 20_000 });
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
