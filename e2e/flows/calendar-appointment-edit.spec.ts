import type { APIRequestContext, BrowserContext, Locator, Page } from '@playwright/test';
import { test, expect } from '../fixtures';
import {
  addDaysISO,
  assertChipAbsent,
  assertChipPresent,
  circleTimezone,
  dateInTz,
  escapeRegExp,
  gotoWeekContaining,
  openChip,
  uniqueSuffix,
  weekOffset,
} from '../notesFirstClassShared';
import { countRequests, dbQuery, failRequest, sqlStr, type ApiSession } from '../unhappy';
import { apiCreateEvent, errorToast } from '../unhappy/writes/_helpers';
import {
  captureJson,
  cookieLogin,
  createCircle,
  createScopedAccount,
  ownerApi,
  uniq,
} from '../unhappy/auth-invites/_helpers';

// K14 (docs/plans/web-test-gaps-2026-09-29-reviewed.md): editing a recurring
// appointment and deleting one occurrence / the future of the series, against
// the real backend.
//
// WEB HAS NO EDIT SCOPE. The PATCH carries none by design
// (api/calendarEvents.ts:473): an edit always applies to the SERIES. Scope
// exists for DELETE only. So (a) pins series semantics; (b)/(b2)/(c) drive the
// delete scope radios. "This appointment only" is a tombstone (PK20; it was a
// 400 NOT_SUPPORTED before the backend learned to remove one occurrence).
//
// TIMEZONES. Every date is computed in the CARE RECIPIENT's zone (the frame the
// calendar renders in), never from the runner's clock. PW_E2E_TZ puts the
// BROWSER in a different zone than the recipient (America/Denver for a scoped
// account): a viewer-frame bug shows up as a chip on the wrong day.
if (process.env.PW_E2E_TZ) test.use({ timezoneId: process.env.PW_E2E_TZ });

async function moreMenu(page: Page, detail: Locator, item: 'Edit event' | 'Delete'): Promise<void> {
  await detail.getByRole('button', { name: 'More', exact: true }).click();
  await page.getByRole('menuitem', { name: item, exact: true }).click();
}

interface Seed {
  api: ApiSession;
  circleId: string;
  tz: string;
  today: string;
  at: (n: number) => string;
  A: string;
  B: string;
  C: string;
  reA: RegExp;
  reB: RegExp;
  rootId: string;
  rootRow: () => {
    title: string;
    scheduled_time: string;
    scheduled_date: string;
    recurrence_end_date: string | null;
    duration_minutes: number | null;
  };
}

/** A scoped owner (never the worker's account) with a fresh circle and a weekly appointment that started 14 days ago. */
async function seed(page: Page, context: BrowserContext, request: APIRequestContext, baseURL: string | undefined): Promise<Seed> {
  const owner = await createScopedAccount('apptedit');
  const api = await ownerApi(request, owner);
  const circleId = await createCircle(api, uniq('apptedit'));
  const tz = await circleTimezone(api, circleId);
  const today = dateInTz(tz, 0);
  const at = (n: number) => addDaysISO(today, n);
  const sfx = uniqueSuffix();
  const A = `ZZ_E2E_APPTA_${sfx}`;
  const B = `ZZ_E2E_APPTB_${sfx}`;
  const C = `ZZ_E2E_APPTC_${sfx}`;
  const root = await apiCreateEvent(api, circleId, {
    event_type: 'appointment',
    title: A,
    scheduled_date: at(-14),
    scheduled_time: '10:00',
    duration_minutes: 30,
    recurrence_rule: 'weekly',
  });
  // After the `page` fixture (which logs in the worker account) has run.
  void page;
  await cookieLogin(context, owner, baseURL);
  return {
    api,
    circleId,
    tz,
    today,
    at,
    A,
    B,
    C,
    reA: new RegExp(escapeRegExp(A)),
    reB: new RegExp(escapeRegExp(B)),
    rootId: root.id,
    rootRow: () =>
      dbQuery<{
        title: string;
        scheduled_time: string;
        scheduled_date: string;
        recurrence_end_date: string | null;
        duration_minutes: number | null;
      }>(
        `select title, scheduled_time::text as scheduled_time, scheduled_date::text as scheduled_date, recurrence_end_date::text as recurrence_end_date, duration_minutes
           from calendar_events where id = ${sqlStr(root.id)}::uuid`
      )[0],
  };
}

