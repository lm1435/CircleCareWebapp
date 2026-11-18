import type { Page } from '@playwright/test';
import { test, expect } from '../../fixtures';

// 1.4.3 web/mobile parity (owner: "web matches mobile"): the paywall's plan choice is mobile's
// annual / monthly TOGGLE with ONE price card (PlanSelectionScreen `plan-toggle` /
// `plan-price-card`), not two radio cards. Prices are the store's (RevenueCat Web Billing):
// this spec never asserts a literal price, only that the card follows the toggle. Nothing is bought.
// Restore purchases stays mobile-only (a store capability; signing in is the web's restore).

test.use({ persona: 'freeOwner', locale: 'en-US', timezoneId: 'America/Denver' });

async function openUpgrade(page: Page): Promise<void> {
  await page.goto('/profile');
  await expect(page.locator('#main')).toBeVisible({ timeout: 20_000 });
  await page.evaluate(() => {
    const idx = ((window.history.state as { idx?: number } | null)?.idx ?? 0) + 1;
    window.history.pushState({ usr: { paywallContext: 'general' }, key: 'e2e-toggle', idx }, '', '/upgrade');
    window.dispatchEvent(new PopStateEvent('popstate', { state: window.history.state }));
  });
  await expect(page.getByTestId('plan-toggle'), 'RevenueCat web offering loaded').toBeVisible({
    timeout: 20_000,
  });
}

test('POSITIVE: Annual is pressed by default; Monthly swaps the one price card and the CTA', async ({ page }) => {
  await openUpgrade(page);
  const annual = page.getByTestId('plan-toggle-tab-annual');
  const monthly = page.getByTestId('plan-toggle-tab-monthly');
  await expect(annual).toHaveAttribute('aria-pressed', 'true');
  await expect(monthly).toHaveAttribute('aria-pressed', 'false');
  const card = page.getByTestId('plan-price-card');
  await expect(card).toHaveCount(1);
  await expect(card).toContainText('/year');
  const footer = page.getByTestId('upgrade-footer');

  await monthly.click();
  await expect(monthly).toHaveAttribute('aria-pressed', 'true');
  await expect(card).toContainText('/month');
  await expect(footer.getByRole('button', { name: /^Subscribe: .+\/mo$/ })).toBeVisible();
  await expect(page.getByTestId('upgrade-terms')).toContainText('month');
});

test('NEGATIVE: no radio cards, never two price cards, no Restore purchases on the web', async ({ page }) => {
  await openUpgrade(page);
  await expect(page.getByRole('radio')).toHaveCount(0);
  await expect(page.getByRole('radiogroup')).toHaveCount(0);
  await page.getByTestId('plan-toggle-tab-monthly').click();
  await expect(page.getByTestId('plan-price-card')).toHaveCount(1);
  await expect(page.getByRole('button', { name: /restore/i })).toHaveCount(0);
  await expect(page.getByRole('link', { name: /restore/i })).toHaveCount(0);
});
