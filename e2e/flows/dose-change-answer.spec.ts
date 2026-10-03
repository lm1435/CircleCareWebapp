import type { APIRequestContext, Page } from '@playwright/test';
import { test, expect } from '../fixtures';
import { sqlExec } from '../db';
import { countRequests, dbQuery, sqlStr } from '../unhappy';
import {
  cookieLogin,
  createCircle,
  createInvite,
  createScopedAccount,
  membershipCount,
  ownerApi,
  uniq,
} from '../unhappy/auth-invites/_helpers';
import {
  circleTimezone,
  createDailyMedication,
  dateInTz,
  deleteSeries,
  escapeRegExp,
  gotoWeekContaining,
  openChip,
  uniqueSuffix,
} from '../notesFirstClassShared';

// PK29 (approved 2026-09-30): "Change Ana's answer?". The already-recorded
// notice gains a "Change answer" action -> a confirm dialog that names the
// other caregiver, what they answered and that everyone will see the change in
// Activity -> a second POST with `overwrite: true, expected_status: <their
// answer>`. The server replaces the answer ONLY while that is still the stored
// one (a conditional overwrite), writes a normal feed row with the suffix
// "(changed another caregiver's answer)", and never takes names or ids from the
// client beyond the two fields.
//
// Two real sessions on a real backend + DB, run-scoped accounts: the OWNER is
// the stale page (loaded BEFORE the member answers through the API and never
// reloaded), the MEMBER ("Marisol") answers first.

const VIEWER_TZ = process.env.DOSE_VIEWER_TZ ?? 'America/Denver';
const RECIPIENT_TZ = process.env.DOSE_RECIPIENT_TZ ?? 'America/Denver';

test.use({ storageState: { cookies: [], origins: [] }, timezoneId: VIEWER_TZ });
test.setTimeout(150_000);

const MEMBER_NAME = 'Marisol';
const CONFIRM = '/api/circles/:id/medications/confirm';
const CONFIRM_RE = /\/api\/circles\/[^/]+\/medications\/confirm$/;
const SUFFIX = "(changed another caregiver's answer)";

async function circleWithMember(request: APIRequestContext, label: string) {
  const owner = await createScopedAccount(`${label}-owner`);
  sqlExec(`update users set timezone = ${sqlStr(RECIPIENT_TZ)} where id = ${sqlStr(owner.userId)}::uuid;`);
  const ownerSession = await ownerApi(request, owner);
  const circleId = await createCircle(ownerSession, uniq(label));
  const member = await createScopedAccount(`${label}-member`);
  sqlExec(`update users set first_name = ${sqlStr(MEMBER_NAME)} where id = ${sqlStr(member.userId)}::uuid;`);
  const memberSession = await ownerApi(request, member);
  const invite = await createInvite(ownerSession, circleId);
  const acc = await memberSession.post(`/api/invites/code/${invite.code}/accept`);
  expect(acc.status(), await acc.text()).toBeLessThan(300);
  expect(membershipCount(circleId, member.userId)).toBe(1);
  return { owner, ownerSession, member, memberSession, circleId };
}

interface Row {
  status: string;
  confirmed_by: string;
}

const rowsOf = (circleId: string, root: string): Row[] =>
  dbQuery<Row>(
    `select mc.status, mc.confirmed_by::text
       from medication_confirmations mc join calendar_events ce on ce.id = mc.event_id
      where ce.circle_id = ${sqlStr(circleId)}::uuid
        and (ce.id = ${sqlStr(root)}::uuid or ce.parent_event_id = ${sqlStr(root)}::uuid)`
  );

const feedDescriptions = (circleId: string): string[] =>
  dbQuery<{ description: string }>(
    `select description from activity_feed where circle_id = ${sqlStr(circleId)}::uuid order by created_at`
  ).map((r) => r.description);

type Session = Awaited<ReturnType<typeof ownerApi>>;

async function answerViaApi(
  session: Session,
  circleId: string,
  root: string,
  body: Record<string, unknown>
): Promise<number> {
  const res = await session.post(`/api/circles/${circleId}/medications/confirm`, {
    event_id: root,
    scheduled_time: '08:00:00',
    ...body,
  });
  return res.status();
}

