import type { APIRequestContext, Page } from '@playwright/test';
import { test, expect, uniqueLabel } from '../../fixtures';
import { countRequests, dbCount, dbQuery, failRequest, sqlStr } from '../../unhappy';
import { MINIMAL_PDF } from '../access/_helpers';
import { captureJson, cookieLogin, createCircle, createScopedAccount, ownerApi, uniq } from '../auth-invites/_helpers';
import { doubleSubmitWhileHeld, errorToast } from './_helpers';

// K10 — DOCUMENT UPLOAD FAILURES. A run-scoped account with its own circle (the
// worker circle's storage bar stays clean; globalTeardown purges the account).
//
// A failed upload must leave the modal open with label + file kept and nothing in
// the database or in Storage; a retry then writes exactly one row and one object;
// a double submit writes one; an oversize file never leaves the browser; bytes
// that are not a PDF are answered by the server, not stored.
test.use({ storageState: { cookies: [], origins: [] } });
test.setTimeout(90_000);

const UPLOAD = '/api/circles/:id/documents/upload';
const SAVE_FAILED = 'Something went wrong. Please try again.';
const UNSUPPORTED_OR_DAMAGED = "This file type isn't supported, or the file is damaged. Try a different file.";

async function setup(request: APIRequestContext, context: import('@playwright/test').BrowserContext, baseURL: string | undefined, page: Page) {
  const acct = await createScopedAccount('doc-up');
  const api = await ownerApi(request, acct);
  const circleId = await createCircle(api, uniq('doc-up'));
  await cookieLogin(context, acct, baseURL);
  await page.goto(`/circles/${circleId}/documents`, { waitUntil: 'domcontentloaded' });
  await expect(page.getByRole('heading', { name: 'Documents', exact: true })).toBeVisible({ timeout: 20_000 });
  return { acct, circleId };
}

const objectCount = (circleId: string) =>
  dbCount(`select 1 from storage.objects where bucket_id = 'circle-documents' and name like ${sqlStr(`${circleId}/%`)}`);
const docRows = (circleId: string, label: string) =>
  `select 1 from circle_documents where circle_id = ${sqlStr(circleId)}::uuid and label = ${sqlStr(label)}`;

async function openUpload(page: Page, name: string, label: string, buffer: Buffer = MINIMAL_PDF, mimeType = 'application/pdf') {
  await page.getByRole('button', { name: 'Upload document' }).first().click();
  const dialog = page.getByRole('dialog');
  await expect(dialog).toBeVisible();
  await dialog.locator('input[type="file"]').setInputFiles({ name, mimeType, buffer });
  await dialog.locator('#document-upload-label').fill(label);
  await dialog.locator('#document-upload-category').selectOption('medical_records');
  return { dialog, upload: dialog.getByRole('button', { name: 'Upload', exact: true }) };
}

