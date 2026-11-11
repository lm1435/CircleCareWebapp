import type { Page } from '@playwright/test';
import { test, expect } from '../fixtures';
import { dbQuery, sqlStr } from '../unhappy';
import { createAccount, runScopedEmail, ACCOUNT_PASSWORD } from '../isolation';
import { cookieLogin, stubJson, uniq } from '../unhappy/auth-invites/_helpers';

// The setup invite step (pricing report 2026-11-02, owner-approved), end to end against the real
// backend: a FREE owner's first circle -> first med -> payoff -> Continue -> "Invite someone to
// help" (with "Your free plan includes one person.") -> the existing invite form -> a real invite
// row -> Done -> the onboarding paywall exactly once -> Today. The step itself is never a
// paywall. Invites go to @example.com, which the backend's isEmailBlocked swallows: nothing is
// mailed. Mobile twin: mobile/.maestro/parity/onboarding/onboarding-invite-step.yaml.

const SEEN_KEY = 'cc:onboardingPaywallSeen';

const wizard = (page: Page) => page.getByRole('dialog', { name: 'Circle created' });

function trackPaths(page: Page): string[] {
  const seen: string[] = [];
  page.on('framenavigated', (f) => {
    if (f === page.mainFrame()) seen.push(new URL(f.url()).pathname);
  });
  return seen;
}

async function createFirstCircle(page: Page, recipient: string): Promise<string> {
  await page.goto('/circles', { waitUntil: 'domcontentloaded' });
  await page.getByRole('button', { name: 'Create circle' }).first().click();
  const modal = page.getByRole('dialog');
  await modal.locator('#recipient_name').fill(recipient);
  const circleLoaded = page.waitForResponse(
    (r) =>
      r.request().method() === 'GET' &&
      /^\/api\/circles\/[0-9a-f-]{36}$/.test(new URL(r.url()).pathname) &&
      r.ok(),
    { timeout: 30_000 }
  );
  await modal.getByRole('button', { name: 'Create circle' }).click();
  await page.waitForURL(/\/circles\/[0-9a-f-]{36}$/, { timeout: 30_000 });
  await expect(wizard(page)).toBeVisible({ timeout: 20_000 });
  await circleLoaded;
  return /\/circles\/([0-9a-f-]{36})/.exec(page.url())![1];
}

async function saveFirstMed(page: Page): Promise<void> {
  await page.getByTestId('first-run-primary').click();
  const form = page.getByRole('dialog').last();
  await form.getByLabel(/Medication name/i).fill('Lisinopril');
  await form.getByRole('checkbox', { name: /Morning/ }).click();
  await form.getByRole('button', { name: 'Add medication' }).click();
  await expect(wizard(page).getByText('ALL SET')).toBeVisible({ timeout: 20_000 });
}

function invites(circleId: string): { invited_email: string; member_type: string }[] {
  return dbQuery<{ invited_email: string; member_type: string }>(
    `select invited_email, member_type from invites where circle_id = ${sqlStr(circleId)}::uuid`
  );
}

test.describe('setup invite step (web)', () => {
  test.setTimeout(120_000);

  test('free owner: invite one person from setup, then the paywall once, then Today', async ({
    page,
    context,
    baseURL,
  }) => {
    await stubJson(page, 'GET', '/api/drugs/search', { body: { success: true, data: { drugs: [] } } });
    const email = runScopedEmail(uniq('obinv'));
    const userId = await createAccount(email, 'free');
    await cookieLogin(context, { email, password: ACCOUNT_PASSWORD }, baseURL);
    const paths = trackPaths(page);
    const circleId = await createFirstCircle(page, uniq('ObInv'));
    await saveFirstMed(page);

    await wizard(page).getByRole('button', { name: 'Continue', exact: true }).click();
    const step = wizard(page).getByTestId('first-run-invite-step');
    await expect(step.getByRole('heading', { name: 'Invite someone to help' })).toBeVisible();
    await expect(step.getByTestId('first-run-invite-free-line')).toHaveText(
      'Your free plan includes one person.'
    );
    // Never a paywall: no price, no upgrade, no route change, the ask not spent.
    await expect(wizard(page).getByText(/Premium|Upgrade|\$/)).toHaveCount(0);
    expect(paths).not.toContain('/upgrade');
    expect(
      await page.evaluate((k) => window.localStorage.getItem(k), `${SEEN_KEY}:${userId}`)
    ).toBeNull();

    await wizard(page).getByTestId('first-run-invite-send').click();
    const form = page.getByRole('dialog', { name: 'Invite a member' });
    await expect(form).toBeVisible();
    const invitee = `e2e-obinv-${Date.now()}@example.com`;
    await form.locator('#invite-email').fill(invitee);
    await form.getByRole('button', { name: 'Send invitation' }).click();
    await expect(form.getByText('Invitation sent')).toBeVisible({ timeout: 20_000 });
    await expect.poll(() => invites(circleId)).toEqual([{ invited_email: invitee, member_type: 'caregiver' }]);

    // Closing the form ends the step: the onboarding paywall, exactly once.
    await form.getByRole('button', { name: 'Close', exact: true }).click();
    await page.waitForURL(/\/upgrade$/, { timeout: 30_000 });
    await page.getByRole('button', { name: /Continue with free plan/ }).click();
    await page.waitForURL(new RegExp(`/circles/${circleId}$`), { timeout: 30_000 });
    await expect(wizard(page)).toHaveCount(0);
    await page.reload({ waitUntil: 'domcontentloaded' });
    await expect(page.getByRole('heading', { level: 1 }).first()).toBeVisible({ timeout: 20_000 });
    await page.waitForTimeout(1500);
    expect(paths.filter((p) => p === '/upgrade')).toHaveLength(1);
  });
});
