import type { Page } from '@playwright/test';
import { test, expect } from '../fixtures';
import { sqlExec } from '../db';
import { countRequests, dbQuery, sqlStr } from '../unhappy';
import {
  cookieLogin,
  createCircle,
  createScopedAccount,
  ownerApi,
  uniq,
} from '../unhappy/auth-invites/_helpers';
import { openAllCircles } from '../unhappy/access/_helpers';
import { circleTimezone, createDailyMedication, dateInTz, deleteSeries, uniqueSuffix } from '../notesFirstClassShared';

// K2 (web test gaps 2026-09-29). Home "Today's medications" Take / Skip / Undo
// against the REAL backend and DB: the 5 s undo window (MEDICATION_UNDO_DELAY_MS)
// really delays the write, Undo really cancels it, leaving the page or the
// circle inside the window still delivers exactly ONE confirm to the circle the
// dose belongs to, and a full reload inside the window never produces two.
//
// Verify-before-alert (lib/confirmVerify.ts) is asserted only by what the user
// sees on the happy path here (success toast, no alert); its failure branches
// are unit-tested (confirmVerifyBeforeAlert.test.tsx) and NOT re-tested here.
//
// TIMEZONES (env, default Denver/Denver):
//   DOSE_VIEWER_TZ     the BROWSER's timezoneId
//   DOSE_RECIPIENT_TZ  the OWNER's profile zone = the care recipient's (no
//                      recipient account) — may differ from the viewer's.
// The dose is 00:01 in the RECIPIENT's zone, "today" in that zone; a run within
// 5 minutes of the recipient's midnight is skipped (nothing due / date straddle).

const VIEWER_TZ = process.env.DOSE_VIEWER_TZ ?? 'America/Denver';
const RECIPIENT_TZ = process.env.DOSE_RECIPIENT_TZ ?? 'America/Denver';

test.use({ storageState: { cookies: [], origins: [] }, timezoneId: VIEWER_TZ });
test.setTimeout(60_000);

const CONFIRM = '/api/circles/:id/medications/confirm';
// Longer than the 5 s window plus the POST round trip.
const PAST_WINDOW_MS = 6_000;

/** Minutes since midnight in `tz` now. */
function minutesIntoDay(tz: string): number {
  const parts = new Intl.DateTimeFormat('en-US', { timeZone: tz, hour: '2-digit', minute: '2-digit', hour12: false }).formatToParts(
    new Date()
  );
  const h = Number(parts.find((p) => p.type === 'hour')?.value ?? '0') % 24;
  const m = Number(parts.find((p) => p.type === 'minute')?.value ?? '0');
  return h * 60 + m;
}

interface Row {
  status: string;
  confirmed_by: string;
  scheduled_date: string;
}

/** Confirmations for the series on TODAY (recipient zone) only. */
const todayRows = (circleId: string, root: string, today: string): Row[] =>
  dbQuery<Row>(
    `select mc.status, mc.confirmed_by::text, ce.scheduled_date::text
       from medication_confirmations mc join calendar_events ce on ce.id = mc.event_id
      where ce.circle_id = ${sqlStr(circleId)}::uuid
        and (ce.id = ${sqlStr(root)}::uuid or ce.parent_event_id = ${sqlStr(root)}::uuid)
        and ce.scheduled_date = ${sqlStr(today)}::date`
  );

const circleConfirmations = (circleId: string): number =>
  Number(
    dbQuery<{ n: string }>(
      `select count(*)::text as n from medication_confirmations where circle_id = ${sqlStr(circleId)}::uuid`
    )[0].n
  );

async function arrange(request: import('@playwright/test').APIRequestContext, label: string) {
  test.skip(
    (() => {
      const m = minutesIntoDay(RECIPIENT_TZ);
      return m < 5 || m > 24 * 60 - 5;
    })(),
    'within 5 minutes of midnight in the recipient zone'
  );
  const owner = await createScopedAccount(label);
  sqlExec(`update users set timezone = ${sqlStr(RECIPIENT_TZ)} where id = ${sqlStr(owner.userId)}::uuid;`);
  const session = await ownerApi(request, owner);
  const circleId = await createCircle(session, uniq(label));
  const tz = await circleTimezone(session, circleId);
  expect(tz, 'recipient zone follows the owner profile zone').toBe(RECIPIENT_TZ);
  const name = `ZZ_E2E_UNDO_${uniqueSuffix()}`;
  // Started yesterday so today's 00:01 dose is due (a start of TODAY with a past
  // time would be rolled to tomorrow by the late-add rule).
  const root = await createDailyMedication(session, circleId, name, dateInTz(tz, -1), { time: '00:01' });
  return { owner, session, circleId, tz, name, root, today: dateInTz(tz, 0) };
}