async function setup(request: APIRequestContext, label: string) {
  const c = await circleWithMember(request, label);
  const tz = await circleTimezone(c.ownerSession, c.circleId);
  expect(tz).toBe(RECIPIENT_TZ);
  const name = `ZZ_E2E_CHG_${uniqueSuffix()}`;
  const yesterday = dateInTz(tz, -1);
  const root = await createDailyMedication(c.ownerSession, c.circleId, name, yesterday, { time: '08:00' });
  return { ...c, tz, name, root, yesterday };
}

const NOTICE = (answer: 'taken' | 'skipped') =>
  new RegExp(
    `Already ${answer === 'taken' ? 'marked taken' : 'skipped'} by ${MEMBER_NAME} at \\d{1,2}:\\d{2}( [AP]M)?\\.`
  );

const noAlert = (page: Page) => expect(page.getByRole('alert').filter({ hasText: /\S/ })).toHaveCount(0);

function confirmPosts(page: Page) {
  const bodies: Array<Record<string, unknown>> = [];
  page.on('request', (r) => {
    if (r.method() === 'POST' && CONFIRM_RE.test(new URL(r.url()).pathname)) {
      try {
        bodies.push(r.postDataJSON() as Record<string, unknown>);
      } catch {
        bodies.push({});
      }
    }
  });
  return bodies;
}

// -- Calendar detail dialog -------------------------------------------------

test('Calendar: Skip over a dose Marisol TOOK -> notice + "Change answer" -> dialog -> overwrite: row is the owner\'s skipped, feed row carries the suffix', async ({
  page,
  context,
  request,
  baseURL,
}) => {
  const s = await setup(request, 'chgcal');
  try {
    await cookieLogin(context, s.owner, baseURL);
    await gotoWeekContaining(page, s.circleId, dateInTz(s.tz, 0), s.yesterday);
    const detail = await openChip(page, s.yesterday, new RegExp(escapeRegExp(s.name)));
    await expect(detail.getByRole('button', { name: 'Skip dose' })).toBeVisible();

    expect(await answerViaApi(s.memberSession, s.circleId, s.root, { status: 'taken' })).toBeLessThan(300);
    const first = rowsOf(s.circleId, s.root);
    expect(first).toHaveLength(1);
    expect(first[0].confirmed_by).toBe(s.member.userId);
    const bodies = confirmPosts(page);

    await detail.getByRole('button', { name: 'Skip dose' }).click();
    const dialog = page.getByRole('dialog', { name: 'Confirm medication' });
    const refused = page.waitForResponse((r) => r.request().method() === 'POST' && CONFIRM_RE.test(new URL(r.url()).pathname));
    await dialog.getByRole('button', { name: 'Save' }).click();
    expect((await refused).status()).toBe(409);

    await expect(dialog.getByRole('status').filter({ hasText: NOTICE('taken') })).toBeVisible({ timeout: 15_000 });
    await noAlert(page);
    await dialog.getByRole('button', { name: 'Change answer' }).click();

    const confirm = page.getByRole('dialog', { name: `Change ${MEMBER_NAME}'s answer?` });
    await expect(confirm).toBeVisible();
    await expect(confirm).toContainText(
      new RegExp(`${MEMBER_NAME} marked this dose taken at \\d{1,2}:\\d{2}( [AP]M)?\\. Change it to skipped\\? Everyone in the circle will see the change in Activity\\.`)
    );
    // Nothing is overwritten until the dialog is confirmed.
    expect(rowsOf(s.circleId, s.root)).toEqual(first);

    const changed = page.waitForResponse((r) => r.request().method() === 'POST' && CONFIRM_RE.test(new URL(r.url()).pathname));
    await confirm.getByRole('button', { name: 'Change answer' }).click();
    expect((await changed).status()).toBeLessThan(300);

    expect(bodies).toHaveLength(2);
    expect(bodies[1]).toMatchObject({ status: 'skipped', overwrite: true, expected_status: 'taken' });
    await expect(page.getByRole('status').filter({ hasText: 'Marked as skipped' })).toBeVisible({ timeout: 15_000 });

    const after = rowsOf(s.circleId, s.root);
    expect(after).toHaveLength(1);
    expect(after[0].status).toBe('skipped');
    expect(after[0].confirmed_by, 'the row is now the owner\'s').toBe(s.owner.userId);
    const feed = feedDescriptions(s.circleId).filter((d) => d.includes(SUFFIX));
    expect(feed, 'one feed row carries the overwrite suffix, and no names').toHaveLength(1);
    expect(feed[0]).not.toContain(MEMBER_NAME);
  } finally {
    await deleteSeries(s.ownerSession, s.circleId, s.root);
  }
});

