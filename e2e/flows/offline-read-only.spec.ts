import type { Page, Request } from '@playwright/test';
import { test, expect } from '../fixtures';
import { sqlExec } from '../db';
import { dbQuery, sqlStr } from '../unhappy';
import {
  cookieLogin,
  createCircle,
  createInvite,
  createScopedAccount,
  inviteStatus,
  membershipCount,
  ownerApi,
  uniq,
} from '../unhappy/auth-invites/_helpers';
import { circleTimezone, createDailyMedication, dateInTz, deleteSeries, uniqueSuffix } from '../notesFirstClassShared';

// OFFLINE = READ-ONLY, NO QUEUE (owner decision 2026-10-14), against the REAL
// backend and DB, with the browser really offline (`context.setOffline`).
//
//   page loaded online → a form opened and typed into → offline:
//     - the slim "You're offline" banner shows (role=status, in flow);
//     - the open form's Create explains "You're offline. Connect to save this."
//       and keeps every typed character; the dialog stays open;
//     - Home's Take is aria-disabled and explains "You're offline. Connect to
//       mark this."; the New menu explains "Connect to make changes.";
//   → back online:
//     - the banner hides, the page's reads refetch;
//     - NOTHING was written, then or on reconnect: no non-GET request left the
//       page at any point, and the DB holds no confirmation and no task.
//
// Under the old `mutations.networkMode: 'online'` the Take would have been
// paused and silently replayed on reconnect — on top of whatever another
// caregiver answered meanwhile.

const VIEWER_TZ = process.env.DOSE_VIEWER_TZ ?? 'America/Denver';
const RECIPIENT_TZ = process.env.DOSE_RECIPIENT_TZ ?? 'America/Denver';

test.use({ storageState: { cookies: [], origins: [] }, timezoneId: VIEWER_TZ });
test.setTimeout(90_000);

function minutesIntoDay(tz: string): number {
  const parts = new Intl.DateTimeFormat('en-US', { timeZone: tz, hour: '2-digit', minute: '2-digit', hour12: false }).formatToParts(
    new Date()
  );
  return (Number(parts.find((p) => p.type === 'hour')?.value ?? '0') % 24) * 60 + Number(parts.find((p) => p.type === 'minute')?.value ?? '0');
}

const confirmations = (circleId: string): number =>
  Number(
    dbQuery<{ n: string }>(
      `select count(*)::text as n from medication_confirmations where circle_id = ${sqlStr(circleId)}::uuid`
    )[0].n
  );

const tasksTitled = (circleId: string, title: string): number =>
  Number(
    dbQuery<{ n: string }>(
      `select count(*)::text as n from calendar_events where circle_id = ${sqlStr(circleId)}::uuid and title = ${sqlStr(title)}`
    )[0].n
  );

/** Every request the page makes to the API, by method. */
function recordApi(page: Page): { writes: Request[]; reads: Request[] } {
  const log = { writes: [] as Request[], reads: [] as Request[] };
  page.on('request', (req) => {
    const path = new URL(req.url()).pathname;
    if (!path.startsWith('/api/')) return;
    if (req.method() === 'GET' || req.method() === 'HEAD' || req.method() === 'OPTIONS') log.reads.push(req);
    // Session refresh is auth, not a data write.
    else if (!path.startsWith('/api/auth/')) log.writes.push(req);
  });
  return log;
}

const toast = (page: Page, text: string) =>
  page.locator('[data-toast-region]').getByText(text, { exact: true });

