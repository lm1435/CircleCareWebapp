import { randomUUID } from 'node:crypto';
import { test, expect, uniqueLabel } from '../fixtures';
import { sqlExec, sqlStr } from '../db';
import { adminUpload } from '../isolation';
import { checkA11y } from '../helpers';

// The in-app document viewer (web parity with mobile's DocumentViewerModal,
// 2026-09-29): row menu = Open / Edit / Delete; the viewer's header is the
// document LABEL, Close, and Download; "Open in new tab" opens a `blob:` URL on
// the app's origin — never the signed Storage URL (host + token in the address
// bar and history; memory feedback_no_system_browser_for_files).
//
// Seeds its own documents straight into the worker's isolated circle (a real
// Storage object at the path the upload route builds), so nothing here depends
// on the upload UI; documents.spec.ts covers that. Rows are deleted at the end;
// the isolated account's teardown removes the Storage objects.

const PDF_BYTES = new TextEncoder().encode(
  '%PDF-1.4\n1 0 obj<</Type/Catalog/Pages 2 0 R>>endobj\n' +
    '2 0 obj<</Type/Pages/Kids[3 0 R]/Count 1>>endobj\n' +
    '3 0 obj<</Type/Page/Parent 2 0 R/MediaBox[0 0 72 72]>>endobj\n' +
    'trailer<</Root 1 0 R>>\n%%EOF\n'
);
// HEIC can't render in a browser — any bytes do; the viewer never fetches them.
const HEIC_BYTES = new TextEncoder().encode('not-really-heic');

const LEAK = /supabase|storage|token|55321/i;

async function seedDocument(
  circleId: string,
  userId: string,
  label: string,
  kind: 'pdf' | 'heic'
): Promise<string> {
  const objectName = `${circleId.toLowerCase()}/${randomUUID()}.${kind}`;
  const mime = kind === 'pdf' ? 'application/pdf' : 'image/heic';
  const bytes = kind === 'pdf' ? PDF_BYTES : HEIC_BYTES;
  await adminUpload('circle-documents', objectName, bytes, mime);
  const id = randomUUID();
  sqlExec(`
    insert into circle_documents (id, circle_id, uploaded_by, label, category, file_path, file_type, file_size)
    values (${sqlStr(id)}::uuid, ${sqlStr(circleId)}::uuid, ${sqlStr(userId)}::uuid, ${sqlStr(label)},
            'medical_records', ${sqlStr(`circle-documents/${objectName}`)}, ${sqlStr(mime)}, ${bytes.byteLength})
  `);
  return id;
}

