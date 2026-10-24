import type { Page, Response } from '@playwright/test';
import { test, expect } from '../fixtures';
import {
  COPY,
  SEED,
  loggedInPage,
  openEntryAction,
  serverArray,
  serverInfo,
  world,
  type Json,
  type World,
} from '../emergencyStaleShared';

// ===========================================================================
// DOCTORS WITH STABLE IDS (notes by doctor, docs/plans/notes-by-doctor.md).
//
// A doctor is edited with PATCH /providers/:id and removed with POST
// /providers/:id/archive: the request names the DOCTOR, never a position in an
// array and never a section version. That is what retires the PK5 "stale
// editor / stale delete" races for doctors (emergency-stale-edit / -delete now
// cover contacts and insurance only). What replaces them, against two real
// caregivers and the real backend:
//
//   edit   - B changed the SAME doctor meanwhile: A's save still lands (last
//            write wins per field set; PROVIDERS_API_CONTRACT 1.3), on the right
//            doctor, with nothing else touched;
//   edit   - B REMOVED the doctor A is editing: PATCH answers 409
//            PROVIDER_ARCHIVED, A is told, the editor closes, nothing is resurrected;
//   delete - B removed an EARLIER doctor while A's confirm is open (every
//            position shifts): exactly the doctor A chose is archived, never the
//            neighbour that now sits at that position;
//   delete - B already removed the doctor A is confirming: told, confirm closes;
//   delete - the PRIMARY doctor is archived by primary_doctor_id.
// ===========================================================================

test.use({ storageState: { cookies: [], origins: [] } });
test.setTimeout(120_000);

const copy = COPY.en;
const ALREADY_REMOVED = /This doctor was already removed/;

const isProviderWrite =
  (circleId: string, method: 'PATCH' | 'POST', suffix = '') =>
  (r: Response): boolean => {
    const path = new URL(r.url()).pathname;
    return (
      r.request().method() === method &&
      path.startsWith(`/api/circles/${circleId}/providers/`) &&
      path.endsWith(suffix)
    );
  };

async function doctorsOf(w: World): Promise<Json[]> {
  return serverArray(w.ownerSession, w.circleId, 'additional_doctors');
}

const idOf = (d: Json): string => String(d.id);

/** B's background change, through the per-doctor API (a second caregiver's client). */
async function bPatch(w: World, id: string, body: Json): Promise<void> {
  const res = await w.memberSession.patch(`/api/circles/${w.circleId}/providers/${id}`, body);
  expect(res.ok(), `B PATCH → ${res.status()} ${await res.text()}`).toBe(true);
}
async function bArchive(w: World, id: string): Promise<void> {
  const res = await w.memberSession.post(`/api/circles/${w.circleId}/providers/${id}/archive`, {});
  expect(res.ok(), `B archive → ${res.status()} ${await res.text()}`).toBe(true);
}

const rowOf = (page: Page, name: string) =>
  page.getByRole('button', { name: `${copy.actionsFor} ${name}`, exact: true });

test('edit: B changed the same doctor meanwhile - A\'s save still lands on THAT doctor, nothing else moves', async ({
  browser,
  request,
  baseURL,
}) => {
  const w = await world(request);
  const A = await loggedInPage(browser, w.owner, baseURL, w.circleId);
  try {
    const [cho, diaz] = await doctorsOf(w);
    expect(cho.id, 'the emergency-info GET names each doctor by id').toBeTruthy();
    await openEntryAction(A.page, copy, copy.noun.doctor, String(cho.name), 'edit');
    const dialog = A.page.getByRole('dialog');
    await expect(dialog).toBeVisible({ timeout: 20_000 });
    const specialty = dialog.locator('#doctor-specialty');
    await expect(specialty).toHaveValue(String(cho.specialty));

    await bPatch(w, idOf(cho), { specialty: 'Oncology B-wrote' });

    await specialty.fill('Radiology A-wrote');
    const [saved] = await Promise.all([
      A.page.waitForResponse(isProviderWrite(w.circleId, 'PATCH'), { timeout: 30_000 }),
      dialog.getByRole('button', { name: copy.save, exact: true }).click(),
    ]);
    expect(saved.status(), 'no section version to be stale against').toBe(200);
    expect(new URL(saved.url()).pathname.endsWith(`/providers/${idOf(cho)}`)).toBe(true);
    await expect(dialog).toBeHidden({ timeout: 20_000 });

    const after = await doctorsOf(w);
    expect(after.map(idOf)).toEqual([idOf(cho), idOf(diaz)]);
    expect(after[0].specialty).toBe('Radiology A-wrote');
    expect(after[0].name).toBe(cho.name);
    expect(after[0].phone).toBe(cho.phone);
    expect(after[1]).toEqual(diaz);
  } finally {
    await A.context.close();
  }
});

