import type { Page } from '@playwright/test';
import { test, expect } from '../fixtures';
import { dbQuery, sqlStr } from '../unhappy';
import { createAccount, runScopedEmail, ACCOUNT_PASSWORD } from '../isolation';
import { cookieLogin, stubJson, uniq } from '../unhappy/auth-invites/_helpers';

// Onboarding 1.3.1 (docs/plans/onboarding-1-3-1.md), the FIRST-MED path end to end against the
// real backend: owner creates their first circle -> Setup (1) -> the ONE simple form in
// first-run mode with a PAST time -> payoff "Already given today? Mark it" -> Continue -> the
// paywall exactly once -> Today. Plus the add-menu twin: a first med saved from the next-step
// card whose start rolled shows Today's "Tomorrow" row with the same Mark it line.
// Needs the backend's `mark_first_day` support (spec section 1). Mobile twin:
// mobile/.maestro/parity/onboarding/.

const SEEN_KEY = 'cc:onboardingPaywallSeen';

async function freeAccount(prefix: string) {
  const email = runScopedEmail(uniq(prefix));
  const userId = await createAccount(email, 'free');
  return { email, password: ACCOUNT_PASSWORD, userId };
}

const wizard = (page: Page) => page.getByRole('dialog', { name: 'Circle created' });
const offerHeading = (page: Page) => page.getByText('Better care, together.');
const ls = (page: Page, key: string) => page.evaluate((k) => window.localStorage.getItem(k), key);

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
  // The first-run form refuses to save before the circle detail (its timezone) has loaded.
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

/** Fill the simple form's name and a PAST time (00:01 in the recipient's day) via "Other time". */
async function fillPastTimeMed(page: Page, name: string): Promise<void> {
  const form = page.getByRole('dialog').last();
  await form.getByLabel(/Medication name/i).fill(name);
  await form.getByRole('button', { name: 'Other time' }).click();
  await form.getByLabel(/^Time/).fill('00:01');
  await expect(form.getByTestId('dose-past-time-note')).toBeVisible();
}

interface MedRow {
  id: string;
  scheduled_date: string;
}
function rootMed(circleId: string): MedRow | undefined {
  return dbQuery<MedRow>(
    `select id, scheduled_date::text as scheduled_date from calendar_events
      where circle_id = ${sqlStr(circleId)}::uuid and event_type = 'medication' and parent_event_id is null`
  )[0];
}
function confirmations(eventId: string): { status: string }[] {
  return dbQuery<{ status: string }>(
    `select status from medication_confirmations where event_id = ${sqlStr(eventId)}::uuid`
  );
}

