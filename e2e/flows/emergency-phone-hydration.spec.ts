import { fileURLToPath } from 'node:url';
import type { Page } from '@playwright/test';
import { test, expect, uniqueLabel } from '../fixtures';
import { apiSession, type ApiSession } from '../unhappy';

// ===========================================================================
// PHONE FIELD HYDRATION — a stored phone number is SHOWN when its record is
// edited, in a real browser.
//
// `PhoneField` (country <select> + formatted national tel input) seeds itself
// from the stored `phone` + `country_code` pair (`resolveSeed` in
// src/lib/phone.ts). If that seeding breaks, the Edit modal opens with an
// empty number on a default "United States" picker and the first Save
// silently erases the stored phone — the mobile hydration bug this field was
// built to avoid. The unit suite proves the rules against jsdom; this proves
// the wiring: real record from the real backend → real modal → visible value.
//
// Records are SEEDED THROUGH THE API (PUT /emergency-info) on this worker's
// isolated circle, appended to whatever the circle already holds, and the
// original arrays are PUT back in `finally`. Names are run-unique so repeats
// and parallel workers never collide.
//
// Cases:
//   1. contact   {phone '55 1234 5678', country_code '+52'}   → Mexico
//   2. doctor    {phone '55 8765 4321', country_code '+52'}   → Mexico,
//      then a NAME-ONLY edit must keep phone + '+52' (API GET after save)
//   3. insurance {phone '(416) 555-0123', country_code '+1'}  → Canada
//      (a shared "+1" code refined by the 416 area code)
//   4. legacy contact {phone '+52 55 1111 2222'}, NO country_code → Mexico,
//      national '55 1111 2222'
// ===========================================================================

type Json = Record<string, unknown>;
type Arrays = {
  emergency_contacts: Json[];
  additional_doctors: Json[];
  insurance_plans: Json[];
};

const SCREENSHOT_PATH = fileURLToPath(
  new URL('../../test-results/emergency-phone-hydration/doctor-edit-modal.png', import.meta.url)
);

async function readInfo(api: ApiSession, circleId: string): Promise<Json> {
  const res = await api.get(`/api/circles/${circleId}/emergency-info`);
  expect(res.ok(), `GET emergency-info → ${res.status()}`).toBe(true);
  const body = (await res.json()) as { data?: { emergency_info?: Json | null } };
  return body.data?.emergency_info ?? {};
}

function arraysOf(info: Json): Arrays {
  return {
    emergency_contacts: (info.emergency_contacts as Json[] | null) ?? [],
    additional_doctors: (info.additional_doctors as Json[] | null) ?? [],
    insurance_plans: (info.insurance_plans as Json[] | null) ?? [],
  };
}

async function putInfo(api: ApiSession, circleId: string, patch: Partial<Arrays>): Promise<void> {
  const res = await api.put(`/api/circles/${circleId}/emergency-info`, patch);
  expect(res.ok(), `PUT emergency-info → ${res.status()} ${await res.text()}`).toBe(true);
}

/**
 * Seed `patch` on top of the circle's current arrays, run `body`, and put the
 * original arrays back whatever happens.
 */
async function withSeeded(
  api: ApiSession,
  circleId: string,
  build: (original: Arrays) => Partial<Arrays>,
  body: () => Promise<void>
): Promise<void> {
  const original = arraysOf(await readInfo(api, circleId));
  await putInfo(api, circleId, build(original));
  try {
    await body();
  } finally {
    await putInfo(api, circleId, original);
  }
}

async function gotoEmergency(page: Page, circleId: string): Promise<void> {
  await page.goto(`/circles/${circleId}/emergency`, { waitUntil: 'domcontentloaded' });
  await expect(page.getByRole('heading', { name: 'Emergency Info' })).toBeVisible({ timeout: 20_000 });
}

/** Open a card's overflow menu and choose its Edit item; returns the open dialog. */
async function openEdit(page: Page, name: string, editLabel: string) {
  await page.getByRole('button', { name: `Actions for ${name}`, exact: true }).click();
  await page.getByRole('menuitem', { name: editLabel, exact: true }).click();
  const dialog = page.getByRole('dialog');
  await expect(dialog).toBeVisible({ timeout: 15_000 });
  return dialog;
}

async function expectPhone(
  dialog: ReturnType<Page['getByRole']>,
  id: string,
  national: string,
  iso2: string,
  countryLabel: string
): Promise<void> {
  await expect(dialog.locator(`#${id}`)).toHaveValue(national);
  const select = dialog.locator(`#${id}-country`);
  await expect(select).toHaveValue(iso2);
  await expect(select.locator('option:checked')).toHaveText(countryLabel);
}

