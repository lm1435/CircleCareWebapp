import type { Page, TestInfo } from '@playwright/test';
import { test, expect } from '../fixtures';
import { checkA11y } from '../helpers';
import { answerFirstRunQuestion, waitForNewCircle } from '../firstRunV2';
import { createAccount, runScopedEmail, ACCOUNT_PASSWORD } from '../isolation';
import {
  cookieLogin,
  createCircle,
  createInvite,
  createScopedAccount,
  ownerApi,
  stubJson,
  uniq,
} from '../unhappy/auth-invites/_helpers';

// DARK MODE on the 1.3.1 surfaces (owner add-on 2026-10-30): the notifications bell and
// /notifications, the invitee welcome (/circles/:id/welcome), the first-run wizard steps (Setup,
// the first-run form, the payoff with Mark it, the onboarding paywall) and Today's FirstMedMarkIt row (add-menu path). Every page is
// painted with the DEVICE in dark and the theme on System (the default), proven by
// html[data-theme="dark"], then scanned by axe (WCAG 2.x AA, which includes color-contrast:
// unreadable text, a light box with light text, an invisible badge all fail it).
// The light-mode twins of these flows are notifications-inbox, onboarding-invitee-welcome,
// first-run-wizard and onboarding-first-med.spec.ts.

test.use({ colorScheme: 'dark', contextOptions: { reducedMotion: 'reduce' } });

async function expectDark(page: Page): Promise<void> {
  await expect
    .poll(() => page.evaluate(() => document.documentElement.getAttribute('data-theme')))
    .toBe('dark');
  // The dark canvas, not a light page that happens to carry the attribute.
  expect(await page.evaluate(() => getComputedStyle(document.body).backgroundColor)).toBe('rgb(26, 24, 21)');
}

async function darkScan(page: Page, name: string, testInfo: TestInfo): Promise<void> {
  await expectDark(page);
  await checkA11y(page, `dark ${name}`, testInfo);
}

// ---------------------------------------------------------------- notifications (stubbed)

function inboxItem(circleId: string, over: Record<string, unknown>) {
  const now = new Date().toISOString();
  return {
    id: crypto.randomUUID(),
    type: 'note_added',
    circle_id: circleId,
    circle_name: 'Circle',
    title: 'Ana added a note',
    body: 'Slept well',
    data: {},
    state: null,
    read_at: null,
    created_at: now,
    updated_at: now,
    target_status: 'ok',
    ...over,
  };
}

async function stubInbox(page: Page, items: ReturnType<typeof inboxItem>[]): Promise<void> {
  // Regex, not a glob: '**/api/inbox**' would also swallow Vite's /src/api/inbox.ts module.
  await page.route(/\/api\/inbox(\/|\?|$)/, async (route) => {
    const unread = items.filter((i) => !i.read_at).length;
    if (route.request().method() === 'POST') return route.fulfill({ json: { success: true, data: { updated: 0 } } });
    if (route.request().url().includes('/unread-count')) {
      return route.fulfill({ json: { success: true, data: { unread_count: unread } } });
    }
    return route.fulfill({ json: { success: true, data: { items, unread_count: unread } } });
  });
}

test.describe('dark: notifications', () => {
  test('the header bell with its unread badge, then /notifications with read, unread and removed rows', async ({
    page,
    circleId,
  }, testInfo) => {
    await stubInbox(page, [
      inboxItem(circleId, { title: 'Medication reminder', body: 'Time for Lisinopril' }),
      inboxItem(circleId, { read_at: new Date().toISOString() }),
      inboxItem(circleId, { title: 'Dose given', body: 'Sam gave Lisinopril', target_status: 'removed' }),
    ]);
    await page.goto(`/circles/${circleId}`, { waitUntil: 'domcontentloaded' });
    const bell = page.getByRole('link', { name: 'Notifications, 2 unread' });
    await expect(bell).toBeVisible({ timeout: 20_000 });
    await darkScan(page, 'today with the bell badge', testInfo);

    await bell.click();
    await expect(page.getByRole('heading', { level: 1, name: 'Notifications' })).toBeVisible();
    await expect(page.getByTestId('inbox-row')).toHaveCount(3);
    await darkScan(page, '/notifications', testInfo);
  });

  test('/notifications empty state', async ({ page }, testInfo) => {
    await stubInbox(page, []);
    await page.goto('/notifications', { waitUntil: 'domcontentloaded' });
    await expect(page.getByRole('heading', { level: 1, name: 'Notifications' })).toBeVisible({ timeout: 20_000 });
    await expect(page.getByTestId('inbox-row')).toHaveCount(0);
    await darkScan(page, '/notifications empty', testInfo);
  });
});

// ---------------------------------------------------------------- run-scoped accounts