// -- Home needs-attention row -------------------------------------------------

async function homeRow(page: Page, circleId: string, name: string, button: 'Skip' | 'Confirm') {
  await page.goto(`/circles/${circleId}`, { waitUntil: 'domcontentloaded' });
  const attention = page.locator('section[aria-labelledby="meds-needs-attention"]');
  const control = attention.getByRole('button', { name: `${button} ${name}` }).first();
  await expect(control).toBeVisible({ timeout: 30_000 });
  return { attention, control };
}

function homeChangeAnswer(choice: 'change' | 'keep', title: string): void {
  test(title, async ({ page, context, request, baseURL }) => {
    const s = await setup(request, `chghome${choice}`);
    try {
      await cookieLogin(context, s.owner, baseURL);
      const { control } = await homeRow(page, s.circleId, s.name, 'Confirm');

      expect(await answerViaApi(s.memberSession, s.circleId, s.root, { status: 'skipped' })).toBeLessThan(300);
      const first = rowsOf(s.circleId, s.root);
      expect(first[0].status).toBe('skipped');
      const bodies = confirmPosts(page);

      const refused = page.waitForResponse((r) => r.request().method() === 'POST' && CONFIRM_RE.test(new URL(r.url()).pathname), {
        timeout: 40_000,
      });
      await control.click(); // the 5 s undo window runs, then the POST
      expect((await refused).status()).toBe(409);

      const toast = page.getByRole('status').filter({ hasText: NOTICE('skipped') });
      await expect(toast).toBeVisible({ timeout: 15_000 });
      await noAlert(page);

      await toast.getByRole('button', { name: 'Change answer' }).click();
      const confirm = page.getByRole('dialog', { name: `Change ${MEMBER_NAME}'s answer?` });
      await expect(confirm).toContainText(/Change it to taken\?/);
      expect(bodies, 'nothing is overwritten until the dialog is confirmed').toHaveLength(1);
      expect(bodies[0]).not.toHaveProperty('overwrite');

      if (choice === 'keep') {
        await confirm.getByRole('button', { name: `Keep ${MEMBER_NAME}'s answer` }).click();
        await expect(page.getByRole('dialog')).toHaveCount(0);
        expect(bodies).toHaveLength(1);
        expect(rowsOf(s.circleId, s.root)).toEqual(first);
        return;
      }

      const changed = page.waitForResponse((r) => r.request().method() === 'POST' && CONFIRM_RE.test(new URL(r.url()).pathname));
      await confirm.getByRole('button', { name: 'Change answer' }).click();
      expect((await changed).status()).toBeLessThan(300);
      expect(bodies[1]).toMatchObject({ status: 'taken', overwrite: true, expected_status: 'skipped' });
      const after = rowsOf(s.circleId, s.root);
      expect(after).toHaveLength(1);
      expect(after[0].status).toMatch(/^taken/);
      expect(after[0].confirmed_by).toBe(s.owner.userId);
      expect(feedDescriptions(s.circleId).filter((d) => d.includes(SUFFIX))).toHaveLength(1);
    } finally {
      await deleteSeries(s.ownerSession, s.circleId, s.root);
    }
  });
}

homeChangeAnswer('change', 'Home: Confirm over a dose Marisol SKIPPED -> toast "Change answer" -> dialog -> overwrite taken');
homeChangeAnswer('keep', 'Home: Confirm over a dose Marisol SKIPPED -> toast "Change answer" -> dialog -> "Keep" sends nothing and her row stands');

