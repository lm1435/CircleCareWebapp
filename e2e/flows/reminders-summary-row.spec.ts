import type { Page } from '@playwright/test';
import { test, expect } from '../fixtures';

// The simple medication form's "Reminders" summary row (owner 2026-11-10, mobile parity): OUTSIDE
// the folded More details, visible with it collapsed, saying what will happen. An accordion: one tap
// expands the full Reminders card ("Enable notifications") inline, directly under the row, with More
// details left collapsed; a second tap folds it. Phone width and desktop.
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
    await form.getByRole('checkbox', { name: /Evening$/ }).click();

    const more = form.getByRole('button', { name: /^More details/ });
    await expect(more).toHaveAttribute('aria-expanded', 'false');
    const row = form.getByRole('button', {
      name: 'Reminders: At the scheduled time · follow-ups on',
    });
    await expect(row).toBeVisible();
    await expect(row).toContainText('Change');
    const enable = form.getByRole('switch', { name: /Enable notifications/ });
    await expect(enable).toBeHidden();

    await expect(row).toHaveAttribute('aria-expanded', 'false');
    await row.click();
    await expect(row).toHaveAttribute('aria-expanded', 'true');
    await expect(enable).toBeVisible();
    // Right under the row, and More details is untouched. THE NUDGE (build 11): the card's first control is
    // scrolled into view with block "nearest" (only by what was hidden behind the fold), so the row and the
    // "Enable notifications" switch are both on screen; the card's lower controls may sit below the fold.
    const panel = form.getByTestId('reminders-summary-panel');
    await expect(panel).toBeVisible();
    await expect(panel).toBeInViewport();
    await expect(enable).toBeInViewport();
    await expect(row).toBeInViewport();
    const [rowBox, panelBox] = [await row.boundingBox(), await panel.boundingBox()];
    expect(rowBox && panelBox && panelBox.y >= rowBox.y + rowBox.height - 1).toBe(true);
    expect(rowBox && panelBox && panelBox.y - (rowBox.y + rowBox.height) < 24).toBe(true);
    await expect(more).toHaveAttribute('aria-expanded', 'false');
    await expect(row).toBeFocused();

    // Live: the card's own control changes the row.
    await form.getByRole('checkbox', { name: /^At the scheduled time/ }).click();
    await expect(
      form.getByRole('button', {
        name: 'Reminders: Follow-ups only · nothing at the scheduled time',
      })
    ).toBeVisible();

    // A second tap folds the card again.
    const rowAgain = form.getByTestId('reminders-summary-row');
    await rowAgain.click();
    await expect(rowAgain).toHaveAttribute('aria-expanded', 'false');
    await expect(enable).toBeHidden();
    await expect(more).toHaveAttribute('aria-expanded', 'false');
  });
}
