import type { Page } from '@playwright/test';
import { test, expect } from '../fixtures';

// The simple medication form's "Reminders" summary row (owner 2026-11-10, mobile parity): OUTSIDE
// the folded More details, visible with it collapsed, saying what will happen; one tap opens More
// details and brings the Reminders card ("Enable notifications") into view. Phone width and desktop.
// Nothing is saved: the form is closed without adding.

async function openNewMedication(page: Page, circleId: string) {
  await page.goto(`/circles/${circleId}/meds`, { waitUntil: 'domcontentloaded' });
  await expect(page.getByRole('heading', { level: 1, name: /'s meds$/ })).toBeVisible({
    timeout: 30_000,
  });
  await page.getByRole('button', { name: 'Add medication' }).first().click();
  const form = page.getByRole('dialog', { name: 'New medication' });
  await expect(form).toBeVisible();
  return form;
}

for (const viewport of [
  { name: 'phone', width: 390, height: 844 },
  { name: 'desktop', width: 1280, height: 900 },
]) {
  test(`reminders summary row on a new medication (${viewport.name})`, async ({ page, circleId }) => {
    await page.setViewportSize({ width: viewport.width, height: viewport.height });
    const form = await openNewMedication(page, circleId);
    await form.getByRole('radio', { name: /^Evening/ }).click();

    const more = form.getByRole('button', { name: /^More details/ });
    await expect(more).toHaveAttribute('aria-expanded', 'false');
    const row = form.getByRole('button', {
      name: 'Reminders: At the scheduled time · follow-ups on',
    });
    await expect(row).toBeVisible();
    await expect(row).toContainText('Change');
    const enable = form.getByRole('switch', { name: /Enable notifications/ });
    await expect(enable).toBeHidden();

    await row.click();
    await expect(more).toHaveAttribute('aria-expanded', 'true');
    await expect(enable).toBeVisible();
    await expect(enable).toBeInViewport();
    await expect(enable).toBeFocused();

    // Live: the card's own control changes the row.
    await form.getByRole('checkbox', { name: /^At the scheduled time/ }).click();
    await expect(
      form.getByRole('button', {
        name: 'Reminders: Follow-ups only · nothing at the scheduled time',
      })
    ).toBeVisible();
  });
}
