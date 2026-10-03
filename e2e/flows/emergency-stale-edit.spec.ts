import type { APIRequestContext, Browser } from '@playwright/test';
import { test, expect } from '../fixtures';
import {
  COPY,
  KINDS,
  SEED,
  bChangesEntry,
  bRemovesEntry,
  entryName,
  expectConflictToast,
  expectRefused,
  falsify,
  loggedInPage,
  names,
  openEntryAction,
  putAs,
  serverArray,
  serverInfo,
  waitPut,
  world,
  type Json,
  type Kind,
  type Lang,
} from '../emergencyStaleShared';

// ===========================================================================
// PK5 stale EDITORS for emergency CONTACTS, DOCTORS and INSURANCE plans
// (coverage map row X10; the Medical-info twin is emergency-concurrent-edit).
// Two REAL caregivers, the real backend, the REAL editor modals:
//
//   1. A (owner) opens the editor on an entry;
//   2. B (the other caregiver) changes THE SAME entry through the API;
//   3. A edits and saves;
//   4. A's save is REFUSED (409 EMERGENCY_INFO_CHANGED naming the one section),
//      the conflict toast shows (EN, and ES for a contact), A's editor STAYS
//      OPEN reloaded with B's value (A's stale draft is gone), and the server
//      still holds B's change and nothing else of A's (the whole row, incl.
//      updated_at, is untouched). A then makes the change again: it saves with
//      the FRESH version the 409 handed back.
//
// Also: B REMOVES the entry A is editing -> A's save is refused, the editor
// closes (nothing left to edit) and the removed entry is NOT resurrected; and
// the PRIMARY doctor (flat primary_doctor_* fields, a different code path from
// the additional_doctors array).
//
// Test ids (PW_FALSIFY=emergency-stale:<id>): edit-contact, edit-doctor,
// edit-insurance, edit-contact-es, removed-contact, removed-doctor,
// removed-insurance, edit-primary-doctor. PW_FALSIFY=emergency-stale (all)
// skips B's change: A's save is then NOT stale, so it is accepted (200) and the
// "refused" assertion must go red.
// ===========================================================================

test.use({ storageState: { cookies: [], origins: [] } });
test.setTimeout(120_000);

interface Ctx {
  browser: Browser;
  request: APIRequestContext;
  baseURL: string | undefined;
}

async function staleEditScenario(ctx: Ctx, kind: Kind, lang: Lang, id: string): Promise<void> {
  const copy = COPY[lang];
  const w = await world(ctx.request, { ownerLanguage: lang });
  const A = await loggedInPage(ctx.browser, w.owner, ctx.baseURL, w.circleId, lang);
  try {
    const target = SEED[kind.field][0] as Json;
    const bystander = SEED[kind.field][1] as Json;
    const name = entryName(kind, target);

    // 1. A opens the editor on the entry, loaded with the seeded value.
    await openEntryAction(A.page, copy, copy.noun[kind.id], name, 'edit');
    const dialog = A.page.getByRole('dialog');
    await expect(dialog).toBeVisible({ timeout: 20_000 });
    const input = dialog.locator(kind.input);
    await expect(input).toHaveValue(String(target[kind.valueKey]));

    // 2. B changes the same entry meanwhile (the stale-making event).
    if (!falsify(id)) await bChangesEntry(w, kind, 0, { [kind.valueKey]: kind.bValue });
    const afterB = await serverInfo(w.ownerSession, w.circleId);

    // 3. A (stale) types over the same field and saves.
    await input.fill(kind.aValue);
    const refusedPut = waitPut(A.page, w.circleId);
    await dialog.getByRole('button', { name: copy.save, exact: true }).click();
    const res = await refusedPut;

    // 4. Refused, and says so, in A's language.
    const { versions } = await expectRefused(res, [kind.field]);
    await expectConflictToast(A.page, copy);

    // The editor stays open and shows the SERVER's value: B's in, A's stale draft out.
    await expect(dialog).toBeVisible();
    await expect(input).toHaveValue(kind.bValue, { timeout: 15_000 });
    await expect(input).not.toHaveValue(kind.aValue);
    await expect(dialog.locator(kind.nameInput)).toHaveValue(name);

    // The server still holds B's change, and A wrote NOTHING (not even updated_at moved).
    const afterRefusal = await serverInfo(w.ownerSession, w.circleId);
    expect(JSON.stringify(afterRefusal), 'the refused save changed nothing').toBe(JSON.stringify(afterB));
    const list = afterRefusal[kind.field] as Json[];
    expect(list[0][kind.valueKey]).toBe(kind.bValue);
    expect(list[0][kind.valueKey]).not.toBe(kind.aValue);
    expect(list[1]).toEqual(expect.objectContaining(bystander));

    // A makes the change again: it saves, with the FRESH version from the 409.
    await input.fill(kind.aValue2);
    const redoPut = waitPut(A.page, w.circleId);
    await dialog.getByRole('button', { name: copy.save, exact: true }).click();
    const redo = await redoPut;
    expect(redo.status(), 'the re-done change saves').toBe(200);
    const sent = redo.request().postDataJSON() as { if_match?: Record<string, string> };
    expect(sent.if_match?.[kind.field], 'the retry carries the version the 409 returned').toBe(versions[kind.field]);
    await expect(dialog).toBeHidden({ timeout: 20_000 });
    const final = await serverArray(w.ownerSession, w.circleId, kind.field);
    expect(names(kind, final)).toEqual(names(kind, SEED[kind.field] as unknown as Json[]));
    expect(final[0][kind.valueKey]).toBe(kind.aValue2);
    expect(final[1]).toEqual(expect.objectContaining(bystander));
  } finally {
    await A.context.close();
  }
}

