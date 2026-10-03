import { randomUUID } from 'node:crypto';
import type { APIRequestContext, Page } from '@playwright/test';
import { test, expect } from '../fixtures';
import { sqlExec, sqlStr } from '../db';
import { adminUpload } from '../isolation';
import { failRequest } from '../unhappy';
import {
  cookieLogin,
  createCircle,
  createScopedAccount,
  ownerApi,
  uniq,
  type ScopedAccount,
} from '../unhappy/auth-invites/_helpers';
import { errorToast } from '../unhappy/writes/_helpers';

// Row "W5 documents Open / blob tab": the failure and fallback states of the
// in-app document viewer (DocumentPreviewModal, openInNewTab.ts) that
// flows/documents-viewer.spec.ts does not drive (it only walks the happy path):
//
//   (1) "Couldn't open this document": the fresh signed-URL read
//       (GET /api/circles/:id/documents, the viewer's first call) fails -> the
//       viewer shows the alert "Couldn't open this document" + "Check your
//       connection and try again." + Retry; Retry re-reads and the PDF frame
//       appears. One failed read, one retry.
//   (2) POPUP BLOCKED: the browser refuses the new tab (window.open -> null) ->
//       "Open in new tab" falls back to a download of the file under its label
//       and says "Your browser blocked the new tab, so the file is downloading
//       instead." No tab is opened.
//   (3) NEW TAB FAILED: the tab opens but the bytes cannot be fetched from Storage
//       (both the held signed URL and the fresh one) -> the empty tab is closed
//       again and the toast says "Couldn't open this document in a new tab.
//       Please try again."; the button is usable again.
// EN and ES.
//
// The document is a real PDF object in Storage at the path the upload route
// builds (adminUpload), inserted into a run-scoped circle owned by a run-scoped
// account, so the worker accounts' circles and the viewer spec are untouched.
// The row is deleted at the end; the Storage object goes with the account at
// teardown.
//
// FALSIFY: PW_FALSIFY=documents-open drops the precondition of every case (no
// failed read, a working window.open, a working Storage fetch), so each
// expectation of the failure state must go red; =documents-open:read | :popup |
// :fetch drops one.
// Proven against the app too (DocumentPreviewModal.tsx edited in place, then
// restored byte-identical, 10-02): with the error state swallowed, the
// popup-blocked fallback removed, or the new-tab failure toast removed, exactly
// the matching test (EN and ES) goes red.

test.use({ storageState: { cookies: [], origins: [] }, viewport: { width: 1280, height: 900 } });
test.setTimeout(90_000);

const FALSIFY = (process.env.PW_FALSIFY ?? '').split(',').filter(Boolean);
const falsify = (step: 'read' | 'popup' | 'fetch'): boolean =>
  FALSIFY.includes('documents-open') || FALSIFY.includes(`documents-open:${step}`);

type Lang = 'en' | 'es';

const COPY = {
  en: {
    failedTitle: "Couldn't open this document",
    failedMessage: 'Check your connection and try again.',
    retry: 'Retry',
    openInNewTab: 'Open in new tab',
    blocked: 'Your browser blocked the new tab, so the file is downloading instead.',
    newTabFailed: "Couldn't open this document in a new tab. Please try again.",
  },
  es: {
    failedTitle: 'No se pudo abrir este documento',
    failedMessage: 'Revisa tu conexión e inténtalo de nuevo.',
    retry: 'Reintentar',
    openInNewTab: 'Abrir en pestaña nueva',
    blocked: 'Tu navegador bloqueó la pestaña nueva, así que el archivo se está descargando.',
    newTabFailed: 'No se pudo abrir este documento en una pestaña nueva. Inténtalo de nuevo.',
  },
} as const;

