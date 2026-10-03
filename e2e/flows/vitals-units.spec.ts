import type { Page } from '@playwright/test';
import { test, expect, uniqueLabel } from '../fixtures';
import { dbQuery, sqlStr } from '../unhappy';
import { cookieLogin, createCircle, createScopedAccount, ownerApi, uniq } from '../unhappy/auth-invites/_helpers';

// K13 — VITALS UNIT ROUND TRIP (PK8 / PK15). Run-scoped account with its own circle.
//
// Canonical storage is kg / mmol/L; the viewer's unit is display only. The first test
// proves the write converts (160 lb -> 72.5748 kg) and the display follows the profile
// unit. PK8 (approved-recs-2026-09-30, was PARKED P2): an edit sends value1/unit only when
// the displayed value changed and recorded_at only when the date/time changed, so a
// note-only edit keeps value1 and the seconds EXACTLY (see VitalFormModal.edit.test.tsx).
// PK15: a decimal comma ("72,5") is read as a decimal.
test.use({ storageState: { cookies: [], origins: [] } });
test.setTimeout(90_000);

interface Row {
  value1: number;
  unit: string;
  recorded_at: string;
  notes: string | null;
}
const rowFor = (circleId: string, note: string) =>
  dbQuery<Row>(
    `select value1::float8 as value1, unit, to_char(recorded_at at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') as recorded_at, notes
       from health_vitals where circle_id = ${sqlStr(circleId)}::uuid and notes = ${sqlStr(note)}`
  );

async function login(request: Parameters<typeof ownerApi>[0], context: Parameters<typeof cookieLogin>[0], baseURL: string | undefined) {
  const acct = await createScopedAccount('vit-un');
  const api = await ownerApi(request, acct);
  const circleId = await createCircle(api, uniq('vit-un'));
  await cookieLogin(context, acct, baseURL);
  return { acct, api, circleId };
}

async function editNoteOnly(page: Page, circleId: string, newNote: string) {
  await page.goto(`/circles/${circleId}/vitals`, { waitUntil: 'domcontentloaded' });
  const group = page.getByRole('region', { name: 'Weight' });
  await expect(group.getByRole('listitem')).toHaveCount(1, { timeout: 20_000 });
  await group.getByRole('button', { name: /^Actions for reading/ }).click();
  await page.getByRole('menu').getByRole('menuitem', { name: 'Edit', exact: true }).click();
  const dialog = page.getByRole('dialog', { name: 'Edit reading' });
  await expect(dialog).toBeVisible();
  await dialog.locator('#notes').fill(newNote);
  await dialog.getByRole('button', { name: 'Save changes' }).click();
  await expect(dialog).toBeHidden({ timeout: 20_000 });
}

// A weight stored as 72.5 kg at a time with non-zero seconds, made through the API.
const ORIGINAL_AT = () => {
  const d = new Date(Date.now() - 3 * 86_400_000);
  d.setUTCHours(15, 4, 37, 0);
  return d.toISOString().replace('.000Z', '.000Z');
};

async function seedWeight(api: Awaited<ReturnType<typeof ownerApi>>, circleId: string, note: string, at: string) {
  const res = await api.post(`/api/circles/${circleId}/vitals`, {
    vital_type: 'weight',
    value1: 72.5,
    unit: 'kg',
    recorded_at: at,
    notes: note,
  });
  expect(res.status(), await res.text()).toBe(201);
}

test('weight: 160 lb is stored as 72.5748 kg, and the row follows the profile unit', async ({ page, request, context, baseURL }) => {
  const { circleId } = await login(request, context, baseURL);
  const note = uniqueLabel('VU');
  await page.goto(`/circles/${circleId}/vitals`, { waitUntil: 'domcontentloaded' });
  await page.getByRole('button', { name: 'Add reading' }).first().click();
  const dialog = page.getByRole('dialog', { name: 'Add reading' });
  await expect(dialog).toBeVisible({ timeout: 20_000 });
  await dialog.locator('#vital_type').selectOption('weight');
  await dialog.locator('#value1').fill('160');
  await dialog.locator('#notes').fill(note);
  await dialog.getByRole('button', { name: 'Save reading', exact: true }).click();
  await expect(dialog).toBeHidden({ timeout: 20_000 });

  const [row] = rowFor(circleId, note);
  expect(row.unit).toBe('kg');
  expect(Math.abs(row.value1 - 72.5748)).toBeLessThan(1e-3);
  const group = page.getByRole('region', { name: 'Weight' });
  await expect(group.getByText(/^160(\.0)?\s*lb/)).toBeVisible({ timeout: 20_000 });

  await page.goto('/profile', { waitUntil: 'domcontentloaded' });
  const put = page.waitForResponse((r) => r.request().method() === 'PUT' && r.url().endsWith('/api/users/me/unit-preferences'));
  await page.getByRole('radio', { name: 'Kilograms (kg)' }).click();
  expect((await put).status()).toBe(200);

  await page.goto(`/circles/${circleId}/vitals`, { waitUntil: 'domcontentloaded' });
  await expect(page.getByRole('region', { name: 'Weight' }).getByText(/^72\.6\s*kg/)).toBeVisible({ timeout: 20_000 });
  // Display only: the stored value did not move.
  expect(rowFor(circleId, note)[0].value1).toBe(row.value1);
});

