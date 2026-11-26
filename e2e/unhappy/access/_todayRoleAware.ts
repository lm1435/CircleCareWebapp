import { expect, type Locator, type Page } from '@playwright/test';

// Shared by memberToday.roleAware.spec.ts and recipientToday.roleAware.spec.ts (a persona is a worker option: one per file).

export function today(page: Page): Locator {
  return page.locator('[data-today-ready="true"]');
}

export async function openToday(page: Page, circleId: string): Promise<void> {
  await page.goto(`/circles/${circleId}`);
  await expect(page.getByRole('heading', { name: /^Today/ }).first()).toBeVisible({ timeout: 20_000 });
  await expect(today(page)).toBeVisible({ timeout: 20_000 });
}

/** Dismiss the teaching elements (first-dose hint, shifts nudge) until the page reports `want`. */
export async function driveCoachingTo(page: Page, want: string): Promise<void> {
  for (let i = 0; i < 4; i++) {
    const coaching = await today(page).getAttribute('data-coaching');
    if (coaching === want) return;
    if (coaching === 'dose_hint') {
      await page.getByTestId('dose-hint').getByRole('button', { name: 'Got it' }).click();
    } else if (coaching === 'shifts') {
      await page.getByTestId('shifts-nudge-card').getByRole('button', { name: 'Not now' }).click();
    } else {
      break;
    }
    await expect(today(page)).toBeVisible();
  }
  await expect(today(page)).toHaveAttribute('data-coaching', want);
}

