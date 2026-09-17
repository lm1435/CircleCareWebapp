import { test, expect, uniqueLabel } from '../../fixtures';
import { sqlExec } from '../../db';
import { countRequests, dbCount, dbQuery, sqlStr } from '../../unhappy';
import { downgradeSeatWhenRequested, gotoCirclePage, setSeatViewOnly } from '../access/_helpers';
import { errorToast } from './_helpers';

// SEAT DOWNGRADED TO VIEW-ONLY MID-EDIT (light; the access suite covers seat
// gating deeply).
//
// The freeMember persona is a NON-OWNER EDITOR (the one free caregiver seat of
// a free host's circle), so it is offered "Edit medical information". It opens
// the editor and makes a change; at the instant the browser SENDS the save,
// `downgradeSeatWhenRequested` really downgrades the stored seat
// (`circle_memberships.view_only = true`, what `applyCaregiverCap` writes) and
// lets the request through. Nothing is injected: the REAL backend refuses the
// save (`requireCircleEditAccess` → 403 VIEW_ONLY,
// backend/src/middleware/circleAccess.ts:59-67) and the REAL backend answers the
// refetch with `can_edit: false`.
//
// The modal must say so with the permission copy — not the generic "try
// again", which invites a retry that can never succeed — and must NOT behave as
// if it saved: it stays open with the edit intact (EditMedicalInfoModal closes
// only on success). The client must re-read its gating flags exactly once
// (`invalidateCircleAccessFlags`), which withdraws the Edit control, and the
// database row must be untouched. The seat is restored in `finally`.

test.use({ persona: 'freeMember' });

const SAVE_PATH = '/api/circles/:id/emergency-info';

test('emergency medical info: seat downgraded while the editor is open → real 403 VIEW_ONLY, permission toast, modal kept, flags refetched once, Edit withdrawn, row unchanged', async ({
  page,
  personaHandle: h,
}) => {
  const allergy = uniqueLabel('403 allergy');
  const c = `${sqlStr(h.circleId)}::uuid`;
  // The whole row the save would change (every medical field + updated_at).
  const snapshot = () =>
    dbQuery<{ v: string }>(
      `select concat_ws('#', coalesce(blood_type, ''), coalesce(array_to_string(medication_allergies, '|'), ''),
              coalesce(array_to_string(allergies, '|'), ''), coalesce(array_to_string(medical_conditions, '|'), ''),
              coalesce(updated_at::text, '')) as v
         from emergency_info where circle_id = ${c}`
    )[0]?.v ?? '(no row)';
  try {
    setSeatViewOnly(h.circleId, h.userId, false);
    await gotoCirclePage(page, h.circleId, 'emergency');
    await expect(page.getByRole('heading', { name: 'Emergency Info' })).toBeVisible({ timeout: 20_000 });
    const edit = page.getByRole('button', { name: 'Edit medical information', exact: true });
    await expect(edit.first(), 'the editor seat is offered Edit').toBeVisible({ timeout: 20_000 });
    await edit.first().click();
    const dialog = page.getByRole('dialog', { name: 'Medical information' });
    await expect(dialog).toBeVisible({ timeout: 20_000 });
    const input = dialog.locator('#allergies-input');
    await input.fill(allergy);
    await input.press('Enter');
    await expect(dialog.getByRole('button', { name: `Remove ${allergy}` })).toBeVisible();
    const before = snapshot();

    await downgradeSeatWhenRequested(page, 'PUT', SAVE_PATH, h);
    const puts = countRequests(page, 'PUT', SAVE_PATH);
    const detail = countRequests(page, 'GET', '/api/circles/:id');
    const answered = page.waitForResponse(
      (r) => r.request().method() === 'PUT' && /^\/api\/circles\/[^/]+\/emergency-info$/.test(new URL(r.url()).pathname),
      { timeout: 20_000 }
    );
    await dialog.getByRole('button', { name: 'Save', exact: true }).click();

    const res = await answered;
    expect(res.status(), 'the real backend refused the save').toBe(403);
    expect(((await res.json()) as { error?: { code?: string } }).error?.code, 'the real refusal code').toBe('VIEW_ONLY');

    await expect(errorToast(page, "You don't have permission to edit this circle.")).toBeVisible({ timeout: 15_000 });
    await expect(errorToast(page, "We couldn't save your changes. Please try again.")).toHaveCount(0);
    await puts.expectCount(1);
    await detail.expectCount(1, { message: 'exactly one GET /api/circles/:id after the refusal' });
    // The refetched flags (real backend, seat now view-only) withdraw the control.
    await expect(edit, 'Edit medical information withdrawn after the refetch').toHaveCount(0, { timeout: 15_000 });

    // Did not claim success: still open, edit intact, no success toast, row unchanged.
    await expect(dialog).toBeVisible();
    await expect(dialog.getByRole('button', { name: `Remove ${allergy}` })).toBeVisible();
    await expect(page.getByRole('status').filter({ hasText: /saved|updated/i })).toHaveCount(0);
    expect(snapshot(), 'emergency_info row unchanged').toBe(before);
    expect(dbCount(`select 1 from emergency_info where circle_id = ${c} and ${sqlStr(allergy)} = any(allergies)`)).toBe(0);
  } finally {
    setSeatViewOnly(h.circleId, h.userId, false);
    sqlExec(`update emergency_info set allergies = array_remove(allergies, ${sqlStr(allergy)}) where circle_id = ${c};`);
  }
});