test.describe('document viewer', () => {
  test.use({ viewport: { width: 1280, height: 900 } });

  test('Open → label-titled viewer; new tab is a blob: URL; Download names the file', async (
    { page, context, circleId, account },
    testInfo
  ) => {
    const label = uniqueLabel('Viewer PDF');
    const heicLabel = uniqueLabel('Viewer HEIC');
    const ids = [
      await seedDocument(circleId, account.userId, label, 'pdf'),
      await seedDocument(circleId, account.userId, heicLabel, 'heic'),
    ];

    try {
      await page.goto(`/circles/${circleId}/documents`, { waitUntil: 'domcontentloaded' });
      const rowButton = page.getByRole('button', { name: label, exact: true });
      await expect(rowButton).toBeVisible({ timeout: 20_000 });

      // --- Row menu: exactly mobile's actions, order and words ---
      await page.getByRole('button', { name: `Options for ${label}`, exact: true }).click();
      const menu = page.getByRole('menu');
      await expect(menu).toBeVisible();
      await expect(menu.getByRole('menuitem')).toHaveText(['Open', 'Edit', 'Delete']);
      await menu.getByRole('menuitem', { name: 'Open', exact: true }).click();

      // --- Viewer: named and titled by the label, never a URL/host ---
      const dialog = page.getByRole('dialog', { name: label, exact: true });
      await expect(dialog).toBeVisible();
      await expect(dialog.locator('iframe')).toBeVisible({ timeout: 20_000 });
      // Visible header title (the sr-only h2 names the dialog).
      await expect(dialog.locator('p').filter({ hasText: label })).toBeVisible();
      expect(await dialog.innerText()).not.toMatch(LEAK);
      // No link anywhere in the dialog carries the signed URL.
      await expect(dialog.locator('a[href*="/storage/"]')).toHaveCount(0);
      await expect(dialog.getByRole('button', { name: 'Close preview' })).toBeVisible();
      await checkA11y(page, 'documents [viewer: pdf]', testInfo, { wcag22: true });

      // --- Open in new tab: a blob: URL on the app's origin ---
      // Headed Chrome renders the blob in its PDF viewer (address bar =
      // `blob:<origin>/<uuid>`). HEADLESS Chromium has no PDF viewer, so the
      // same navigation surfaces as a download of that blob: URL instead.
      // Either way, the URL the tab was sent to is what is asserted.
      // Listeners go on in the context's `page` handler — synchronously, as the
      // tab is created — so a fast blob download can't beat them.
      const tabRequests: string[] = [];
      let tabTarget = '';
      const onPage = (p: import('@playwright/test').Page): void => {
        p.on('request', (r) => tabRequests.push(r.url()));
        p.on('download', (d) => {
          tabTarget = d.url();
        });
        p.on('framenavigated', (f) => {
          if (f === p.mainFrame() && f.url().startsWith('blob:')) tabTarget = f.url();
        });
      };
      context.on('page', onPage);
      const [tab] = await Promise.all([
        context.waitForEvent('page'),
        dialog.getByRole('button', { name: 'Open in new tab', exact: true }).click(),
      ]);
      await expect.poll(() => tabTarget || tab.url(), { timeout: 20_000 }).toMatch(/^blob:/);
      context.off('page', onPage);
      if (!tabTarget) tabTarget = tab.url();
      expect(tabTarget).not.toMatch(LEAK);
      expect(tabTarget.startsWith(`blob:${new URL(page.url()).origin}/`)).toBe(true);
      expect(tab.url()).not.toMatch(LEAK);
      expect(tabRequests.filter((u) => LEAK.test(u))).toEqual([]);
      await tab.close();

      // --- Download: fresh signed URL, the label as the filename ---
      const [download] = await Promise.all([
        page.waitForEvent('download'),
        dialog.getByRole('button', { name: `Download ${label}`, exact: true }).click(),
      ]);
      expect(download.suggestedFilename()).toBe(`${label}.pdf`);
      await expect(page.getByText('Download started.', { exact: true })).toBeVisible();

      // --- Escape closes ---
      await page.keyboard.press('Escape');
      await expect(dialog).toBeHidden();

      // --- Row click on a type the browser can't render: can't-preview state ---
      await page.getByRole('button', { name: heicLabel, exact: true }).click();
      const heicDialog = page.getByRole('dialog', { name: heicLabel, exact: true });
      await expect(heicDialog).toBeVisible();
      await expect(heicDialog.getByText("This file can't be previewed here")).toBeVisible();
      await expect(heicDialog.getByText('Use Download to save it to your device.')).toBeVisible();
      await expect(heicDialog.getByRole('button', { name: 'Open in new tab' })).toHaveCount(0);
      await checkA11y(page, 'documents [viewer: unsupported]', testInfo, { wcag22: true });

      // 320px: the header (long label + Download + Close) wraps, nothing scrolls sideways.
      await page.setViewportSize({ width: 320, height: 800 });
      await expect(heicDialog.getByText("This file can't be previewed here")).toBeVisible();
      expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(320);
      await checkA11y(page, 'documents [viewer: unsupported @320]', testInfo, { wcag22: true });
      await page.screenshot({ path: testInfo.outputPath('viewer-320.png') });
      await page.setViewportSize({ width: 1280, height: 900 });

      const [heicDownload] = await Promise.all([
        page.waitForEvent('download'),
        heicDialog.getByRole('button', { name: `Download ${heicLabel}`, exact: true }).last().click(),
      ]);
      expect(heicDownload.suggestedFilename()).toBe(`${heicLabel}.heic`);
      await page.keyboard.press('Escape');
      await expect(heicDialog).toBeHidden();
      await expect(page.getByRole('button', { name: heicLabel, exact: true })).toBeFocused();
    } finally {
      sqlExec(`delete from circle_documents where id in (${ids.map((id) => `${sqlStr(id)}::uuid`).join(', ')})`);
    }
  });
});
