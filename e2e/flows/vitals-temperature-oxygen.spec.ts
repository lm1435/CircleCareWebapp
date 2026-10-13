import type { Page } from '@playwright/test';
import { test, expect, uniqueLabel } from '../fixtures';
import { dbQuery, sqlStr } from '../unhappy';
import { cookieLogin, createCircle, createScopedAccount, ownerApi, uniq } from '../unhappy/auth-invites/_helpers';

// TEMPERATURE + BLOOD OXYGEN (1.2.3). Run-scoped account with its own circle.
//
// Canonical storage is °C (U+00B0 + C) and %; the viewer's temperature unit is display
// only, like weight. A new account has no saved temperature unit, so it follows the weight
// unit (lbs -> °F). The tests log both readings through the form, then assert the stored
// row, the grouped list, the type filter, the value after a reload, and the unit switch
// from Profile. The reads only return these two types because the app sends
// `extraTypes=temperature,oxygen_saturation`: a row that shows up here proves that too.
test.use({ storageState: { cookies: [], origins: [] } });
test.setTimeout(120_000);

interface Row {
  vital_type: string;
  value1: number;
  value2: number | null;
  unit: string;
}
const rowFor = (circleId: string, note: string) =>
  dbQuery<Row>(
    `select vital_type, value1::float8 as value1, value2::float8 as value2, unit
       from health_vitals where circle_id = ${sqlStr(circleId)}::uuid and notes = ${sqlStr(note)}`
  );

async function login(request: Parameters<typeof ownerApi>[0], context: Parameters<typeof cookieLogin>[0], baseURL: string | undefined) {
  const acct = await createScopedAccount('vit-to');
  const api = await ownerApi(request, acct);
  const circleId = await createCircle(api, uniq('vit-to'));
  await cookieLogin(context, acct, baseURL);
  return { acct, api, circleId };
}

async function logReading(page: Page, type: 'temperature' | 'oxygen_saturation', value: string, note: string) {
  await page.getByRole('button', { name: 'Add reading' }).first().click();
  const dialog = page.getByRole('dialog', { name: 'Add reading' });
  await expect(dialog).toBeVisible({ timeout: 20_000 });
  await dialog.locator('#vital_type').selectOption(type);
  await dialog.locator('#value1').fill(value);
  await dialog.locator('#notes').fill(note);
  await dialog.getByRole('button', { name: 'Save reading', exact: true }).click();
  await expect(dialog).toBeHidden({ timeout: 20_000 });
}

test('temperature and blood oxygen: logged through the form, listed, filtered, and kept after a reload', async ({ page, request, context, baseURL }) => {
  const { circleId } = await login(request, context, baseURL);
  const tempNote = uniqueLabel('VT');
  const oxygenNote = uniqueLabel('VO');
  await page.goto(`/circles/${circleId}/vitals`, { waitUntil: 'domcontentloaded' });

  // The two newer types close the chip row, in this order.
  const chips = page.getByRole('radiogroup', { name: 'Type' }).getByRole('radio');
  await expect(chips).toHaveCount(7, { timeout: 20_000 });
  await expect(chips.nth(5)).toHaveAccessibleName('Temperature');
  await expect(chips.nth(6)).toHaveAccessibleName('Blood oxygen');

  // Temperature, typed in °F (the unit shown under the field), stored in °C.
  await page.getByRole('button', { name: 'Add reading' }).first().click();
  const dialog = page.getByRole('dialog', { name: 'Add reading' });
  await expect(dialog).toBeVisible({ timeout: 20_000 });
  await dialog.locator('#vital_type').selectOption('temperature');
  await expect(dialog.getByText('in °F', { exact: true })).toBeVisible();
  await dialog.getByRole('button', { name: 'Cancel', exact: true }).click();
  await expect(dialog).toBeHidden();

  await logReading(page, 'temperature', '99.1', tempNote);
  const [temp] = rowFor(circleId, tempNote);
  expect(temp.vital_type).toBe('temperature');
  expect(temp.unit).toBe('°C');
  expect(temp.value2).toBeNull();
  expect(Math.abs(temp.value1 - ((99.1 - 32) * 5) / 9)).toBeLessThan(1e-3);

  // Blood oxygen: sent as typed, in %.
  await logReading(page, 'oxygen_saturation', '96', oxygenNote);
  const [oxygen] = rowFor(circleId, oxygenNote);
  expect(oxygen.vital_type).toBe('oxygen_saturation');
  expect(oxygen.unit).toBe('%');
  expect(oxygen.value1).toBe(96);
  expect(oxygen.value2).toBeNull();

  // "All types": one group each, value in the viewer's unit; blood oxygen has no space.
  const tempGroup = page.getByRole('region', { name: 'Temperature' });
  const oxygenGroup = page.getByRole('region', { name: 'Blood oxygen' });
  await expect(tempGroup.getByText('99.1 °F', { exact: true })).toBeVisible({ timeout: 20_000 });
  await expect(oxygenGroup.getByText('96%', { exact: true })).toBeVisible({ timeout: 20_000 });

  // Filter: each chip narrows the list to its own type.
  await page.getByRole('radio', { name: 'Temperature', exact: true }).click();
  await expect(page.getByText('99.1 °F', { exact: true })).toBeVisible({ timeout: 20_000 });
  await expect(page.getByText('96%', { exact: true })).toHaveCount(0);
  await page.getByRole('radio', { name: 'Blood oxygen', exact: true }).click();
  await expect(page.getByText('96%', { exact: true })).toBeVisible({ timeout: 20_000 });
  await expect(page.getByText('99.1 °F', { exact: true })).toHaveCount(0);

  // Persisted: a fresh load reads both back from the server.
  await page.reload({ waitUntil: 'domcontentloaded' });
  await expect(page.getByRole('region', { name: 'Temperature' }).getByText('99.1 °F', { exact: true })).toBeVisible({ timeout: 20_000 });
  await expect(page.getByRole('region', { name: 'Blood oxygen' }).getByText('96%', { exact: true })).toBeVisible({ timeout: 20_000 });
});

