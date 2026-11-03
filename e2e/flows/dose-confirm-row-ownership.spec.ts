import type { BrowserContext, Page, Request } from '@playwright/test';
import { test, expect } from '../fixtures';
import { sqlExec, sqlStr } from '../db';
import { dbQuery } from '../unhappy';
import {
  addDaysISO,
  createDailyMedication,
  dateInTz,
  escapeRegExp,
  gotoWeekContaining,
  materializeRecurringInstances,
  openChip,
  uniqueSuffix,
} from '../notesFirstClassShared';
import {
  cookieLogin,
  createCircle,
  createScopedAccount,
  ownerApi,
  uniq,
  type ScopedAccount,
} from '../unhappy/auth-invites/_helpers';

// WHICH ROW A DOSE CONFIRMATION BELONGS TO, as the web reads it back (1.4.0).
//
// medication_confirmations is UNIQUE(event_id, scheduled_time) with NO date, and
// GET /events embeds a dose's confirmation by (row id, row time). Three backend
// fixes keep a confirmation on the row the client will look it up on:
//
//   N2 (backend b37faa6): a STALE screen confirms a materialized dose by its own
//       (plain) id with the time it showed; another member had moved that
//       dose's time meanwhile. The confirmation used to be keyed on the CLIENT's
//       time, so the Taken answer was a 201 that read back untaken. It is now
//       keyed on the row's own time.
//   N3 (backend b37faa6): a STALE screen confirms a series' FIRST-DAY dose by
//       the plain ROOT id; meanwhile a series time edit froze that day into its
//       own child (seriesStartFreeze). The confirmation used to land on the
//       root, which GET suppresses on that day — invisible. It now goes to the
//       live start-date child.
//   601745b: the web circle card's "taken today" (GET .../medications/today
//       summary). The root's start-date confirmation was handed to every
//       UNMATERIALIZED date of the series (they carry the template's id), so a
//       series answered yesterday read "All medications taken" today.
//
// Scoped owner + own circle per test; the recipient zone (= the owner's
// users.timezone) is pinned to the browser's. The "another member" writes are
// made straight to the local DB / API between opening and saving the dialog.
//
// FALSIFY: run against a backend with b37faa6 (N2, N3) / 601745b (card)
// reverted (scratch `git archive` + `git apply -R`): each test goes red on its
// read-back assertion.

test.use({ storageState: { cookies: [], origins: [] } });

interface Scene {
  owner: ScopedAccount;
  circleId: string;
  tz: string;
  today: string;
  api: Awaited<ReturnType<typeof ownerApi>>;
}

async function arrange(page: Page, context: BrowserContext, request: Parameters<typeof ownerApi>[0], baseURL: string | undefined, tag: string): Promise<Scene> {
  await page.goto('about:blank');
  const tz = await page.evaluate(() => Intl.DateTimeFormat().resolvedOptions().timeZone);
  const owner = await createScopedAccount(tag);
  sqlExec(`update public.users set timezone = ${sqlStr(tz)} where id = ${sqlStr(owner.userId)}::uuid;`);
  const api = await ownerApi(request, owner);
  const circleId = await createCircle(api, uniq(tag));
  await cookieLogin(context, owner, baseURL);
  return { owner, circleId, tz, today: dateInTz(tz, 0), api };
}

/** Minutes past midnight on the recipient's clock right now. */
function minutesNow(tz: string): number {
  const [h, m] = new Intl.DateTimeFormat('en-GB', { timeZone: tz, hour: '2-digit', minute: '2-digit', hourCycle: 'h23' })
    .format(new Date())
    .split(':')
    .map(Number);
  return h * 60 + m;
}

