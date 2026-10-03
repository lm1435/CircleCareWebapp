import type { APIRequestContext, Locator, Page } from '@playwright/test';
import { test, expect } from '../../fixtures';
import { failRequest, type ApiSession } from '../../unhappy';
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
// Security re-check 2026-10-01 (I-3, docs/plans/security-recheck-2026-10-01-
// evening.md "Status after fixes"). A PK9 draft (sessionStorage, saved at a
// FORCED sign-out) of an emergency CONTACT / DOCTOR / INSURANCE editor used to be
// keyed by the entry's list POSITION. These entries have no id, so when another
// member deleted an EARLIER entry while the owner was signed out, the SAME slot
// held a different entry and the restored draft filled THAT entry's editor (the
// `if_match` stale-edit check cannot catch it: its base is read at mount). Drafts
// are now keyed by a hash of the entry's identifying fields (src/lib/
// emergencyDraftKey.ts), so a draft follows its entry.
//
// Scenario, per list kind, two REAL accounts against the real backend:
//   1. Owner O has [A, B, C]; a second member M is in the circle.
//   2. O opens B's editor and types a change (name + a second field).
//   3. The session dies on Save (the PUT 401s and the refresh fails): a FORCED
//      sign-out, which saves the open form. Same trigger as
//      draft-circle-scope.spec.ts. Nothing reaches the server.
//   4. While O is signed out, M deletes A through the API (PUT of [B, C]).
//   5. O signs back in through the form.
//   Assert: C's editor (now in B's OLD slot) shows C's real values and NO
//   "restored" notice, and the draft is still unconsumed; B's editor (now in a new
//   slot) restores O's draft WITH the notice, keeps B's untouched fields, and
//   consumes it. Neither restore writes anything.
//
// FALSIFY: PW_FALSIFY=draft-entry-identity skips M's delete, so the "A is gone"
// precondition must go red (it proves the scenario really removed the earlier
// entry). The real falsifier is the product one: with the index-keyed drafts back
// (EditContactModal / EditDoctorModal / EditInsuranceModal), the C assertions go
// red.
// ===========================================================================

const FALSIFY = new Set((process.env.PW_FALSIFY ?? '').split(',').filter(Boolean));

test.use({ storageState: { cookies: [], origins: [] } });
test.setTimeout(150_000);

type Json = Record<string, unknown>;
type Field = 'emergency_contacts' | 'additional_doctors' | 'insurance_plans';

interface Kind {
  noun: 'contact' | 'doctor' | 'insurance';
  field: Field;
  /** The key that names an entry (what the cards and menu labels show). */
  key: 'name' | 'carrier';
  /** A second identifying text field; the draft changes it too. */
  second: 'relationship' | 'specialty' | 'label';
  /** Seeded values of `second` for entries A, B, C. */
  seconds: [string, string, string];
  nameInput: string;
  secondInput: string;
  phoneInput: string;
  make: (name: string, second: string, phone: string) => Json;
}

const PHONES: [string, string, string] = ['(303) 555-0101', '(303) 555-0102', '(303) 555-0103'];

const KINDS: Kind[] = [
  {
    noun: 'contact',
    field: 'emergency_contacts',
    key: 'name',
    second: 'relationship',
    seconds: ['Daughter', 'Son', 'Neighbor'],
    nameInput: '#contact-name',
    secondInput: '#contact-relationship',
    phoneInput: '#contact-phone',
    make: (name, relationship, phone) => ({ name, relationship, phone, country_code: '+1', is_primary: false }),
  },
  {
    noun: 'doctor',
    field: 'additional_doctors',
    key: 'name',
    second: 'specialty',
    seconds: ['Cardiology', 'Neurology', 'Podiatry'],
    nameInput: '#doctor-name',
    secondInput: '#doctor-specialty',
    phoneInput: '#doctor-phone',
    make: (name, specialty, phone) => ({ name, specialty, phone, country_code: '+1', address: null }),
  },
  {
    noun: 'insurance',
    field: 'insurance_plans',
    key: 'carrier',
    second: 'label',
    seconds: ['Dental', 'Vision', 'Hearing'],
    nameInput: '#insurance-carrier',
    secondInput: '#insurance-label',
    phoneInput: '#insurance-phone',
    make: (carrier, label, phone) => ({
      carrier,
      label,
      policy_number: 'P-1',
      phone,
      country_code: '+1',
      is_primary: false,
    }),
  },
];