test('temperature unit: Profile switches °F to °C for display only, and "37,5" (decimal comma) is stored as 37.5 °C', async ({ page, request, context, baseURL }) => {
  const { circleId } = await login(request, context, baseURL);
  const firstNote = uniqueLabel('VT');
  const secondNote = uniqueLabel('VT');
  await page.goto(`/circles/${circleId}/vitals`, { waitUntil: 'domcontentloaded' });
  await logReading(page, 'temperature', '98.6', firstNote);
  const [before] = rowFor(circleId, firstNote);
  expect(Math.abs(before.value1 - 37)).toBeLessThan(1e-3);

  await page.goto('/profile', { waitUntil: 'domcontentloaded' });
  const group = page.getByRole('radiogroup', { name: 'Temperature' });
  await expect(group.getByRole('radio', { name: 'Fahrenheit (°F)' })).toBeChecked({ timeout: 20_000 });
  const put = page.waitForResponse((r) => r.request().method() === 'PUT' && r.url().endsWith('/api/users/me/unit-preferences'));
  await group.getByRole('radio', { name: 'Celsius (°C)' }).click();
  const response = await put;
  expect(response.status()).toBe(200);
  expect(response.request().postDataJSON()).toEqual({ temperature_unit: '°C' });

  await page.goto(`/circles/${circleId}/vitals`, { waitUntil: 'domcontentloaded' });
  await expect(page.getByRole('region', { name: 'Temperature' }).getByText('37 °C', { exact: true })).toBeVisible({ timeout: 20_000 });
  // Display only: the stored value did not move.
  expect(rowFor(circleId, firstNote)[0].value1).toBe(before.value1);

  await logReading(page, 'temperature', '37,5', secondNote);
  const [second] = rowFor(circleId, secondNote);
  expect(second.unit).toBe('°C');
  expect(second.value1).toBe(37.5);
  await expect(page.getByRole('region', { name: 'Temperature' }).getByText('37.5 °C', { exact: true })).toBeVisible({ timeout: 20_000 });

  // The setting survives a reload of Profile.
  await page.goto('/profile', { waitUntil: 'domcontentloaded' });
  await expect(page.getByRole('radiogroup', { name: 'Temperature' }).getByRole('radio', { name: 'Celsius (°C)' })).toBeChecked({ timeout: 20_000 });
});

test('out-of-range readings are refused in the form and nothing is stored', async ({ page, request, context, baseURL }) => {
  const { circleId } = await login(request, context, baseURL);
  const note = uniqueLabel('VR');
  await page.goto(`/circles/${circleId}/vitals`, { waitUntil: 'domcontentloaded' });
  await page.getByRole('button', { name: 'Add reading' }).first().click();
  const dialog = page.getByRole('dialog', { name: 'Add reading' });
  await expect(dialog).toBeVisible({ timeout: 20_000 });
  await dialog.locator('#notes').fill(note);

  await dialog.locator('#vital_type').selectOption('oxygen_saturation');
  await dialog.locator('#value1').fill('101');
  await dialog.getByRole('button', { name: 'Save reading', exact: true }).click();
  await expect(dialog.getByText('That looks outside the expected range. Double-check the number.')).toBeVisible();

  // 37 is a °C number; this account reads °F.
  await dialog.locator('#vital_type').selectOption('temperature');
  await dialog.locator('#value1').fill('37');
  await dialog.getByRole('button', { name: 'Save reading', exact: true }).click();
  await expect(dialog.getByText('That looks outside the expected range. Double-check the number.')).toBeVisible();
  await expect(dialog).toBeVisible();
  expect(rowFor(circleId, note)).toHaveLength(0);
});
