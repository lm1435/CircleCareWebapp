import type { Page } from '@playwright/test';
import { test, expect } from '../fixtures';
import { dbQuery, sqlStr } from '../unhappy';
import { createAccount, runScopedEmail, ACCOUNT_PASSWORD } from '../isolation';
import { cookieLogin, stubJson, uniq } from '../unhappy/auth-invites/_helpers';
import { startFirstCircle } from '../firstRunV2';

// 1.4.2 REWRITE (file name kept): the setup invite step is gone from first run; the invite question
// is Today's next-step card. Against the real backend: a FREE owner's first circle -> first med ->
// payoff -> Continue. NEGATIVE: no invite step appears (no "Invite someone to help" heading, no
// first-run-invite-* test ids, no free-plan line). Then the onboarding paywall exactly once ->
// Continue with free plan -> Today, where the next-step card (data-step="invite") asks "Invite
// someone to help" -> Invite -> Members -> Invite member -> a real invite row. Invites go to
// @example.com, which the backend's isEmailBlocked swallows: nothing is mailed. Mobile twin:
// mobile/.maestro/parity/onboarding/owner-invite-step-send.yaml.

const SEEN_KEY = 'cc:onboardingPaywallSeen';

/** First run v2: the All set dialog (its hidden title is the eyebrow). */
const wizard = (page: Page) => page.getByRole('dialog', { name: 'ALL SET' });

function trackPaths(page: Page): string[] {
  const seen: string[] = [];
  page.on('framenavigated', (f) => {
    if (f === page.mainFrame()) seen.push(new URL(f.url()).pathname);
  });
  return seen;
}

async function createFirstCircle(page: Page, recipient: string): Promise<string> {
  const circleLoaded = page.waitForResponse(
    (r) =>
      r.request().method() === 'GET' &&
      /^\/api\/circles\/[0-9a-f-]{36}$/.test(new URL(r.url()).pathname) &&
      r.ok(),
    { timeout: 30_000 }
  );
  const circleId = await startFirstCircle(page, recipient);
  await circleLoaded;
  return circleId;
}

/** The first-item form opens on Medication with NO time lit (owner 2026-11-21); the person picks Morning. */
async function saveFirstMed(page: Page): Promise<void> {
  const form = page.getByRole('dialog').last();
  await form.getByLabel(/Medication name/i).fill('Lisinopril');
  await form.getByRole('checkbox', { name: /Morning$/ }).click();
  await form.getByRole('button', { name: 'Add medication' }).click();
  await expect(wizard(page).getByTestId('first-run-all-set')).toBeVisible({ timeout: 20_000 });
}

function invites(circleId: string): { invited_email: string; member_type: string }[] {
  return dbQuery<{ invited_email: string; member_type: string }>(
    `select invited_email, member_type from invites where circle_id = ${sqlStr(circleId)}::uuid`
  );
}

test.describe('first run v2: the invite on All set is OPTIONAL; Today next-step card still sends the invite (web)', () => {
  test.setTimeout(150_000);

  test('negative: Go to Today without sharing creates no invite; positive: the Today invite card sends one invite', async ({
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

    // All set offers the invite under "Optional"; nothing is created until it is pressed.
    await expect(wizard(page).getByText('Optional', { exact: true })).toBeVisible();
    await expect(wizard(page).getByText('Your free plan includes one caregiver.', { exact: false })).toBeVisible();
    expect(invites(circleId), 'opening All set holds no seat').toEqual([]);
    // NEGATIVE: Go to Today without sharing creates no invite.
    await wizard(page).getByTestId('first-run-go-to-today').click();

    // The onboarding paywall, once; "Continue with free plan" -> Today.
    await page.waitForURL(/\/upgrade$/, { timeout: 30_000 });
    expect(
      await page.evaluate((k) => window.localStorage.getItem(k), `${SEEN_KEY}:${userId}`)
    ).not.toBeNull();
    await page.getByRole('button', { name: /Continue with free plan/ }).click();
    await page.waitForURL(new RegExp(`/circles/${circleId}$`), { timeout: 30_000 });
    await expect(wizard(page)).toHaveCount(0);
    expect(invites(circleId)).toEqual([]);

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