const PDF_BYTES = new TextEncoder().encode(
  '%PDF-1.4\n1 0 obj<</Type/Catalog/Pages 2 0 R>>endobj\n' +
    '2 0 obj<</Type/Pages/Kids[3 0 R]/Count 1>>endobj\n' +
    '3 0 obj<</Type/Page/Parent 2 0 R/MediaBox[0 0 72 72]>>endobj\n' +
    'trailer<</Root 1 0 R>>\n%%EOF\n'
);

async function arrange(
  request: APIRequestContext,
  lang: Lang,
  tag: string
): Promise<{ owner: ScopedAccount; circleId: string; docId: string; label: string }> {
  const owner = await createScopedAccount(`docopen-${tag}-${lang}`);
  sqlExec(
    `update public.users set language = ${sqlStr(lang)}, language_set_at = now() ` +
      `where id = ${sqlStr(owner.userId)}::uuid;`
  );
  const circleId = await createCircle(await ownerApi(request, owner), uniq(`docopen-${tag}`));
  const label = `Informe Medico ${uniq('d')}`;
  const objectName = `${circleId.toLowerCase()}/${randomUUID()}.pdf`;
  await adminUpload('circle-documents', objectName, PDF_BYTES, 'application/pdf');
  const docId = randomUUID();
  sqlExec(`
    insert into circle_documents (id, circle_id, uploaded_by, label, category, file_path, file_type, file_size)
    values (${sqlStr(docId)}::uuid, ${sqlStr(circleId)}::uuid, ${sqlStr(owner.userId)}::uuid, ${sqlStr(label)},
            'medical_records', ${sqlStr(`circle-documents/${objectName}`)}, 'application/pdf', ${PDF_BYTES.byteLength})
  `);
  return { owner, circleId, docId, label };
}

const dropDocument = (docId: string): void =>
  sqlExec(`delete from circle_documents where id = ${sqlStr(docId)}::uuid`);

async function openDocumentsPage(page: Page, circleId: string, label: string): Promise<void> {
  await page.goto(`/circles/${circleId}/documents`, { waitUntil: 'domcontentloaded' });
  await expect(page.getByRole('button', { name: label, exact: true })).toBeVisible({ timeout: 30_000 });
}