test('PK8 weight: a note-only edit sends only the note: value1 is exactly 72.5 kg and the unit stays kg', async ({ page, request, context, baseURL }) => {
  const { api, circleId } = await login(request, context, baseURL);
  const note = uniqueLabel('VU');
  await seedWeight(api, circleId, note, ORIGINAL_AT());
  await editNoteOnly(page, circleId, `${note} edited`);
  const [row] = rowFor(circleId, `${note} edited`);
  expect(row.value1).toBe(72.5);
  expect(row.unit).toBe('kg');
});

test('PK8 weight: a note-only edit keeps recorded_at exactly (seconds preserved)', async ({ page, request, context, baseURL }) => {
  const { api, circleId } = await login(request, context, baseURL);
  const note = uniqueLabel('VU');
  const at = ORIGINAL_AT();
  await seedWeight(api, circleId, note, at);
  await editNoteOnly(page, circleId, `${note} edited`);
  expect(rowFor(circleId, `${note} edited`)[0].recorded_at).toBe(at);
});

test('PK15 weight: "72,5" lb (decimal comma) is stored as 72.5 lb in kg', async ({ page, request, context, baseURL }) => {
  const { circleId } = await login(request, context, baseURL);
  const note = uniqueLabel('VU');
  await page.goto(`/circles/${circleId}/vitals`, { waitUntil: 'domcontentloaded' });
  await page.getByRole('button', { name: 'Add reading' }).first().click();
  const dialog = page.getByRole('dialog', { name: 'Add reading' });
  await expect(dialog).toBeVisible({ timeout: 20_000 });
  await dialog.locator('#vital_type').selectOption('weight');
  await dialog.locator('#value1').fill('72,5');
  await dialog.locator('#notes').fill(note);
  await dialog.getByRole('button', { name: 'Save reading', exact: true }).click();
  await expect(dialog).toBeHidden({ timeout: 20_000 });
  const [row] = rowFor(circleId, note);
  expect(row.unit).toBe('kg');
  expect(Math.abs(row.value1 - 72.5 * 0.45359237)).toBeLessThan(1e-3);
});

test('PK15 heart rate: "1,200" is read as 1.2 and refused by the range check; nothing is stored', async ({ page, request, context, baseURL }) => {
  const { circleId } = await login(request, context, baseURL);
  const note = uniqueLabel('VU');
  await page.goto(`/circles/${circleId}/vitals`, { waitUntil: 'domcontentloaded' });
  await page.getByRole('button', { name: 'Add reading' }).first().click();
  const dialog = page.getByRole('dialog', { name: 'Add reading' });
  await expect(dialog).toBeVisible({ timeout: 20_000 });
  await dialog.locator('#vital_type').selectOption('heart_rate');
  await dialog.locator('#value1').fill('1,200');
  await dialog.locator('#notes').fill(note);
  await dialog.getByRole('button', { name: 'Save reading', exact: true }).click();
  await expect(dialog.locator('#value1')).toHaveAttribute('aria-invalid', 'true');
  await expect(dialog).toBeVisible();
  expect(rowFor(circleId, note)).toHaveLength(0);
});

for (const zone of ['Pacific/Kiritimati', 'America/Los_Angeles'] as const) {
  test.describe(`viewer zone ${zone}`, () => {
    test.use({ timezoneId: zone });
    test('weight: a note-only edit stays within 60 s of the original instant', async ({ page, request, context, baseURL }) => {
      const { api, circleId } = await login(request, context, baseURL);
      const note = uniqueLabel('VU');
      const at = ORIGINAL_AT();
      await seedWeight(api, circleId, note, at);
      await editNoteOnly(page, circleId, `${note} edited`);
      const [row] = rowFor(circleId, `${note} edited`);
      expect(Math.abs(new Date(row.recorded_at).getTime() - new Date(at).getTime())).toBeLessThan(60_000);
    });
  });
}
