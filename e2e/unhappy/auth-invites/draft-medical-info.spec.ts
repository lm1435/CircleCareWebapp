import type { APIRequestContext, Locator, Page } from '@playwright/test';
import { test, expect } from '../../fixtures';
import { sqlExec } from '../../db';
import { dbCount, dbQuery, failRequest, sqlStr, type ApiSession, type FaultHandle } from '../../unhappy';
import {
  cookieLogin,
  createCircle,
  createInvite,
  createScopedAccount,
  membershipCount,
  ownerApi,
  settle,
  uniq,
  type ScopedAccount,
} from './_helpers';

// ===========================================================================
// X12 / PK9 + SEC-W F2 for the MEDICAL INFORMATION editor (EditMedicalInfoModal:
// blood type + medication allergies + other allergies + conditions). A FORCED
// sign-out (the emergency-info PUT 401s and the refresh fails) saves the edited
// form to sessionStorage under `emergency:medical:<circle>`; the SAME user,
// signing back in within 30 minutes, gets it back in the SAME circle's editor
// with the "restored" notice, and nothing is written until they press Save.
// It must NOT turn up in another circle's editor (SEC-W F2: this is one care
// recipient's health data) nor for another user.
//
// The emergency CONTACT / DOCTOR / INSURANCE editors have e2e
// (draft-circle-scope, draft-entry-identity); the Medical info circle scope was
// vitest-only.
//
// Tests (through the real UI; setup data goes in through the real API):
//   1. EN: restore in the same circle + NO restore in the user's other circle
//      (circle scope); the restore writes nothing, Save then writes the row once.
//   2. EN: a DIFFERENT user (a member of the circle) signing in gets no restore,
//      sees none of the typed values, and the entry is purged.
//   3. ES: the same restore with "Recuperamos tu borrador sin guardar.".
//   4. EN: a form left UNTOUCHED when the session dies is not parked (no entry,
//      nothing restored): the "only saved when it differs from what it opened
//      with" rule.
//
// FALSIFY (PW_FALSIFY=<token>[,<token>], each makes exactly the named assertion go
// red; plain `draft-medical-info` = `:signout`):
//   draft-medical-info:signout  the refresh SUCCEEDS, so the 401 is retried and the
//                               values are saved: no forced sign-out, no draft
//   draft-medical-info:typing   nothing is typed, so the form equals what it opened
//                               with and (correctly) nothing is saved
//   draft-medical-info:drop     the stored draft is deleted just before the editor is
//                               reopened (tab closed / expired): nothing to restore
//   draft-medical-info:circle   test 1 opens the origin circle's editor where it
//                               expects the user's other circle
//   draft-medical-info:user     test 2 signs back in as the SAME user, not the other
//
// PRODUCT MUTATIONS (each applied in place to the app file, spec run, file restored
// and diffed identical; the named tests went red, the rest stayed green):
//   EditMedicalInfoModal: useSessionDraft call removed     -> tests 1, 2, 3 (no entry is saved)
//   EditMedicalInfoModal: key `emergency:medical` (no circle)
//                                                          -> tests 1, 3 (circle B's editor is pre-filled)
//   EditMedicalInfoModal: restore skips the conditions     -> tests 1, 3 (the Asthma pill is missing)
//   EditMedicalInfoModal: baseline check removed (an untouched form is parked)
//                                                          -> test 4
//   lib/sessionDraft.ts: hashUser() constant (one shared entry for every user)
//                                                          -> test 2 (the member inherits the owner's values)
//
// Run-scoped accounts with their own circles; the worker account is never touched.
// ===========================================================================

type Step = 'signout' | 'typing' | 'drop' | 'circle' | 'user';
const FALSIFY = new Set((process.env.PW_FALSIFY ?? '').split(',').filter(Boolean));
const falsify = (step: Step): boolean =>
  FALSIFY.has(`draft-medical-info:${step}`) || (step === 'signout' && FALSIFY.has('draft-medical-info'));

test.use({ storageState: { cookies: [], origins: [] } });
test.setTimeout(180_000);

const INFO_PATH = '/api/circles/:id/emergency-info';

interface Copy {
  heading: string;
  editMedical: string;
  save: string;
  /** Prefix of a selected tag pill's accessible name ("Remove <tag>"). */
  remove: string;
  notice: string;
}
const COPY: Record<'en' | 'es', Copy> = {
  en: {
    heading: 'Emergency Info',
    editMedical: 'Edit medical information',
    save: 'Save',
    remove: 'Remove',
    notice: 'We restored your unsaved draft.',
  },
  es: {
    heading: 'Información de emergencia',
    editMedical: 'Editar información médica',
    save: 'Guardar',
    remove: 'Quitar',
    notice: 'Recuperamos tu borrador sin guardar.',
  },
};

