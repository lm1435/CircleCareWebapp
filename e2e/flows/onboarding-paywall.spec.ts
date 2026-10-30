import type { BrowserContext, Page } from '@playwright/test';
import { test, expect } from '../fixtures';
import { dbQuery, sqlStr } from '../unhappy';
import { createAccount, runScopedEmail, ACCOUNT_PASSWORD } from '../isolation';
import { cookieLogin, uniq } from '../unhappy/auth-invites/_helpers';

// The onboarding soft paywall (docs/plans/prompts-modals-coverage-2026-09-30.md), MOVED by
// onboarding 1.3.1 (docs/plans/onboarding-1-3-1.md section 7): circle creation no longer sends
// a FREE user's FIRST circle to /upgrade (CreateCircleModal only records it as owed,
// lib/onboardingPaywall.ts); the wizard runs first and the paywall shows ONCE afterwards (after
// the first med's payoff: onboarding-first-med.spec.ts; or, no first med, the next Today:
// onboarding-skip-paywall.spec.ts). This file pins the gate: free / seen / premium / shared browser. Mobile twin:
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
const skipSetup = (page: Page) => wizard(page).getByRole('button', { name: 'Skip for now' }).click();

test.describe('onboarding paywall (web)', () => {
  test.setTimeout(90_000);

  test('free user, first circle: creation goes to the WIZARD (not /upgrade); Skip then shows the offer once, flag written at the ask, Continue free lands on Today', async ({
    page: _page,
    context,
    baseURL,
  }) => {
    const page = _page;
    const a = await account('obfree', 'free');
    await cookieLogin(context, a, baseURL);
    const recipient = uniq('ObFree');
    const paths = trackPaths(page);

    await createFirstCircle(page, recipient);
    await page.waitForURL(/\/circles\/[0-9a-f-]{36}$/, { timeout: 30_000 });
    await expect(wizard(page)).toBeVisible({ timeout: 20_000 });
    expect(paths).not.toContain('/upgrade');
    // Owed, not yet asked.
    expect(await page.evaluate((k) => window.localStorage.getItem(k), `${SEEN_KEY}:${a.userId}`)).toBeNull();

    await skipSetup(page);
    await page.waitForURL(/\/upgrade$/, { timeout: 30_000 });
    await expect(offerHeading(page)).toBeVisible();
    expect(await page.evaluate((k) => window.localStorage.getItem(k), `${SEEN_KEY}:${a.userId}`)).toBe('1');

    await page.getByRole('button', { name: /Continue with free plan/ }).click();
    await page.waitForURL(/\/circles\/[0-9a-f-]{36}$/, { timeout: 30_000 });
    // Every exit lands on Today, with no wizard to replay.
    await expect(page.getByRole('heading', { level: 1 }).first()).toBeVisible({ timeout: 20_000 });
    await expect(wizard(page)).toHaveCount(0);

    expect(planTier(a.userId)).toBe('free');
    expect(ownedCircles(a.userId)).toEqual([recipient]);
  });

  test('free user who was already asked in this browser: wizard, Skip, Today - never /upgrade', async ({
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
    await skipSetup(page);
    await expect(wizard(page)).toHaveCount(0);
    await page.waitForTimeout(1500);
    expect(paths).not.toContain('/upgrade');
    await expect(offerHeading(page)).toHaveCount(0);
  });

  test('premium user, first circle: wizard, Skip, Today - no offer', async ({ page, context, baseURL }) => {
    const a = await account('obprem', 'premium');
    await cookieLogin(context, a, baseURL);
    const paths = trackPaths(page);

    await createFirstCircle(page, uniq('ObPrem'));
    await page.waitForURL(/\/circles\/[0-9a-f-]{36}$/, { timeout: 30_000 });
    await expect(wizard(page)).toBeVisible({ timeout: 20_000 });
    await skipSetup(page);
    await expect(wizard(page)).toHaveCount(0);
    await page.waitForTimeout(1500);
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
    await expect(wizard(page)).toBeVisible({ timeout: 20_000 });
    await skipSetup(page);
    await page.waitForURL(/\/upgrade$/, { timeout: 30_000 });
    await expect(offerHeading(page)).toBeVisible();
    expect(await page.evaluate((k) => window.localStorage.getItem(k), `${SEEN_KEY}:${me.userId}`)).toBe('1');
  });

  // PROVEN DEFECT 2026-09-30 (fixed in CirclePickerPage.tsx; unit twin
  // CirclePickerPage.createRace.test.tsx): on a slower client the circles refetch
  // triggered by the create beat the modal's own onSuccess, and the picker's
  // single-circle auto-skip took the user into the circle with NO first-run state. The CPU
  // throttle makes the old ordering deterministic. Since 1.3.1 the wizard is the thing that
  // must still appear (and, for free, the OWED paywall must still be recorded and shown after).
  for (const tier of ['free', 'premium'] as const) {
    test(`slow client (CPU x12), ${tier}: the first circle still reaches the wizard${tier === 'free' ? ' and the owed offer' : ''}`, async ({
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
      await page.waitForURL(/\/circles\/[0-9a-f-]{36}$/, { timeout: 60_000 });
      await expect(wizard(page)).toBeVisible({ timeout: 40_000 });
      await cdp.send('Emulation.setCPUThrottlingRate', { rate: 1 });
      if (tier === 'free') {
        await skipSetup(page);
        await page.waitForURL(/\/upgrade$/, { timeout: 30_000 });
        await expect(offerHeading(page)).toBeVisible();
      }
    });
  }
});