test('edit: B REMOVED the doctor being edited - told it is gone, the editor closes, nothing is resurrected', async ({
  browser,
  request,
  baseURL,
}) => {
  const w = await world(request);
  const A = await loggedInPage(browser, w.owner, baseURL, w.circleId);
  try {
    const [cho, diaz] = await doctorsOf(w);
    await openEntryAction(A.page, copy, copy.noun.doctor, String(cho.name), 'edit');
    const dialog = A.page.getByRole('dialog');
    await expect(dialog).toBeVisible({ timeout: 20_000 });

    await bArchive(w, idOf(cho));

    await dialog.locator('#doctor-specialty').fill('Radiology A-wrote');
    const [refused] = await Promise.all([
      A.page.waitForResponse(isProviderWrite(w.circleId, 'PATCH'), { timeout: 30_000 }),
      dialog.getByRole('button', { name: copy.save, exact: true }).click(),
    ]);
    expect(refused.status()).toBe(409);
    expect(((await refused.json()) as { error: { code: string } }).error.code).toBe('PROVIDER_ARCHIVED');
    await expect(A.page.getByRole('alert').filter({ hasText: ALREADY_REMOVED })).toBeVisible({
      timeout: 15_000,
    });

    await expect(dialog).toBeHidden({ timeout: 15_000 });
    await expect(rowOf(A.page, String(cho.name))).toHaveCount(0, { timeout: 15_000 });
    await expect(rowOf(A.page, String(diaz.name))).toBeVisible();
    expect((await doctorsOf(w)).map(idOf), 'the removed doctor was not resurrected').toEqual([idOf(diaz)]);
  } finally {
    await A.context.close();
  }
});

test('delete: B removed an EARLIER doctor while the confirm is open (positions shift) - exactly the chosen doctor goes, never the neighbour', async ({
  browser,
  request,
  baseURL,
}) => {
  const w = await world(request);
  const third = {
    name: 'Dr Eze Seed',
    specialty: 'Oncology',
    phone: '(303) 555-0113',
    country_code: '+1',
  };
  const added = await w.ownerSession.post(`/api/circles/${w.circleId}/providers`, third);
  expect(added.status()).toBe(201);
  const A = await loggedInPage(browser, w.owner, baseURL, w.circleId);
  try {
    const [cho, diaz, eze] = await doctorsOf(w);
    expect([cho.name, diaz.name, eze.name]).toEqual(['Dr Cho Seed', 'Dr Diaz Seed', 'Dr Eze Seed']);
    await expect(rowOf(A.page, String(eze.name))).toBeVisible({ timeout: 20_000 });

    // A picks Delete on the SECOND doctor and leaves the confirm open.
    await openEntryAction(A.page, copy, copy.noun.doctor, String(diaz.name), 'delete');
    const confirm = A.page.getByRole('dialog', { name: copy.removeTitle.doctor });
    await expect(confirm).toBeVisible({ timeout: 15_000 });

    // B removes the FIRST doctor: Diaz is now position 0, Eze position 1.
    await bArchive(w, idOf(cho));
    expect((await doctorsOf(w)).map(idOf)).toEqual([idOf(diaz), idOf(eze)]);

    // A's tab regains focus (the list behind the confirm refetches), then A confirms.
    const refetched = A.page.waitForResponse(
      (r) => r.request().method() === 'GET' && new URL(r.url()).pathname === `/api/circles/${w.circleId}/emergency-info`,
      { timeout: 20_000 }
    );
    await A.page.evaluate(() => {
      for (const state of ['hidden', 'visible']) {
        Object.defineProperty(document, 'visibilityState', { value: state, configurable: true });
        document.dispatchEvent(new Event('visibilitychange', { bubbles: true }));
      }
    });
    await refetched;
    await expect(rowOf(A.page, String(cho.name))).toHaveCount(0, { timeout: 15_000 });

    const [archived] = await Promise.all([
      A.page.waitForResponse(isProviderWrite(w.circleId, 'POST', '/archive'), { timeout: 30_000 }),
      confirm.getByRole('button', { name: copy.del, exact: true }).click(),
    ]);
    expect(archived.status()).toBe(200);
    expect(new URL(archived.url()).pathname).toBe(`/api/circles/${w.circleId}/providers/${idOf(diaz)}/archive`);
    await expect(confirm).toBeHidden({ timeout: 20_000 });
    await expect(rowOf(A.page, String(diaz.name))).toHaveCount(0, { timeout: 20_000 });
    await expect(rowOf(A.page, String(eze.name)), 'the neighbour at the old position stays').toBeVisible();
    expect((await doctorsOf(w)).map(idOf)).toEqual([idOf(eze)]);
  } finally {
    await A.context.close();
  }
});