for (const kind of KINDS) {
  test(`${kind.id}: a stale save is refused, the editor reloads with the other caregiver's value, the server keeps theirs`, async ({
    browser,
    request,
    baseURL,
  }) => {
    await staleEditScenario({ browser, request, baseURL }, kind, 'en', `edit-${kind.id}`);
  });
}

test('ES contact: the stale save is refused with the Spanish message and the editor reloads with the other caregiver\'s value', async ({
  browser,
  request,
  baseURL,
}) => {
  await staleEditScenario({ browser, request, baseURL }, KINDS[0], 'es', 'edit-contact-es');
});

for (const kind of KINDS) {
  test(`${kind.id}: the other caregiver REMOVED the entry being edited: the save is refused, the editor closes, nothing is resurrected`, async ({
    browser,
    request,
    baseURL,
  }) => {
    const id = `removed-${kind.id}`;
    const copy = COPY.en;
    const w = await world(request);
    const A = await loggedInPage(browser, w.owner, baseURL, w.circleId);
    try {
      const target = SEED[kind.field][0] as Json;
      const bystander = SEED[kind.field][1] as Json;
      const name = entryName(kind, target);

      await openEntryAction(A.page, copy, copy.noun[kind.id], name, 'edit');
      const dialog = A.page.getByRole('dialog');
      await expect(dialog).toBeVisible({ timeout: 20_000 });

      // B removes exactly that entry.
      if (!falsify(id)) await bRemovesEntry(w, kind, 0);
      const afterB = await serverInfo(w.ownerSession, w.circleId);

      // A (stale) edits and saves: a last-write-wins write would put the entry back.
      await dialog.locator(kind.input).fill(kind.aValue);
      const putA = waitPut(A.page, w.circleId);
      await dialog.getByRole('button', { name: copy.save, exact: true }).click();
      await expectRefused(await putA, [kind.field]);
      await expectConflictToast(A.page, copy);

      // Nothing left to edit: the editor closes; the list behind shows the latest.
      await expect(dialog).toBeHidden({ timeout: 15_000 });
      await expect(A.page.getByRole('button', { name: `${copy.actionsFor} ${name}`, exact: true })).toHaveCount(0, {
        timeout: 15_000,
      });
      await expect(
        A.page.getByRole('button', { name: `${copy.actionsFor} ${entryName(kind, bystander)}`, exact: true })
      ).toBeVisible();

      // The entry stays removed on the server; A wrote nothing.
      const serverNow = await serverInfo(w.ownerSession, w.circleId);
      expect(JSON.stringify(serverNow), 'the refused save changed nothing').toBe(JSON.stringify(afterB));
      expect(names(kind, serverNow[kind.field] as Json[]), 'the removed entry was not resurrected').toEqual([
        entryName(kind, bystander),
      ]);
    } finally {
      await A.context.close();
    }
  });
}

test('primary doctor: a stale save is refused, the editor reloads with the other caregiver\'s value, the server keeps theirs', async ({
  browser,
  request,
  baseURL,
}) => {
  const id = 'edit-primary-doctor';
  const copy = COPY.en;
  const w = await world(request);
  const A = await loggedInPage(browser, w.owner, baseURL, w.circleId);
  try {
    const name = SEED.primary_doctor_name;
    await openEntryAction(A.page, copy, copy.noun.doctor, name, 'edit');
    const dialog = A.page.getByRole('dialog', { name: copy.primaryTitle });
    await expect(dialog).toBeVisible({ timeout: 20_000 });
    const specialty = dialog.locator('#doctor-specialty');
    await expect(specialty).toHaveValue(SEED.primary_doctor_specialty);

    // B changes the primary doctor's specialty meanwhile.
    if (!falsify(id)) await putAs(w.memberSession, w.circleId, { primary_doctor_specialty: 'Oncology B-wrote' });
    const afterB = await serverInfo(w.ownerSession, w.circleId);

    await specialty.fill('Radiology A-stale');
    const refusedPut = waitPut(A.page, w.circleId);
    await dialog.getByRole('button', { name: copy.save, exact: true }).click();
    // Only the flat field B changed conflicts; the other four A named did not move.
    const { versions } = await expectRefused(await refusedPut, ['primary_doctor_specialty']);
    await expectConflictToast(A.page, copy);

    await expect(dialog).toBeVisible();
    await expect(specialty).toHaveValue('Oncology B-wrote', { timeout: 15_000 });
    await expect(dialog.locator('#doctor-name')).toHaveValue(name);
    const afterRefusal = await serverInfo(w.ownerSession, w.circleId);
    expect(JSON.stringify(afterRefusal), 'the refused save changed nothing').toBe(JSON.stringify(afterB));
    expect(afterRefusal.primary_doctor_specialty).toBe('Oncology B-wrote');

    // The retry saves with the fresh version.
    await specialty.fill('Radiology A-again');
    const redoPut = waitPut(A.page, w.circleId);
    await dialog.getByRole('button', { name: copy.save, exact: true }).click();
    const redo = await redoPut;
    expect(redo.status(), 'the re-done change saves').toBe(200);
    const sent = redo.request().postDataJSON() as { if_match?: Record<string, string> };
    expect(sent.if_match?.primary_doctor_specialty).toBe(versions.primary_doctor_specialty);
    await expect(dialog).toBeHidden({ timeout: 20_000 });
    const final = await serverInfo(w.ownerSession, w.circleId);
    expect(final.primary_doctor_specialty).toBe('Radiology A-again');
    expect(final.primary_doctor_name).toBe(name);
  } finally {
    await A.context.close();
  }
});
