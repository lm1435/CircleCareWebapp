import type { APIRequestContext, Page } from '@playwright/test';
import { test, expect } from '../../fixtures';
import { sqlExec } from '../../db';
import { countRequests, dbQuery, sqlStr } from '../../unhappy';
import {
  cookieLogin,
  createCircle,
  createInvite,
  createScopedAccount,
  membershipCount,
  ownerApi,
  uniq,
} from '../auth-invites/_helpers';
import {
  circleTimezone,
  createDailyMedication,
  dateInTz,
  deleteSeries,
  escapeRegExp,
  gotoWeekContaining,
  openChip,
  uniqueSuffix,
} from '../../notesFirstClassShared';

// K1 (web test gaps 2026-09-29), UPDATED for the decided P1 (PK1): a second
// caregiver who answers a dose someone else already answered is never allowed
// to overwrite it.
//   * DIFFERENT answer -> 409 DOSE_ALREADY_RECORDED, nothing written. The client
//     says "Already marked taken by <name> at <time>." as a calm STATUS toast
//     (never an alert) and refetches.
//   * SAME answer      -> 200 { already_recorded: true }, nothing written. The
//     client reports its normal success toast.
// Either way: ONE row for the dose, and it is still the FIRST caregiver's
// (status, confirmed_by, confirmed_at byte-identical).
//
// The Home stale-page / different-answer path is also covered by
// unhappy/writes/dose-already-recorded.spec.ts (two browsers, freeMember). This
// file adds: the CALENDAR detail dialog surface, and the SAME-answer path on
// both surfaces.
//
// Real backend, real DB, two real sessions; run-scoped accounts. The stale
// page is reproduced by loading the owner's page BEFORE the member answers
// through the API and never reloading it.
//
// TIMEZONES (env, default = Denver/Denver):
//   DOSE_VIEWER_TZ     the BROWSER's timezoneId
//   DOSE_RECIPIENT_TZ  the OWNER's profile timezone = the care recipient's
//                      (no recipient account), so it can differ from the viewer's.

const VIEWER_TZ = process.env.DOSE_VIEWER_TZ ?? 'America/Denver';
const RECIPIENT_TZ = process.env.DOSE_RECIPIENT_TZ ?? 'America/Denver';

test.use({ storageState: { cookies: [], origins: [] }, timezoneId: VIEWER_TZ });
test.setTimeout(120_000);

const MEMBER_NAME = 'Marisol';
const CONFIRM = '/api/circles/:id/medications/confirm';
const CONFIRM_RE = /\/api\/circles\/[^/]+\/medications\/confirm$/;

async function circleWithMember(request: APIRequestContext, label: string) {
  const owner = await createScopedAccount(`${label}-owner`);
  sqlExec(`update users set timezone = ${sqlStr(RECIPIENT_TZ)} where id = ${sqlStr(owner.userId)}::uuid;`);
  const ownerSession = await ownerApi(request, owner);
  const circleId = await createCircle(ownerSession, uniq(label)); // recipient_name "E2E <label>", no recipient account
  const member = await createScopedAccount(`${label}-member`);
  sqlExec(`update users set first_name = ${sqlStr(MEMBER_NAME)} where id = ${sqlStr(member.userId)}::uuid;`);
  const memberSession = await ownerApi(request, member);
  const invite = await createInvite(ownerSession, circleId); // @example.com, never mailed
  const acc = await memberSession.post(`/api/invites/code/${invite.code}/accept`);
  expect(acc.status(), await acc.text()).toBeLessThan(300);
  expect(membershipCount(circleId, member.userId)).toBe(1);
  return { owner, ownerSession, member, memberSession, circleId };
}

interface Row {
  status: string;
  confirmed_by: string;
  confirmed_at: string;
  scheduled_date: string;
}

const rowsOf = (circleId: string, root: string): Row[] =>
  dbQuery<Row>(
    `select mc.status, mc.confirmed_by::text, mc.confirmed_at::text, ce.scheduled_date::text
       from medication_confirmations mc join calendar_events ce on ce.id = mc.event_id
      where ce.circle_id = ${sqlStr(circleId)}::uuid
        and (ce.id = ${sqlStr(root)}::uuid or ce.parent_event_id = ${sqlStr(root)}::uuid)`
  );