interface Conf {
  event_id: string;
  scheduled_time: string;
  status: string;
}
function confirmationsOfSeries(rootId: string): Conf[] {
  return dbQuery<Conf>(
    `select mc.event_id::text as event_id, mc.scheduled_time::text as scheduled_time, mc.status
       from medication_confirmations mc join calendar_events ce on ce.id = mc.event_id
      where ce.id = ${sqlStr(rootId)}::uuid or ce.parent_event_id = ${sqlStr(rootId)}::uuid
      order by 1, 2`
  );
}
function childOn(rootId: string, date: string): { id: string; scheduled_time: string } | undefined {
  return dbQuery<{ id: string; scheduled_time: string }>(
    `select id::text as id, scheduled_time::text as scheduled_time from calendar_events
      where parent_event_id = ${sqlStr(rootId)}::uuid and scheduled_date = ${sqlStr(date)}
        and removed_at is null and deleted_at is null`
  )[0];
}

/** Open the dose on `date` and its Confirm dialog (left open: the screen goes stale). */
async function openConfirm(page: Page, k: Scene, date: string, name: string) {
  await gotoWeekContaining(page, k.circleId, k.today, date);
  const detail = await openChip(page, date, new RegExp(escapeRegExp(name)));
  await detail.getByRole('button', { name: /^Mark .+ as taken$/ }).click();
  const confirm = page.getByRole('dialog', { name: 'Confirm medication' });
  await expect(confirm).toBeVisible({ timeout: 10_000 });
  return confirm;
}

/** Save the open (stale) dialog; returns the confirm request's body. */
async function saveStale(page: Page, confirm: ReturnType<Page['getByRole']>): Promise<Record<string, unknown>> {
  const req = page.waitForRequest(
    (r: Request) => r.method() === 'POST' && new URL(r.url()).pathname.endsWith('/medications/confirm')
  );
  const res = page.waitForResponse(
    (r) => r.request().method() === 'POST' && new URL(r.url()).pathname.endsWith('/medications/confirm')
  );
  await confirm.getByRole('button', { name: 'Save' }).click();
  const body = ((await req).postDataJSON() ?? {}) as Record<string, unknown>;
  expect((await res).status(), 'the stale Taken is accepted').toBeLessThan(300);
  await expect(confirm).toBeHidden({ timeout: 20_000 });
  return body;
}

/** After a fresh load, the dose on `date` reads as answered: no Mark-taken offer. */
async function expectAnswered(page: Page, k: Scene, date: string, name: string): Promise<void> {
  await gotoWeekContaining(page, k.circleId, k.today, date);
  const detail = await openChip(page, date, new RegExp(escapeRegExp(name)));
  await expect(detail, `${date}: the dose reads as taken`).toContainText(/Taken/, { timeout: 15_000 });
  await expect(detail.getByRole('button', { name: /^Mark .+ as taken$/ })).toHaveCount(0);
}

test('N2: a stale screen marks a dose Taken after another member moved its time; the dose reads back as taken', async ({
  page,
  context,
  request,
  baseURL,
}) => {
  test.setTimeout(120_000);
  const k = await arrange(page, context, request, baseURL, 'confown-n2');
  test.skip(minutesNow(k.tz) < 30, 'needs both 00:05 and 00:20 on the recipient clock to be past');
  const name = `ZZ_E2E_CONFOWN_N2_${uniqueSuffix()}`;
  const rootId = await createDailyMedication(k.api, k.circleId, name, addDaysISO(k.today, -3), { time: '00:05' });
  materializeRecurringInstances();
  const child = childOn(rootId, k.today);
  expect(child, "fixture: today's dose is a materialized row").toBeTruthy();

  const confirm = await openConfirm(page, k, k.today, name);
  // Another member moves THIS dose to 00:20 while the dialog is open.
  sqlExec(`update calendar_events set scheduled_time = '00:20' where id = ${sqlStr(child!.id)}::uuid;`);
  const body = await saveStale(page, confirm);
  expect(body.event_id, 'the stale screen confirms by the row id').toBe(child!.id);
  expect(String(body.scheduled_time).slice(0, 5), 'with the time it showed').toBe('00:05');

  expect(confirmationsOfSeries(rootId), 'keyed on the row and its CURRENT time').toEqual([
    { event_id: child!.id, scheduled_time: '00:20:00', status: expect.stringMatching(/^taken/) },
  ]);
  await expectAnswered(page, k, k.today, name);
});