test('offline: banner, writes explained not sent, input kept; reconnect hides it, refetches, replays nothing', async ({
  page,
  context,
  request,
  baseURL,
}) => {
  test.skip(
    (() => {
      const m = minutesIntoDay(RECIPIENT_TZ);
      return m < 5 || m > 24 * 60 - 5;
    })(),
    'within 5 minutes of midnight in the recipient zone'
  );
  const owner = await createScopedAccount('offline');
  sqlExec(`update users set timezone = ${sqlStr(RECIPIENT_TZ)} where id = ${sqlStr(owner.userId)}::uuid;`);
  const session = await ownerApi(request, owner);
  const circleId = await createCircle(session, uniq('offline'));
  const tz = await circleTimezone(session, circleId);
  const medName = `ZZ_E2E_OFFLINE_${uniqueSuffix()}`;
  // Started yesterday so today's 00:01 dose is due now.
  const root = await createDailyMedication(session, circleId, medName, dateInTz(tz, -1), { time: '00:01' });
  const taskTitle = `ZZ_E2E_OFFLINE_TASK_${uniqueSuffix()}`;

  try {
    await cookieLogin(context, owner, baseURL);
    await page.goto(`/circles/${circleId}`, { waitUntil: 'domcontentloaded' });
    const today = page.locator('section[aria-labelledby="todays-meds-heading"] > ul');
    const take = today.getByRole('button', { name: `Confirm ${medName}` }).first();
    await expect(take).toBeVisible({ timeout: 30_000 });
    const banner = page.getByTestId('offline-banner');
    await expect(banner).toHaveCount(0);

    // A form opened ONLINE and typed into.
    const newButton = page.locator('aside').getByRole('button', { name: 'New', exact: true });
    await newButton.click();
    await page.getByRole('menuitem', { name: 'Task', exact: true }).click();
    const dialog = page.getByRole('dialog');
    await expect(dialog.locator('#event_type')).toHaveValue('task');
    await dialog.locator('#title').fill(taskTitle);
    await dialog.locator('#scheduled_date').fill(dateInTz(tz, 0));

    const api = recordApi(page);

    // ── Offline ─────────────────────────────────────────────────────────────
    await context.setOffline(true);
    await expect(banner).toBeVisible();
    await expect(banner).toContainText("You're offline");
    await expect(banner).toContainText('Showing saved info. Connect to make changes.');
    await expect(page.getByRole('status').filter({ has: banner })).toHaveCount(1);
    // In flow under the header: it never covers the header.
    const headerBox = await page.locator('header').first().boundingBox();
    const bannerBox = await banner.boundingBox();
    expect(bannerBox!.y).toBeGreaterThanOrEqual(headerBox!.y + headerBox!.height - 1);

    // The open form: Create explains, input stays, dialog stays.
    const create = dialog.getByRole('button', { name: 'Create' });
    await expect(create).toHaveAttribute('aria-disabled', 'true');
    // `force`: Playwright treats aria-disabled as "not enabled" and would wait
    // forever; a person can still press it — and is told why it did nothing.
    await create.click({ force: true });
    await expect(toast(page, "You're offline. Connect to save this.")).toBeVisible();
    await expect(dialog).toBeVisible();
    await expect(dialog.locator('#title')).toHaveValue(taskTitle);
    // Enter in the title field (implicit submission) is refused the same way.
    await dialog.locator('#title').press('Enter');
    await expect(dialog).toBeVisible();
    await expect(dialog.locator('#title')).toHaveValue(taskTitle);

    // Cancel is not a write: it still closes the form offline.
    await dialog.getByRole('button', { name: 'Cancel', exact: true }).click();
    await expect(page.getByRole('dialog')).toHaveCount(0);

    // Home's Take: visible, aria-disabled, explains; nothing optimistic.
    await expect(take).toBeVisible();
    await expect(take).toHaveAttribute('aria-disabled', 'true');
    await take.click({ force: true });
    await expect(toast(page, "You're offline. Connect to mark this.")).toBeVisible();
    await expect(today.getByRole('button', { name: `Undo ${medName}` })).toHaveCount(0);

    // The New menu explains instead of opening.
    await expect(newButton).toHaveAttribute('aria-disabled', 'true');
    await newButton.click({ force: true });
    await expect(toast(page, "You're offline. Connect to make changes.")).toBeVisible();
    await expect(page.getByRole('menu')).toHaveCount(0);

    // Past the 5 s undo window: still nothing sent.
    await page.waitForTimeout(6_000);
    expect(api.writes.map((r) => `${r.method()} ${r.url()}`)).toEqual([]);

    // ── Back online ─────────────────────────────────────────────────────────
    const readsBefore = api.reads.length;
    await context.setOffline(false);
    await expect(banner).toHaveCount(0);
    await expect(take).not.toHaveAttribute('aria-disabled');
    // The page's reads refetch on reconnect (refetchOnReconnect).
    await expect
      .poll(
        () =>
          api.reads
            .slice(readsBefore)
            .filter((r) => new URL(r.url()).pathname.startsWith(`/api/circles/${circleId}/`)).length,
        { timeout: 15_000 }
      )
      .toBeGreaterThan(0);

    // Nothing replays: give a replay every chance to happen, then check the wire
    // AND the database.
    await page.waitForTimeout(3_000);
    expect(api.writes.map((r) => `${r.method()} ${r.url()}`)).toEqual([]);
    expect(confirmations(circleId)).toBe(0);
    expect(tasksTitled(circleId, taskTitle)).toBe(0);
    await expect(take).toBeVisible();
  } finally {
    await context.setOffline(false);
    await deleteSeries(session, circleId, root);
  }
});