const feedRows = (circleId: string): number =>
  Number(
    dbQuery<{ n: string }>(
      `select count(*)::text as n from activity_feed where circle_id = ${sqlStr(circleId)}::uuid`
    )[0]?.n ?? '0'
  );

/** The member answers first, through the API (the owner's page never hears of it). */
async function memberAnswers(
  memberSession: Awaited<ReturnType<typeof ownerApi>>,
  circleId: string,
  root: string,
  status: 'taken' | 'skipped'
): Promise<void> {
  const res = await memberSession.post(`/api/circles/${circleId}/medications/confirm`, {
    event_id: root,
    status,
    scheduled_time: '08:00:00',
  });
  expect(res.status(), await res.text()).toBeLessThan(300);
}

const noAlert = (page: Page) => expect(page.getByRole('alert').filter({ hasText: /\S/ })).toHaveCount(0);

interface Setup {
  owner: Awaited<ReturnType<typeof circleWithMember>>['owner'];
  ownerSession: Awaited<ReturnType<typeof circleWithMember>>['ownerSession'];
  member: Awaited<ReturnType<typeof circleWithMember>>['member'];
  memberSession: Awaited<ReturnType<typeof circleWithMember>>['memberSession'];
  circleId: string;
  tz: string;
  name: string;
  root: string;
  yesterday: string;
}

async function setup(request: APIRequestContext, label: string): Promise<Setup> {
  const c = await circleWithMember(request, label);
  const tz = await circleTimezone(c.ownerSession, c.circleId);
  expect(tz, 'the recipient zone follows the owner profile zone').toBe(RECIPIENT_TZ);
  const name = `ZZ_E2E_2CG_${uniqueSuffix()}`;
  // Yesterday's dose is the root row itself: due and confirmable (a start of
  // TODAY with a past time would be rolled to tomorrow).
  const yesterday = dateInTz(tz, -1);
  const root = await createDailyMedication(c.ownerSession, c.circleId, name, yesterday, { time: '08:00' });
  return { ...c, tz, name, root, yesterday };
}

const ALREADY = (answer: 'taken' | 'skipped') =>
  new RegExp(
    `Already ${answer === 'taken' ? 'marked taken' : 'skipped'} by ${MEMBER_NAME} at \\d{1,2}:\\d{2}( [AP]M)?\\.`
  );

// ── Calendar detail dialog ───────────────────────────────────────────────────