test("N3: a stale screen marks a series' first-day dose Taken by the root id after a time edit froze that day; the dose reads back as taken", async ({
  page,
  context,
  request,
  baseURL,
}) => {
  test.setTimeout(120_000);
  const k = await arrange(page, context, request, baseURL, 'confown-n3');
  const name = `ZZ_E2E_CONFOWN_N3_${uniqueSuffix()}`;
  const start = addDaysISO(k.today, -2);
  const rootId = await createDailyMedication(k.api, k.circleId, name, start, { time: '08:00' });
  expect(childOn(rootId, start), 'fixture: the first day is the root itself (no child)').toBeUndefined();

  const confirm = await openConfirm(page, k, start, name);
  // Another member moves the SERIES to 09:00: the settled first day is frozen
  // into its own child at the old time.
  const patch = await k.api.patch(`/api/circles/${k.circleId}/events/${rootId}`, { scheduled_time: '09:00' });
  expect(patch.status(), `series time edit: ${await patch.text()}`).toBe(200);
  const frozen = childOn(rootId, start);
  expect(frozen, 'fixture: the edit froze the first day into a child').toBeTruthy();
  expect(frozen!.scheduled_time).toBe('08:00:00');

  const body = await saveStale(page, confirm);
  expect(body.event_id, 'the stale screen confirms by the plain ROOT id').toBe(rootId);

  expect(confirmationsOfSeries(rootId), 'the confirmation went to the live first-day child').toEqual([
    { event_id: frozen!.id, scheduled_time: '08:00:00', status: expect.stringMatching(/^taken/) },
  ]);
  await expectAnswered(page, k, start, name);
});

test("601745b: a series whose first day (yesterday) was answered on the root does not read as taken today on the circle card", async ({
  page,
  context,
  request,
  baseURL,
}) => {
  test.setTimeout(90_000);
  const k = await arrange(page, context, request, baseURL, 'confown-card');
  test.skip(minutesNow(k.tz) >= 23 * 60 + 50, "today's 23:58 dose must still be upcoming");
  const name = `ZZ_E2E_CONFOWN_CARD_${uniqueSuffix()}`;
  const yesterday = addDaysISO(k.today, -1);
  const rootId = await createDailyMedication(k.api, k.circleId, name, yesterday, { time: '23:58' });
  const res = await k.api.post(`/api/circles/${k.circleId}/medications/confirm`, {
    event_id: rootId,
    status: 'taken',
    scheduled_time: '23:58:00',
  });
  expect(res.ok(), `answer the first day: ${await res.text()}`).toBe(true);
  // Today must stay UNMATERIALIZED (the bug's shape): no child row for today.
  sqlExec(
    `delete from calendar_events where parent_event_id = ${sqlStr(rootId)}::uuid and scheduled_date = ${sqlStr(k.today)};`
  );
  expect(confirmationsOfSeries(rootId), "fixture: yesterday's answer sits on the root").toEqual([
    { event_id: rootId, scheduled_time: '23:58:00', status: expect.stringMatching(/^taken/) },
  ]);

  // A second (empty) circle: with only one, /circles goes straight into it.
  await createCircle(k.api, uniq('confown-card2'));
  await page.goto('/circles', { waitUntil: 'domcontentloaded' });
  await expect(page.getByText('0/1 taken today')).toBeVisible({ timeout: 20_000 });
  await expect(page.getByText('All medications taken')).toHaveCount(0);
  expect(childOn(rootId, k.today), 'today was still unmaterialized when the card read it').toBeUndefined();
});
