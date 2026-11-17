import type { Page } from '@playwright/test';
import { test, expect } from '../fixtures';
import { dbQuery, sqlStr } from '../unhappy';
import { createAccount, runScopedEmail, ACCOUNT_PASSWORD } from '../isolation';
import { cookieLogin, stubJson, uniq } from '../unhappy/auth-invites/_helpers';

// 1.4.2 REWRITE (file name kept): the setup invite step is gone from first run; the invite question
// is Today's next-step card. Against the real backend: a FREE owner's first circle -> first med ->
// payoff -> Continue. NEGATIVE: no invite step appears (no "Invite someone to help" heading, no
// first-run-invite-* test ids, no free-plan line). Then the onboarding paywall exactly once ->
// Continue with free plan -> Today, where the next-step card (data-step="invite") asks "Invite
// someone to help" -> Invite -> Members -> Invite member -> a real invite row. Invites go to
// @example.com, which the backend's isEmailBlocked swallows: nothing is mailed. Mobile twin:
// mobile/.maestro/parity/onboarding/owner-invite-step-send.yaml.

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
  await page.getByRole('button', { name: /^(Start a care circle|Create circle)$/ }).first().click();
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

test.describe('first run has no invite step; Today next-step card sends the invite (web)', () => {
  test.setTimeout(150_000);

  test('negative: first run never shows an invite step; positive: the Today invite card sends one invite', async ({
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

    // NEGATIVE: Continue ends first run. No invite step, in any of its old forms.
    await wizard(page).getByRole('button', { name: 'Continue', exact: true }).click();
    await expect(wizard(page).getByRole('heading', { name: 'Invite someone to help' })).toHaveCount(0);
    await expect(page.getByTestId('first-run-invite-step')).toHaveCount(0);
    await expect(page.getByTestId('first-run-invite-free-line')).toHaveCount(0);
    await expect(page.getByTestId('first-run-invite-send')).toHaveCount(0);
    await expect(page.getByText('Your free plan includes one person.')).toHaveCount(0);

    // The onboarding paywall, once; "Continue with free plan" -> Today.
    await page.waitForURL(/\/upgrade$/, { timeout: 30_000 });
    expect(
      await page.evaluate((k) => window.localStorage.getItem(k), `${SEEN_KEY}:${userId}`)
    ).not.toBeNull();
    await page.getByRole('button', { name: /Continue with free plan/ }).click();
    await page.waitForURL(new RegExp(`/circles/${circleId}$`), { timeout: 30_000 });
    await expect(wizard(page)).toHaveCount(0);

    // POSITIVE: Today's next-step card asks the invite question (the first med is done).
    const card = page.getByTestId('next-step-card');
    await expect(card).toHaveAttribute('data-step', 'invite', { timeout: 30_000 });
    await expect(card.getByRole('heading', { name: 'Invite someone to help' })).toBeVisible();
    expect(invites(circleId)).toEqual([]);
    await card.getByRole('button', { name: 'Invite', exact: true }).click();

    await page.waitForURL(new RegExp(`/circles/${circleId}/members$`), { timeout: 20_000 });
    await page.getByRole('button', { name: 'Invite member' }).first().click();
    const form = page.getByRole('dialog', { name: 'Invite a member' });
    await expect(form).toBeVisible();
    const invitee = `e2e-obinv-${Date.now()}@example.com`;
    await form.locator('#invite-email').fill(invitee);
    await form.getByRole('button', { name: 'Send invitation' }).click();
    await expect(form.getByText('Invitation sent')).toBeVisible({ timeout: 20_000 });
    await expect
      .poll(() => invites(circleId))
      .toEqual([{ invited_email: invitee, member_type: 'caregiver' }]);

    // NEGATIVE: with the invite out, Today no longer asks it, and the paywall did not come back.
    await form.getByRole('button', { name: 'Close', exact: true }).click();
    await page.goto(`/circles/${circleId}`, { waitUntil: 'domcontentloaded' });
    await expect(page.getByTestId('quick-access-grid')).toBeVisible({ timeout: 20_000 });
    await expect(page.locator('[data-testid="next-step-card"][data-step="invite"]')).toHaveCount(0);
    expect(paths.filter((p) => p === '/upgrade')).toHaveLength(1);
  });
});
