import type { APIRequestContext, Browser, Page } from '@playwright/test';
import { test, expect } from '../fixtures';
import {
  COPY,
  KINDS,
  SEED,
  bChangesEntry,
  bInsertsFirst,
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
// PK5 stale DELETES, page level (EmergencyInfoPage.confirmDelete): deleting an
// emergency contact / doctor / insurance plan from a list that is out of date.
// A deletes with the REAL "..." menu + Remove confirm; B's change is made
// through the API while A's page still shows the old list.
//
//   * CHANGED: B edits the entry A is about to delete. A's delete is REFUSED
//     (409 EMERGENCY_INFO_CHANGED), the toast shows, the confirm closes, the
//     list now shows B's value, the entry is still on the server with B's value.
//   * MOVED: B inserts a new entry AHEAD of the seeded ones, so every position
//     shifts. A's delete (by what A saw) is REFUSED; the server still holds B's
//     new entry AND the entry A tried to delete (a last-write-wins write of the
//     stale array minus A's entry would wipe B's new entry). A then deletes
//     again from the refreshed list: only the chosen entry goes.
//   * ES (doctor), and the PRIMARY doctor (flat primary_doctor_* fields).
//
// Test ids (PW_FALSIFY=emergency-stale:<id>): delete-changed-{contact,doctor,
// insurance}, delete-moved-{contact,doctor,insurance}, delete-changed-doctor-es,
// delete-changed-primary-doctor. PW_FALSIFY=emergency-stale (all) skips B's
// change: A's delete is then NOT stale, so it is accepted (200) and the
// "refused" assertion must go red.
// ===========================================================================

test.use({ storageState: { cookies: [], origins: [] } });
test.setTimeout(120_000);

interface Ctx {
  browser: Browser;
  request: APIRequestContext;
  baseURL: string | undefined;
}

type Variant = 'changed' | 'moved';

async function staleDeleteScenario(ctx: Ctx, kind: Kind, variant: Variant, lang: Lang, id: string): Promise<void> {
  const copy = COPY[lang];
  const noun = copy.noun[kind.id];
  const w = await world(ctx.request, { ownerLanguage: lang });
  const A = await loggedInPage(ctx.browser, w.owner, ctx.baseURL, w.circleId, lang);
  try {
    const target = SEED[kind.field][0] as Json;
    const bystander = SEED[kind.field][1] as Json;
    const name = entryName(kind, target);
    const insertedName = entryName(kind, kind.inserted);
    const rowOf = (n: string) => A.page.getByRole('button', { name: `${copy.actionsFor} ${n}`, exact: true });

    // A's page has the seeded list on screen (the stale view).
    await expect(rowOf(name)).toBeVisible({ timeout: 20_000 });

    // B changes the list behind A's back.
    if (!falsify(id)) {
      if (variant === 'changed') await bChangesEntry(w, kind, 0, { [kind.valueKey]: kind.bValue });
      else await bInsertsFirst(w, kind, kind.inserted);
    }
    const afterB = await serverInfo(w.ownerSession, w.circleId);

    // A deletes the entry she saw: menu -> Delete -> confirm.
    await openEntryAction(A.page, copy, noun, name, 'delete');
    const confirm = A.page.getByRole('dialog', { name: copy.removeTitle[kind.id] });
    await expect(confirm).toBeVisible({ timeout: 15_000 });
    const refusedPut = waitPut(A.page, w.circleId);
    await confirm.getByRole('button', { name: copy.del, exact: true }).click();
    const { versions } = await expectRefused(await refusedPut, [kind.field]);

    // Said so; the stale confirm is dropped; the list behind now shows B's version.
    await expectConflictToast(A.page, copy);
    await expect(confirm).toBeHidden({ timeout: 15_000 });
    await expect(rowOf(name), 'the entry A tried to delete is still listed').toBeVisible({ timeout: 15_000 });
    if (variant === 'changed') {
      await expect(A.page.getByText(kind.bValue, { exact: true }).first()).toBeVisible({ timeout: 15_000 });
    } else {
      await expect(rowOf(insertedName), "B's new entry appeared in A's list").toBeVisible({ timeout: 15_000 });
    }

    // Nothing was deleted: the server is exactly what B left.
    const afterRefusal = await serverInfo(w.ownerSession, w.circleId);
    expect(JSON.stringify(afterRefusal), 'the refused delete changed nothing').toBe(JSON.stringify(afterB));
    const kept = names(kind, afterRefusal[kind.field] as Json[]);
    expect(kept).toContain(name);
    if (variant === 'changed') {
      expect((afterRefusal[kind.field] as Json[])[0][kind.valueKey]).toBe(kind.bValue);
      expect(kept).toEqual([name, entryName(kind, bystander)]);
    } else {
      expect(kept, "B's inserted entry and both seeded entries survive").toEqual([
        insertedName,
        name,
        entryName(kind, bystander),
      ]);
    }

    // A deletes again from the refreshed list: it goes through with the fresh version,
    // and ONLY the chosen entry is removed.
    await openEntryAction(A.page, copy, noun, name, 'delete');
    await expect(confirm).toBeVisible({ timeout: 15_000 });
    const redoPut = waitPut(A.page, w.circleId);
    await confirm.getByRole('button', { name: copy.del, exact: true }).click();
    const redo = await redoPut;
    expect(redo.status(), 'the re-done delete saves').toBe(200);
    const sent = redo.request().postDataJSON() as { if_match?: Record<string, string> };
    expect(sent.if_match?.[kind.field], 'the retry carries the version the 409 returned').toBe(versions[kind.field]);
    await expect(confirm).toBeHidden({ timeout: 20_000 });
    await expect(rowOf(name)).toHaveCount(0, { timeout: 20_000 });
    const final = names(kind, await serverArray(w.ownerSession, w.circleId, kind.field));
    expect(final).toEqual(variant === 'changed' ? [entryName(kind, bystander)] : [insertedName, entryName(kind, bystander)]);
  } finally {
    await A.context.close();
  }
}

for (const kind of KINDS) {
  test(`${kind.id} delete: the entry was CHANGED meanwhile: the delete is refused, the list reloads, the server keeps the change`, async ({
    browser,
    request,
    baseURL,
  }) => {
    await staleDeleteScenario({ browser, request, baseURL }, kind, 'changed', 'en', `delete-changed-${kind.id}`);
  });

  test(`${kind.id} delete: the list MOVED meanwhile (a new entry inserted ahead): the delete is refused, nothing is lost`, async ({
    browser,
    request,
    baseURL,
  }) => {
    await staleDeleteScenario({ browser, request, baseURL }, kind, 'moved', 'en', `delete-moved-${kind.id}`);
  });
}

test('ES doctor delete: the entry was changed meanwhile: the Spanish message shows and the delete is refused', async ({
  browser,
  request,
  baseURL,
}) => {
  await staleDeleteScenario({ browser, request, baseURL }, KINDS[1], 'changed', 'es', 'delete-changed-doctor-es');
});

test('primary doctor delete: the doctor was changed meanwhile: the delete is refused, the server keeps the change', async ({
  browser,
  request,
  baseURL,
}) => {
  const id = 'delete-changed-primary-doctor';
  const copy = COPY.en;
  const w = await world(request);
  const A = await loggedInPage(browser, w.owner, baseURL, w.circleId);
  try {
    const name = SEED.primary_doctor_name;
    const row = A.page.getByRole('button', { name: `${copy.actionsFor} ${name}`, exact: true });
    await expect(row).toBeVisible({ timeout: 20_000 });

    if (!falsify(id)) await putAs(w.memberSession, w.circleId, { primary_doctor_specialty: 'Oncology B-wrote' });
    const afterB = await serverInfo(w.ownerSession, w.circleId);

    await openEntryAction(A.page, copy, copy.noun.doctor, name, 'delete');
    const confirm = A.page.getByRole('dialog', { name: copy.removeTitle.primary });
    await expect(confirm).toBeVisible({ timeout: 15_000 });
    const refusedPut = waitPut(A.page, w.circleId);
    await confirm.getByRole('button', { name: copy.del, exact: true }).click();
    // The delete names four flat fields; only the one B changed conflicts.
    const { versions } = await expectRefused(await refusedPut, ['primary_doctor_specialty']);

    await expectConflictToast(A.page, copy);
    await expect(confirm).toBeHidden({ timeout: 15_000 });
    await expect(row).toBeVisible();
    await expect(A.page.getByText('Oncology B-wrote', { exact: true }).first()).toBeVisible({ timeout: 15_000 });
    const afterRefusal = await serverInfo(w.ownerSession, w.circleId);
    expect(JSON.stringify(afterRefusal), 'the refused delete changed nothing').toBe(JSON.stringify(afterB));
    expect(afterRefusal.primary_doctor_name).toBe(name);
    expect(afterRefusal.primary_doctor_specialty).toBe('Oncology B-wrote');

    // Again from the refreshed page: the primary doctor goes.
    await openEntryAction(A.page, copy, copy.noun.doctor, name, 'delete');
    await expect(confirm).toBeVisible({ timeout: 15_000 });
    const redoPut = waitPut(A.page, w.circleId);
    await confirm.getByRole('button', { name: copy.del, exact: true }).click();
    const redo = await redoPut;
    expect(redo.status(), 'the re-done delete saves').toBe(200);
    const sent = redo.request().postDataJSON() as { if_match?: Record<string, string> };
    expect(sent.if_match?.primary_doctor_specialty).toBe(versions.primary_doctor_specialty);
    await expect(confirm).toBeHidden({ timeout: 20_000 });
    await expect(row).toHaveCount(0, { timeout: 20_000 });
    const final = await serverInfo(w.ownerSession, w.circleId);
    expect(final.primary_doctor_name).toBeNull();
    expect(final.primary_doctor_specialty).toBeNull();
  } finally {
    await A.context.close();
  }
});

// ---------------------------------------------------------------------------
// The confirm is OPEN when the list shifts (found by this spec, fixed in
// EmergencyInfoPage + buildEmergencyDelete).
//
// The page used to keep only the POSITION of the entry to delete and, on
// confirm, slice the LIVE cache with it under the LIVE versions. A tab refocus
// refetches the list ('refetchOnWindowFocus: always'); if another caregiver
// removed an EARLIER entry meanwhile, the position named the neighbour, and
// because the versions were fresh too there was no 409: the neighbour was
// deleted, the chosen entry stayed.
//
//   A: [first, second, third]; A opens "Delete" on SECOND and leaves the confirm
//   open; B removes FIRST; A's tab refocuses -> the list is [second, third];
//   A confirms.
//
// Now the delete is built from the snapshot the list was rendered from when
// Delete was picked, with ITS versions: the server refuses (409), nothing is
// deleted, the toast shows, the confirm closes, the list shows the fresh state,
// and deleting SECOND again from there removes exactly SECOND. Chosen behaviour
// (refuse + reload, not a silent re-target): see buildEmergencyDelete.
// Test ids: delete-shift-{contact,doctor,insurance}, delete-shift-primary-doctor.
// PW_FALSIFY skips B's change: nothing shifts, so the delete goes through and the
// "refused" assertion must go red.
// ---------------------------------------------------------------------------

/** The refetch a tab regaining focus triggers (React Query's focus handler listens for visibilitychange). */
async function refocus(page: Page, circleId: string): Promise<void> {
  const refetched = page.waitForResponse(
    (r) => r.request().method() === 'GET' && new URL(r.url()).pathname === `/api/circles/${circleId}/emergency-info`,
    { timeout: 20_000 }
  );
  await page.evaluate(() => {
    for (const state of ['hidden', 'visible']) {
      Object.defineProperty(document, 'visibilityState', { value: state, configurable: true });
      document.dispatchEvent(new Event('visibilitychange', { bubbles: true }));
    }
  });
  await refetched;
}

for (const kind of KINDS) {
  test(`${kind.id} delete: the list SHIFTS while the confirm is OPEN (tab refocus): the delete is refused, never the neighbour deleted`, async ({
    browser,
    request,
    baseURL,
  }) => {
    const id = `delete-shift-${kind.id}`;
    const copy = COPY.en;
    const noun = copy.noun[kind.id];
    const w = await world(request);
    const [first, second] = SEED[kind.field] as unknown as Json[];
    const third = kind.third;
    const [firstName, secondName, thirdName] = [first, second, third].map((e) => entryName(kind, e));
    await putAs(w.ownerSession, w.circleId, { [kind.field]: [first, second, third] });
    const A = await loggedInPage(browser, w.owner, baseURL, w.circleId);
    try {
      const rowOf = (n: string) => A.page.getByRole('button', { name: `${copy.actionsFor} ${n}`, exact: true });
      await expect(rowOf(thirdName)).toBeVisible({ timeout: 20_000 });

      // A picks Delete on SECOND (position 1) and leaves the confirm open.
      await openEntryAction(A.page, copy, noun, secondName, 'delete');
      const confirm = A.page.getByRole('dialog', { name: copy.removeTitle[kind.id] });
      await expect(confirm).toBeVisible({ timeout: 15_000 });

      // B removes FIRST (an earlier entry): second moves to position 0, third to position 1.
      if (!falsify(id)) await bRemovesEntry(w, kind, 0);
      const afterB = await serverInfo(w.ownerSession, w.circleId);
      expect(names(kind, afterB[kind.field] as Json[])).toEqual(
        falsify(id) ? [firstName, secondName, thirdName] : [secondName, thirdName]
      );

      // A's tab regains focus: the list behind the confirm refetches to the shifted one.
      await refocus(A.page, w.circleId);
      if (!falsify(id)) await expect(rowOf(firstName)).toHaveCount(0, { timeout: 15_000 });

      // A confirms. The server refuses (the page sent what A saw, with the versions A saw).
      const putA = waitPut(A.page, w.circleId);
      await confirm.getByRole('button', { name: copy.del, exact: true }).click();
      const { versions } = await expectRefused(await putA, [kind.field]);
      await expectConflictToast(A.page, copy);
      await expect(confirm).toBeHidden({ timeout: 15_000 });

      // Nothing was deleted: the neighbour (third) is NOT gone, second is still there.
      const afterRefusal = await serverInfo(w.ownerSession, w.circleId);
      expect(JSON.stringify(afterRefusal), 'the refused delete changed nothing').toBe(JSON.stringify(afterB));
      await expect(rowOf(secondName)).toBeVisible();
      await expect(rowOf(thirdName)).toBeVisible();

      // A deletes SECOND again from the refreshed list: exactly second goes.
      await openEntryAction(A.page, copy, noun, secondName, 'delete');
      await expect(confirm).toBeVisible({ timeout: 15_000 });
      const redoPut = waitPut(A.page, w.circleId);
      await confirm.getByRole('button', { name: copy.del, exact: true }).click();
      const redo = await redoPut;
      expect(redo.status(), 'the re-done delete saves').toBe(200);
      const sent = redo.request().postDataJSON() as { if_match?: Record<string, string> };
      expect(sent.if_match?.[kind.field], 'the retry carries the version the 409 returned').toBe(versions[kind.field]);
      await expect(confirm).toBeHidden({ timeout: 20_000 });
      await expect(rowOf(secondName)).toHaveCount(0, { timeout: 20_000 });
      expect(names(kind, await serverArray(w.ownerSession, w.circleId, kind.field))).toEqual([thirdName]);
    } finally {
      await A.context.close();
    }
  });
}

test('primary doctor delete: the doctor is CHANGED while the confirm is OPEN (tab refocus): the delete is refused, the doctor stays', async ({
  browser,
  request,
  baseURL,
}) => {
  const id = 'delete-shift-primary-doctor';
  const copy = COPY.en;
  const w = await world(request);
  const A = await loggedInPage(browser, w.owner, baseURL, w.circleId);
  try {
    const name = SEED.primary_doctor_name;
    const row = A.page.getByRole('button', { name: `${copy.actionsFor} ${name}`, exact: true });
    await expect(row).toBeVisible({ timeout: 20_000 });
    await openEntryAction(A.page, copy, copy.noun.doctor, name, 'delete');
    const confirm = A.page.getByRole('dialog', { name: copy.removeTitle.primary });
    await expect(confirm).toBeVisible({ timeout: 15_000 });

    if (!falsify(id)) await putAs(w.memberSession, w.circleId, { primary_doctor_specialty: 'Oncology B-wrote' });
    const afterB = await serverInfo(w.ownerSession, w.circleId);
    await refocus(A.page, w.circleId);
    if (!falsify(id)) await expect(A.page.getByText('Oncology B-wrote', { exact: true }).first()).toBeVisible({ timeout: 15_000 });

    // The delete was picked on the doctor A saw; it is not silently re-based onto B's edit.
    const putA = waitPut(A.page, w.circleId);
    await confirm.getByRole('button', { name: copy.del, exact: true }).click();
    await expectRefused(await putA, ['primary_doctor_specialty']);
    await expectConflictToast(A.page, copy);
    await expect(confirm).toBeHidden({ timeout: 15_000 });
    const afterRefusal = await serverInfo(w.ownerSession, w.circleId);
    expect(JSON.stringify(afterRefusal), 'the refused delete changed nothing').toBe(JSON.stringify(afterB));
    expect(afterRefusal.primary_doctor_name).toBe(name);
    await expect(row).toBeVisible();
  } finally {
    await A.context.close();
  }
});
