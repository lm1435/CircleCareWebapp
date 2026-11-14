import type { Page, Request } from '@playwright/test';
import { test, expect } from '../fixtures';
import { checkA11y } from '../helpers';
import { cookieLogin, createCircle, createScopedAccount, ownerApi, uniq } from '../unhappy/auth-invites/_helpers';

// Quiet-circle back-off 1.4.2 (docs/plans/quiet-circle-backoff-1-4-2-backend-contract.md):
// the routine_checkin inbox row -> the check-in page and each answer; the paused notice on
// Today and Meds and its "Turn alerts back on"; the view-only seat sees the notice with no
// buttons. The backend switch `quiet_circle_backoff_mode` ships 'off' (GET always answers
// paused:false), so the two dose-alerts endpoints and the inbox are STUBBED here and every
// POST body is asserted on the wire; the account, circle, pages and routing are real.

test.use({ storageState: { cookies: [], origins: [] } });
test.setTimeout(90_000);

interface DoseAlerts {
  paused: boolean;
  paused_since: string | null;
  answer: 'routine_changed' | 'keep_paused' | null;
  can_answer: boolean;
}

const PAUSED: DoseAlerts = {
  paused: true,
  paused_since: '2026-11-07T17:00:00.000Z',
  answer: null,
  can_answer: true,
};

/** Stubs GET + POST; the POST answers per the contract and the next GET reflects it. */
async function stubDoseAlerts(page: Page, initial: DoseAlerts): Promise<{ posts: Array<Record<string, unknown>> }> {
  let state = { ...initial };
  const posts: Array<Record<string, unknown>> = [];
  await page.route(/\/api\/circles\/[^/]+\/dose-alerts(\/answer)?$/, async (route) => {
    const req: Request = route.request();
    if (req.method() === 'POST') {
      const body = req.postDataJSON() as { answer: string; source: string };
      posts.push(body);
      const resumed = body.answer === 'still_giving' && state.paused;
      state =
        body.answer === 'still_giving'
          ? { paused: false, paused_since: null, answer: null, can_answer: state.can_answer }
          : { ...state, answer: body.answer as DoseAlerts['answer'] };
      return route.fulfill({ json: { success: true, data: { ...state, resumed } } });
    }
    return route.fulfill({ json: { success: true, data: state } });
  });
  return { posts };
}

async function stubInbox(page: Page, circleId: string): Promise<void> {
  const now = new Date().toISOString();
  const items = [
    {
      id: crypto.randomUUID(),
      type: 'routine_checkin',
      circle_id: circleId,
      circle_name: 'Circle',
      title: "Has Rose's routine changed?",
      body: 'No doses have been marked lately, so we paused the extra alerts. Mark any dose to turn them back on.',
      data: { type: 'routine_checkin', circleId, circle_id: circleId },
      state: null,
      read_at: null,
      created_at: now,
      updated_at: now,
      target_status: 'ok',
    },
  ];
  await page.route(/\/api\/inbox(\/|\?|$)/, async (route) => {
    const req = route.request();
    if (req.method() === 'POST') return route.fulfill({ json: { success: true, data: { updated: 1 } } });
    if (req.url().includes('/unread-count')) return route.fulfill({ json: { success: true, data: { unread_count: 1 } } });
    return route.fulfill({ json: { success: true, data: { items, unread_count: 1 } } });
  });
}

async function arrange(request: import('@playwright/test').APIRequestContext, tag: string) {
  const owner = await createScopedAccount(tag);
  const session = await ownerApi(request, owner);
  const circleId = await createCircle(session, uniq(tag));
  return { owner, circleId };
}

for (const [answer, label, landsOn] of [
  ['still_giving', "We're still giving these", 'today'],
  ['routine_changed', 'The routine changed', 'meds'],
  ['keep_paused', 'Keep alerts paused for now', 'today'],
] as const) {
  test(`inbox row -> check-in -> "${label}" posts {answer:${answer}, source:inbox} and lands on ${landsOn}`, async ({
    page,
    context,
    request,
    baseURL,
  }, testInfo) => {
    const { owner, circleId } = await arrange(request, `qc${answer.slice(0, 4)}`);
    const { posts } = await stubDoseAlerts(page, PAUSED);
    await stubInbox(page, circleId);
    await cookieLogin(context, owner, baseURL);
    await page.goto('/notifications', { waitUntil: 'domcontentloaded' });
    await page.getByTestId('inbox-row').first().click({ timeout: 30_000 });

    await expect(page).toHaveURL(new RegExp(`/circles/${circleId}/routine-check-in$`));
    await expect(page.getByRole('heading', { level: 1 })).toContainText('routine changed?', { timeout: 30_000 });
    await expect(page.getByText(/Paused since/)).toBeVisible();
    if (answer === 'still_giving') await checkA11y(page, `/circles/${circleId}/routine-check-in`, testInfo);

    await page.getByRole('button', { name: new RegExp(`^${label.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}`) }).click();
    await expect.poll(() => posts).toEqual([{ answer, source: 'inbox' }]);
    if (landsOn === 'meds') {
      await expect(page).toHaveURL(new RegExp(`/circles/${circleId}/meds$`));
    } else {
      await expect(page).toHaveURL(new RegExp(`/circles/${circleId}$`));
    }
    if (answer === 'still_giving') {
      await expect(page.getByTestId('dose-alerts-resumed-today')).toHaveText('Alerts are on');
      await expect(page.getByTestId('dose-alerts-notice-today')).toHaveCount(0);
    }
    if (answer === 'keep_paused') {
      await expect(page.getByTestId('dose-alerts-notice-today')).toContainText('You chose to keep follow-up alerts paused');
    }
  });
}

