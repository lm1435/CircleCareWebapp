import type { BrowserContext, Page } from '@playwright/test';
import { test, expect } from '../fixtures';
import { dbQuery, sqlStr } from '../unhappy';
import { createAccount, runScopedEmail, ACCOUNT_PASSWORD } from '../isolation';
import { cookieLogin, uniq } from '../unhappy/auth-invites/_helpers';

// The onboarding soft paywall (docs/plans/prompts-modals-coverage-2026-09-30.md): shown ONCE,
// right after a FREE user's FIRST circle (CreateCircleModal -> lib/onboardingPaywall.ts
// shouldShowOnboardingPaywall), the wizard deferred behind it. Mobile twin:
// mobile/.maestro/parity/prompts/onboarding-paywall-{free,seen,premium}.yaml.
// Real backend, no stubs: the tier is the account's stored plan_tier.

const SEEN_KEY = 'cc:onboardingPaywallSeen'; // lib/onboardingPaywall.ts, scoped per user (storageScope)

interface Acct {
  email: string;
  password: string;
  userId: string;
}

async function account(prefix: string, tier: 'free' | 'premium'): Promise<Acct> {
  const email = runScopedEmail(uniq(prefix));
  const userId = await createAccount(email, tier);
  return { email, password: ACCOUNT_PASSWORD, userId };
}

/** Pre-set a user's "seen" flag in this browser before the app boots (a shared/used browser). */
async function seedSeen(context: BrowserContext, userId: string): Promise<void> {
  await context.addInitScript(
    ([k]) => {
      try {
        window.localStorage.setItem(k, '1');
      } catch {
        /* storage blocked: the test then fails on its own assertion */
      }
    },
    [`${SEEN_KEY}:${userId}`]
  );
}

/** Every path this page visits, so "never went to /upgrade" is checked, not assumed. */
function trackPaths(page: Page): string[] {
  const seen: string[] = [];
  page.on('framenavigated', (f) => {
    if (f === page.mainFrame()) seen.push(new URL(f.url()).pathname);
  });
  return seen;
}

async function createFirstCircle(page: Page, recipient: string): Promise<void> {
  await page.goto('/circles', { waitUntil: 'domcontentloaded' });
  await page.getByRole('button', { name: 'Create circle' }).first().click();
  const modal = page.getByRole('dialog');
  await modal.locator('#recipient_name').fill(recipient);
  await modal.getByRole('button', { name: 'Create circle' }).click();
}

function ownedCircles(userId: string): string[] {
  return dbQuery<{ recipient_name: string }>(
    `select recipient_name from care_circles where owner_id = ${sqlStr(userId)} order by created_at`
  ).map((r) => r.recipient_name);
}

function planTier(userId: string): string | undefined {
  return dbQuery<{ plan_tier: string }>(`select plan_tier from users where id = ${sqlStr(userId)}`)[0]?.plan_tier;
}

const wizard = (page: Page) => page.getByRole('dialog', { name: 'Circle created' });
const offerHeading = (page: Page) => page.getByText('Better care, together.');