/** Offset (ms) of `tz` from UTC at the instant `utcMs`. */
function zoneOffsetMs(tz: string, utcMs: number): number {
  const parts = Object.fromEntries(
    new Intl.DateTimeFormat('en-US', {
      timeZone: tz,
      hourCycle: 'h23',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
    })
      .formatToParts(new Date(utcMs))
      .map((p) => [p.type, p.value])
  );
  const wall = Date.UTC(+parts.year, +parts.month - 1, +parts.day, +parts.hour, +parts.minute, +parts.second);
  return wall - Math.floor(utcMs / 1000) * 1000;
}

/** The instant a wall clock (`date` + `hhmm`) shows in `tz`. */
function instantOf(date: string, hhmm: string, tz: string): number {
  const [y, m, d] = date.split('-').map(Number);
  const [h, mi] = hhmm.split(':').map(Number);
  const guess = Date.UTC(y, m - 1, d, h, mi);
  return guess - zoneOffsetMs(tz, guess - zoneOffsetMs(tz, guess));
}

/** `{ date, hhmm }` the instant shows in `tz`. */
function wallIn(instant: number, tz: string): { date: string; hhmm: string } {
  const parts = Object.fromEntries(
    new Intl.DateTimeFormat('en-CA', {
      timeZone: tz,
      hourCycle: 'h23',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
    })
      .formatToParts(new Date(instant))
      .map((p) => [p.type, p.value])
  );
  return { date: `${parts.year}-${parts.month}-${parts.day}`, hhmm: `${parts.hour}:${parts.minute}` };
}

const WEEK_RANGE = /^[A-Z][a-z]{2} \d{1,2} – [A-Z][a-z]{2} \d{1,2}, \d{4}$/;

/**
 * Go to the week containing `date` and assert the chip titled `titleRe` is NOT
 * on that day. A week with nothing left in it renders "No events this week"
 * instead of a grid, and that is a valid absence: `assertChipAbsent` insists on
 * a rendered day cell and would fail on the very state being asserted.
 */
async function expectGoneOnDay(page: Page, k: Seed, date: string, titleRe: RegExp): Promise<void> {
  await page.goto(`/circles/${k.circleId}/calendar`, { waitUntil: 'domcontentloaded' });
  const range = page.getByRole('heading', { level: 2, name: WEEK_RANGE });
  await expect(range).toBeVisible({ timeout: 25_000 });
  const weeks = weekOffset(k.today, date);
  for (let i = 0; i < Math.abs(weeks); i += 1) {
    const before = (await range.textContent())?.trim() ?? '';
    await page.getByRole('button', { name: weeks < 0 ? 'Previous week' : 'Next week' }).click();
    await expect(range).not.toHaveText(before, { timeout: 25_000 });
  }
  const empty = page.getByText('No events this week');
  const cell = page.locator(`[role="gridcell"][data-date="${date}"]`).first();
  await expect(empty.or(cell)).toBeVisible({ timeout: 25_000 });
  await expect(page.locator(`[role="gridcell"][data-date="${date}"]`).getByRole('button', { name: titleRe })).toHaveCount(0);
}

async function openDeleteDialog(page: Page, k: Seed, date: string, titleRe: RegExp): Promise<Locator> {
  await gotoWeekContaining(page, k.circleId, k.today, date);
  const detail = await openChip(page, date, titleRe);
  await moreMenu(page, detail, 'Delete');
  const del = page.getByRole('dialog', { name: 'Delete appointment' });
  await expect(del).toBeVisible({ timeout: 10_000 });
  return del;
}

