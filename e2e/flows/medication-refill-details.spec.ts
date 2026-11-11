import type { Page } from '@playwright/test';
import { test, expect } from '../fixtures';
import { checkA11y } from '../helpers';
import { apiSession, dbQuery, sqlStr } from '../unhappy';

// Web parity (owner 2026-11-08): the medication form's More details carries what mobile's does — Track
// refills (pills remaining / per dose / alert days, the computed lines) and Prescriber / Pharmacy /
// Pharmacy phone / Rx number. Added on the web against the live backend, the REAL row must hold mobile's
// columns, and the edit form must hydrate them back (the events list omits them: the form reads the
// single-event GET).
//
// The photo half is covered by vitest only: a local backend (NODE_ENV=development + localhost Supabase)
// answers the upload-url request with a placeholder instead of a signed upload URL.

const PREFIX = 'ZZ_E2E_REFILL_';
const uniqueName = () => `${PREFIX}${Date.now()}-${Math.floor(Math.random() * 1e4)}`;

async function gotoMeds(page: Page, circleId: string): Promise<void> {
  await page.goto(`/circles/${circleId}/meds`, { waitUntil: 'domcontentloaded' });
  await expect(page.getByRole('heading', { level: 1, name: /'s meds$/ })).toBeVisible({ timeout: 30_000 });
}

interface Row {
  id: string;
  track_refills: boolean;
  quantity_in_bottle: number | null;
  quantity_remaining: number | null;
  pills_per_dose: number | null;
  pills_per_day: number | null;
  alert_days_before: number | null;
  prescriber_name: string | null;
  pharmacy_name: string | null;
  pharmacy_phone: string | null;
  rx_number: string | null;
}
const rowsFor = (circleId: string, name: string) =>
  dbQuery<Row>(
    `select id, track_refills, quantity_in_bottle, quantity_remaining, pills_per_dose, pills_per_day,
            alert_days_before, prescriber_name, pharmacy_name, pharmacy_phone, rx_number
       from calendar_events
      where circle_id = ${sqlStr(circleId)} and medication_name = ${sqlStr(name)} and parent_event_id is null`
  );

test('add a medication with refill tracking + prescriber on the web; the edit form reads it back', async ({
  page,
  circleId,
  account,
  request,
}, testInfo) => {
  const name = uniqueName();
  try {
    await gotoMeds(page, circleId);
    await page.getByRole('button', { name: 'Add medication' }).first().click();
    const form = page.getByRole('dialog', { name: 'New medication' });
    await form.getByLabel(/Medication name/i).fill(name);
    await form.getByLabel(/Dosage/i).fill('500 mg');
    await form.getByRole('radio', { name: /^Evening/ }).click();

    const more = form.getByRole('button', { name: /^More details/ });
    await expect(more).toContainText('Refills, pharmacy, prescriber, instructions');
    await more.click();
    await expect(form.getByRole('button', { name: 'Add a photo' })).toBeVisible();
    await form.getByRole('checkbox', { name: /Track refills/ }).click();
    await form.getByLabel('Pills remaining').fill('60');
    await form.getByLabel('Pills per dose').fill('2');
    await expect(form.getByTestId('pills-per-day-derived')).toHaveText('2 × 1 dose times = 2 per day');
    await expect(form.getByTestId('refill-estimate')).toHaveText('~30 days supply. Alert when 7 days left.');
    await form.getByLabel('Prescriber').fill('Dr. Rivera');
    await form.getByLabel('Pharmacy', { exact: true }).fill('Main St Pharmacy');
    await form.getByLabel('Pharmacy phone').fill('555-0100');
    await form.getByLabel('Rx number').fill('RX-4471');
    await checkA11y(page, 'add medication dialog (More details: refills + prescription)', testInfo, { wcag22: true });

    await form.getByRole('button', { name: 'Add medication' }).click();
    await expect(page.getByText('Medication added')).toBeVisible({ timeout: 20_000 });

    // The real row: mobile's columns, mobile's values.
    await expect.poll(() => rowsFor(circleId, name).length, { timeout: 10_000 }).toBe(1);
    expect(rowsFor(circleId, name)[0]).toMatchObject({
      track_refills: true,
      quantity_in_bottle: 60,
      quantity_remaining: 60,
      pills_per_dose: 2,
      pills_per_day: 2,
      alert_days_before: 7,
      prescriber_name: 'Dr. Rivera',
      pharmacy_name: 'Main St Pharmacy',
      pharmacy_phone: '555-0100',
      rx_number: 'RX-4471',
    });

    // Edit: More details opens on the stored values; an untouched bottle is not re-seeded.
    const card = page.getByRole('listitem').filter({ hasText: name });
    await card.getByRole('button', { name: `More actions for ${name}` }).click();
    await page.getByRole('menuitem', { name: 'Edit' }).click();
    const edit = page.getByRole('dialog', { name: 'Edit medication' });
    await expect(edit.getByLabel('Prescriber')).toHaveValue('Dr. Rivera', { timeout: 15_000 });
    await expect(edit.getByRole('button', { name: /^More details/ })).toHaveAttribute('aria-expanded', 'true');
    await expect(edit.getByRole('checkbox', { name: /Track refills/ })).toHaveAttribute('aria-checked', 'true');
    await expect(edit.getByLabel('Pills remaining')).toHaveValue('60');
    await edit.getByLabel('Rx number').fill('RX-9000');
    await edit.getByRole('button', { name: 'Save changes' }).click();
    await expect(edit).toBeHidden({ timeout: 20_000 });
    await expect.poll(() => rowsFor(circleId, name)[0]?.rx_number, { timeout: 10_000 }).toBe('RX-9000');
    expect(rowsFor(circleId, name)[0]).toMatchObject({
      track_refills: true,
      quantity_in_bottle: 60,
      quantity_remaining: 60,
      prescriber_name: 'Dr. Rivera',
    });
  } finally {
    const session = await apiSession(request, account);
    for (const row of rowsFor(circleId, name)) {
      await session.delete(`/api/circles/${circleId}/events/${row.id}?deleteScope=series`).catch(() => {});
    }
  }
});
