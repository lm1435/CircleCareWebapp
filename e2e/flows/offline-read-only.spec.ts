import type { Page, Request } from '@playwright/test';
import { test, expect } from '../fixtures';
import { sqlExec } from '../db';
import { dbQuery, sqlStr } from '../unhappy';
import {
  cookieLogin,
  createCircle,
  createScopedAccount,
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
