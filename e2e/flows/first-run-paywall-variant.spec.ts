import type { Page } from '@playwright/test';
import { test, expect } from '../fixtures';
import { createAccount, runScopedEmail, ACCOUNT_PASSWORD } from '../isolation';
import { cookieLogin, stubJson, uniq } from '../unhappy/auth-invites/_helpers';
import { startFirstCircle } from '../firstRunV2';

// First-run paywall variants (owner-approved 2026-11-26). The first thing added in first-run setup
// picks the onboarding paywall's headline and the order of its reasons: a first medication leads
// with "Everyone who helps sees each dose marked." (top three: caregivers, exports, shifts);
// skipping the first item is today's paywall. Real backend, no paywall stubs. Mobile twin:
// mobile/src/__tests__/screens/FirstRunPaywallVariants.test.tsx.

async function freeAccount(prefix: string) {
  const email = runScopedEmail(uniq(prefix));
  const userId = await createAccount(email, 'free');
  return { email, password: ACCOUNT_PASSWORD, userId };
}

const topReasons = (page: Page) =>
  page.locator('[data-reasons] [data-benefit]').evaluateAll((els) => els.map((e) => e.getAttribute('data-benefit')));

test.describe('first-run paywall variants (web)', () => {
  test.setTimeout(120_000);

  test('a first medication leads the paywall with the medication headline and order', async ({
    page,
    context,
    baseURL,
  }) => {
    await stubJson(page, 'GET', '/api/drugs/search', { body: { success: true, data: { drugs: [] } } });
    const a = await freeAccount('fpvm');
    await cookieLogin(context, a, baseURL);
    await startFirstCircle(page, uniq('Fpvm'));

    const form = page.getByRole('dialog').last();
    await form.getByLabel(/Medication name/i).fill('Lisinopril');
    await form.getByRole('checkbox', { name: /Morning$/ }).click();
    await form.getByRole('button', { name: 'Add medication' }).click();
    await expect(page.getByTestId('first-run-all-set')).toBeVisible({ timeout: 20_000 });
    await page.getByTestId('first-run-go-to-today').click();

    await page.waitForURL(/\/upgrade$/, { timeout: 30_000 });
    await expect(page.getByRole('heading', { level: 1 })).toHaveText('Everyone who helps sees each dose marked.');
    expect(await topReasons(page)).toEqual(['caregivers', 'exports', 'shifts']);
    await page.getByRole('button', { name: 'See everything included' }).click();
    await expect(page.locator('[data-details] [data-benefit]')).toHaveCount(5);
  });

  test('skipping the first item shows today\'s paywall (default headline and order)', async ({
    page,
    context,
    baseURL,
  }) => {
    const a = await freeAccount('fpvd');
    await cookieLogin(context, a, baseURL);
    await startFirstCircle(page, uniq('Fpvd'));
    await page.getByTestId('first-run-skip').click();

    await page.waitForURL(/\/upgrade$/, { timeout: 30_000 });
    await expect(page.getByRole('heading', { level: 1 })).toHaveText('Share the care with everyone who helps.');
    expect(await topReasons(page)).toEqual(['caregivers', 'shifts', 'circles']);
  });
});