test('Calendar, stale detail: Skip over a dose another caregiver TOOK -> 409, calm "already marked taken" + Change answer, their row untouched', async ({
  page,
  context,
  request,
  baseURL,
}) => {
  const s = await setup(request, 'dose2cal');
  try {
    await cookieLogin(context, s.owner, baseURL);
    await gotoWeekContaining(page, s.circleId, dateInTz(s.tz, 0), s.yesterday);
    const detail = await openChip(page, s.yesterday, new RegExp(escapeRegExp(s.name)));
    // The stale state: the dialog still offers to answer this dose.
    await expect(detail.getByRole('button', { name: 'Skip dose' })).toBeVisible();

    await memberAnswers(s.memberSession, s.circleId, s.root, 'taken');
    const first = rowsOf(s.circleId, s.root);
    expect(first).toHaveLength(1);
    expect(first[0].status).toMatch(/^taken/);
    expect(first[0].confirmed_by).toBe(s.member.userId);
    const feedBefore = feedRows(s.circleId);

    const posts = countRequests(page, 'POST', CONFIRM);
    await detail.getByRole('button', { name: 'Skip dose' }).click();
    const dialog = page.getByRole('dialog', { name: 'Confirm medication' });
    await expect(dialog).toBeVisible();
    const refused = page.waitForResponse((r) => r.request().method() === 'POST' && CONFIRM_RE.test(new URL(r.url()).pathname));
    await dialog.getByRole('button', { name: 'Save' }).click();
    const res = await refused;
    expect(res.status(), 'the second, different answer is refused').toBe(409);
    expect(((await res.json()) as { error: { code: string } }).error.code).toBe('DOSE_ALREADY_RECORDED');

    // PK29: the dialog STAYS OPEN with a calm status notice naming the first
    // caregiver (not an alert), now offering "Change answer"; closing it sends
    // nothing further. (The change itself: flows/dose-change-answer.spec.ts.)
    await expect(dialog.getByRole('status').filter({ hasText: ALREADY('taken') })).toBeVisible({ timeout: 15_000 });
    await expect(dialog.getByRole('button', { name: 'Change answer' })).toBeVisible();
    await noAlert(page);
    await posts.expectCount(1);
    await dialog.getByRole('button', { name: 'Close' }).last().click();
    await expect(page.getByRole('dialog', { name: 'Confirm medication' })).toHaveCount(0, { timeout: 10_000 });
    await posts.expectCount(1);

    // DB: still exactly the member's row, byte for byte; nothing new in the feed.
    expect(rowsOf(s.circleId, s.root)).toEqual(first);
    expect(feedRows(s.circleId)).toBe(feedBefore);

    // The day was refetched: the reopened detail shows THEIR answer, no Skip/Take.
    const again = await openChip(page, s.yesterday, new RegExp(escapeRegExp(s.name)));
    await expect(again.getByText(/(Taken|Taken late) at /).first()).toBeVisible({ timeout: 15_000 });
    await expect(again.getByRole('button', { name: 'Skip dose' })).toHaveCount(0);
    await expect(again.getByRole('button', { name: 'Mark taken' })).toHaveCount(0);
  } finally {
    await deleteSeries(s.ownerSession, s.circleId, s.root);
  }
});

test('Calendar, stale detail: Mark taken over a dose another caregiver TOOK (same answer) -> 200 no-op, success toast, their row untouched', async ({
  page,
  context,
  request,
  baseURL,
}) => {
  const s = await setup(request, 'dose2same');
  try {
    await cookieLogin(context, s.owner, baseURL);
    await gotoWeekContaining(page, s.circleId, dateInTz(s.tz, 0), s.yesterday);
    const detail = await openChip(page, s.yesterday, new RegExp(escapeRegExp(s.name)));
    await expect(detail.getByRole('button', { name: 'Mark taken' })).toBeVisible();

    await memberAnswers(s.memberSession, s.circleId, s.root, 'taken');
    const first = rowsOf(s.circleId, s.root);
    expect(first).toHaveLength(1);
    const feedBefore = feedRows(s.circleId);

    const posts = countRequests(page, 'POST', CONFIRM);
    await detail.getByRole('button', { name: 'Mark taken' }).click();
    const dialog = page.getByRole('dialog', { name: 'Confirm medication' });
    await expect(dialog).toBeVisible();
    const agreed = page.waitForResponse((r) => r.request().method() === 'POST' && CONFIRM_RE.test(new URL(r.url()).pathname));
    await dialog.getByRole('button', { name: 'Save' }).click();
    const res = await agreed;
    expect(res.status(), 'agreement is success, not a conflict').toBe(200);
    const body = (await res.json()) as { data: { already_recorded?: boolean; confirmation: { confirmed_by: string } } };
    expect(body.data.already_recorded).toBe(true);
    expect(body.data.confirmation.confirmed_by, "the response carries THEIR row").toBe(s.member.userId);

    await expect(page.getByRole('status').filter({ hasText: /^\s*Marked as taken/ })).toBeVisible({ timeout: 15_000 });
    await noAlert(page);
    await expect(page.getByRole('dialog', { name: 'Confirm medication' })).toHaveCount(0, { timeout: 10_000 });
    await posts.expectCount(1);

    // One row; confirmed_by is still the member; no second feed row.
    const after = rowsOf(s.circleId, s.root);
    expect(after).toEqual(first);
    expect(after[0].confirmed_by).toBe(s.member.userId);
    expect(feedRows(s.circleId)).toBe(feedBefore);
  } finally {
    await deleteSeries(s.ownerSession, s.circleId, s.root);
  }
});

