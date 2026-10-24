import type { Page } from '@playwright/test';
import { test, expect, uniqueLabel } from '../fixtures';
import { apiSession, type ApiSession } from '../unhappy';

// ===========================================================================
// THE PHONE EXTENSION (1.2.3) — an optional digits-only extension under the
// phone number of a doctor, in a real browser against the real backend:
// disabled until a number exists → digits only (letters stripped, 10 max) →
// saved → shown as "<phone> ext. <digits>" on the card (tel: link keeps the
// main number only) → reopened with the value → cleared → gone (null).
//
// REQUIRES a backend that accepts `phone_extension` (1.2.3). Against an older
// backend the key is stripped and the "shown on the card" step fails by design.
// Mobile twin: mobile/.maestro/parity/emergency/ (doctor phone extension).
//
// A doctor is edited through PATCH /providers/:id (notes by doctor), not the array PUT.
//
// The doctor is SEEDED THROUGH THE API on this worker's isolated circle,
// appended to whatever it already holds; the original array is PUT back in
// `finally`. The name is run-unique.
// ===========================================================================

type Json = Record<string, unknown>;

async function readDoctors(api: ApiSession, circleId: string): Promise<Json[]> {
  const res = await api.get(`/api/circles/${circleId}/emergency-info`);
  expect(res.ok(), `GET emergency-info → ${res.status()}`).toBe(true);
  const body = (await res.json()) as { data?: { emergency_info?: Json | null } };
  return (body.data?.emergency_info?.additional_doctors as Json[] | null) ?? [];
}

async function putDoctors(api: ApiSession, circleId: string, doctors: Json[]): Promise<void> {
  const res = await api.put(`/api/circles/${circleId}/emergency-info`, { additional_doctors: doctors });
  expect(res.ok(), `PUT emergency-info → ${res.status()} ${await res.text()}`).toBe(true);
}

async function openEdit(page: Page, circleId: string, name: string) {
  await page.goto(`/circles/${circleId}/emergency`, { waitUntil: 'domcontentloaded' });
  await expect(page.getByRole('heading', { name: 'Emergency Info' })).toBeVisible({ timeout: 20_000 });
  await page.getByRole('button', { name: `Actions for ${name}`, exact: true }).click();
  await page.getByRole('menuitem', { name: `Edit doctor ${name}`, exact: true }).click();
  const dialog = page.getByRole('dialog');
  await expect(dialog).toBeVisible({ timeout: 15_000 });
  return dialog;
}

test('doctor: the extension is digits-only, saved, shown beside the number, and clearable', async ({
  page,
  request,
  account,
  circleId,
}) => {
  const api = await apiSession(request, account);
  const name = uniqueLabel('Dr Ext');
  const original = await readDoctors(api, circleId);
  await putDoctors(api, circleId, [
    ...original,
    { name, specialty: 'Cardiology', phone: null, country_code: null, address: null },
  ]);

  try {
    let dialog = await openEdit(page, circleId, name);
    const phone = dialog.locator('#doctor-phone');
    const ext = dialog.getByLabel('Extension', { exact: true });
    const save = dialog.getByRole('button', { name: 'Save', exact: true });

    // Disabled with no number; its description says why.
    await expect(ext).toBeDisabled();
    await expect(ext).toHaveAccessibleDescription('Enter a phone number first');

    await phone.fill('5121548191');
    await expect(ext).toBeEnabled();
    await expect(ext).toHaveAccessibleDescription('Optional');
    await expect(ext).toHaveAttribute('inputmode', 'numeric');

    // Digits only, ten at most.
    await ext.fill('x1-2a3 4567 8901 2');
    await expect(ext).toHaveValue('1234567890');
    await ext.fill('204');

    const [saved] = await Promise.all([
      page.waitForResponse(
        (r) =>
          r.request().method() === 'PATCH' &&
          new URL(r.url()).pathname.startsWith(`/api/circles/${circleId}/providers/`),
        { timeout: 20_000 }
      ),
      save.click(),
    ]);
    expect(saved.ok(), `PATCH providers → ${saved.status()}`).toBe(true);
    await expect(dialog).toBeHidden({ timeout: 20_000 });

    const stored = (await readDoctors(api, circleId)).find((d) => d.name === name);
    expect(stored?.phone_extension).toBe('204');

    // Shown beside the number; the tel: link is the main number only.
    // (The doctor's name is run-unique and no other seeded row carries an extension.)
    await expect(page.getByText('ext. 204', { exact: true })).toBeVisible();
    const link = page.getByRole('link', { name: `Call ${name}`, exact: true });
    await expect(link).toHaveAttribute('href', 'tel:+15121548191');

    // Reopen: seeded; clear it → null.
    dialog = await openEdit(page, circleId, name);
    await expect(dialog.getByLabel('Extension', { exact: true })).toHaveValue('204');
    await dialog.getByLabel('Extension', { exact: true }).fill('');
    await Promise.all([
      page.waitForResponse(
        (r) =>
          r.request().method() === 'PATCH' &&
          new URL(r.url()).pathname.startsWith(`/api/circles/${circleId}/providers/`),
        { timeout: 20_000 }
      ),
      dialog.getByRole('button', { name: 'Save', exact: true }).click(),
    ]);
    await expect(dialog).toBeHidden({ timeout: 20_000 });
    const cleared = (await readDoctors(api, circleId)).find((d) => d.name === name);
    expect(cleared?.phone_extension ?? null).toBeNull();
    await expect(page.getByText('ext. 204', { exact: true })).toHaveCount(0);
  } finally {
    await putDoctors(api, circleId, original);
  }
});