interface Medical {
  blood: string;
  medAllergy: string;
  otherAllergy: string;
  condition: string;
}

const DRAFT_ENTRIES = (page: Page): Promise<string[]> =>
  page.evaluate(() => Object.keys(sessionStorage).filter((k) => k.startsWith('cc:draft:')));

interface MedicalRow {
  blood_type: string | null;
  medication_allergies: string[] | null;
  allergies: string[] | null;
  medical_conditions: string[] | null;
}
/** The circle's stored medical slice, or null when no emergency_info row exists yet. */
const medicalRow = (circleId: string): MedicalRow | null =>
  dbQuery<MedicalRow>(
    `select blood_type, medication_allergies, allergies, medical_conditions
       from emergency_info where circle_id = ${sqlStr(circleId)}::uuid`
  )[0] ?? null;

/** Nothing medical stored: no row at all, or a row with every medical field empty. */
function expectNothingStored(circleId: string, what: string): void {
  const row = medicalRow(circleId);
  if (row === null) return;
  expect(row.blood_type ?? null, `${what}: blood type`).toBeNull();
  expect(row.medication_allergies ?? [], `${what}: medication allergies`).toEqual([]);
  expect(row.allergies ?? [], `${what}: other allergies`).toEqual([]);
  expect(row.medical_conditions ?? [], `${what}: conditions`).toEqual([]);
}