/** Resolves with the confirm response (the write happens after the 5 s undo window). Start BEFORE the click. */
function confirmResponse(page: Page) {
  return page.waitForResponse((r) => r.request().method() === 'POST' && /\/api\/circles\/[^/]+\/medications\/confirm$/.test(new URL(r.url()).pathname), {
    timeout: 40_000,
  });
}

/** The Today list of Home. The Needs-attention list (yesterday's dose) is a nested section. */
function todayList(page: Page) {
  return page.locator('section[aria-labelledby="todays-meds-heading"] > ul');
}

async function openHome(page: Page, circleId: string, name: string) {
  await page.goto(`/circles/${circleId}`, { waitUntil: 'domcontentloaded' });
  const list = todayList(page);
  await expect(list.getByRole('button', { name: `Confirm ${name}` }).first()).toBeVisible({ timeout: 30_000 });
  return list;
}

test('(a) Take, then wait: exactly one POST after the window, DB taken, success toast, gone after reload', async ({
  page,
  context,
  request,
  baseURL,
}) => {
  const s = await arrange(request, 'undoa');
  try {
    await cookieLogin(context, s.owner, baseURL);
    const list = await openHome(page, s.circleId, s.name);
    const posts = countRequests(page, 'POST', CONFIRM);

    const answered = confirmResponse(page);
    await list.getByRole('button', { name: `Confirm ${s.name}` }).first().click();
    // Inside the window nothing has been written.
    await expect(list.getByRole('button', { name: `Undo ${s.name}` })).toBeVisible();
    expect(todayRows(s.circleId, s.root, s.today)).toHaveLength(0);
    expect(posts.count).toBe(0);

    expect((await answered).status()).toBe(201);
    await posts.expectCount(1);
    const rows = todayRows(s.circleId, s.root, s.today);
    expect(rows).toHaveLength(1);
    expect(rows[0].status).toMatch(/^taken/); // past 00:31 -> taken_late; before -> taken
    expect(rows[0].confirmed_by).toBe(s.owner.userId);
    await expect(page.getByRole('status').filter({ hasText: /^\s*Marked as taken/ })).toBeVisible();
    await expect(page.getByRole('alert').filter({ hasText: /\S/ })).toHaveCount(0);

    await page.reload({ waitUntil: 'domcontentloaded' });
    await expect(todayList(page).getByRole('listitem').first()).toBeVisible({ timeout: 30_000 });
    await expect(todayList(page).getByRole('button', { name: `Confirm ${s.name}` })).toHaveCount(0);
  } finally {
    await deleteSeries(s.session, s.circleId, s.root);
  }
});

test('(b) Take then Undo inside the window: no POST ever, no row, Confirm offered again', async ({
  page,
  context,
  request,
  baseURL,
}) => {
  const s = await arrange(request, 'undob');
  try {
    await cookieLogin(context, s.owner, baseURL);
    const list = await openHome(page, s.circleId, s.name);
    const posts = countRequests(page, 'POST', CONFIRM);

    await list.getByRole('button', { name: `Confirm ${s.name}` }).first().click();
    await page.waitForTimeout(0); // Undo at ~0 s, well inside the 5 s window
    await list.getByRole('button', { name: `Undo ${s.name}` }).click();

    await page.waitForTimeout(PAST_WINDOW_MS + 1_000);
    await posts.expectCount(0);
    expect(todayRows(s.circleId, s.root, s.today)).toHaveLength(0);
    await expect(list.getByRole('button', { name: `Confirm ${s.name}` }).first()).toBeVisible();
    await expect(page.getByRole('status').filter({ hasText: /Marked as/ })).toHaveCount(0);
  } finally {
    await deleteSeries(s.session, s.circleId, s.root);
  }
});

