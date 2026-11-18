import type { Page } from '@playwright/test';
import { test, expect } from '../fixtures';
import { dbQuery, sqlStr } from '../unhappy';
import { createAccount, runScopedEmail, ACCOUNT_PASSWORD } from '../isolation';
import { cookieLogin, uniq } from '../unhappy/auth-invites/_helpers';
import { startFirstCircle } from '../firstRunV2';

// Onboarding 1.3.1 section 7, the NO-FIRST-MED path: a free owner who creates their first
// circle and does NOT save a first med (Skip, the x, another first-run action, or closing the
// first-run form unsaved) is shown the paywall ONCE, the next time Today is on screen
// (paywall_shown trigger 'onboarding'). Every exit lands on Today and it never comes back.
// Real backend, no stubs. Mobile twin: mobile/.maestro/parity/onboarding/.

const SEEN_KEY = 'cc:onboardingPaywallSeen';
const PENDING_KEY = 'cc:onboardingPaywallPending';

interface Acct {
  email: string;
  password: string;
  userId: string;
}
async function freeAccount(prefix: string): Promise<Acct> {
  const email = runScopedEmail(uniq(prefix));
  const userId = await createAccount(email, 'free');
  return { email, password: ACCOUNT_PASSWORD, userId };
}

function trackPaths(page: Page): string[] {
  const seen: string[] = [];
  page.on('framenavigated', (f) => {
    if (f === page.mainFrame()) seen.push(new URL(f.url()).pathname);
  });
  return seen;
}

/** First run v2: Start -> the one question -> the circle forms -> the first-item form is open. */
async function createFirstCircle(page: Page, recipient: string): Promise<string> {
  return startFirstCircle(page, recipient);
}

const offerHeading = (page: Page) => page.getByText('Share the care with everyone who helps.');
const ls = (page: Page, key: string) => page.evaluate((k) => window.localStorage.getItem(k), key);

test.describe('onboarding paywall: no first med (web)', () => {
  test.setTimeout(90_000);

  test('the x on the first-item form: paywall once at Today, Continue free lands on Today, a reload never asks again', async ({
    page,
    context,
    baseURL,
  }) => {
    const a = await freeAccount('obsx');
    await cookieLogin(context, a, baseURL);
    const paths = trackPaths(page);
    await createFirstCircle(page, uniq('ObX'));
    // Owed from creation, not yet asked.
    expect(await ls(page, `${PENDING_KEY}:${a.userId}`)).not.toBeNull();
    expect(await ls(page, `${SEEN_KEY}:${a.userId}`)).toBeNull();

    await page.getByRole('dialog').last().getByRole('button', { name: 'Close event form' }).click();
    await page.waitForURL(/\/upgrade$/, { timeout: 30_000 });
    await expect(offerHeading(page)).toBeVisible();
    expect(await ls(page, `${SEEN_KEY}:${a.userId}`)).toBe('1');
    expect(await ls(page, `${PENDING_KEY}:${a.userId}`)).toBeNull();

    await page.getByRole('button', { name: /Continue with free plan/ }).click();
    await page.waitForURL(/\/circles\/[0-9a-f-]{36}$/, { timeout: 30_000 });
    await expect(page.getByRole('heading', { level: 1 }).first()).toBeVisible({ timeout: 20_000 });

    await page.reload({ waitUntil: 'domcontentloaded' });
    await expect(page.getByRole('heading', { level: 1 }).first()).toBeVisible({ timeout: 20_000 });
    await page.waitForTimeout(1500);
    expect(paths.filter((p) => p === '/upgrade')).toHaveLength(1);
    await expect(offerHeading(page)).toHaveCount(0);
  });

  test('closing the first-run FORM unsaved counts as a skip: Today, then the paywall once, nothing saved', async ({
    page,
    context,
    baseURL,
  }) => {
    const a = await freeAccount('obsform');
    await cookieLogin(context, a, baseURL);
    const circleId = await createFirstCircle(page, uniq('ObForm'));

    await expect(page.getByTestId('first-run-form-heading')).toBeVisible();
    await page.getByTestId('first-run-skip').click();

    await page.waitForURL(/\/upgrade$/, { timeout: 30_000 });
    await expect(offerHeading(page)).toBeVisible();
    expect(
      dbQuery(`select 1 from calendar_events where circle_id = ${sqlStr(circleId)}::uuid`)
    ).toHaveLength(0);
  });
  // First run v2: the v1 chooser's other actions (an appointment, someone to help, Emergency info) are
  // gone; the type switch on the first-item form replaces them (first-run-v2.spec.ts).
});