const INFO = (circleId: string): string => `/api/circles/${circleId}/emergency-info`;

const DRAFT_ENTRIES = (page: Page): Promise<string[]> =>
  page.evaluate(() => Object.keys(sessionStorage).filter((k) => k.startsWith('cc:draft:')));

async function readList(api: ApiSession, circleId: string, field: Field): Promise<Json[]> {
  const res = await api.get(INFO(circleId));
  expect(res.ok(), `GET emergency-info → ${res.status()}`).toBe(true);
  const body = (await res.json()) as { data?: { emergency_info?: Json | null } };
  return (body.data?.emergency_info?.[field] as Json[] | null | undefined) ?? [];
}

interface World {
  owner: ScopedAccount;
  circleId: string;
  ownerSession: ApiSession;
  memberSession: ApiSession;
  /** The names of entries A, B, C (the `kind.key` value), run-unique. */
  names: [string, string, string];
}

/** Owner + circle + one more member, with the owner's list seeded to [A, B, C] through the real PUT. */
async function world(request: APIRequestContext, kind: Kind): Promise<World> {
  const owner = await createScopedAccount('pk9id-owner');
  const ownerSession = await ownerApi(request, owner);
  const circleId = await createCircle(ownerSession, uniq('pk9id'));
  const member = await createScopedAccount('pk9id-member');
  const memberSession = await ownerApi(request, member);
  const invite = await createInvite(ownerSession, circleId);
  const accepted = await memberSession.post(`/api/invites/code/${invite.code}/accept`);
  expect(accepted.status(), await accepted.text()).toBeLessThan(300);
  expect(membershipCount(circleId, member.userId)).toBe(1);

  const tag = uniq(kind.noun);
  const names: World['names'] = [`${tag}-a`, `${tag}-b`, `${tag}-c`];
  const seed = await ownerSession.put(INFO(circleId), {
    [kind.field]: names.map((n, i) => kind.make(n, kind.seconds[i], PHONES[i])),
  });
  expect(seed.ok(), `seed ${kind.field}: ${seed.status()} ${await seed.text()}`).toBe(true);
  expect((await readList(ownerSession, circleId, kind.field)).map((e) => e[kind.key])).toEqual(names);
  return { owner, circleId, ownerSession, memberSession, names };
}

async function gotoEmergency(page: Page, circleId: string): Promise<void> {
  await page.goto(`/circles/${circleId}/emergency`, { waitUntil: 'domcontentloaded' });
  await expect(page.getByRole('heading', { name: 'Emergency Info', level: 1 })).toBeVisible({ timeout: 20_000 });
}