test.describe('onboarding paywall (web)', () => {
  test.setTimeout(90_000);

  test('free user, first circle: the offer appears once, the flag is written at the ask, Continue free opens the wizard', async ({
    page: _page,
    context,
    baseURL,
  }) => {
    const page = _page;
    const a = await account('obfree', 'free');
    await cookieLogin(context, a, baseURL);
    const recipient = uniq('ObFree');

    await createFirstCircle(page, recipient);
    await page.waitForURL(/\/upgrade$/, { timeout: 30_000 });
    await expect(offerHeading(page)).toBeVisible();
    expect(await page.evaluate((k) => window.localStorage.getItem(k), `${SEEN_KEY}:${a.userId}`)).toBe('1');

    await page.getByRole('button', { name: /Continue with free plan/ }).click();
    await page.waitForURL(/\/circles\/[0-9a-f-]{36}$/, { timeout: 30_000 });
    await expect(wizard(page)).toBeVisible({ timeout: 20_000 });

    expect(planTier(a.userId)).toBe('free');
    expect(ownedCircles(a.userId)).toEqual([recipient]);
  });

  test('free user who was already asked in this browser: the wizard comes up directly, never /upgrade', async ({
    page,
    context,
    baseURL,
  }) => {
    const a = await account('obseen', 'free');
    await seedSeen(context, a.userId);
    await cookieLogin(context, a, baseURL);
    const paths = trackPaths(page);

    await createFirstCircle(page, uniq('ObSeen'));
    await page.waitForURL(/\/circles\/[0-9a-f-]{36}$/, { timeout: 30_000 });
    await expect(wizard(page)).toBeVisible({ timeout: 20_000 });
    expect(paths).not.toContain('/upgrade');
    await expect(offerHeading(page)).toHaveCount(0);
  });

  test('premium user, first circle: no offer, the wizard directly', async ({ page, context, baseURL }) => {
    const a = await account('obprem', 'premium');
    await cookieLogin(context, a, baseURL);
    const paths = trackPaths(page);

    await createFirstCircle(page, uniq('ObPrem'));
    await page.waitForURL(/\/circles\/[0-9a-f-]{36}$/, { timeout: 30_000 });
    await expect(wizard(page)).toBeVisible({ timeout: 20_000 });
    expect(paths).not.toContain('/upgrade');
    expect(planTier(a.userId)).toBe('premium');
  });

  test('shared browser: another account already asked here does not use up THIS account\'s ask', async ({
    page,
    context,
    baseURL,
  }) => {
    const other = await account('obother', 'free');
    const me = await account('obme', 'free');
    await seedSeen(context, other.userId); // the flag is per user (storageScope WB7)
    await cookieLogin(context, me, baseURL);

    await createFirstCircle(page, uniq('ObMe'));
    await page.waitForURL(/\/upgrade$/, { timeout: 30_000 });
    await expect(offerHeading(page)).toBeVisible();
    expect(await page.evaluate((k) => window.localStorage.getItem(k), `${SEEN_KEY}:${me.userId}`)).toBe('1');
  });

  // PROVEN DEFECT 2026-09-30 (fixed in CirclePickerPage.tsx; unit twin
  // CirclePickerPage.createRace.test.tsx): on a slower client the circles refetch
  // triggered by the create beat the modal's own onSuccess, and the picker's
  // single-circle auto-skip took the user into the circle with NO paywall and NO
  // wizard (8/8 at CPU x12 before the fix, 0/8 unthrottled). The CPU throttle makes
  // the old ordering deterministic.
  for (const tier of ['free', 'premium'] as const) {
    test(`slow client (CPU x12), ${tier}: the first circle still reaches the ${tier === 'free' ? 'offer' : 'wizard'}`, async ({
      page,
      context,
      baseURL,
    }) => {
      test.setTimeout(150_000);
      const a = await account(`obslow${tier}`, tier);
      await cookieLogin(context, a, baseURL);
      const cdp = await context.newCDPSession(page);
      await page.goto('/circles', { waitUntil: 'domcontentloaded' });
      await page.getByRole('button', { name: 'Create circle' }).first().click();
      const modal = page.getByRole('dialog');
      await modal.locator('#recipient_name').fill(uniq('ObSlow'));
      await cdp.send('Emulation.setCPUThrottlingRate', { rate: 12 });
      await modal.getByRole('button', { name: 'Create circle' }).click();
      if (tier === 'free') {
        await page.waitForURL(/\/upgrade$/, { timeout: 60_000 });
        await expect(offerHeading(page)).toBeVisible({ timeout: 30_000 });
      } else {
        await page.waitForURL(/\/circles\/[0-9a-f-]{36}$/, { timeout: 60_000 });
        await expect(wizard(page)).toBeVisible({ timeout: 40_000 });
      }
      await cdp.send('Emulation.setCPUThrottlingRate', { rate: 1 });
    });
  }
});