// ── Home "Needs attention" row ───────────────────────────────────────────────

async function homeNeedsAttentionRow(page: Page, circleId: string, name: string, button: 'Skip' | 'Confirm') {
  await page.goto(`/circles/${circleId}`, { waitUntil: 'domcontentloaded' });
  const attention = page.locator('section[aria-labelledby="meds-needs-attention"]');
  const control = attention.getByRole('button', { name: `${button} ${name}` }).first();
  await expect(control).toBeVisible({ timeout: 30_000 });
  return { attention, control };
}

test('Home, stale row: Skip over a dose another caregiver TOOK -> 409, ONE request, calm toast, row refetched, their row untouched', async ({
  page,
  context,
  request,
  baseURL,
}) => {
  const s = await setup(request, 'dose2home');
  try {
    await cookieLogin(context, s.owner, baseURL);
    const { attention, control } = await homeNeedsAttentionRow(page, s.circleId, s.name, 'Skip');

    await memberAnswers(s.memberSession, s.circleId, s.root, 'taken');
    const first = rowsOf(s.circleId, s.root);
    expect(first).toHaveLength(1);
    const feedBefore = feedRows(s.circleId);

    const posts = countRequests(page, 'POST', CONFIRM);
    const refused = page.waitForResponse((r) => r.request().method() === 'POST' && CONFIRM_RE.test(new URL(r.url()).pathname), {
      timeout: 40_000,
    });
    await control.click(); // the 5 s undo window runs, then the POST
    const res = await refused;
    expect(res.status()).toBe(409);
    expect(((await res.json()) as { error: { code: string } }).error.code).toBe('DOSE_ALREADY_RECORDED');

    await expect(page.getByRole('status').filter({ hasText: ALREADY('taken') })).toBeVisible({ timeout: 15_000 });
    await noAlert(page);
    await expect(attention.getByRole('button', { name: `Skip ${s.name}` })).toHaveCount(0, { timeout: 15_000 });
    await expect(attention.getByRole('button', { name: `Confirm ${s.name}` })).toHaveCount(0);
    await posts.expectCount(1);

    expect(rowsOf(s.circleId, s.root)).toEqual(first);
    expect(feedRows(s.circleId)).toBe(feedBefore);
  } finally {
    await deleteSeries(s.ownerSession, s.circleId, s.root);
  }
});

test('Home, stale row: Confirm over a dose another caregiver TOOK (same answer) -> 200 no-op, success toast, ONE request, their row untouched', async ({
  page,
  context,
  request,
  baseURL,
}) => {
  const s = await setup(request, 'dose2homesame');
  try {
    await cookieLogin(context, s.owner, baseURL);
    const { attention, control } = await homeNeedsAttentionRow(page, s.circleId, s.name, 'Confirm');

    await memberAnswers(s.memberSession, s.circleId, s.root, 'taken');
    const first = rowsOf(s.circleId, s.root);
    expect(first).toHaveLength(1);
    const feedBefore = feedRows(s.circleId);

    const posts = countRequests(page, 'POST', CONFIRM);
    const agreed = page.waitForResponse((r) => r.request().method() === 'POST' && CONFIRM_RE.test(new URL(r.url()).pathname), {
      timeout: 40_000,
    });
    await control.click();
    const res = await agreed;
    expect(res.status()).toBe(200);
    expect(((await res.json()) as { data: { already_recorded?: boolean } }).data.already_recorded).toBe(true);

    await expect(page.getByRole('status').filter({ hasText: /^\s*Marked as taken/ })).toBeVisible({ timeout: 15_000 });
    await noAlert(page);
    await expect(attention.getByRole('button', { name: `Confirm ${s.name}` })).toHaveCount(0, { timeout: 15_000 });
    await posts.expectCount(1);

    const after = rowsOf(s.circleId, s.root);
    expect(after).toEqual(first);
    expect(after[0].confirmed_by).toBe(s.member.userId);
    expect(feedRows(s.circleId)).toBe(feedBefore);
  } finally {
    await deleteSeries(s.ownerSession, s.circleId, s.root);
  }
});