test('contact with country_code +52 opens with its Mexican number', async ({ page, request, account, circleId }) => {
  const api = await apiSession(request, account);
  const name = uniqueLabel('Contact MX');
  await withSeeded(
    api,
    circleId,
    (o) => ({
      emergency_contacts: [
        ...o.emergency_contacts,
        { name, relationship: 'Son', phone: '55 1234 5678', country_code: '+52', is_primary: false },
      ],
    }),
    async () => {
      await gotoEmergency(page, circleId);
      const dialog = await openEdit(page, name, `Edit contact ${name}`);
      await expectPhone(dialog, 'contact-phone', '55 1234 5678', 'MX', 'Mexico (+52)');
    }
  );
});

test('additional doctor with +52 opens with its number, and a name-only edit preserves phone + country_code', async ({
  page,
  request,
  account,
  circleId,
}) => {
  const api = await apiSession(request, account);
  const name = uniqueLabel('Dr MX');
  const renamed = `${name} renamed`;
  await withSeeded(
    api,
    circleId,
    (o) => ({
      additional_doctors: [
        ...o.additional_doctors,
        { name, specialty: 'Cardiology', phone: '55 8765 4321', country_code: '+52', address: null },
      ],
    }),
    async () => {
      await gotoEmergency(page, circleId);
      const dialog = await openEdit(page, name, `Edit doctor ${name}`);
      await expectPhone(dialog, 'doctor-phone', '55 8765 4321', 'MX', 'Mexico (+52)');
      await dialog.locator('#doctor-phone').scrollIntoViewIfNeeded();
      await dialog.screenshot({ path: SCREENSHOT_PATH });

      // Change ONLY the name, save.
      await dialog.locator('#doctor-name').fill(renamed);
      const [saved] = await Promise.all([
        page.waitForResponse(
          (r) => r.request().method() === 'PUT' && new URL(r.url()).pathname === `/api/circles/${circleId}/emergency-info`,
          { timeout: 20_000 }
        ),
        dialog.getByRole('button', { name: 'Save', exact: true }).click(),
      ]);
      expect(saved.ok(), `PUT emergency-info from the modal → ${saved.status()}`).toBe(true);
      await expect(dialog).toBeHidden({ timeout: 20_000 });

      // The stored record: renamed, phone and '+52' intact.
      const doctors = arraysOf(await readInfo(api, circleId)).additional_doctors;
      const doc = doctors.find((d) => d.name === renamed);
      expect(doc, `doctor "${renamed}" in ${JSON.stringify(doctors)}`).toBeTruthy();
      expect(doc!.phone).toBe('55 8765 4321');
      expect(doc!.country_code).toBe('+52');
      expect(doctors.some((d) => d.name === name), 'no leftover row under the old name').toBe(false);
    }
  );
});

test('insurance plan with +1 and a 416 number opens as Canada', async ({ page, request, account, circleId }) => {
  const api = await apiSession(request, account);
  const carrier = uniqueLabel('Carrier');
  await withSeeded(
    api,
    circleId,
    (o) => ({
      insurance_plans: [
        ...o.insurance_plans,
        { carrier, phone: '(416) 555-0123', country_code: '+1', is_primary: false },
      ],
    }),
    async () => {
      await gotoEmergency(page, circleId);
      const dialog = await openEdit(page, carrier, `Edit insurance ${carrier}`);
      await expectPhone(dialog, 'insurance-phone', '(416) 555-0123', 'CA', 'Canada (+1)');
    }
  );
});

test('legacy contact with an international number and NO country_code opens as Mexico', async ({
  page,
  request,
  account,
  circleId,
}) => {
  const api = await apiSession(request, account);
  const name = uniqueLabel('Legacy MX');
  await withSeeded(
    api,
    circleId,
    (o) => ({
      emergency_contacts: [
        ...o.emergency_contacts,
        { name, relationship: 'Friend', phone: '+52 55 1111 2222', is_primary: false },
      ],
    }),
    async () => {
      // The seed really has no country_code (the test is about the legacy shape).
      const seeded = arraysOf(await readInfo(api, circleId)).emergency_contacts.find((c) => c.name === name);
      expect(seeded?.country_code ?? null).toBeNull();

      await gotoEmergency(page, circleId);
      const dialog = await openEdit(page, name, `Edit contact ${name}`);
      await expectPhone(dialog, 'contact-phone', '55 1111 2222', 'MX', 'Mexico (+52)');
    }
  );
});
