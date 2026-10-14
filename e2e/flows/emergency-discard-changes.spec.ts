import type { Locator, Page } from '@playwright/test';
import { test, expect, uniqueLabel } from '../fixtures';
import { apiSession, type ApiSession } from '../unhappy';

// ===========================================================================
// "DISCARD CHANGES?" ON THE EMERGENCY EDIT MODALS (owner-approved 2026-10-14),
// in a real browser against the real backend:
//
// - untouched form: Cancel closes at once, no prompt;
// - edited form: Cancel asks; "Keep editing" returns to the form with the typed
//   text intact; a sidebar link asks too, and "Discard" lets the navigation
//   through — with nothing written;
// - edited form: the browser's Back button asks the same question;
// - edited form: closing the tab raises the browser's own beforeunload prompt.
//
// Unit coverage for every modal + the save bypass:
// src/components/emergency/__tests__/EditModals.discardChanges.test.tsx.
// Mobile twin: mobile/.maestro/ (emergency discard changes).
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

async function gotoEmergency(page: Page, circleId: string): Promise<void> {
  await page.goto(`/circles/${circleId}/emergency`, { waitUntil: 'domcontentloaded' });
  await expect(page.getByRole('heading', { name: 'Emergency Info' })).toBeVisible({ timeout: 20_000 });
}

async function openEdit(page: Page, name: string): Promise<Locator> {
  await page.getByRole('button', { name: `Actions for ${name}`, exact: true }).click();
  await page.getByRole('menuitem', { name: `Edit doctor ${name}`, exact: true }).click();
  const dialog = page.getByRole('dialog', { name: 'Edit doctor' });
  await expect(dialog).toBeVisible({ timeout: 15_000 });
  return dialog;
}

const prompt = (page: Page): Locator => page.getByRole('dialog', { name: 'Discard changes?' });

async function withSeededDoctor(
  request: Parameters<typeof apiSession>[0],
  account: Parameters<typeof apiSession>[1],
  circleId: string,
  body: (name: string, api: ApiSession) => Promise<void>
): Promise<void> {
  const api = await apiSession(request, account);
  const name = uniqueLabel('Dr Discard');
  const original = await readDoctors(api, circleId);
  await putDoctors(api, circleId, [
    ...original,
    { name, specialty: 'Cardiology', phone: null, country_code: null, address: null },
  ]);
  try {
    await body(name, api);
  } finally {
    await putDoctors(api, circleId, original);
  }
}

test('untouched form: Cancel closes at once with no prompt', async ({
  page,
  request,
  account,
  circleId,
}) => {
  await withSeededDoctor(request, account, circleId, async (name) => {
    await gotoEmergency(page, circleId);
    const dialog = await openEdit(page, name);
    await dialog.getByRole('button', { name: 'Cancel', exact: true }).click();
    await expect(dialog).toBeHidden();
    await expect(prompt(page)).toHaveCount(0);
  });
});

test('edited form: Cancel asks, Keep editing keeps the text, a sidebar link asks, Discard navigates', async ({
  page,
  request,
  account,
  circleId,
}) => {
  await withSeededDoctor(request, account, circleId, async (name, api) => {
    await gotoEmergency(page, circleId);
    const dialog = await openEdit(page, name);
    const field = dialog.getByLabel(/^Name/);
    await field.fill(`${name} edited`);

    await dialog.getByRole('button', { name: 'Cancel', exact: true }).click();
    await expect(prompt(page)).toBeVisible();
    await expect(prompt(page).getByText("What you typed here won't be saved.")).toBeVisible();
    await prompt(page).getByRole('button', { name: 'Keep editing', exact: true }).click();
    await expect(prompt(page)).toHaveCount(0);
    await expect(dialog).toBeVisible();
    await expect(field).toHaveValue(`${name} edited`);

    // A sidebar link. The modal's backdrop covers it for a pointer, so the
    // click is dispatched on the link itself — what react-router's Link sees
    // is exactly a sidebar click.
    await page.locator('aside').first().getByRole('link', { name: 'Vitals' }).dispatchEvent('click');
    await expect(prompt(page)).toBeVisible();
    await expect(page).toHaveURL(new RegExp(`/circles/${circleId}/emergency(?:[?#]|$)`));
    await prompt(page).getByRole('button', { name: 'Discard', exact: true }).click();

    await expect(page).toHaveURL(new RegExp(`/circles/${circleId}/vitals(?:[/?#]|$)`), {
      timeout: 20_000,
    });
    await expect(page.getByRole('dialog')).toHaveCount(0);
    // Nothing was written.
    const stored = await readDoctors(api, circleId);
    expect(stored.some((d) => d.name === name)).toBe(true);
    expect(stored.some((d) => d.name === `${name} edited`)).toBe(false);
  });
});

test('edited form: the browser Back button asks the same question', async ({
  page,
  request,
  account,
  circleId,
}) => {
  await withSeededDoctor(request, account, circleId, async (name) => {
    // Arrive by an in-app link so Back is an in-app (router) navigation.
    await page.goto(`/circles/${circleId}/vitals`, { waitUntil: 'domcontentloaded' });
    await page.locator('aside').first().getByRole('link', { name: 'Emergency Info' }).click();
    await expect(page.getByRole('heading', { name: 'Emergency Info' })).toBeVisible({
      timeout: 20_000,
    });
    const dialog = await openEdit(page, name);
    await dialog.getByLabel(/^Name/).fill(`${name} edited`);

    await page.evaluate(() => window.history.back());
    await expect(prompt(page)).toBeVisible();
    await prompt(page).getByRole('button', { name: 'Keep editing', exact: true }).click();
    await expect(page).toHaveURL(new RegExp(`/circles/${circleId}/emergency(?:[?#]|$)`));
    await expect(dialog.getByLabel(/^Name/)).toHaveValue(`${name} edited`);

    await page.evaluate(() => window.history.back());
    await prompt(page).getByRole('button', { name: 'Discard', exact: true }).click();
    await expect(page).toHaveURL(new RegExp(`/circles/${circleId}/vitals(?:[/?#]|$)`), {
      timeout: 20_000,
    });
  });
});

test('edited form: closing the tab raises beforeunload; untouched does not', async ({
  page,
  request,
  account,
  circleId,
}) => {
  await withSeededDoctor(request, account, circleId, async (name) => {
    // A second tab of the same signed-in context, so the fixture's page stays.
    const tab = await page.context().newPage();
    try {
      await gotoEmergency(tab, circleId);
      let dialog = await openEdit(tab, name);
      const dialogs: string[] = [];
      tab.on('dialog', (d) => {
        dialogs.push(d.type());
        void d.dismiss();
      });

      // Untouched: no beforeunload. (Probed via a reload that must just go.)
      await dialog.getByLabel(/^Name/).click();
      await tab.reload({ waitUntil: 'domcontentloaded' });
      expect(dialogs).toEqual([]);

      await expect(tab.getByRole('heading', { name: 'Emergency Info' })).toBeVisible({
        timeout: 20_000,
      });
      dialog = await openEdit(tab, name);
      await dialog.getByLabel(/^Name/).fill(`${name} edited`);
      await tab.close({ runBeforeUnload: true });
      await expect.poll(() => dialogs).toEqual(['beforeunload']);
    } finally {
      if (!tab.isClosed()) await tab.close();
    }
  });
});