async function loginViaForm(page: Page, acct: ScopedAccount): Promise<void> {
  await page.locator('#login-email').fill(acct.email);
  await page.locator('#login-password').fill(acct.password);
  await page.getByRole('button', { name: 'Sign in', exact: true }).click();
  await expect(page).toHaveURL(/\/circles\//, { timeout: 30_000 });
}

/** Open the editor of the entry called `name` from its card's action menu. */
async function openEditor(page: Page, kind: Kind, name: string): Promise<Locator> {
  await page.getByRole('button', { name: `Actions for ${name}`, exact: true }).click();
  await page.getByRole('menuitem', { name: `Edit ${kind.noun} ${name}`, exact: true }).click();
  const dialog = page.getByRole('dialog');
  await expect(dialog).toBeVisible({ timeout: 15_000 });
  await expect(dialog.locator(kind.nameInput)).toBeVisible({ timeout: 15_000 });
  return dialog;
}

/** The phone field shows a formatted national number; compare its digits. */
const phoneDigits = async (input: Locator): Promise<string> => (await input.inputValue()).replace(/\D/g, '');
const digitsOf = (phone: string): string => phone.replace(/\D/g, '');

const RESTORED_NOTICE = 'We restored your unsaved draft.';

for (const kind of KINDS) {
  test(`PK9 entry identity (${kind.noun}): the draft follows its entry when an earlier one is deleted, and never fills the entry that took its slot`, async ({
    page,
    context,
    request,
    baseURL,
  }) => {
    const w = await world(request, kind);
    const [nameA, nameB, nameC] = w.names;
    const secondC = kind.seconds[2];
    const draftName = `DRAFT-${uniq(kind.noun)}`;
    const draftSecond = `Draft ${kind.second} ${uniq('s')}`;
    await cookieLogin(context, w.owner, baseURL);

    // --- 2. O opens B's editor (slot 1 of [A, B, C]) and types a change. ---
    await gotoEmergency(page, w.circleId);
    const editorB = await openEditor(page, kind, nameB);
    await expect(editorB.locator(kind.nameInput)).toHaveValue(nameB);
    await editorB.locator(kind.nameInput).fill(draftName);
    await editorB.locator(kind.secondInput).fill(draftSecond);

    // --- 3. The session dies on Save: a FORCED sign-out that saves the open form. ---
    const refresh = await failRequest(page, 'POST', '/api/auth/refresh', {
      status: 401,
      code: 'UNAUTHORIZED',
      times: 5,
    });
    const write = await failRequest(page, 'PUT', '/api/circles/:id/emergency-info', {
      status: 401,
      code: 'UNAUTHORIZED',
      times: 1,
    });
    await editorB.getByRole('button', { name: 'Save', exact: true }).click();
    await expect(page).toHaveURL(/\/login/, { timeout: 15_000 });
    await write.expectHits(1);
    await refresh.dispose();
    await write.dispose();
    // The refused save wrote nothing; the typed form is parked in sessionStorage.
    const parked = await readList(w.ownerSession, w.circleId, kind.field);
    expect(parked.map((e) => e[kind.key]), 'the refused save changed nothing').toEqual(w.names);
    expect(await DRAFT_ENTRIES(page)).toHaveLength(1);

    // --- 4. While O is signed out, the other member deletes A (the entry BEFORE B). ---
    if (!FALSIFY.has('draft-entry-identity')) {
      const current = await readList(w.memberSession, w.circleId, kind.field);
      const del = await w.memberSession.put(INFO(w.circleId), {
        [kind.field]: current.filter((e) => e[kind.key] !== nameA),
      });
      expect(del.ok(), `member deletes A: ${del.status()} ${await del.text()}`).toBe(true);
    }
    const afterDelete = await readList(w.ownerSession, w.circleId, kind.field);
    expect(afterDelete.map((e) => e[kind.key]), 'A is gone; B and C moved up one slot').toEqual([nameB, nameC]);

    // --- 5. O signs back in. ---
    await loginViaForm(page, w.owner);
    await gotoEmergency(page, w.circleId);
    await expect(page.getByRole('button', { name: `Actions for ${nameA}`, exact: true })).toHaveCount(0);
    await expect(page.getByRole('button', { name: `Actions for ${nameB}`, exact: true })).toBeVisible({ timeout: 20_000 });
    await expect(page.getByRole('button', { name: `Actions for ${nameC}`, exact: true })).toBeVisible();

    // C now sits in B's OLD slot (index 1). Its editor shows C's real values and no
    // notice; O's draft is not consumed by it.
    const editorC = await openEditor(page, kind, nameC);
    await settle(); // a late restore effect would land by now
    await expect(editorC.locator(kind.nameInput)).toHaveValue(nameC);
    await expect(editorC.locator(kind.secondInput)).toHaveValue(secondC);
    expect(await phoneDigits(editorC.locator(kind.phoneInput))).toBe(digitsOf(PHONES[2]));
    await expect(page.getByText(RESTORED_NOTICE)).toHaveCount(0);
    expect(await DRAFT_ENTRIES(page), "C's editor must not take O's draft").toHaveLength(1);
    await page.keyboard.press('Escape');
    await expect(editorC).toBeHidden({ timeout: 10_000 });

    // B moved to slot 0. Its editor restores O's draft, with the notice, keeps the
    // fields O never touched, and consumes the entry.
    const restoredB = await openEditor(page, kind, nameB);
    await expect(restoredB.locator(kind.nameInput)).toHaveValue(draftName, { timeout: 5_000 });
    await expect(restoredB.locator(kind.secondInput)).toHaveValue(draftSecond);
    expect(await phoneDigits(restoredB.locator(kind.phoneInput))).toBe(digitsOf(PHONES[1]));
    await expect(page.getByText(RESTORED_NOTICE)).toBeVisible();
    expect(await DRAFT_ENTRIES(page)).toHaveLength(0);

    // Restoring writes nothing: the server still holds exactly [B, C] as M left them.
    const finalList = await readList(w.ownerSession, w.circleId, kind.field);
    expect(JSON.stringify(finalList), 'neither restore wrote to the server').toBe(JSON.stringify(afterDelete));
  });
}
