import { test, expect } from '../fixtures';

// Profile > Appearance > Theme (System / Light / Dark). AUTHENTICATED half of the
// dark-mode e2e (needs the backend + an isolated account like every flows/ spec);
// the backend-free runtime half (pre-paint, live System, print) is
// e2e/theme-public.spec.ts. The preference is per device (localStorage), so each
// test's fresh browser context starts on System.

const theme = (page: import('@playwright/test').Page): Promise<string | null> =>
  page.evaluate(() => document.documentElement.getAttribute('data-theme'));

async function openAppearance(page: import('@playwright/test').Page) {
  await page.goto('/profile', { waitUntil: 'domcontentloaded' });
  const tablist = page.getByRole('tablist', { name: 'Theme' });
  await expect(tablist).toBeVisible({ timeout: 15_000 });
  return tablist;
}

test('Appearance offers System / Light / Dark, System selected by default', async ({ page }) => {
  await page.emulateMedia({ colorScheme: 'light' });
  const tablist = await openAppearance(page);
  await expect(page.getByRole('heading', { name: 'Appearance' })).toBeVisible();
  await expect(tablist.getByRole('tab')).toHaveText(['System', 'Light', 'Dark']);
  await expect(tablist.getByRole('tab', { name: 'System' })).toHaveAttribute('aria-selected', 'true');
  await expect(page.getByText(/System follows your device/)).toBeVisible();
  expect(await theme(page)).toBe('light');
});

test('picking Dark paints dark and survives a reload', async ({ page }) => {
  await page.emulateMedia({ colorScheme: 'light' });
  const tablist = await openAppearance(page);

  await tablist.getByRole('tab', { name: 'Dark' }).click();
  await expect(tablist.getByRole('tab', { name: 'Dark' })).toHaveAttribute('aria-selected', 'true');
  expect(await theme(page)).toBe('dark');
  expect(await page.evaluate(() => localStorage.getItem('cc.themePreference.v1'))).toBe('dark');
  expect(await page.evaluate(() => getComputedStyle(document.body).backgroundColor)).toBe(
    'rgb(26, 24, 21)'
  );

  await page.reload({ waitUntil: 'domcontentloaded' });
  const again = page.getByRole('tablist', { name: 'Theme' });
  await expect(again.getByRole('tab', { name: 'Dark' })).toHaveAttribute('aria-selected', 'true', {
    timeout: 15_000,
  });
  expect(await theme(page)).toBe('dark');
});

test('System follows the device live; Light holds against a dark device', async ({ page }) => {
  await page.emulateMedia({ colorScheme: 'light' });
  const tablist = await openAppearance(page);

  // System (default): the device flips, the app flips with it, no reload.
  await page.emulateMedia({ colorScheme: 'dark' });
  await expect.poll(() => theme(page)).toBe('dark');
  await page.emulateMedia({ colorScheme: 'light' });
  await expect.poll(() => theme(page)).toBe('light');

  // An explicit Light ignores a dark device.
  await tablist.getByRole('tab', { name: 'Light' }).click();
  await page.emulateMedia({ colorScheme: 'dark' });
  expect(await theme(page)).toBe('light');

  // Back to System: it snaps to the device straight away.
  await tablist.getByRole('tab', { name: 'System' }).click();
  await expect.poll(() => theme(page)).toBe('dark');
});

test('the selector works in dark: primary fill is warm white with a charcoal label', async ({ page }) => {
  await page.emulateMedia({ colorScheme: 'dark' });
  const tablist = await openAppearance(page);
  const selected = tablist.getByRole('tab', { name: 'System' });
  expect(await selected.evaluate((el) => getComputedStyle(el).color)).toBe('rgb(35, 32, 25)');
  expect(
    await tablist.getByTestId('segmented-thumb').evaluate((el) => getComputedStyle(el).backgroundColor)
  ).toBe('rgb(239, 233, 222)');
});
