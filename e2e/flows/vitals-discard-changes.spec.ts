import type { Locator, Page } from '@playwright/test';
import { test, expect, uniqueLabel } from '../fixtures';
import { apiSession, type ApiSession } from '../unhappy';

// ===========================================================================
// "DISCARD CHANGES?" ON THE VITALS ADD FORM (2026-10-14), in a real browser
// against the real backend — the same shared guard as the Emergency modals:
//
// - untouched form: Cancel closes at once, no prompt;
// - typed reading: Cancel asks; "Keep editing" returns to the form with the
//   number intact; a sidebar link asks too, and "Discard" lets the navigation
//   through — with nothing written;
// - a successful save closes without asking.
//
// Unit coverage (edit mode, time, type-only, beforeunload):
// src/components/vitals/__tests__/VitalFormModal.discardChanges.test.tsx.
// Mobile twin: mobile/.maestro/parity/vitals/discard-changes.yaml.
//
// Readings are tagged with a run-unique note and removed through the API in
// `finally`.
// ===========================================================================

interface VitalRow {
  id: string;
  value1: number;
  notes: string | null;
}

async function listHeartRate(api: ApiSession, circleId: string): Promise<VitalRow[]> {
  const to = new Date(Date.now() + 2 * 24 * 60 * 60 * 1000).toISOString();
  const res = await api.get(
    `/api/circles/${circleId}/vitals?type=heart_rate&from=2000-01-01&to=${encodeURIComponent(to)}`
  );
  expect(res.ok(), `list vitals: ${res.status()} ${await res.text()}`).toBe(true);
  return ((await res.json()) as { data: { vitals: VitalRow[] } }).data.vitals;
}

async function openAdd(page: Page, circleId: string): Promise<Locator> {
  await page.goto(`/circles/${circleId}/vitals`, { waitUntil: 'domcontentloaded' });
  const addBtn = page.getByRole('button', { name: 'Add reading' }).first();
  await expect(addBtn).toBeVisible({ timeout: 15_000 });
  await addBtn.click();
  const dialog = page.getByRole('dialog', { name: 'Add reading' });
  await expect(dialog).toBeVisible();
  await dialog.locator('#vital_type').selectOption('heart_rate');
  return dialog;
}

const prompt = (page: Page): Locator => page.getByRole('dialog', { name: 'Discard changes?' });

test('untouched add form (type chosen, nothing typed): Cancel closes at once', async ({
  page,
  circleId,
}) => {
  const dialog = await openAdd(page, circleId);
  await dialog.getByRole('button', { name: 'Cancel', exact: true }).click();
  await expect(dialog).toBeHidden();
  await expect(prompt(page)).toHaveCount(0);
});

test('typed reading: Cancel asks, Keep editing keeps it, a sidebar link asks, Discard navigates, nothing saved', async ({
  page,
  request,
  account,
  circleId,
}) => {
  const api = await apiSession(request, account);
  const before = (await listHeartRate(api, circleId)).length;
  const bpm = String(240 + Math.floor(Math.random() * 51));

  const dialog = await openAdd(page, circleId);
  await dialog.locator('#value1').fill(bpm);

  await dialog.getByRole('button', { name: 'Cancel', exact: true }).click();
  await expect(prompt(page)).toBeVisible();
  await expect(prompt(page).getByText("What you typed here won't be saved.")).toBeVisible();
  await prompt(page).getByRole('button', { name: 'Keep editing', exact: true }).click();
  await expect(prompt(page)).toHaveCount(0);
  await expect(dialog).toBeVisible();
  await expect(dialog.locator('#value1')).toHaveValue(bpm);

  // The modal's backdrop covers the sidebar for a pointer; the click is
  // dispatched on the link itself (what react-router's Link sees).
  await page.locator('aside').first().getByRole('link', { name: 'Emergency Info' }).dispatchEvent('click');
  await expect(prompt(page)).toBeVisible();
  await expect(page).toHaveURL(new RegExp(`/circles/${circleId}/vitals(?:[?#]|$)`));
  await prompt(page).getByRole('button', { name: 'Discard', exact: true }).click();
  await expect(page).toHaveURL(new RegExp(`/circles/${circleId}/emergency(?:[/?#]|$)`), {
    timeout: 20_000,
  });
  await expect(page.getByRole('dialog')).toHaveCount(0);

  const after = await listHeartRate(api, circleId);
  expect(after).toHaveLength(before);
  expect(after.some((v) => String(v.value1) === bpm)).toBe(false);
});

test('typed reading then Save: closes without asking', async ({
  page,
  request,
  account,
  circleId,
}) => {
  const api = await apiSession(request, account);
  const note = uniqueLabel('vital-discard');
  try {
    const dialog = await openAdd(page, circleId);
    await dialog.locator('#value1').fill('77');
    await dialog.locator('#notes').fill(note);
    await dialog.getByRole('button', { name: 'Save reading' }).click();
    await expect(dialog).toBeHidden({ timeout: 20_000 });
    await expect(prompt(page)).toHaveCount(0);
  } finally {
    for (const v of await listHeartRate(api, circleId)) {
      if (v.notes === note) await api.delete(`/api/circles/${circleId}/vitals/${v.id}`);
    }
  }
});
