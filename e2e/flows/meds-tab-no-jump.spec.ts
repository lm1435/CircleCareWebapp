import { test, expect } from '../fixtures';

// Medications | History: both tabs carry exactly ONE subtitle line in the same slot, so the
// segmented control (and everything under it) does not move when you switch tabs.
// Non-destructive: nothing is saved.

const NAV_TIMEOUT = 20_000;

test('Medications | History: one subtitle on each tab and the tab control does not move', async ({
  page,
  circleId,
}) => {
  await page.goto(`/circles/${circleId}/meds`, { waitUntil: 'domcontentloaded' });
  const subtitle = page.getByTestId('page-subtitle');
  const tabs = page.getByRole('tab', { name: 'Medications' });
  await expect(tabs).toBeVisible({ timeout: NAV_TIMEOUT });
  // The summary replaces the held (non-breaking space) line once the roster answers.
  await expect(subtitle).toHaveText(/medication|as needed|No medications yet/i, { timeout: NAV_TIMEOUT });
  await expect(subtitle).toHaveCount(1);
  const before = await tabs.boundingBox();

  await page.getByRole('tab', { name: 'History' }).click();
  await expect(subtitle).toHaveText('Track adherence and review what was taken when.');
  await expect(subtitle).toHaveCount(1);
  const after = await page.getByRole('tab', { name: 'Medications' }).boundingBox();

  expect(before).not.toBeNull();
  expect(after).not.toBeNull();
  expect(Math.abs(after!.y - before!.y), 'the tab control stays put').toBeLessThanOrEqual(0.5);
});
