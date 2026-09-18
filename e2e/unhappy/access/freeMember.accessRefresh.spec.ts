import { test, expect, uniqueLabel } from '../../fixtures';
import { API_ERRORS, countRequests, dbCount, failRequest, sqlStr } from '../../unhappy';
import {
  downgradeSeatWhenRequested,
  gotoCirclePage,
  loadSurfaceData,
  setSeatViewOnly,
  sidebarNew,
} from './_helpers';

// ===========================================================================
// ACCESS REFRESH — a write refused mid-session makes the client re-read its
// gating flags and withdraw the controls, in a real browser.
//
// The unit suite mocks this (`viewOnlyGateRefresh.test.tsx`). Here the
// freeMember persona starts as an EDITOR — every write control is on screen —
// and then:
//
//   403 VIEW_ONLY   the write is answered by `failRequest` (never reaches the
//                   backend, so nothing can be written), and AT THE MOMENT the
//                   browser sends it the stored seat is really downgraded
//                   (`circle_memberships.view_only = true`, exactly what
//                   `applyCaregiverCap` writes). So the refetch the client makes
//                   is answered by the REAL backend deriving `can_edit: false`,
//                   and the controls must disappear because of THAT refetch.
//   402             the write is refused as premium-only; the client must show
//                   the upgrade prompt (and still refetch its flags).
//
// Each test proves: exactly one GET /api/circles/:id after the refusal, the
// right toast, the controls withdrawn / the upgrade prompt, and no row in the
// database. The seat is restored in `finally`.
// ===========================================================================

test.use({ persona: 'freeMember' });

const MINIMAL_PDF = Buffer.from(
  '%PDF-1.1\n1 0 obj<</Type/Catalog/Pages 2 0 R>>endobj\n' +
    '2 0 obj<</Type/Pages/Kids[3 0 R]/Count 1>>endobj\n' +
    '3 0 obj<</Type/Page/Parent 2 0 R/MediaBox[0 0 100 100]>>endobj\n' +
    'trailer<</Root 1 0 R>>\n%%EOF\n'
);