async function loginViaForm(page: Page, acct: ScopedAccount): Promise<void> {
  await page.locator('#login-email').fill(acct.email);
  await page.locator('#login-password').fill(acct.password);
  // The login page may already speak the account's language (es) after a forced sign-out.
  await page.getByRole('button', { name: /^(Sign in|Iniciar sesión)$/ }).click();
  await expect(page).toHaveURL(/\/circles\//, { timeout: 30_000 });
}

interface World {
  owner: ScopedAccount;
  ownerSession: ApiSession;
  circleA: string;
  circleB: string;
  draft: Medical;
}

async function world(request: APIRequestContext, lang: 'en' | 'es'): Promise<World> {
  const owner = await createScopedAccount(`pk9med-${lang}`);
  sqlExec(
    `update public.users set language = ${sqlStr(lang)}, language_set_at = now() where id = ${sqlStr(owner.userId)}::uuid;`
  );
  const ownerSession = await ownerApi(request, owner);
  const circleA = await createCircle(ownerSession, uniq(`pk9medA${lang}`));
  const circleB = await createCircle(ownerSession, uniq(`pk9medB${lang}`));
  const tag = uniq('m');
  // Custom (non-suggestion) tags, so each is added verbatim and told apart by name.
  const draft: Medical = {
    blood: 'A-',
    medAllergy: `Penicillin ${tag}`,
    otherAllergy: `Pollen ${tag}`,
    condition: `Asthma ${tag}`,
  };
  expectNothingStored(circleA, 'fresh circle A');
  expectNothingStored(circleB, 'fresh circle B');
  return { owner, ownerSession, circleA, circleB, draft };
}

/** A second REAL account joined to `circleId` as a caregiver, through the invite API. */
async function addMember(request: APIRequestContext, ownerSession: ApiSession, circleId: string): Promise<ScopedAccount> {
  const member = await createScopedAccount('pk9med-member');
  const memberSession = await ownerApi(request, member);
  const invite = await createInvite(ownerSession, circleId);
  const accepted = await memberSession.post(`/api/invites/code/${invite.code}/accept`);
  expect(accepted.status(), await accepted.text()).toBeLessThan(300);
  expect(membershipCount(circleId, member.userId)).toBe(1);
  return member;
}

async function gotoEmergency(page: Page, circleId: string, copy: Copy): Promise<void> {
  await page.goto(`/circles/${circleId}/emergency`, { waitUntil: 'domcontentloaded' });
  await expect(page.getByRole('heading', { name: copy.heading, level: 1 })).toBeVisible({ timeout: 20_000 });
}

async function openMedical(page: Page, copy: Copy): Promise<Locator> {
  await page.getByRole('button', { name: copy.editMedical }).first().click();
  const dialog = page.getByRole('dialog');
  await expect(dialog).toBeVisible({ timeout: 15_000 });
  await expect(dialog.locator('#medical_conditions-input')).toBeVisible({ timeout: 15_000 });
  return dialog;
}

const pill = (dialog: Locator, copy: Copy, tag: string): Locator =>
  dialog.getByRole('button', { name: `${copy.remove} ${tag}`, exact: true });

async function fillMedical(dialog: Locator, copy: Copy, d: Medical): Promise<void> {
  await dialog.getByRole('radio', { name: d.blood, exact: true }).click();
  await expect(dialog.getByRole('radio', { name: d.blood, exact: true })).toHaveAttribute('aria-checked', 'true');
  const fields: Array<[string, string]> = [
    ['medication_allergies', d.medAllergy],
    ['allergies', d.otherAllergy],
    ['medical_conditions', d.condition],
  ];
  for (const [id, value] of fields) {
    const input = dialog.locator(`#${id}-input`);
    await input.fill(value);
    await input.press('Enter');
    await expect(pill(dialog, copy, value)).toBeVisible();
  }
}

async function expectBlankEditor(page: Page, dialog: Locator, copy: Copy, what: string): Promise<void> {
  await settle(); // a late restore effect would have landed by now
  await expect(dialog.getByRole('radio', { checked: true }), `${what}: no blood type chosen`).toHaveCount(0);
  await expect(
    dialog.getByRole('button', { name: new RegExp(`^${copy.remove} `) }),
    `${what}: no tag pills`
  ).toHaveCount(0);
  await expect(page.getByText(copy.notice), `${what}: no restored notice`).toHaveCount(0);
}

async function expectRestoredEditor(page: Page, dialog: Locator, copy: Copy, d: Medical): Promise<void> {
  await expect(dialog.getByRole('radio', { name: d.blood, exact: true })).toHaveAttribute('aria-checked', 'true', {
    timeout: 5_000,
  });
  await expect(pill(dialog, copy, d.medAllergy)).toBeVisible();
  await expect(pill(dialog, copy, d.otherAllergy)).toBeVisible();
  await expect(pill(dialog, copy, d.condition)).toBeVisible();
  await expect(page.getByText(copy.notice)).toBeVisible();
}

/**
 * Open circle A's Medical information editor, fill it in (unless falsified), kill
 * the session on Save (the PUT 401s, every refresh 401s) and wait for /login.
 */
async function editAndLoseSession(page: Page, w: World, copy: Copy, opts: { edit: boolean } = { edit: true }): Promise<void> {
  const typed = opts.edit && !falsify('typing');
  await gotoEmergency(page, w.circleA, copy);
  const dialog = await openMedical(page, copy);
  if (typed) await fillMedical(dialog, copy, w.draft);

  const handles: FaultHandle[] = [];
  if (!falsify('signout')) {
    handles.push(await failRequest(page, 'POST', '/api/auth/refresh', { status: 401, code: 'UNAUTHORIZED', times: 5 }));
  }
  const write = await failRequest(page, 'PUT', INFO_PATH, { status: 401, code: 'UNAUTHORIZED', times: 1 });
  handles.push(write);
  await dialog.getByRole('button', { name: copy.save, exact: true }).click();
  await expect(page).toHaveURL(/\/login/, { timeout: 15_000 });
  await write.expectHits(1);
  await Promise.all(handles.map((h) => h.dispose()));

  // Parked in sessionStorage only, never localStorage; the refused PUT wrote nothing.
  // A form left as it opened is NOT parked (nothing was typed, so nothing to give back).
  expect(await DRAFT_ENTRIES(page)).toHaveLength(typed ? 1 : 0);
  expect(await page.evaluate(() => JSON.stringify(localStorage))).not.toContain(w.draft.medAllergy);
  expectNothingStored(w.circleA, 'after the refused save');
}

/** FALSIFY `:drop`: the saved draft vanishes (tab closed / expired) before the editor is reopened. */
async function dropDraftIfFalsified(page: Page): Promise<void> {
  if (falsify('drop')) await page.evaluate(() => sessionStorage.clear());
}

test('PK9 Medical info (EN): after a forced sign-out and re-login the SAME circle restores the form with the notice; the other circle does not; nothing is written until Save', async ({
  page,
  context,
  request,
  baseURL,
}) => {
  const w = await world(request, 'en');
  const copy = COPY.en;
  await cookieLogin(context, w.owner, baseURL);

  await editAndLoseSession(page, w, copy);
  await loginViaForm(page, w.owner);

  // SEC-W F2: the same user's OTHER circle is a different care recipient. Its
  // editor opens blank, with no notice, and leaves circle A's draft untouched.
  const otherCircle = falsify('circle') ? w.circleA : w.circleB;
  await gotoEmergency(page, otherCircle, copy);
  const dialogB = await openMedical(page, copy);
  await expectBlankEditor(page, dialogB, copy, otherCircle === w.circleB ? 'circle B editor' : 'circle A editor (falsified)');
  expect(await DRAFT_ENTRIES(page), "circle B must not consume circle A's draft").toHaveLength(1);

  // Circle A: restored where it was typed, with the notice, then consumed.
  await dropDraftIfFalsified(page);
  await gotoEmergency(page, w.circleA, copy);
  const dialog = await openMedical(page, copy);
  await expectRestoredEditor(page, dialog, copy, w.draft);
  expect(await DRAFT_ENTRIES(page)).toHaveLength(0);
  // The restore itself writes nothing, in either circle...
  expectNothingStored(w.circleA, 'after the restore');
  expectNothingStored(w.circleB, 'circle B after the restore');
  // ...and the restored form saves exactly once when the user presses Save.
  await dialog.getByRole('button', { name: copy.save, exact: true }).click();
  await expect(dialog).toBeHidden({ timeout: 20_000 });
  await expect
    .poll(() => medicalRow(w.circleA)?.blood_type ?? null, { timeout: 15_000 })
    .toBe(w.draft.blood);
  const saved = medicalRow(w.circleA);
  expect(saved?.medication_allergies).toEqual([w.draft.medAllergy]);
  expect(saved?.allergies).toEqual([w.draft.otherAllergy]);
  expect(saved?.medical_conditions).toEqual([w.draft.condition]);
  expect(dbCount(`select 1 from emergency_info where circle_id = ${sqlStr(w.circleA)}::uuid`)).toBe(1);
  expectNothingStored(w.circleB, 'circle B after circle A saved');
});

test('PK9 Medical info privacy (EN): a DIFFERENT user (a circle member) signing in gets no restore, sees none of the typed values, and the entry is purged', async ({
  page,
  context,
  request,
  baseURL,
}) => {
  const w = await world(request, 'en');
  const copy = COPY.en;
  const member = await addMember(request, w.ownerSession, w.circleA);
  await cookieLogin(context, w.owner, baseURL);

  await editAndLoseSession(page, w, copy);

  // The member signs in on the same browser (the form, as a real second person would).
  await loginViaForm(page, falsify('user') ? w.owner : member);
  expect(await DRAFT_ENTRIES(page), "another user's sign-in purges the entry").toHaveLength(0);

  // The member opens the very editor the owner typed in: nothing of it is there.
  await gotoEmergency(page, w.circleA, copy);
  const dialog = await openMedical(page, copy);
  await expectBlankEditor(page, dialog, copy, "the member in the owner's circle");
  await expect(page.getByText(w.draft.medAllergy)).toHaveCount(0);
  expect(await DRAFT_ENTRIES(page)).toHaveLength(0);
  expectNothingStored(w.circleA, 'nothing written for the member');
});

test('PK9 Medical info (ES): the restored form comes back with "Recuperamos tu borrador sin guardar."; nothing is written until "Guardar"', async ({
  page,
  context,
  request,
  baseURL,
}) => {
  const w = await world(request, 'es');
  const copy = COPY.es;
  await cookieLogin(context, w.owner, baseURL);

  await editAndLoseSession(page, w, copy);
  await loginViaForm(page, w.owner);

  // The other circle (Spanish UI): blank, no notice, draft kept.
  await gotoEmergency(page, w.circleB, copy);
  await expectBlankEditor(page, await openMedical(page, copy), copy, 'circle B editor (ES)');
  expect(await DRAFT_ENTRIES(page)).toHaveLength(1);

  await dropDraftIfFalsified(page);
  await gotoEmergency(page, w.circleA, copy);
  const dialog = await openMedical(page, copy);
  await expectRestoredEditor(page, dialog, copy, w.draft);
  // The English notice must not leak into the Spanish UI.
  await expect(page.getByText('We restored your unsaved draft.')).toHaveCount(0);
  expect(await DRAFT_ENTRIES(page)).toHaveLength(0);
  expectNothingStored(w.circleA, 'after the restore (ES)');

  await dialog.getByRole('button', { name: copy.save, exact: true }).click();
  await expect(dialog).toBeHidden({ timeout: 20_000 });
  await expect
    .poll(() => medicalRow(w.circleA)?.blood_type ?? null, { timeout: 15_000 })
    .toBe(w.draft.blood);
  expect(medicalRow(w.circleA)?.medication_allergies).toEqual([w.draft.medAllergy]);
});

test('PK9 Medical info (EN): a form left UNTOUCHED when the session dies is not parked, so nothing is restored after re-login', async ({
  page,
  context,
  request,
  baseURL,
}) => {
  const w = await world(request, 'en');
  const copy = COPY.en;
  await cookieLogin(context, w.owner, baseURL);

  // Open the editor, change nothing, press Save while the session is dead.
  await editAndLoseSession(page, w, copy, { edit: false });
  await loginViaForm(page, w.owner);

  await gotoEmergency(page, w.circleA, copy);
  const dialog = await openMedical(page, copy);
  await expectBlankEditor(page, dialog, copy, 'an untouched form is not restored');
  expect(await DRAFT_ENTRIES(page)).toHaveLength(0);
  expectNothingStored(w.circleA, 'nothing written for an untouched form');
});