test.describe('dark: onboarding', () => {
  test.use({ storageState: { cookies: [], origins: [] } });
  test.setTimeout(150_000);

  test('the invitee welcome at /circles/:id/welcome', async ({ page, request, context, baseURL }, testInfo) => {
    const label = uniq('dkw');
    const api = await ownerApi(request, await createScopedAccount('dkw-owner'));
    const circleId = await createCircle(api, label);
    const invite = await createInvite(api, circleId);
    await cookieLogin(context, await createScopedAccount('dkw-invitee'), baseURL);

    await page.goto(`/invite/${invite.code}`, { waitUntil: 'domcontentloaded' });
    await page.getByRole('button', { name: 'Accept invitation' }).click();
    await expect(page).toHaveURL(new RegExp(`/circles/${circleId}/welcome$`), { timeout: 20_000 });
    await expect(page.getByTestId('invitee-welcome-items').getByRole('listitem')).toHaveCount(3);
    await darkScan(page, 'invitee welcome', testInfo);
  });

  test('first run v2: the one question, the first-item form, All set, the onboarding paywall, Today', async ({
    page,
    context,
    baseURL,
  }, testInfo) => {
    const { circleId } = await freshOwnerWithFirstCircle(page, context, baseURL!, 'dkfr', testInfo);

    // The first-item form (type switch, 8:00 AM Morning picked).
    await fillPastTimeMed(page, 'Lisinopril');
    await darkScan(page, 'wizard first-run form', testInfo);

    await page.getByRole('dialog').last().getByRole('button', { name: 'Add medication' }).click();
    await expect(page.getByTestId('first-run-all-set')).toBeVisible({ timeout: 20_000 });
    await darkScan(page, 'first run all set', testInfo);

    // Go to Today -> the onboarding paywall once -> Today.
    await page.getByTestId('first-run-go-to-today').click();
    await page.waitForURL(/\/upgrade$/, { timeout: 30_000 });
    await expect(page.getByText('Share the care with everyone who helps.')).toBeVisible();
    await darkScan(page, 'onboarding paywall', testInfo);
    await page.getByRole('button', { name: /Continue with free plan/ }).click();
    await page.waitForURL(new RegExp(`/circles/${circleId}$`), { timeout: 30_000 });
    await expect(page.getByRole('heading', { level: 1 }).first()).toBeVisible({ timeout: 20_000 });
    await darkScan(page, 'today after the wizard', testInfo);
  });

  test("add-menu path: Today's FirstMedMarkIt row (Tomorrow + Already given today? Mark it), then Taken", async ({
    page,
    context,
    baseURL,
  }, testInfo) => {
    const { circleId } = await freshOwnerWithFirstCircle(page, context, baseURL!, 'dkam');
    await page.getByTestId('first-run-skip').click();
    await page.waitForURL(/\/upgrade$/, { timeout: 30_000 });
    await page.getByRole('button', { name: /Continue with free plan/ }).click();
    await page.waitForURL(new RegExp(`/circles/${circleId}$`), { timeout: 30_000 });

    const card = page.getByTestId('next-step-card');
    await expect(card).toBeVisible({ timeout: 20_000 });
    await darkScan(page, 'today next-step card', testInfo);
    await card.getByRole('button', { name: 'Add medication' }).click();
    await fillPastTimeMed(page, 'Amlodipine');
    await page.getByRole('dialog').last().getByRole('button', { name: 'Add medication' }).click();

    const row = page.getByTestId('first-med-mark-it');
    await expect(row).toBeVisible({ timeout: 20_000 });
    await expect(row.getByTestId('mark-it-line')).toContainText('Already given today? Mark it');
    await darkScan(page, 'today FirstMedMarkIt', testInfo);

    await row.getByTestId('mark-it-button').click();
    await expect(row.getByText('Taken by you', { exact: false })).toBeVisible({ timeout: 20_000 });
    await darkScan(page, 'today FirstMedMarkIt taken', testInfo);
  });
});

async function freshOwnerWithFirstCircle(
  page: Page,
  context: import('@playwright/test').BrowserContext,
  baseURL: string,
  prefix: string,
  testInfo?: TestInfo
) {
  await stubJson(page, 'GET', '/api/drugs/search', { body: { success: true, data: { drugs: [] } } });
  const email = runScopedEmail(uniq(prefix));
  await createAccount(email, 'free');
  await cookieLogin(context, { email, password: ACCOUNT_PASSWORD }, baseURL);
  // First run v2: "Start a care circle" -> the one question (scanned dark) -> the circle forms.
  await page.goto('/circles', { waitUntil: 'domcontentloaded' });
  await page.getByTestId('empty-circles').getByRole('button').first().click();
  await expect(page.getByTestId('first-run-who')).toBeVisible({ timeout: 20_000 });
  if (testInfo) await darkScan(page, 'first run who', testInfo);
  // The first-run form refuses to save before the circle detail (its timezone) has loaded.
  const circleLoaded = page.waitForResponse(
    (r) => r.request().method() === 'GET' && /^\/api\/circles\/[0-9a-f-]{36}$/.test(new URL(r.url()).pathname) && r.ok(),
    { timeout: 30_000 }
  );
  await answerFirstRunQuestion(page, uniq(prefix).slice(0, 40));
  const circleId = await waitForNewCircle(page);
  await expect(page.getByRole('tablist')).toBeVisible({ timeout: 30_000 });
  await circleLoaded;
  return { circleId };
}

/** The simple form's name and a PAST time (00:01 in the recipient's day) via "Other time". */
async function fillPastTimeMed(page: Page, name: string): Promise<void> {
  const form = page.getByRole('dialog').last();
  await form.getByLabel(/Medication name/i).fill(name);
  // "Other…" is the time picker over the hidden #scheduled_time (build 11): the value goes straight in.
  await form.locator('#scheduled_time').fill('00:01');
  await expect(form.getByTestId('dose-past-time-note')).toBeVisible();
}
