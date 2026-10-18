import { test, expect } from '../fixtures';
import { checkA11y } from '../helpers';

// Dark-mode fake door (Profile > Appearance): tap records interest, the vote
// persists across reload (localStorage). Cleans the key so the demo browser is
// left as found.
test('dark mode interest row: vote persists across reload', async ({ page }, testInfo) => {
  await page.goto('/profile', { waitUntil: 'domcontentloaded' });
  await page.evaluate(() => localStorage.removeItem('cc.darkModeInterest.v1'));
  await page.reload({ waitUntil: 'domcontentloaded' });

  const row = page.getByTestId('dark-mode-interest-row');
  await expect(row).toBeVisible({ timeout: 15_000 });
  await expect(row).toContainText('Coming soon');
  await expect(row).toHaveAttribute('aria-pressed', 'false');

  await row.click();
  await expect(row).toContainText('Requested');
  await expect(row).toHaveAttribute('aria-pressed', 'true');
  await expect(page.getByText("Thanks. We've noted your vote.")).toBeVisible();

  await page.reload({ waitUntil: 'domcontentloaded' });
  await expect(page.getByTestId('dark-mode-interest-row')).toContainText('Requested', {
    timeout: 15_000,
  });
  await checkA11y(page, '/profile', testInfo);

  await page.evaluate(() => localStorage.removeItem('cc.darkModeInterest.v1'));
});
