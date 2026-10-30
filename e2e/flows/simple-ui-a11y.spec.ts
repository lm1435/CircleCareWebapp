import type { Page } from '@playwright/test';
import { test, expect } from '../fixtures';
import { checkA11y } from '../helpers';

// AXE (WCAG 2.1 AA + 2.2 AA target size) on the three simple-UI surfaces, at a desktop
// and a phone width: Today, the new-medication / new-appointment forms (open
// dialogs), and Care > Meds. Each scan is taken on the worker's isolated clone of
// the demo circle (meds, tasks, appointments), so every row type is on screen.

test.use({ contextOptions: { reducedMotion: 'reduce' } });
const WCAG22 = { wcag22: true } as const;

const SIZES = [
  { name: 'desktop 1280x800', width: 1280, height: 800 },
  { name: 'phone 390x844', width: 390, height: 844 },
] as const;

async function openAddOption(page: Page, option: 'Med' | 'Appt'): Promise<void> {
  const desktop = (page.viewportSize()?.width ?? 0) >= 1024;
  const trigger = desktop
    ? page.locator('aside').getByRole('button', { name: 'New', exact: true })
    : page.getByRole('navigation').getByRole('button', { name: 'New', exact: true });
  await expect(trigger.first()).toBeVisible({ timeout: 20_000 });
  await trigger.first().click();
  await page.getByRole('menuitem', { name: option, exact: true }).click();
}

for (const size of SIZES) {
  test.describe(size.name, () => {
    test.use({ viewport: { width: size.width, height: size.height } });

    test('Today', async ({ page, circleId }, testInfo) => {
      await page.goto(`/circles/${circleId}`, { waitUntil: 'domcontentloaded' });
      await expect(page.getByRole('heading', { level: 1 })).toContainText('Today', { timeout: 30_000 });
      await expect(page.getByTestId('quick-access-grid')).toBeVisible();
      await expect(page.getByRole('region', { name: 'Next up' })).toBeVisible();
      await checkA11y(page, `today ${size.name}`, testInfo, WCAG22);
    });

    test('new medication form', async ({ page, circleId }, testInfo) => {
      await page.goto(`/circles/${circleId}`, { waitUntil: 'domcontentloaded' });
      await expect(page.getByRole('heading', { level: 1 })).toContainText('Today', { timeout: 30_000 });
      await openAddOption(page, 'Med');
      const dialog = page.getByRole('dialog', { name: 'New medication' });
      await expect(dialog).toBeVisible();
      await dialog.getByRole('radio', { name: /Morning/ }).click();
      await dialog.getByTestId('add-another-dose').click();
      await checkA11y(page, `new-medication ${size.name}`, testInfo, WCAG22);
    });

    test('new appointment form', async ({ page, circleId }, testInfo) => {
      await page.goto(`/circles/${circleId}`, { waitUntil: 'domcontentloaded' });
      await expect(page.getByRole('heading', { level: 1 })).toContainText('Today', { timeout: 30_000 });
      await openAddOption(page, 'Appt');
      await expect(page.getByRole('dialog', { name: 'New appointment' })).toBeVisible();
      await checkA11y(page, `new-appointment ${size.name}`, testInfo, WCAG22);
    });

    test('Care > Meds', async ({ page, circleId }, testInfo) => {
      await page.goto(`/circles/${circleId}/meds`, { waitUntil: 'domcontentloaded' });
      await expect(page.getByRole('heading', { level: 1 })).toContainText("meds", { timeout: 30_000 });
      await expect(page.getByTestId('med-time-row').first()).toBeVisible({ timeout: 20_000 });
      await checkA11y(page, `meds ${size.name}`, testInfo, WCAG22);
    });
  });
}