function todayISO(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

test('calendar: event create refused 403 VIEW_ONLY → detail refetched, Add event withdrawn, permission toast, no row', async ({
  page,
  personaHandle: h,
}) => {
  const title = uniqueLabel('Refresh event');
  try {
    await gotoCirclePage(page, h.circleId, 'calendar');
    await expect(page.getByRole('button', { name: /, (Appointment|Task|Medication),/ }).first()).toBeVisible({
      timeout: 20_000,
    });
    const add = page.getByRole('button', { name: 'Add event', exact: true });
    await expect(add).toBeVisible();
    await expect(sidebarNew(page)).toBeEnabled();

    await add.click();
    const dialog = page.getByRole('dialog');
    await expect(dialog).toBeVisible();
    await dialog.locator('#event_type').selectOption('task');
    await dialog.locator('#title').fill(title);
    await dialog.locator('#scheduled_date').fill(todayISO());

    const fault = await failRequest(page, 'POST', '/api/circles/:id/events', API_ERRORS.viewOnly);
    await downgradeSeatWhenRequested(page, 'POST', '/api/circles/:id/events', h);
    const detail = countRequests(page, 'GET', '/api/circles/:id');
    await dialog.getByRole('button', { name: 'Create', exact: true }).click();

    await fault.expectHits(1);
    await expect(page.getByText("You don't have permission to make changes in this circle.")).toBeVisible();
    await detail.expectCount(1);
    await expect(add).toHaveCount(0, { timeout: 15_000 });
    await expect(sidebarNew(page)).toBeDisabled();
    expect(
      dbCount(`select 1 from calendar_events where circle_id = ${sqlStr(h.circleId)}::uuid and title = ${sqlStr(title)}`),
      'no event row'
    ).toBe(0);
  } finally {
    setSeatViewOnly(h.circleId, h.userId, false);
  }
});

test('documents: upload refused 403 VIEW_ONLY → detail refetched, Upload withdrawn, permission toast, no row', async ({
  page,
  personaHandle: h,
}) => {
  const label = uniqueLabel('Refresh doc');
  const data = loadSurfaceData(h);
  try {
    await gotoCirclePage(page, h.circleId, 'documents');
    await expect(page.getByText(data.documentLabel!).first()).toBeVisible({ timeout: 20_000 });
    const upload = page.getByRole('button', { name: 'Upload document', exact: true });
    await expect(upload).toBeVisible();

    await upload.click();
    const dialog = page.getByRole('dialog');
    await expect(dialog).toBeVisible();
    await dialog.locator('input[type="file"]').setInputFiles({
      name: 'e2e-refresh.pdf',
      mimeType: 'application/pdf',
      buffer: MINIMAL_PDF,
    });
    await dialog.locator('#document-upload-label').fill(label);
    await dialog.locator('#document-upload-category').selectOption('medical_records');

    const fault = await failRequest(page, 'POST', '/api/circles/:id/documents/**', API_ERRORS.viewOnly);
    await downgradeSeatWhenRequested(page, 'POST', '/api/circles/:id/documents/**', h);
    const detail = countRequests(page, 'GET', '/api/circles/:id');
    await dialog.getByRole('button', { name: 'Upload', exact: true }).click();

    await fault.expectHits(1);
    await expect(page.getByText("You don't have permission to do that.")).toBeVisible();
    await detail.expectCount(1);
    await expect(upload).toHaveCount(0, { timeout: 15_000 });
    await expect(sidebarNew(page)).toBeDisabled();
    expect(
      dbCount(`select 1 from circle_documents where circle_id = ${sqlStr(h.circleId)}::uuid and label = ${sqlStr(label)}`),
      'no document row'
    ).toBe(0);
  } finally {
    setSeatViewOnly(h.circleId, h.userId, false);
  }
});

test('vitals: reading refused 402 SUBSCRIPTION_REQUIRED → detail refetched, owner-only upgrade notice (no Upgrade action), no row', async ({
  page,
  personaHandle: h,
}) => {
  const note = uniqueLabel('Refresh vital');
  const data = loadSurfaceData(h);
  await gotoCirclePage(page, h.circleId, 'vitals');
  await expect(page.getByText(data.vitalText!).first()).toBeVisible({ timeout: 20_000 });
  const add = page.getByRole('button', { name: 'Add reading', exact: true });
  await expect(add).toBeVisible();

  await add.click();
  const dialog = page.getByRole('dialog');
  await expect(dialog).toBeVisible();
  await dialog.locator('#vital_type').selectOption('heart_rate');
  await dialog.locator('#value1').fill('77');
  await dialog.locator('#notes').fill(note);

  const fault = await failRequest(page, 'POST', '/api/circles/:id/vitals', {
    status: 402,
    code: 'SUBSCRIPTION_REQUIRED',
    message: 'Upgrade to Premium',
  });
  const detail = countRequests(page, 'GET', '/api/circles/:id');
  await dialog.getByRole('button', { name: 'Save reading' }).click();

  await fault.expectHits(1);
  // Owner-aware gate (usePremiumGate with { circleId }): a NON-owner of the
  // circle is told only the owner can upgrade, and is offered no Upgrade action.
  await expect(
    page.getByText(/^This is a Premium feature for this circle\. Only (.+, )?the circle owner,? can upgrade\.$/)
  ).toBeVisible();
  await expect(page.getByText("That feature isn't included in the free plan.", { exact: false })).toHaveCount(0);
  await expect(page.getByText("You don't have permission to make this change.")).toHaveCount(0);
  await detail.expectCount(1);
  expect(
    dbCount(`select 1 from health_vitals where circle_id = ${sqlStr(h.circleId)}::uuid and notes = ${sqlStr(note)}`),
    'no vital row'
  ).toBe(0);

  await expect(page.getByRole('button', { name: 'Upgrade', exact: true })).toHaveCount(0);
  await expect(page).not.toHaveURL(/\/upgrade$/);
});