for (const [faultName, fault] of [
  ['HTTP 500', { status: 500, code: 'SERVER_ERROR', message: 'Internal server error' }],
  ['network abort', { abort: true as const }],
] as const) {
  test(`${faultName} on the first upload keeps the dialog, label and file, writes nothing, and a retry writes exactly one`, async ({
    page,
    request,
    context,
    baseURL,
  }) => {
    const { circleId } = await setup(request, context, baseURL, page);
    const label = uniqueLabel('UP');
    const { dialog, upload } = await openUpload(page, 'scan.pdf', label);
    const injected = await failRequest(page, 'POST', UPLOAD, { ...fault, times: 1 });
    const sent = countRequests(page, 'POST', UPLOAD);
    const objectsBefore = objectCount(circleId);

    await upload.click();
    await injected.expectHits(1);
    await expect(errorToast(page, SAVE_FAILED)).toBeVisible({ timeout: 15_000 });
    await expect(errorToast(page, SAVE_FAILED)).toHaveCount(1);
    await expect(dialog).toBeVisible();
    await expect(dialog.locator('#document-upload-label')).toHaveValue(label);
    expect(await dialog.locator('input[type="file"]').evaluate((i: HTMLInputElement) => i.files?.length)).toBe(1);
    await expect(dialog.getByText('scan.pdf')).toBeVisible();
    await expect(upload).toBeEnabled();
    expect(dbCount(docRows(circleId, label)), 'nothing written by the failed attempt').toBe(0);
    expect(objectCount(circleId)).toBe(objectsBefore);
    expect(sent.count).toBe(1);

    await upload.click({ timeout: 5_000 });
    await expect(dialog).toBeHidden({ timeout: 30_000 });
    await sent.expectCount(2);
    expect(dbCount(docRows(circleId, label)), 'exactly one row after the retry').toBe(1);
    expect(objectCount(circleId)).toBe(objectsBefore + 1);
    const [{ file_path }] = dbQuery<{ file_path: string }>(
      `select file_path from circle_documents where circle_id = ${sqlStr(circleId)}::uuid and label = ${sqlStr(label)}`
    );
    expect(file_path.startsWith(`circle-documents/${circleId}/`), `object prefix ${file_path}`).toBe(true);
    sent.dispose();
  });
}

test('double submit while the upload is pending writes one row and one object', async ({ page, request, context, baseURL }) => {
  const { circleId } = await setup(request, context, baseURL, page);
  const label = uniqueLabel('UP');
  const { dialog, upload } = await openUpload(page, 'twice.pdf', label);
  const objectsBefore = objectCount(circleId);
  await doubleSubmitWhileHeld(page, { method: 'POST', path: UPLOAD, submit: upload });
  await expect(dialog).toBeHidden({ timeout: 30_000 });
  expect(dbCount(docRows(circleId, label))).toBe(1);
  expect(objectCount(circleId)).toBe(objectsBefore + 1);
});

test('a file over the 10 MB cap is refused in the modal and no request is sent', async ({ page, request, context, baseURL }) => {
  const { circleId } = await setup(request, context, baseURL, page);
  const label = uniqueLabel('UP');
  const sent = countRequests(page, 'POST', UPLOAD);
  const { dialog, upload } = await openUpload(page, 'big.pdf', label, Buffer.alloc(10 * 1024 * 1024 + 1, 0x20));
  await upload.click();
  await expect(dialog.getByText('This file is too large. The limit is 10.0 MB.')).toBeVisible();
  await page.waitForTimeout(500);
  expect(sent.count).toBe(0);
  expect(dbCount(docRows(circleId, label))).toBe(0);
  sent.dispose();
});

test('bytes that are not a PDF (named x.pdf): the server answer is pinned, nothing is stored', async ({ page, request, context, baseURL }) => {
  const { circleId } = await setup(request, context, baseURL, page);
  const label = uniqueLabel('UP');
  const cap = await captureJson(page, 'POST', UPLOAD);
  const objectsBefore = objectCount(circleId);
  const { dialog, upload } = await openUpload(page, 'x.pdf', label, Buffer.from('this is plain text, not a pdf'));
  await upload.click();
  const res = await cap.next();
  expect(res.status).toBe(400);
  expect((res.json as { error: { code: string } }).error.code).toBe('VALIDATION_ERROR');
  // PK19 (approved-recs-2026-09-30, B2/B7): the 400 now names its reason and the dialog says what is wrong
  // instead of the generic "Something went wrong" (BV 2026-10-01 updated this pin; code/status unchanged).
  expect((res.json as { error: { details?: { reason?: string } } }).error.details?.reason).toBe('CONTENT_MISMATCH');
  await expect(errorToast(page, UNSUPPORTED_OR_DAMAGED)).toBeVisible({ timeout: 15_000 });
  await expect(errorToast(page, SAVE_FAILED)).toHaveCount(0);
  await expect(dialog).toBeVisible();
  expect(dbCount(docRows(circleId, label))).toBe(0);
  expect(objectCount(circleId)).toBe(objectsBefore);
  await cap.dispose();
});