test('delete: B already removed the doctor being confirmed - told, the confirm closes, the list is fresh', async ({
  browser,
  request,
  baseURL,
}) => {
  const w = await world(request);
  const A = await loggedInPage(browser, w.owner, baseURL, w.circleId);
  try {
    const [cho, diaz] = await doctorsOf(w);
    await openEntryAction(A.page, copy, copy.noun.doctor, String(cho.name), 'delete');
    const confirm = A.page.getByRole('dialog', { name: copy.removeTitle.doctor });
    await expect(confirm).toBeVisible({ timeout: 15_000 });

    await bArchive(w, idOf(cho));

    const [res] = await Promise.all([
      A.page.waitForResponse(isProviderWrite(w.circleId, 'POST', '/archive'), { timeout: 30_000 }),
      confirm.getByRole('button', { name: copy.del, exact: true }).click(),
    ]);
    // Archiving is idempotent server side: a second archive is a 200 with the original archived_at.
    expect(res.status()).toBe(200);
    await expect(confirm).toBeHidden({ timeout: 20_000 });
    await expect(rowOf(A.page, String(cho.name))).toHaveCount(0, { timeout: 15_000 });
    await expect(rowOf(A.page, String(diaz.name))).toBeVisible();
    expect((await doctorsOf(w)).map(idOf)).toEqual([idOf(diaz)]);
  } finally {
    await A.context.close();
  }
});

test('primary doctor delete: B changed it meanwhile - the doctor A chose is archived by primary_doctor_id', async ({
  browser,
  request,
  baseURL,
}) => {
  const w = await world(request);
  const A = await loggedInPage(browser, w.owner, baseURL, w.circleId);
  try {
    const before = await serverInfo(w.ownerSession, w.circleId);
    const primaryId = String(before.primary_doctor_id);
    expect(primaryId, 'the GET names the primary doctor by id').toMatch(/^[0-9a-f-]{36}$/);
    const name = SEED.primary_doctor_name;

    await openEntryAction(A.page, copy, copy.noun.doctor, name, 'delete');
    const confirm = A.page.getByRole('dialog', { name: copy.removeTitle.primary });
    await expect(confirm).toBeVisible({ timeout: 15_000 });

    await bPatch(w, primaryId, { specialty: 'Oncology B-wrote' });

    const [res] = await Promise.all([
      A.page.waitForResponse(isProviderWrite(w.circleId, 'POST', '/archive'), { timeout: 30_000 }),
      confirm.getByRole('button', { name: copy.del, exact: true }).click(),
    ]);
    expect(res.status()).toBe(200);
    expect(new URL(res.url()).pathname).toBe(`/api/circles/${w.circleId}/providers/${primaryId}/archive`);
    await expect(confirm).toBeHidden({ timeout: 20_000 });
    await expect(rowOf(A.page, name)).toHaveCount(0, { timeout: 20_000 });
    const after = await serverInfo(w.ownerSession, w.circleId);
    expect(after.primary_doctor_name ?? null).toBeNull();
  } finally {
    await A.context.close();
  }
});
