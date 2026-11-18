import type { Page } from '@playwright/test';
import { test, expect } from '../fixtures';
import { dbQuery, sqlStr } from '../unhappy';
import { createAccount, runScopedEmail, ACCOUNT_PASSWORD } from '../isolation';
import { sqlExec } from '../db';
import { refuseZoneSync } from '../helpers';
import { cookieLogin, stubJson, uniq } from '../unhappy/auth-invites/_helpers';
import { startFirstCircle } from '../firstRunV2';

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

/** First run v2: the All set dialog (its hidden title is the eyebrow). */
const wizard = (page: Page) => page.getByRole('dialog', { name: 'ALL SET' });
const offerHeading = (page: Page) => page.getByText('Share the care with everyone who helps.');
const ls = (page: Page, key: string) => page.evaluate((k) => window.localStorage.getItem(k), key);

function trackPaths(page: Page): string[] {
  const seen: string[] = [];
  page.on('framenavigated', (f) => {
    if (f === page.mainFrame()) seen.push(new URL(f.url()).pathname);
  });
  return seen;
}

/** First run v2: Start -> the one question -> the circle forms -> the first-item form is open. */
async function createFirstCircle(page: Page, recipient: string): Promise<string> {
  // The first-run form refuses to save before the circle detail (its timezone) has loaded.
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

/** Fill the simple form's name and a PAST time (00:01 in the recipient's day) via "Other time". */
async function fillPastTimeMed(page: Page, name: string): Promise<void> {
  const form = page.getByRole('dialog').last();
  await form.getByLabel(/Medication name/i).fill(name);
  // First run v2: 8:00 AM Morning is preselected on the first-run form; untick it so the typed time
  // is the ONE dose (a second time would be an extra dose, by design). The add-menu form has none.
  const morning = form.getByRole('checkbox', { name: /Morning$/ });
  if (await morning.isChecked()) await morning.click();
  // "Other…" is the time picker over the hidden #scheduled_time (build 11): the value goes straight in.
  await form.locator('#scheduled_time').fill('00:01');
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

test.describe('onboarding first med: the schedule means the circle clock (BC-8)', () => {
  test.setTimeout(120_000);
  // The browser is in New York; the account (and so the new circle) is in Denver. The wizard form's "Morning" is
  // the CIRCLE's 8:00 AM, exactly as the old "Every morning 8:00" preset now is: it saves 08:00, never 06:00.
  test.use({ timezoneId: 'America/New_York' });

  test('a New York browser, a Denver circle: Morning saves 08:00', async ({ page, context, baseURL }) => {
    await refuseZoneSync(page);
    await stubJson(page, 'GET', '/api/drugs/search', { body: { success: true, data: { drugs: [] } } });
    const a = await freeAccount('obtz');
    sqlExec(`update users set timezone = ${sqlStr('America/Denver')} where id = ${sqlStr(a.userId)}::uuid;`);
    await cookieLogin(context, a, baseURL);
    const circleId = await createFirstCircle(page, uniq('ObTz'));
    const form = page.getByRole('dialog').last();
    await form.getByLabel(/Medication name/i).fill('Metformin');
    // First run v2: Morning (the circle's 8:00 AM) is already picked.
    const morning = form.getByRole('checkbox', { name: /Morning$/ });
    await expect(morning).toBeChecked();
    await form.getByRole('button', { name: 'Add medication' }).click();
    await expect(wizard(page).getByTestId('first-run-all-set')).toBeVisible({ timeout: 20_000 });
    const rows = dbQuery<{ scheduled_time: string }>(
      `select scheduled_time::text from calendar_events
        where circle_id = ${sqlStr(circleId)}::uuid and event_type = 'medication' and parent_event_id is null`
    );
    expect(rows.map((r) => r.scheduled_time.slice(0, 5))).toEqual(['08:00']);
  });
});

test.describe('onboarding first med (web)', () => {
  test.setTimeout(120_000);

  test('first run v2: past time -> All set (starts tomorrow) -> paywall once -> Today offers Mark it -> Taken', async ({
    page,
    context,
    baseURL,
  }) => {
    await stubJson(page, 'GET', '/api/drugs/search', { body: { success: true, data: { drugs: [] } } });
    const a = await freeAccount('obfm');
    await cookieLogin(context, a, baseURL);
    const paths = trackPaths(page);
    const recipient = uniq('ObFm');
    const circleId = await createFirstCircle(page, recipient);

    await fillPastTimeMed(page, 'Lisinopril');
    await page.getByRole('dialog').last().getByRole('button', { name: 'Add medication' }).click();

    // All set: starts tomorrow, the Optional invite; no Mark it on All set (Today carries it).
    await expect(wizard(page).getByTestId('first-run-all-set')).toBeVisible({ timeout: 20_000 });
    await expect(wizard(page).getByText(/starts tomorrow/)).toBeVisible();
    await expect(wizard(page).getByText(/who.s usually there/i)).toBeVisible();
    await expect(wizard(page).getByTestId('mark-it-button')).toHaveCount(0);
    const root = rootMed(circleId)!;
    expect(confirmations(root.id)).toHaveLength(0);

    // Not asked yet: Go to Today goes to the paywall once.
    expect(await ls(page, `${SEEN_KEY}:${a.userId}`)).toBeNull();
    await wizard(page).getByTestId('first-run-go-to-today').click();
    await page.waitForURL(/\/upgrade$/, { timeout: 30_000 });
    await expect(offerHeading(page)).toBeVisible();
    expect(await ls(page, `${SEEN_KEY}:${a.userId}`)).toBe('1');

    await page.getByRole('button', { name: /Continue with free plan/ }).click();
    await page.waitForURL(new RegExp(`/circles/${circleId}$`), { timeout: 30_000 });
    await expect(page.getByRole('heading', { level: 1 }).first()).toBeVisible({ timeout: 20_000 });
    await expect(wizard(page)).toHaveCount(0);
    // Today's Tomorrow row with Mark it (written by the first-run save).
    const row = page.getByTestId('first-med-mark-it');
    await expect(row).toBeVisible({ timeout: 20_000 });
    await row.getByTestId('mark-it-button').click();
    await expect(row.getByText('Taken by you', { exact: false })).toBeVisible({ timeout: 20_000 });
    await expect.poll(() => confirmations(root.id).map((c) => c.status)).toEqual(['taken']);
    await page.reload({ waitUntil: 'domcontentloaded' });
    await expect(page.getByRole('heading', { level: 1 }).first()).toBeVisible({ timeout: 20_000 });
    await page.waitForTimeout(1500);
    expect(paths.filter((p) => p === '/upgrade')).toHaveLength(1);
    expect(confirmations(root.id)).toHaveLength(1);
  });

  test('first run v2: Go to Today without tapping Mark it records nothing', async ({ page, context, baseURL }) => {
    const a = await freeAccount('obfn');
    await cookieLogin(context, a, baseURL);
    const circleId = await createFirstCircle(page, uniq('ObFn'));
    await fillPastTimeMed(page, 'Metformin');
    await page.getByRole('dialog').last().getByRole('button', { name: 'Add medication' }).click();
    await expect(wizard(page).getByTestId('first-run-all-set')).toBeVisible({ timeout: 20_000 });
    await wizard(page).getByTestId('first-run-go-to-today').click();
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
    // Skip the first item, take the paywall exit, land on Today with no medication.
    await page.getByTestId('first-run-skip').click();
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
