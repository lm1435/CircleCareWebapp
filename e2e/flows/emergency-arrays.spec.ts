import type { Locator, Page } from '@playwright/test';
import { test, expect, uniqueLabel } from '../fixtures';
import { apiSession, type ApiSession } from '../unhappy';

// ===========================================================================
// EMERGENCY ARRAYS — add / edit / delete of emergency CONTACTS, additional
// DOCTORS and INSURANCE plans against the real backend
// (docs/plans/test-gap-audit-2026-09-29.md #11; Maestro twins:
// mobile/.maestro/parity/emergency/{contacts,doctors,insurance}-crud.yaml).
//
// Every save of these records is a read-modify-write of the WHOLE array
// (EditContactModal / EditDoctorModal / EditInsuranceModal, and the page's
// confirmDelete), and PUT /emergency-info stores what it is given. These are
// the arrays the hydration bug truncated ("adding a contact deleted every
// other one"), so each step reads the server back:
//   1. add a THIRD record -> the two seeded ones are still there, byte-identical;
//   2. rename it -> edited in place (no leftover under the old name);
//   3. delete the MIDDLE seeded one -> the one after it and the renamed one
//      survive, every other record byte-identical and in its order.
//
// Records are seeded through the API on this worker's isolated circle,
// APPENDED to what it already holds; the original arrays are PUT back in
// `finally`. Names are run-unique.
//
// FALSIFY: PW_FALSIFY=emergency-arrays re-plays the hydration bug right after
// the UI add (the array is PUT back without its first record) — the "add kept
// every other record" check must go red.
// ===========================================================================

const FALSIFY = new Set((process.env.PW_FALSIFY ?? '').split(',').filter(Boolean));

type Json = Record<string, unknown>;
type Field = 'emergency_contacts' | 'additional_doctors' | 'insurance_plans';

interface Kind {
  field: Field;
  key: 'name' | 'carrier';
  noun: 'contact' | 'doctor' | 'insurance';
  addButton: string;
  make: (name: string) => Json;
  fill: (dialog: Locator, name: string) => Promise<void>;
  nameInput: string;
  removeTitle: string;
}

const KINDS: Kind[] = [
  {
    field: 'emergency_contacts',
    key: 'name',
    noun: 'contact',
    addButton: 'Add contact',
    make: (name) => ({ name, relationship: 'Daughter', phone: '(303) 555-0101', country_code: '+1', is_primary: false }),
    fill: async (dialog, name) => {
      await dialog.locator('#contact-name').fill(name);
      await dialog.locator('#contact-relationship').fill('Son');
      await dialog.locator('#contact-phone').fill('3035550142');
    },
    nameInput: '#contact-name',
    removeTitle: 'Remove contact',
  },
  {
    field: 'additional_doctors',
    key: 'name',
    noun: 'doctor',
    addButton: 'Add doctor',
    make: (name) => ({ name, specialty: 'Nephrology', phone: '(303) 555-0102', country_code: '+1', address: null }),
    fill: async (dialog, name) => {
      await dialog.locator('#doctor-name').fill(name);
    },
    nameInput: '#doctor-name',
    removeTitle: 'Remove doctor',
  },
  {
    field: 'insurance_plans',
    key: 'carrier',
    noun: 'insurance',
    addButton: 'Add insurance',
    make: (carrier) => ({ carrier, label: 'Dental', policy_number: 'P-1', phone: '(303) 555-0103', country_code: '+1', is_primary: false }),
    fill: async (dialog, name) => {
      await dialog.locator('#insurance-carrier').fill(name);
    },
    nameInput: '#insurance-carrier',
    removeTitle: 'Remove insurance',
  },
];

async function readArray(api: ApiSession, circleId: string, field: Field): Promise<Json[]> {
  const res = await api.get(`/api/circles/${circleId}/emergency-info`);
  expect(res.ok(), `GET emergency-info → ${res.status()}`).toBe(true);
  const body = (await res.json()) as { data?: { emergency_info?: Json | null } };
  return ((body.data?.emergency_info?.[field] as Json[] | null) ?? []) as Json[];
}

async function putArray(api: ApiSession, circleId: string, field: Field, value: Json[]): Promise<void> {
  const res = await api.put(`/api/circles/${circleId}/emergency-info`, { [field]: value });
  expect(res.ok(), `PUT emergency-info → ${res.status()} ${await res.text()}`).toBe(true);
}

async function gotoEmergency(page: Page, circleId: string): Promise<void> {
  await page.goto(`/circles/${circleId}/emergency`, { waitUntil: 'domcontentloaded' });
  await expect(page.getByRole('heading', { name: 'Emergency Info' })).toBeVisible({ timeout: 20_000 });
}

/** Click Save in `dialog` and wait for the real PUT to answer 2xx and the dialog to close. */
async function saveDialog(page: Page, dialog: Locator, circleId: string): Promise<void> {
  const [saved] = await Promise.all([
    page.waitForResponse(
      (r) => r.request().method() === 'PUT' && new URL(r.url()).pathname === `/api/circles/${circleId}/emergency-info`,
      { timeout: 20_000 }
    ),
    dialog.getByRole('button', { name: 'Save', exact: true }).click(),
  ]);
  expect(saved.ok(), `PUT from the modal → ${saved.status()}`).toBe(true);
  await expect(dialog).toBeHidden({ timeout: 20_000 });
}

