import type { Page } from '@playwright/test';
import { expect } from './fixtures';

/**
 * First run v2 (1.4.3) helpers for specs that pass THROUGH the new first run on the way to what they
 * test. Language-agnostic: ids and test ids, never copy.
 *
 *   /signup         step 1 is "Who are you caring for?" (owners; an invite code skips it)
 *   /circles empty  "Start a care circle" -> the same question -> the circle forms by itself ->
 *                   Today with the first-item form (the real AddEventModal, first-run mode)
 *
 * The Create circle FORM is now only the header's "Create circle", for a further circle.
 */

/** Answer the one question on /signup (or /circles) with a name, or as self-care. */
export async function answerFirstRunQuestion(page: Page, name: string | null = 'E2E Rosa'): Promise<void> {
  await expect(page.getByTestId('first-run-who')).toBeVisible({ timeout: 20_000 });
  if (name === null) {
    await page.getByTestId('first-run-who-for-me').click();
    return;
  }
  await page.locator('#first-run-recipient-name').fill(name);
  await page.getByTestId('first-run-who-continue').click();
}

/** The circle id in the URL once the moment has handed over to the new circle's Today. */
export async function waitForNewCircle(page: Page): Promise<string> {
  await page.waitForURL(/\/circles\/[0-9a-f-]{36}$/, { timeout: 30_000 });
  return /\/circles\/([0-9a-f-]{36})$/.exec(page.url())![1];
}

/**
 * /circles with NO circle -> "Start a care circle" (the empty state's moss primary, matched by test
 * position, not copy) -> the one question -> the circle forms -> Today with the first-item form open.
 * Returns the new circle id.
 */
export async function startFirstCircle(page: Page, name: string | null = 'E2E Rosa'): Promise<string> {
  await page.goto('/circles', { waitUntil: 'domcontentloaded' });
  await expect(page.getByTestId('empty-circles')).toBeVisible({ timeout: 20_000 });
  await page.getByTestId('empty-circles').getByRole('button').first().click();
  await answerFirstRunQuestion(page, name);
  const circleId = await waitForNewCircle(page);
  // The first-item form (type switch) is the wizard's first screen.
  await expect(page.getByRole('tablist')).toBeVisible({ timeout: 30_000 });
  return circleId;
}

/** Leave the first-item form with "Skip for now" (lands on Today; the paywall stays owed). */
export async function skipFirstItem(page: Page): Promise<void> {
  await page.getByTestId('first-run-skip').click();
  await expect(page.getByRole('tablist')).toHaveCount(0);
}
