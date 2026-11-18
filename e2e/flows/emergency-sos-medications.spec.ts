import { test, expect } from '../fixtures';

// 1.4.3 web/mobile parity on Emergency info: the SOS card (local number, large and selectable,
// plus a tel: link), the Current medications section, and every section always open (no
// web-only accordions). Non-destructive. Unit twins: EmergencyInfoPage.test.tsx, SosCard.test.tsx.

const NAV_TIMEOUT = 20_000;

test.describe('US browser', () => {
  test.use({ locale: 'en-US' });

  test('POSITIVE: SOS shows "Dial 911" as text with a tel:911 link; medications section present; no accordions', async ({
    page,
    circleId,
  }) => {
    await page.goto(`/circles/${circleId}/emergency`, { waitUntil: 'domcontentloaded' });
    const card = page.getByTestId('sos-card');
    await expect(card).toBeVisible({ timeout: NAV_TIMEOUT });
    const number = card.getByTestId('sos-number');
    await expect(number).toHaveText('Dial 911');
    // Selectable: the text node is not inside the link and user-select is not "none".
    expect(await number.evaluate((el) => getComputedStyle(el).userSelect)).not.toBe('none');
    await expect(card.getByRole('link', { name: 'Dial 911' })).toHaveAttribute('href', 'tel:911');

    await expect(page.getByRole('heading', { level: 2, name: 'Current medications' })).toBeVisible();
    for (const name of ['Doctors', 'Emergency Contacts', 'Insurance']) {
      await expect(page.getByRole('heading', { level: 2, name })).toBeVisible();
    }
    await expect(page.getByRole('button', { name: /Collapse all|Expand all/ })).toHaveCount(0);
    // Address and download links are never terracotta text.
    const terracottaLinks = await page
      .locator('a')
      .evaluateAll((as) => as.filter((a) => /terracotta/.test(a.className)).length);
    expect(terracottaLinks).toBe(0);
  });
});

test.describe('UK browser', () => {
  test.use({ locale: 'en-GB' });
  test('POSITIVE: the per-country number follows mobile (999)', async ({ page, circleId }) => {
    await page.goto(`/circles/${circleId}/emergency`, { waitUntil: 'domcontentloaded' });
    await expect(page.getByTestId('sos-number')).toHaveText('Dial 999', { timeout: NAV_TIMEOUT });
  });
});

test.describe('browser with no region', () => {
  test.use({ locale: 'en' });
  test('NEGATIVE: no SOS card, never a guessed number; the page still renders', async ({ page, circleId }) => {
    await page.goto(`/circles/${circleId}/emergency`, { waitUntil: 'domcontentloaded' });
    await expect(page.getByRole('heading', { level: 2, name: 'Current medications' })).toBeVisible({
      timeout: NAV_TIMEOUT,
    });
    await expect(page.getByTestId('sos-card')).toHaveCount(0);
  });
});