const strip = (o: Json, key: string): string => {
  const c = { ...o };
  delete c[key];
  return JSON.stringify(c);
};

for (const kind of KINDS) {
  test(`${kind.noun}: add a 3rd keeps the others, rename it in place, delete the MIDDLE one keeps the rest`, async ({
    page,
    request,
    account,
    circleId,
  }) => {
    test.slow();
    const api = await apiSession(request, account);
    const tag = uniqueLabel(`Arr ${kind.noun}`);
    const n1 = `${tag} one`;
    const n2 = `${tag} two`;
    const n3 = `${tag} three`;
    const renamed = `${tag} three renamed`;
    const original = await readArray(api, circleId, kind.field);
    const seeded = [...original, kind.make(n1), kind.make(n2)];
    await putArray(api, circleId, kind.field, seeded);
    const before = await readArray(api, circleId, kind.field);
    expect(before.map((x) => x[kind.key]).slice(-2)).toEqual([n1, n2]);

    try {
      await gotoEmergency(page, circleId);

      // --- 1. add ---
      await page.getByRole('button', { name: kind.addButton, exact: true }).click();
      let dialog = page.getByRole('dialog');
      await expect(dialog).toBeVisible({ timeout: 15_000 });
      await kind.fill(dialog, n3);
      await saveDialog(page, dialog, circleId);
      await expect(page.getByRole('button', { name: `Actions for ${n3}`, exact: true })).toBeVisible({ timeout: 20_000 });
      if (FALSIFY.has('emergency-arrays')) await putArray(api, circleId, kind.field, (await readArray(api, circleId, kind.field)).slice(1));
      const afterAdd = await readArray(api, circleId, kind.field);
      expect(afterAdd.map((x) => x[kind.key]), 'add appended ONE record and kept every other').toEqual([
        ...before.map((x) => x[kind.key]),
        n3,
      ]);
      for (let i = 0; i < before.length; i++) {
        expect(JSON.stringify(afterAdd[i]), `add left record ${i} (${String(before[i][kind.key])}) byte-identical`).toBe(
          JSON.stringify(before[i])
        );
      }

      // --- 2. edit (rename the added one) ---
      await page.getByRole('button', { name: `Actions for ${n3}`, exact: true }).click();
      await page.getByRole('menuitem', { name: `Edit ${kind.noun} ${n3}`, exact: true }).click();
      dialog = page.getByRole('dialog');
      await expect(dialog).toBeVisible({ timeout: 15_000 });
      await expect(dialog.locator(kind.nameInput)).toHaveValue(n3);
      await dialog.locator(kind.nameInput).fill(renamed);
      await saveDialog(page, dialog, circleId);
      const afterEdit = await readArray(api, circleId, kind.field);
      const editNames = afterEdit.map((x) => x[kind.key]);
      expect(editNames, 'renamed in place, no leftover under the old name').toEqual([
        ...before.map((x) => x[kind.key]),
        renamed,
      ]);
      expect(strip(afterEdit[afterEdit.length - 1], kind.key)).toBe(strip(afterAdd[afterAdd.length - 1], kind.key));

      // --- 3. delete the MIDDLE seeded record ---
      await page.getByRole('button', { name: `Actions for ${n1}`, exact: true }).click();
      await page.getByRole('menuitem', { name: `Delete ${kind.noun} ${n1}`, exact: true }).click();
      const confirm = page.getByRole('dialog', { name: kind.removeTitle });
      await expect(confirm).toBeVisible({ timeout: 15_000 });
      const [deleted] = await Promise.all([
        page.waitForResponse(
          (r) => r.request().method() === 'PUT' && new URL(r.url()).pathname === `/api/circles/${circleId}/emergency-info`,
          { timeout: 20_000 }
        ),
        confirm.getByRole('button', { name: 'Delete', exact: true }).click(),
      ]);
      expect(deleted.ok(), `PUT from the delete confirm → ${deleted.status()}`).toBe(true);
      await expect(page.getByRole('button', { name: `Actions for ${n1}`, exact: true })).toHaveCount(0, { timeout: 20_000 });
      await expect(page.getByRole('button', { name: `Actions for ${n2}`, exact: true })).toBeVisible();
      await expect(page.getByRole('button', { name: `Actions for ${renamed}`, exact: true })).toBeVisible();

      const final = await readArray(api, circleId, kind.field);
      const expected = [...before.filter((x) => x[kind.key] !== n1), afterEdit[afterEdit.length - 1]];
      expect(final.map((x) => x[kind.key]), 'only the middle record went; order kept').toEqual(expected.map((x) => x[kind.key]));
      for (let i = 0; i < expected.length; i++) {
        expect(JSON.stringify(final[i]), `record ${i} (${String(expected[i][kind.key])}) byte-identical after the delete`).toBe(
          JSON.stringify(expected[i])
        );
      }

      // Survives a reload (read view from the server).
      await page.reload({ waitUntil: 'domcontentloaded' });
      await expect(page.getByRole('button', { name: `Actions for ${renamed}`, exact: true })).toBeVisible({ timeout: 20_000 });
      await expect(page.getByRole('button', { name: `Actions for ${n1}`, exact: true })).toHaveCount(0);
    } finally {
      await putArray(api, circleId, kind.field, original);
    }
  });
}
