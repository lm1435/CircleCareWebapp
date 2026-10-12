import type { Page } from '@playwright/test';
import { test, expect, uniqueLabel } from '../fixtures';
import { apiSession, type ApiSession } from '../unhappy';

// ===========================================================================
// THE PHONE SAVE GATE — an invalid phone number is not saved, in a real browser.
//
// Found by the owner on iOS build 31: on Edit Doctor a too-long number
// ("5121548191566") showed "Enter a valid phone number" under the field and
// Save stored it anyway. Owner decision: PREVENT the save, on every emergency
// form with the phone field, on both platforms. The unit suites
// (EditModals.phoneSaveGate.test.tsx, PhoneField.test.tsx, lib/phone.test.ts)
// prove the rule on all three forms; this proves the wiring on the doctor
// form: real modal → Save refused with NO request → corrected → real PUT.
// Mobile twin: mobile/.maestro/parity/emergency/doctor-phone-save-gate.yaml.
//
// The doctor is SEEDED THROUGH THE API on this worker's isolated circle,
// appended to whatever it already holds; the original array is PUT back in
// `finally`. The name is run-unique.
// ===========================================================================

type Json = Record<string, unknown>;

const TOO_LONG = '5121548191566';
const ERROR = 'Enter a valid phone number';

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

async function gotoEmergency(page: Page, circleId: string): Promise<void> {
  await page.goto(`/circles/${circleId}/emergency`, { waitUntil: 'domcontentloaded' });
  await expect(page.getByRole('heading', { name: 'Emergency Info' })).toBeVisible({ timeout: 20_000 });
}

test('doctor: a too-long phone number blocks Save (no request, error shown, phone focused); corrected, it saves', async ({
  page,
  request,
  account,
  circleId,
}) => {
  const api = await apiSession(request, account);
  const name = uniqueLabel('Dr Gate');
  const original = await readDoctors(api, circleId);
  await putDoctors(api, circleId, [
    ...original,
    { name, specialty: 'Cardiology', phone: null, country_code: null, address: null },
  ]);

  try {
    // Every write to the record from here on, so "no network call" is a fact.
    const puts: string[] = [];
    page.on('request', (r) => {
      if (r.method() === 'PUT' && new URL(r.url()).pathname === `/api/circles/${circleId}/emergency-info`) {
        puts.push(r.url());
      }
    });

    await gotoEmergency(page, circleId);
    await page.getByRole('button', { name: `Actions for ${name}`, exact: true }).click();
    await page.getByRole('menuitem', { name: `Edit doctor ${name}`, exact: true }).click();
    const dialog = page.getByRole('dialog');
    await expect(dialog).toBeVisible({ timeout: 15_000 });

    const phone = dialog.locator('#doctor-phone');
    const save = dialog.getByRole('button', { name: 'Save', exact: true });

    // ── 1. Invalid: Save is refused ───────────────────────────────────────
    await phone.fill(TOO_LONG);
    // Leave the number (focus the name) so the refusal has to MOVE focus back.
    await dialog.locator('#doctor-name').focus();
    await save.click();

    await expect(dialog.getByText(ERROR, { exact: true })).toBeVisible();
    await expect(phone).toBeFocused();
    await expect(phone).toBeInViewport();
    await expect(phone).toHaveAttribute('aria-invalid', 'true');
    // The error is the input's description (what a screen reader reads on focus).
    await expect(phone).toHaveAccessibleDescription(ERROR);
    // Still open, nothing sent — and the stored record has no phone.
    await page.waitForTimeout(750);
    await expect(dialog).toBeVisible();
    expect(puts, 'no PUT for the refused save').toHaveLength(0);
    const refused = (await readDoctors(api, circleId)).find((d) => d.name === name);
    expect(refused?.phone ?? null).toBeNull();

    // Enter (implicit form submission) is refused the same way.
    await phone.press('Enter');
    await page.waitForTimeout(500);
    await expect(dialog).toBeVisible();
    expect(puts, 'no PUT for the refused Enter submit').toHaveLength(0);

    // ── 2. Corrected: it saves ────────────────────────────────────────────
    await phone.fill('5121548191');
    await expect(phone).toHaveValue('(512) 154-8191');
    const [saved] = await Promise.all([
      page.waitForResponse(
        (r) =>
          r.request().method() === 'PUT' &&
          new URL(r.url()).pathname === `/api/circles/${circleId}/emergency-info`,
        { timeout: 20_000 }
      ),
      save.click(),
    ]);
    expect(saved.ok(), `PUT emergency-info from the modal → ${saved.status()}`).toBe(true);
    await expect(dialog).toBeHidden({ timeout: 20_000 });
    expect(puts).toHaveLength(1);

    const doc = (await readDoctors(api, circleId)).find((d) => d.name === name);
    expect(doc, `doctor "${name}" after the corrected save`).toBeTruthy();
    expect(doc!.phone).toBe('(512) 154-8191');
    expect(doc!.country_code).toBe('+1');
  } finally {
    await putDoctors(api, circleId, original);
  }
});