test('(c) Take then in-app navigation inside the window: the unmount flush sends exactly one POST to this circle', async ({
  page,
  context,
  request,
  baseURL,
}) => {
  const s = await arrange(request, 'undoc');
  try {
    await cookieLogin(context, s.owner, baseURL);
    const list = await openHome(page, s.circleId, s.name);
    const posts = countRequests(page, 'POST', CONFIRM);

    await list.getByRole('button', { name: `Confirm ${s.name}` }).first().click();
    await expect(list.getByRole('button', { name: `Undo ${s.name}` })).toBeVisible();
    // Sidebar link: a client-side route change, NOT page.goto (a full load is P5).
    await page.getByRole('link', { name: 'Calendar', exact: true }).first().click();
    await expect(page).toHaveURL(new RegExp(`/circles/${s.circleId}/calendar$`));

    await posts.expectCount(1, { timeoutMs: 8_000 });
    expect(new URL(posts.requests[0].url()).pathname).toContain(`/api/circles/${s.circleId}/`);
    await expect.poll(() => todayRows(s.circleId, s.root, s.today).length, { timeout: 15_000 }).toBe(1);
    expect(todayRows(s.circleId, s.root, s.today)[0].status).toMatch(/^taken/);
  } finally {
    await deleteSeries(s.session, s.circleId, s.root);
  }
});

test('(d) Skip, then wait: DB skipped, success toast', async ({ page, context, request, baseURL }) => {
  const s = await arrange(request, 'undod');
  try {
    await cookieLogin(context, s.owner, baseURL);
    const list = await openHome(page, s.circleId, s.name);
    const posts = countRequests(page, 'POST', CONFIRM);

    const answered = confirmResponse(page);
    await list.getByRole('button', { name: `Skip ${s.name}` }).first().click();
    expect((await answered).status()).toBe(201);
    await posts.expectCount(1);
    const rows = todayRows(s.circleId, s.root, s.today);
    expect(rows).toHaveLength(1);
    expect(rows[0].status).toBe('skipped');
    expect(rows[0].confirmed_by).toBe(s.owner.userId);
    await expect(page.getByRole('status').filter({ hasText: /^\s*Marked as skipped/ })).toBeVisible();
    await expect(page.getByRole('alert').filter({ hasText: /\S/ })).toHaveCount(0);
  } finally {
    await deleteSeries(s.session, s.circleId, s.root);
  }
});

test('(e) Take in circle A, switch to circle B inside the window: one POST, to A, nothing in B', async ({
  page,
  context,
  request,
  baseURL,
}) => {
  const s = await arrange(request, 'undoe');
  const labelB = uniq('undoeB');
  const circleB = await createCircle(s.session, labelB);
  try {
    await cookieLogin(context, s.owner, baseURL);
    const list = await openHome(page, s.circleId, s.name);
    const posts = countRequests(page, 'POST', CONFIRM);

    await list.getByRole('button', { name: `Confirm ${s.name}` }).first().click();
    await expect(list.getByRole('button', { name: `Undo ${s.name}` })).toBeVisible();
    await openAllCircles(page);
    await page.getByRole('link', { name: new RegExp(`^Open E2E ${labelB}`) }).click();
    await expect(page).toHaveURL(new RegExp(`/circles/${circleB}`));

    await posts.expectCount(1, { timeoutMs: 8_000 });
    const path = new URL(posts.requests[0].url()).pathname;
    expect(path).toContain(`/api/circles/${s.circleId}/`);
    expect(path).not.toContain(circleB);
    await expect.poll(() => todayRows(s.circleId, s.root, s.today).length, { timeout: 15_000 }).toBe(1);
    expect(circleConfirmations(circleB), 'circle B received no confirmation').toBe(0);
  } finally {
    await deleteSeries(s.session, s.circleId, s.root);
  }
});

test('(f) PK11: a full reload inside the window flushes the dose through a keepalive request: exactly ONE confirmation in the DB (never 0, never 2)', async ({
  page,
  context,
  request,
  baseURL,
}) => {
  const s = await arrange(request, 'undof');
  try {
    await cookieLogin(context, s.owner, baseURL);
    const list = await openHome(page, s.circleId, s.name);

    await list.getByRole('button', { name: `Confirm ${s.name}` }).first().click();
    await expect(list.getByRole('button', { name: `Undo ${s.name}` })).toBeVisible();
    // The undo window is still open: the pagehide flush must send it, and it
    // must survive the page being torn down (fetch keepalive, bearer token).
    expect(todayRows(s.circleId, s.root, s.today)).toHaveLength(0);
    await page.reload({ waitUntil: 'domcontentloaded' });

    await expect.poll(() => todayRows(s.circleId, s.root, s.today).length, { timeout: 20_000 }).toBe(1);
    // Past the original window nothing else arrives: never two.
    await page.waitForTimeout(PAST_WINDOW_MS);
    const rows = todayRows(s.circleId, s.root, s.today);
    expect(rows).toHaveLength(1);
    expect(rows[0].confirmed_by).toBe(s.owner.userId);
    expect(circleConfirmations(s.circleId)).toBe(1);
  } finally {
    await deleteSeries(s.session, s.circleId, s.root);
  }
});