// ── Join and first-run gates (commit 052d34f) ─────────────────────────────────
//
//   - CreateCircleModal's "Join with an invite code" hand-off is a change: offline
//     it explains "Connect to make changes." and the join modal does not open;
//   - JoinCircleModal's details-step "Join circle" (invite looked up ONLINE) is a
//     save: offline it explains "Connect to save this.", the preview stays, and no
//     POST /api/invites/code/:code/accept leaves the page, then or on reconnect;
//   - the first-run wizard's step 1: all four choices are aria-disabled offline and
//     explain with the change sentence; the footer "Skip for now" still closes it.
//
// FALSIFIED (10-15) by removing each gate in the app file in turn
// (offlineKind on the join link / on Join circle, and the ChooseActionStep
// offline branch): the matching test below goes red; files restored byte-identical.

const CHANGE = "You're offline. Connect to make changes.";
const SAVE = "You're offline. Connect to save this.";

test('offline: the create-circle modal\'s "Join with an invite code" explains and does not open the join modal', async ({
  page,
  context,
  baseURL,
}) => {
  const joiner = await createScopedAccount('offline-cjoin');
  await cookieLogin(context, joiner, baseURL);
  await page.goto('/circles', { waitUntil: 'domcontentloaded' });
  const createEntry = page.getByRole('button', { name: 'Create circle' }).first();
  await expect(createEntry).toBeVisible({ timeout: 30_000 });
  await createEntry.click();
  const createDialog = page.getByRole('dialog');
  await expect(createDialog.locator('#recipient_name')).toBeVisible();
  const joinLink = createDialog.getByRole('button', { name: 'Join with an invite code', exact: true });
  await expect(joinLink).not.toHaveAttribute('aria-disabled');

  const api = recordApi(page);
  try {
    await context.setOffline(true);
    await expect(page.getByTestId('offline-banner')).toBeVisible();
    await expect(joinLink).toHaveAttribute('aria-disabled', 'true');
    await joinLink.click({ force: true });
    await expect(toast(page, CHANGE)).toBeVisible();
    // Still on the create form; the join modal never opened.
    await expect(createDialog.locator('#recipient_name')).toBeVisible();
    await expect(page.getByRole('dialog', { name: 'Join a circle', exact: true })).toHaveCount(0);
    await expect(page.getByRole('dialog')).toHaveCount(1);
    expect(api.writes.map((r) => `${r.method()} ${r.url()}`)).toEqual([]);
  } finally {
    await context.setOffline(false);
  }
});

test('offline: join by code - an invite looked up online is not accepted offline; the preview stays, nothing is sent', async ({
  page,
  context,
  request,
  baseURL,
}) => {
  const owner = await createScopedAccount('offline-jowner');
  const session = await ownerApi(request, owner);
  const circleId = await createCircle(session, uniq('offline-join'));
  const invite = await createInvite(session, circleId);
  const recipientName = dbQuery<{ recipient_name: string }>(
    `select recipient_name from care_circles where id = ${sqlStr(circleId)}::uuid`
  )[0].recipient_name;

  const joiner = await createScopedAccount('offline-joiner');
  await cookieLogin(context, joiner, baseURL);
  await page.goto('/circles', { waitUntil: 'domcontentloaded' });
  const entry = page.getByRole('button', { name: 'Join with an invite code', exact: true });
  await expect(entry).toBeVisible({ timeout: 30_000 });
  await entry.click();
  const dialog = page.getByRole('dialog', { name: 'Join a circle', exact: true });
  await expect(dialog).toBeVisible({ timeout: 10_000 });

  // ONLINE: type the code and look it up.
  await dialog.getByLabel('Character 1 of 6', { exact: true }).click();
  await page.keyboard.type(invite.code.toLowerCase(), { delay: 15 });
  await dialog.getByRole('button', { name: 'Find circle', exact: true }).click();
  await expect(dialog.getByText(recipientName, { exact: true }).first()).toBeVisible({ timeout: 20_000 });
  const join = dialog.getByRole('button', { name: 'Join circle', exact: true });
  await expect(join).not.toHaveAttribute('aria-disabled');

  const api = recordApi(page);
  try {
    await context.setOffline(true);
    await expect(page.getByTestId('offline-banner')).toBeVisible();
    await expect(join).toHaveAttribute('aria-disabled', 'true');
    await join.click({ force: true });
    await expect(toast(page, SAVE)).toBeVisible();
    await expect(dialog).toBeVisible();
    await expect(dialog.getByText(recipientName, { exact: true }).first()).toBeVisible();
    await page.waitForTimeout(2_000);
    expect(api.writes.map((r) => `${r.method()} ${r.url()}`)).toEqual([]);

    // Reconnect: nothing replays.
    await context.setOffline(false);
    await expect(page.getByTestId('offline-banner')).toHaveCount(0);
    await expect(join).not.toHaveAttribute('aria-disabled');
    await page.waitForTimeout(3_000);
    expect(api.writes.map((r) => `${r.method()} ${r.url()}`)).toEqual([]);
    expect(membershipCount(circleId, joiner.userId)).toBe(0);
    expect(inviteStatus(invite.id)).toBe('pending');
  } finally {
    await context.setOffline(false);
  }
});

