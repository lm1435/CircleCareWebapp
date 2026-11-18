import type { Page } from '@playwright/test';
import { test, expect } from '../../fixtures';
import { checkA11y } from '../../helpers';
import { sqlStr } from '../../unhappy';
import { sqlExec } from '../../db';

// ===========================================================================
// THE COMPACT PAYWALL (1.4.2) — docs/plans/paywall-redesign-1-4-2.md §10.
//
//   P6  on a 390 x 844 phone the buy button AND "Continue with free plan" are on
//       the first view without scrolling (pinned footer), and the selected
//       plan's price is not under that footer;
//   P2  "See everything included" expands IN PLACE: aria-expanded flips, five
//       more rows, "Show less";
//   N8  on a short viewport (large zoom / landscape) the footer is NOT pinned,
//       so it can never cover the price; from `sm` up it is not pinned either.
//
// The onboarding context (the only one with the free button) is reached the way
// the app reaches it: router state `{ paywallContext: 'onboarding' }` on the
// /upgrade entry. A free owner with no premium is the persona; nothing is bought.
// Unit twin: src/pages/__tests__/UpgradePage.compact.test.tsx. Mobile twin:
// mobile/.maestro/parity/paywall/ (compact paywall flow).
// ===========================================================================

test.use({ persona: 'freeOwner' });

/** Open /upgrade with router state, as `consumeOnboardingPaywall` / `usePremiumGate` do. */
async function openUpgrade(page: Page, paywallContext: string): Promise<void> {
  await page.goto('/profile');
  await expect(page.locator('#main')).toBeVisible({ timeout: 20_000 });
  await page.evaluate((ctx) => {
    const idx = ((window.history.state as { idx?: number } | null)?.idx ?? 0) + 1;
    window.history.pushState({ usr: { paywallContext: ctx }, key: 'e2e-upgrade', idx }, '', '/upgrade');
    window.dispatchEvent(new PopStateEvent('popstate', { state: window.history.state }));
  }, paywallContext);
  await expect(page).toHaveURL(/\/upgrade$/);
  // The plans must have loaded: this spec is about the plan view, not the
  // "checkout unavailable" card. Fail loudly if the sandbox offering is missing.
  await expect(page.getByTestId('plan-toggle'), 'RevenueCat web offering loaded').toBeVisible({ timeout: 20_000 });
}

const LANGS = [
  { name: 'EN', code: 'en', locale: 'en-US', buy: /^(Start .*free trial|Subscribe: )/, free: /^Continue with free plan/, seeAll: 'See everything included', less: 'Show less' },
  { name: 'ES', code: 'es', locale: 'es-MX', buy: /^(Comenzar prueba gratis|Suscribirse: )/, free: /^Continuar con plan gratuito/, seeAll: 'Ver todo lo que incluye', less: 'Ver menos' },
] as const;

for (const L of LANGS) {
  test.describe(`compact paywall (${L.name})`, () => {
    test.use({ locale: L.locale, timezoneId: 'America/Denver', viewport: { width: 390, height: 844 } });

    test('P6_buy_and_free_buttons_visible_without_scrolling + P2 details expand in place', async ({
      page,
      personaHandle: h,
    }, testInfo) => {
      sqlExec(`update users set language = ${sqlStr(L.code)} where id = ${sqlStr(h.userId)}::uuid`);
      try {
        await openUpgrade(page, 'onboarding');
        expect(await page.evaluate(() => window.scrollY)).toBe(0);

        const footer = page.getByTestId('upgrade-footer');
        const buy = footer.getByRole('button', { name: L.buy });
        const free = footer.getByRole('button', { name: L.free });
        await expect(buy).toBeInViewport({ ratio: 1 });
        await expect(free).toBeInViewport({ ratio: 1 });
        await expect(footer.getByTestId('upgrade-terms')).toBeInViewport({ ratio: 1 });
        expect(await footer.evaluate((el) => getComputedStyle(el).position)).toBe('sticky');

        // The selected plan's billed price is above the pinned footer, not under it.
        const price = page.getByTestId('plan-price-card').locator('[data-price]');
        const priceBox = await price.boundingBox();
        const footerBox = await footer.boundingBox();
        expect(priceBox && footerBox && priceBox.y + priceBox.height <= footerBox.y).toBe(true);

        // P2: expands in place.
        const toggle = page.getByRole('button', { name: L.seeAll });
        await expect(toggle).toHaveAttribute('aria-expanded', 'false');
        await expect(page.locator('[data-details] li')).toHaveCount(0);
        await toggle.click();
        await expect(page.getByRole('button', { name: L.less })).toHaveAttribute('aria-expanded', 'true');
        await expect(page.locator('#upgrade-details [data-details] li')).toHaveCount(5);

        // 1.4.3 mobile parity: the annual / monthly toggle swaps the ONE price card, with the
        // store's prices (never two cards, never a literal).
        const annualPrice = await price.textContent();
        await page.getByTestId('plan-toggle-tab-monthly').click();
        await expect(page.getByTestId('plan-toggle-tab-monthly')).toHaveAttribute('aria-pressed', 'true');
        await expect(page.getByTestId('plan-price-card')).toHaveCount(1);
        await expect(price).not.toHaveText(annualPrice ?? '');
        await page.getByTestId('plan-toggle-tab-annual').click();
        await expect(price).toHaveText(annualPrice ?? '');

        await checkA11y(page, `/upgrade compact (${L.name} 390px)`, testInfo);
        await page.screenshot({ path: testInfo.outputPath(`upgrade-compact-${L.code}-expanded.png`) });
      } finally {
        sqlExec(`update users set language = 'en' where id = ${sqlStr(h.userId)}::uuid`);
      }
    });
  });
}

test.describe('N8 footer at large zoom', () => {
  test.use({ locale: 'en-US', timezoneId: 'America/Denver' });

  test('N8_footer_does_not_cover_price_at_largest_text_size', async ({ page }) => {
    // 390 x 844 at 200% browser zoom is a 195 x 422 CSS viewport; a landscape
    // phone is ~844 x 390. Both are "short": the footer must flow, not pin.
    await page.setViewportSize({ width: 390, height: 844 });
    await openUpgrade(page, 'onboarding');
    const footer = page.getByTestId('upgrade-footer');
    expect(await footer.evaluate((el) => getComputedStyle(el).position)).toBe('sticky');

    for (const vp of [
      { width: 360, height: 420 },
      { width: 844, height: 390 },
      { width: 1280, height: 800 },
    ]) {
      await page.setViewportSize(vp);
      expect(
        await footer.evaluate((el) => getComputedStyle(el).position),
        `footer position @${vp.width}x${vp.height}`
      ).toBe('static');
    }

    // At the short viewport, the top of the page (the price) is not covered by anything.
    await page.setViewportSize({ width: 360, height: 420 });
    await page.evaluate(() => window.scrollTo(0, 0));
    const price = page.getByTestId('plan-price-card').locator('[data-price]');
    await price.scrollIntoViewIfNeeded();
    const box = await price.boundingBox();
    expect(box).not.toBeNull();
    const covering = await page.evaluate(
      ({ x, y }) => document.elementFromPoint(x, y)?.closest('[data-testid="upgrade-footer"]') !== null,
      { x: (box?.x ?? 0) + 2, y: (box?.y ?? 0) + (box?.height ?? 0) / 2 }
    );
    expect(covering, 'the footer is not painted over the price').toBe(false);
  });
});