test.describe('onboarding first med (web)', () => {
  test.setTimeout(120_000);

  test('wizard: past time -> payoff Mark it -> paywall once -> Today', async ({ page, context, baseURL }) => {
    await stubJson(page, 'GET', '/api/drugs/search', { body: { success: true, data: { drugs: [] } } });
    const a = await freeAccount('obfm');
    await cookieLogin(context, a, baseURL);
    const paths = trackPaths(page);
    const recipient = uniq('ObFm');
    const circleId = await createFirstCircle(page, recipient);

    await page.getByTestId('first-run-primary').click();
    await fillPastTimeMed(page, 'Lisinopril');
    await page.getByRole('dialog').last().getByRole('button', { name: 'Add medication' }).click();

    // Payoff: ALL SET, starts tomorrow, the Mark it line, NO invite question.
    await expect(wizard(page).getByText('ALL SET')).toBeVisible({ timeout: 20_000 });
    await expect(wizard(page).getByText(/starts tomorrow/)).toBeVisible();
    await expect(wizard(page).getByText(/who.s usually there/i)).toHaveCount(0);
    const root = rootMed(circleId)!;
    expect(confirmations(root.id)).toHaveLength(0);

    await wizard(page).getByTestId('mark-it-button').click();
    await expect(wizard(page).getByText('Marked as taken.')).toBeVisible({ timeout: 20_000 });
    // ONE Taken, by the opt-in flag, on the primary root.
    await expect.poll(() => confirmations(root.id).map((c) => c.status)).toEqual(['taken']);

    // Not asked yet: the paywall is the Continue's next step.
    expect(await ls(page, `${SEEN_KEY}:${a.userId}`)).toBeNull();
    await wizard(page).getByRole('button', { name: 'Continue', exact: true }).click();
    await page.waitForURL(/\/upgrade$/, { timeout: 30_000 });
    await expect(offerHeading(page)).toBeVisible();
    expect(await ls(page, `${SEEN_KEY}:${a.userId}`)).toBe('1');

    await page.getByRole('button', { name: /Continue with free plan/ }).click();
    await page.waitForURL(new RegExp(`/circles/${circleId}$`), { timeout: 30_000 });
    await expect(page.getByRole('heading', { level: 1 }).first()).toBeVisible({ timeout: 20_000 });
    // Today: no wizard, no second paywall, no Mark it line (it was used), the dose is Taken.
    await expect(wizard(page)).toHaveCount(0);
    await expect(page.getByTestId('mark-it-line')).toHaveCount(0);
    await page.reload({ waitUntil: 'domcontentloaded' });
    await expect(page.getByRole('heading', { level: 1 }).first()).toBeVisible({ timeout: 20_000 });
    await page.waitForTimeout(1500);
    expect(paths.filter((p) => p === '/upgrade')).toHaveLength(1);
    expect(confirmations(root.id)).toHaveLength(1);
    // The backend moved the root's start back to today (the pre-roll date): never after it.
    expect(rootMed(circleId)!.scheduled_date <= root.scheduled_date).toBe(true);
  });

  test('wizard: Continue without tapping Mark it records nothing', async ({ page, context, baseURL }) => {
    const a = await freeAccount('obfn');
    await cookieLogin(context, a, baseURL);
    const circleId = await createFirstCircle(page, uniq('ObFn'));
    await page.getByTestId('first-run-primary').click();
    await fillPastTimeMed(page, 'Metformin');
    await page.getByRole('dialog').last().getByRole('button', { name: 'Add medication' }).click();
    await expect(wizard(page).getByTestId('mark-it-button')).toBeVisible({ timeout: 20_000 });
    await wizard(page).getByRole('button', { name: 'Continue', exact: true }).click();
    await page.waitForURL(/\/upgrade$/, { timeout: 30_000 });
    expect(confirmations(rootMed(circleId)!.id)).toHaveLength(0);
  });

  test('add-menu twin: a first med saved after skipping Setup shows Today\'s Tomorrow row with Mark it; marking shows Taken', async ({
    page,
    context,
    baseURL,
  }) => {
    await stubJson(page, 'GET', '/api/drugs/search', { body: { success: true, data: { drugs: [] } } });
    const a = await freeAccount('obtw');
    await cookieLogin(context, a, baseURL);
    const circleId = await createFirstCircle(page, uniq('ObTw'));
    // Skip Setup, take the paywall exit, land on Today with no medication.
    await wizard(page).getByRole('button', { name: 'Skip for now' }).click();
    await page.waitForURL(/\/upgrade$/, { timeout: 30_000 });
    await page.getByRole('button', { name: /Continue with free plan/ }).click();
    await page.waitForURL(new RegExp(`/circles/${circleId}$`), { timeout: 30_000 });

    const card = page.getByTestId('next-step-card');
    await expect(card).toBeVisible({ timeout: 20_000 });
    await card.getByRole('button', { name: 'Add medication' }).click();
    await fillPastTimeMed(page, 'Amlodipine');
    await page.getByRole('dialog').last().getByRole('button', { name: 'Add medication' }).click();

    const row = page.getByTestId('first-med-mark-it');
    await expect(row).toBeVisible({ timeout: 20_000 });
    await expect(row.getByText('Tomorrow')).toBeVisible();
    await expect(row.getByText('Amlodipine')).toBeVisible();
    await expect(row.getByTestId('mark-it-line')).toContainText('Already given today? Mark it');

    await row.getByTestId('mark-it-button').click();
    await expect(row.getByText('Taken by you', { exact: false })).toBeVisible({ timeout: 20_000 });
    await expect(row.getByTestId('mark-it-line')).toHaveCount(0);
    await expect(row.getByText('Tomorrow')).toBeVisible();
    const root = rootMed(circleId)!;
    await expect.poll(() => confirmations(root.id).map((c) => c.status)).toEqual(['taken']);

    // Remembered for the rest of the day: a reload still shows Taken, never the line again.
    await page.reload({ waitUntil: 'domcontentloaded' });
    await expect(page.getByTestId('first-med-mark-it').getByText('Taken by you', { exact: false })).toBeVisible({
      timeout: 20_000,
    });
    await expect(page.getByTestId('mark-it-line')).toHaveCount(0);
  });
});