test('offline: first-run wizard - every step-1 choice is aria-disabled and explains; Skip for now still closes; nothing sent', async ({
  page,
  context,
  baseURL,
}) => {
  const acct = await createScopedAccount('offline-wiz');
  await cookieLogin(context, acct, baseURL);
  await page.goto('/circles', { waitUntil: 'domcontentloaded' });
  await page.getByRole('button', { name: 'Create circle' }).first().click();
  const modal = page.getByRole('dialog');
  await modal.locator('#recipient_name').fill(uniq('offwiz'));
  // The wizard mounts over the new circle; let its circle GET land first.
  const circleLoaded = page.waitForResponse(
    (r) =>
      r.request().method() === 'GET' &&
      /^\/api\/circles\/[0-9a-f-]{36}$/.test(new URL(r.url()).pathname) &&
      r.ok(),
    { timeout: 30_000 }
  );
  await modal.getByRole('button', { name: 'Create circle' }).click();
  await page.waitForURL(/\/circles\/[0-9a-f-]{36}/, { timeout: 30_000 });
  const wizard = page.getByRole('dialog', { name: 'Circle created' });
  await expect(wizard).toBeVisible({ timeout: 20_000 });
  await circleLoaded;
  const circleId = /\/circles\/([0-9a-f-]{36})/.exec(page.url())![1];

  const choices = [
    wizard.getByTestId('first-run-primary'),
    wizard.getByTestId('first-run-start-with-appointment'),
    wizard.getByTestId('first-run-start-with-invite'),
    wizard.getByTestId('first-run-start-with-emergency'),
  ];
  for (const choice of choices) {
    await expect(choice).toBeVisible();
    await expect(choice).not.toHaveAttribute('aria-disabled');
  }

  const api = recordApi(page);
  try {
    await context.setOffline(true);
    await expect(page.getByTestId('offline-banner')).toBeVisible();
    for (const choice of choices) {
      await expect(choice).toHaveAttribute('aria-disabled', 'true');
      await choice.click({ force: true });
      await expect(toast(page, CHANGE).first()).toBeVisible();
      // Still on step 1 of the wizard: the choice went nowhere.
      await expect(wizard).toBeVisible();
      await expect(wizard.getByTestId('first-run-primary')).toBeVisible();
      await expect(page).toHaveURL(new RegExp(`/circles/${circleId}(/|\\?|$)`));
    }
    // No other modal opened (appointment / invite / emergency hand-offs).
    await expect(page.getByRole('dialog')).toHaveCount(1);

    // Skip is a close, not a write: it still closes offline.
    await wizard.getByRole('button', { name: 'Skip for now', exact: true }).click();
    await expect(wizard).toHaveCount(0);
    await page.waitForTimeout(1_000);
    expect(api.writes.map((r) => `${r.method()} ${r.url()}`)).toEqual([]);
    expect(
      Number(
        dbQuery<{ n: string }>(
          `select count(*)::text as n from calendar_events where circle_id = ${sqlStr(circleId)}::uuid`
        )[0].n
      )
    ).toBe(0);
  } finally {
    await context.setOffline(false);
  }
});