for (const lang of ['en', 'es'] as const) {
  const c = COPY[lang];

  test(`documents (${lang.toUpperCase()}): a failed signed-URL read shows "Couldn't open this document" and Retry recovers`, async ({
    page,
    context,
    request,
    baseURL,
  }) => {
    const d = await arrange(request, lang, 'read');
    try {
      await cookieLogin(context, d.owner, baseURL);
      await openDocumentsPage(page, d.circleId, d.label);

      // The list is on screen; from now on EVERY read of the documents answers 500 until the fault is
      // lifted (not just the next one: in dev the viewer's mount effect runs twice under StrictMode and
      // the first read's result is discarded, so a single fault would be swallowed by the discarded read).
      const fault = falsify('read')
        ? null
        : await failRequest(page, 'GET', '/api/circles/:id/documents', { status: 500, times: 50 });
      await page.getByRole('button', { name: d.label, exact: true }).click();
      const dialog = page.getByRole('dialog', { name: d.label, exact: true });
      await expect(dialog).toBeVisible();

      const alert = dialog.getByRole('alert');
      await expect(alert).toContainText(c.failedTitle, { timeout: 20_000 });
      await expect(alert).toContainText(c.failedMessage);
      await expect(dialog.locator('iframe')).toHaveCount(0);
      expect(fault ? fault.hits : 1, 'the viewer read was refused').toBeGreaterThanOrEqual(1);
      // Nothing else in the viewer pretends to work: no new-tab button without a document.
      await expect(dialog.getByRole('button', { name: c.openInNewTab, exact: true })).toHaveCount(0);

      // Retry re-reads (the fault is lifted) and the document frame appears.
      await fault?.dispose();
      await dialog.getByRole('button', { name: c.retry, exact: true }).click();
      await expect(dialog.locator('iframe')).toBeVisible({ timeout: 20_000 });
      await expect(dialog.getByRole('alert')).toHaveCount(0);
      await expect(dialog.getByRole('button', { name: c.openInNewTab, exact: true })).toBeVisible();
    } finally {
      dropDocument(d.docId);
    }
  });

  test(`documents (${lang.toUpperCase()}): a blocked popup falls back to a download and says so`, async ({
    page,
    context,
    request,
    baseURL,
  }) => {
    const d = await arrange(request, lang, 'popup');
    try {
      // A browser that blocks the popup: window.open answers null (what Chrome does without a user
      // gesture / with the blocker on). Registered before any page script runs.
      if (!falsify('popup')) {
        await page.addInitScript(() => {
          window.open = () => null;
        });
      }
      await cookieLogin(context, d.owner, baseURL);
      await openDocumentsPage(page, d.circleId, d.label);
      await page.getByRole('button', { name: d.label, exact: true }).click();
      const dialog = page.getByRole('dialog', { name: d.label, exact: true });
      await expect(dialog.locator('iframe')).toBeVisible({ timeout: 20_000 });

      const pagesBefore = context.pages().length;
      // Headless Chromium has no PDF viewer, so the viewer's own <iframe> navigation to the signed URL
      // ALSO surfaces as a download (no `download=` parameter, named after the Storage object). The one
      // under test is the fallback's: the fresh signed URL carries `download=<label>.pdf`.
      const [download] = await Promise.all([
        page.waitForEvent('download', {
          timeout: 20_000,
          predicate: (d) => new URL(d.url()).searchParams.has('download'),
        }),
        dialog.getByRole('button', { name: c.openInNewTab, exact: true }).click(),
      ]);
      expect(download.suggestedFilename()).toBe(`${d.label}.pdf`);
      await expect(page.getByRole('status').filter({ hasText: c.blocked })).toBeVisible({ timeout: 10_000 });
      // No tab was opened, and no error was shown.
      expect(context.pages().length).toBe(pagesBefore);
      await expect(page.getByRole('alert').filter({ hasText: /\S/ })).toHaveCount(0);
    } finally {
      dropDocument(d.docId);
    }
  });

  test(`documents (${lang.toUpperCase()}): a new tab whose bytes cannot be fetched is closed again with an error toast`, async ({
    page,
    context,
    request,
    baseURL,
  }) => {
    const d = await arrange(request, lang, 'fetch');
    try {
      await cookieLogin(context, d.owner, baseURL);
      await openDocumentsPage(page, d.circleId, d.label);
      await page.getByRole('button', { name: d.label, exact: true }).click();
      const dialog = page.getByRole('dialog', { name: d.label, exact: true });
      await expect(dialog.locator('iframe')).toBeVisible({ timeout: 20_000 });

      // Storage answers every FETCH of the signed object with 500 (the PDF frame is not a fetch).
      let fetchesFailed = 0;
      if (!falsify('fetch')) {
        await page.route(
          (url) => url.pathname.includes('/storage/v1/object/sign/'),
          async (route) => {
            if (route.request().resourceType() !== 'fetch') return route.fallback();
            fetchesFailed += 1;
            await route.fulfill({ status: 500, contentType: 'text/plain', body: 'storage down' });
          }
        );
      }

      const button = dialog.getByRole('button', { name: c.openInNewTab, exact: true });
      const [tab] = await Promise.all([context.waitForEvent('page', { timeout: 15_000 }), button.click()]);
      await expect(errorToast(page, c.newTabFailed)).toBeVisible({ timeout: 25_000 });
      // The held URL, then a fresh one: two attempts, both refused.
      expect(fetchesFailed).toBe(2);
      // The empty tab the click opened was closed again.
      await expect.poll(() => tab.isClosed(), { timeout: 10_000 }).toBe(true);
      // The button works again.
      await expect(button).toBeEnabled();
    } finally {
      dropDocument(d.docId);
    }
  });
}