test.describe('recurring appointment: edit + delete scope', () => {
  test.setTimeout(120_000);

  test('(a) editing an occurrence edits the SERIES (web has no edit scope)', async ({ page, context, request, baseURL }) => {
    const k = await seed(page, context, request, baseURL);
    await gotoWeekContaining(page, k.circleId, k.today, k.at(0));
    const detail = await openChip(page, k.at(0), k.reA);
    await moreMenu(page, detail, 'Edit event');
    const edit = page.getByRole('dialog', { name: 'Edit event' });
    await expect(edit).toBeVisible();
    await expect(edit.getByText('This event repeats. Changes you save here will apply to the whole series.')).toBeVisible();
    // The form hydrates its schedule from the series ROOT, which it may still be
    // fetching (AddEventModal `seriesRootPending`): the date/time fields are empty
    // until it lands. Wait for that, or the edit races the hydration.
    await expect(edit.locator('#scheduled_date')).not.toHaveValue('', { timeout: 20_000 });
    // The form's date/time fields are in the VIEWER's frame and are converted to
    // the recipient's on save. With PW_E2E_TZ the two differ, so the stored time is
    // the recipient-frame reading of "11:00 on the viewer's clock", not '11:00'.
    const viewerTz = await page.evaluate(() => Intl.DateTimeFormat().resolvedOptions().timeZone);
    const rootViewerDate = wallIn(instantOf(k.at(-14), '10:00', k.tz), viewerTz).date;
    const expectedStored = wallIn(instantOf(rootViewerDate, '11:00', viewerTz), k.tz);
    await edit.locator('#title').fill(k.B);
    await edit.locator('#scheduled_time').fill('11:00');
    // PK21: moving the start moves the end (the 30-minute duration is kept), so
    // the end is NOT touched here. It used to be refused (10:30 < 11:00) and
    // the test had to move both fields by hand.
    await expect(edit.locator('#endTime')).toHaveValue('11:30');
    await edit.getByRole('button', { name: 'Save changes' }).click();
    await expect(edit).toBeHidden({ timeout: 20_000 });
    expect(k.rootRow().duration_minutes, 'the duration survived the move').toBe(30);

    await expect.poll(() => k.rootRow().title, { timeout: 15_000 }).toBe(k.B);
    expect(k.rootRow().scheduled_time).toBe(`${expectedStored.hhmm}:00`);
    expect(k.rootRow().scheduled_date, 'the series anchor date did not move').toBe(k.at(-14));
    // No detached "this occurrence only" copy carrying the old title.
    expect(
      dbQuery(`select 1 from calendar_events where parent_event_id = ${sqlStr(k.rootId)}::uuid and title = ${sqlStr(k.A)}`)
    ).toHaveLength(0);
    // Series semantics: last week's occurrence reads the new title too.
    await gotoWeekContaining(page, k.circleId, k.today, k.at(-7));
    await assertChipPresent(page, k.at(-7), k.reB);
    await assertChipAbsent(page, k.at(-7), k.reA);
  });

  test('(b) "This appointment only" removes just +7 (one tombstone at (root, +7)) and keeps 0 and +14', async ({
    page,
    context,
    request,
    baseURL,
  }) => {
    // PK20 (docs/plans/appointment-delete-single-occurrence.md): this used to be
    // pinned as a 400 NOT_SUPPORTED refusal (and this test as `test.fail()`).
    // The backend now tombstones the occurrence (`removed_at`) exactly like
    // "This dose only" on a medication.
    const k = await seed(page, context, request, baseURL);
    const del = await openDeleteDialog(page, k, k.at(7), k.reA);
    await del.getByRole('radio', { name: 'This appointment only' }).check();
    const responses = await captureJson(page, 'DELETE', '/api/circles/:id/events/:eventId');
    await del.getByRole('button', { name: 'Delete', exact: true }).click();
    const res = await responses.next();
    expect(res.status).toBe(200);
    expect(res.json?.data?.message).toBe('Instance removed successfully');
    await responses.dispose();
    await expect(del).toBeHidden({ timeout: 10_000 });

    // EXACTLY ONE tombstone, at (root, +7), stamped; the series was NOT ended.
    const tombstones = dbQuery<{ scheduled_date: string; removed_by: string | null }>(
      `select scheduled_date::text as scheduled_date, removed_by::text as removed_by
         from calendar_events
        where parent_event_id = ${sqlStr(k.rootId)}::uuid and removed_at is not null`
    );
    expect(tombstones).toHaveLength(1);
    expect(tombstones[0].scheduled_date).toBe(k.at(7));
    expect(tombstones[0].removed_by).toBeTruthy();
    expect(k.rootRow().recurrence_end_date, 'a single delete must not end the series').toBeNull();

    await expectGoneOnDay(page, k, k.at(7), k.reA);
    await gotoWeekContaining(page, k.circleId, k.today, k.at(14));
    await assertChipPresent(page, k.at(14), k.reA);
    await gotoWeekContaining(page, k.circleId, k.today, k.at(0));
    await assertChipPresent(page, k.at(0), k.reA);
  });

  test('(b2) "This appointment only" on the series START date (-14) removes only -14; the root is unchanged and -7 stays', async ({
    page,
    context,
    request,
    baseURL,
  }) => {
    const k = await seed(page, context, request, baseURL);
    const rootBefore = k.rootRow();
    const del = await openDeleteDialog(page, k, k.at(-14), k.reA);
    await del.getByRole('radio', { name: 'This appointment only' }).check();
    await del.getByRole('button', { name: 'Delete', exact: true }).click();
    await expect(del).toBeHidden({ timeout: 10_000 });

    // The ROOT is byte-for-byte what it was (title, anchor date, time, no end date);
    // the removal lives on a NEW tombstoned child at the start date.
    expect(k.rootRow()).toEqual(rootBefore);
    expect(rootBefore.scheduled_date).toBe(k.at(-14));
    const tombstones = dbQuery<{ scheduled_date: string }>(
      `select scheduled_date::text as scheduled_date from calendar_events
        where parent_event_id = ${sqlStr(k.rootId)}::uuid and removed_at is not null`
    );
    expect(tombstones.map((t) => t.scheduled_date)).toEqual([k.at(-14)]);
    expect(
      dbQuery(`select 1 from calendar_events where id = ${sqlStr(k.rootId)}::uuid and removed_at is not null`),
      'removed_at is never stamped on the series root'
    ).toHaveLength(0);

    await expectGoneOnDay(page, k, k.at(-14), k.reA);
    await gotoWeekContaining(page, k.circleId, k.today, k.at(-7));
    await assertChipPresent(page, k.at(-7), k.reA);
  });

  test('(c) "This and all future appointments" from +14 ends the series before +14', async ({ page, context, request, baseURL }) => {
    const k = await seed(page, context, request, baseURL);
    const del = await openDeleteDialog(page, k, k.at(14), k.reA);
    await del.getByRole('radio', { name: 'This and all future appointments' }).check();
    await del.getByRole('button', { name: 'Delete', exact: true }).click();
    await expect(del).toBeHidden({ timeout: 20_000 });
    await expectGoneOnDay(page, k, k.at(14), k.reA);
    await expectGoneOnDay(page, k, k.at(21), k.reA);
    await gotoWeekContaining(page, k.circleId, k.today, k.at(-7));
    await assertChipPresent(page, k.at(-7), k.reA);
    await gotoWeekContaining(page, k.circleId, k.today, k.at(0));
    await assertChipPresent(page, k.at(0), k.reA);
    // The root survives, and the series now ENDS the day before the chosen
    // occurrence (pinned exactly).
    const ended = k.rootRow();
    expect(ended, 'the series root still exists').toBeTruthy();
    expect(ended.recurrence_end_date).toBe(k.at(13));
  });

  test('(e) PK21: moving a late start across midnight keeps the duration (wraps, never clamps)', async ({
    page,
    context,
    request,
    baseURL,
  }) => {
    const k = await seed(page, context, request, baseURL);
    await gotoWeekContaining(page, k.circleId, k.today, k.at(0));
    const detail = await openChip(page, k.at(0), k.reA);
    await moreMenu(page, detail, 'Edit event');
    const edit = page.getByRole('dialog', { name: 'Edit event' });
    await expect(edit).toBeVisible();
    await expect(edit.locator('#scheduled_date')).not.toHaveValue('', { timeout: 20_000 });
    await edit.locator('#scheduled_time').fill('23:45');
    // 30 minutes after 23:45 is 00:15 the next day: the end wraps, it is not
    // clamped to 23:59 (which would silently shorten the appointment to 14 min).
    await expect(edit.locator('#endTime')).toHaveValue('00:15');
    await edit.getByRole('button', { name: 'Save changes' }).click();
    await expect(edit).toBeHidden({ timeout: 20_000 });
    await expect.poll(() => k.rootRow().duration_minutes, { timeout: 15_000 }).toBe(30);
  });

  test('(f) PK21: an appointment stored WITHOUT a duration saves on edit with no end time', async ({
    page,
    context,
    request,
    baseURL,
  }) => {
    const k = await seed(page, context, request, baseURL);
    const D = `ZZ_E2E_APPTD_${uniqueSuffix()}`;
    const E = `${D}_EDITED`;
    const row = await apiCreateEvent(k.api, k.circleId, {
      event_type: 'appointment',
      title: D,
      scheduled_date: k.at(1),
      scheduled_time: '15:00',
    });
    expect(
      dbQuery<{ duration_minutes: number | null }>(
        `select duration_minutes from calendar_events where id = ${sqlStr(row.id)}::uuid`
      )[0].duration_minutes,
      'seeded without a duration'
    ).toBeNull();
    await gotoWeekContaining(page, k.circleId, k.today, k.at(1));
    const detail = await openChip(page, k.at(1), new RegExp(escapeRegExp(D)));
    await moreMenu(page, detail, 'Edit event');
    const edit = page.getByRole('dialog', { name: 'Edit event' });
    await expect(edit).toBeVisible();
    await expect(edit.locator('#scheduled_date')).not.toHaveValue('', { timeout: 20_000 });
    // No end is invented, and none is demanded.
    await expect(edit.locator('#endTime')).toHaveValue('');
    await edit.locator('#title').fill(E);
    await edit.getByRole('button', { name: 'Save changes' }).click();
    await expect(edit).toBeHidden({ timeout: 20_000 });
    await expect
      .poll(
        () => dbQuery<{ title: string }>(`select title from calendar_events where id = ${sqlStr(row.id)}::uuid`)[0].title,
        { timeout: 15_000 }
      )
      .toBe(E);
    expect(
      dbQuery<{ duration_minutes: number | null }>(
        `select duration_minutes from calendar_events where id = ${sqlStr(row.id)}::uuid`
      )[0].duration_minutes,
      'still no duration after the edit'
    ).toBeNull();
  });

  test('(d) PATCH 500: the modal stays with the typed title, nothing saved, the retry saves (2 PATCHes)', async ({
    page,
    context,
    request,
    baseURL,
  }) => {
    const k = await seed(page, context, request, baseURL);
    await gotoWeekContaining(page, k.circleId, k.today, k.at(0));
    const detail = await openChip(page, k.at(0), k.reA);
    await moreMenu(page, detail, 'Edit event');
    const edit = page.getByRole('dialog', { name: 'Edit event' });
    await expect(edit).toBeVisible();
    await expect(edit.locator('#scheduled_date')).not.toHaveValue('', { timeout: 20_000 });
    const patches = countRequests(page, 'PATCH', '/api/circles/:id/events/:eventId');
    const fault = await failRequest(page, 'PATCH', '/api/circles/:id/events/:eventId', { status: 500 });
    await edit.locator('#title').fill(k.C);
    await edit.getByRole('button', { name: 'Save changes' }).click();
    await fault.expectHits(1);
    await expect(errorToast(page, "Couldn't save your changes. Please try again.")).toHaveCount(1, { timeout: 10_000 });
    await expect(edit).toBeVisible();
    await expect(edit.locator('#title')).toHaveValue(k.C);
    expect(k.rootRow().title, 'the failed PATCH wrote nothing').toBe(k.A);
    await edit.getByRole('button', { name: 'Save changes' }).click();
    await expect(edit).toBeHidden({ timeout: 20_000 });
    await expect.poll(() => k.rootRow().title, { timeout: 15_000 }).toBe(k.C);
    await patches.expectCount(2);
  });
});