test('Conditional: Marisol changes her answer to the owner\'s wish before the owner confirms -> agreement (200 no-op), her row is untouched, no overwrite feed row', async ({
  page,
  context,
  request,
  baseURL,
}) => {
  const s = await setup(request, 'chgcond');
  try {
    await cookieLogin(context, s.owner, baseURL);
    await gotoWeekContaining(page, s.circleId, dateInTz(s.tz, 0), s.yesterday);
    const detail = await openChip(page, s.yesterday, new RegExp(escapeRegExp(s.name)));
    await expect(detail.getByRole('button', { name: 'Skip dose' })).toBeVisible();

    // Marisol TOOK it; the owner (stale) tries to skip and is told so.
    expect(await answerViaApi(s.memberSession, s.circleId, s.root, { status: 'taken' })).toBeLessThan(300);
    await detail.getByRole('button', { name: 'Skip dose' }).click();
    const dialog = page.getByRole('dialog', { name: 'Confirm medication' });
    await dialog.getByRole('button', { name: 'Save' }).click();
    await expect(dialog.getByRole('button', { name: 'Change answer' })).toBeVisible({ timeout: 15_000 });
    await dialog.getByRole('button', { name: 'Change answer' }).click();
    const confirm = page.getByRole('dialog', { name: `Change ${MEMBER_NAME}'s answer?` });
    await expect(confirm).toBeVisible();

    // Before the owner confirms, Marisol flips to SKIPPED herself (her own
    // correction). The stored answer no longer matches expected_status 'taken',
    // so the server must NOT take it for an overwrite - and since it now equals
    // what the owner wants, it is agreement: 200 no-op, her row untouched.
    expect(await answerViaApi(s.memberSession, s.circleId, s.root, { status: 'skipped' })).toBeLessThan(300);
    const mid = rowsOf(s.circleId, s.root);
    expect(mid[0].status).toBe('skipped');
    expect(mid[0].confirmed_by).toBe(s.member.userId);
    const overwriteRowsBefore = feedDescriptions(s.circleId).filter((d) => d.includes(SUFFIX)).length;
    const posts = countRequests(page, 'POST', CONFIRM);

    const answered = page.waitForResponse((r) => r.request().method() === 'POST' && CONFIRM_RE.test(new URL(r.url()).pathname));
    await confirm.getByRole('button', { name: 'Change answer' }).click();
    const res = await answered;
    expect(res.status()).toBe(200);
    expect(((await res.json()) as { data: { already_recorded?: boolean } }).data.already_recorded).toBe(true);
    await posts.expectCount(1);

    expect(rowsOf(s.circleId, s.root)).toEqual(mid);
    expect(feedDescriptions(s.circleId).filter((d) => d.includes(SUFFIX)).length).toBe(overwriteRowsBefore);
  } finally {
    await deleteSeries(s.ownerSession, s.circleId, s.root);
  }
});

test('API: overwrite without a matching expected_status never overwrites (no flag -> 409; wrong expectation -> 409)', async ({
  request,
}) => {
  const s = await setup(request, 'chgapi');
  try {
    expect(await answerViaApi(s.memberSession, s.circleId, s.root, { status: 'taken' })).toBeLessThan(300);
    const first = rowsOf(s.circleId, s.root);
    expect(await answerViaApi(s.ownerSession, s.circleId, s.root, { status: 'skipped' })).toBe(409);
    expect(
      await answerViaApi(s.ownerSession, s.circleId, s.root, {
        status: 'skipped',
        overwrite: true,
        expected_status: 'skipped',
      }),
      'expected_status that is not what is stored'
    ).toBe(409);
    expect(rowsOf(s.circleId, s.root)).toEqual(first);
    expect(
      await answerViaApi(s.ownerSession, s.circleId, s.root, {
        status: 'skipped',
        overwrite: true,
        expected_status: 'taken',
      })
    ).toBeLessThan(300);
    expect(rowsOf(s.circleId, s.root)[0].confirmed_by).toBe(s.owner.userId);
  } finally {
    await deleteSeries(s.ownerSession, s.circleId, s.root);
  }
});