test('the Today notice: "Turn alerts back on" posts {still_giving, notice}, hides it and keeps focus on the confirmation', async ({
  page,
  context,
  request,
  baseURL,
}, testInfo) => {
  const { owner, circleId } = await arrange(request, 'qcnotice');
  const { posts } = await stubDoseAlerts(page, PAUSED);
  await cookieLogin(context, owner, baseURL);
  await page.goto(`/circles/${circleId}`, { waitUntil: 'domcontentloaded' });
  const notice = page.getByTestId('dose-alerts-notice-today');
  await expect(notice).toContainText('Follow-up alerts are paused', { timeout: 30_000 });
  // The ONE coaching element: no next-step card beside it.
  await expect(page.getByTestId('next-step-card')).toHaveCount(0);
  await checkA11y(page, `/circles/${circleId}`, testInfo);
  await notice.getByRole('button', { name: 'Turn alerts back on' }).click();
  await expect.poll(() => posts).toEqual([{ answer: 'still_giving', source: 'notice' }]);
  const line = page.getByTestId('dose-alerts-resumed-today');
  await expect(line).toHaveText('Alerts are on');
  await expect(line).toBeFocused();
  await expect(notice).toHaveCount(0);
});

test('the Meds line shows the notice; "Has the routine changed?" opens the check-in with source notice', async ({
  page,
  context,
  request,
  baseURL,
}) => {
  const { owner, circleId } = await arrange(request, 'qcmeds');
  const { posts } = await stubDoseAlerts(page, PAUSED);
  await cookieLogin(context, owner, baseURL);
  await page.goto(`/circles/${circleId}/meds`, { waitUntil: 'domcontentloaded' });
  const line = page.getByTestId('dose-alerts-notice-meds');
  await expect(line).toContainText('Follow-up alerts are paused', { timeout: 30_000 });
  await line.getByRole('button', { name: 'Has the routine changed?' }).click();
  await expect(page).toHaveURL(new RegExp(`/circles/${circleId}/routine-check-in$`));
  await page.getByRole('button', { name: /^Keep alerts paused for now/ }).click();
  await expect.poll(() => posts).toEqual([{ answer: 'keep_paused', source: 'notice' }]);
});

test('view-only: the notice shows with NO buttons, the check-in offers NO answers (can_answer:false)', async ({
  page,
  context,
  request,
  baseURL,
}) => {
  const { owner, circleId } = await arrange(request, 'qcview');
  const { posts } = await stubDoseAlerts(page, { ...PAUSED, can_answer: false });
  await cookieLogin(context, owner, baseURL);
  await page.goto(`/circles/${circleId}`, { waitUntil: 'domcontentloaded' });
  const notice = page.getByTestId('dose-alerts-notice-today');
  await expect(notice).toContainText('Follow-up alerts are paused', { timeout: 30_000 });
  await expect(notice.getByRole('button')).toHaveCount(0);
  await page.goto(`/circles/${circleId}/routine-check-in`, { waitUntil: 'domcontentloaded' });
  await expect(page.getByTestId('routine-checkin-view-only')).toBeVisible({ timeout: 30_000 });
  await expect(page.getByTestId('routine-checkin-answers')).toHaveCount(0);
  expect(posts).toEqual([]);
});

test('paused:false (the shipped server state): no notice on Today or Meds; the check-in says "Alerts are on"', async ({
  page,
  context,
  request,
  baseURL,
}) => {
  const { owner, circleId } = await arrange(request, 'qcoff');
  await stubDoseAlerts(page, { paused: false, paused_since: null, answer: null, can_answer: true });
  await cookieLogin(context, owner, baseURL);
  await page.goto(`/circles/${circleId}`, { waitUntil: 'domcontentloaded' });
  await expect(page.getByTestId('today-grid')).toBeVisible({ timeout: 30_000 });
  await expect(page.getByTestId('dose-alerts-notice-today')).toHaveCount(0);
  await page.goto(`/circles/${circleId}/meds`, { waitUntil: 'domcontentloaded' });
  await expect(page.getByRole('heading', { level: 1 })).toBeVisible({ timeout: 30_000 });
  await expect(page.getByTestId('dose-alerts-notice-meds')).toHaveCount(0);
  await page.goto(`/circles/${circleId}/routine-check-in`, { waitUntil: 'domcontentloaded' });
  await expect(page.getByTestId('routine-checkin-alerts-on')).toContainText('Alerts are on', { timeout: 30_000 });
  await expect(page.getByTestId('routine-checkin-answers')).toHaveCount(0);
});
