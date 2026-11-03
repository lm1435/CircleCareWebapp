import type { Page, Route } from '@playwright/test';
import { test, expect } from '../fixtures';
import { sqlExec } from '../db';
import { apiSession, dbCount, dbQuery, sqlStr, type ApiSession } from '../unhappy';
import { dateInZone, recipientTimezone } from '../unhappy/writes/_helpers';
import { dayCell, escapeRegExp, gotoCalendarSettled, stepWeeks, weekOffset } from '../notesFirstClassShared';

// ===========================================================================
// A HEAVY PAYING CIRCLE READS EVERY LOGGED DOSE (scenarios K6, K7, H1).
//
// The customer this models: 25 medications, ~29 doses a day, one circle, who
// cancelled with "Meds didn't save". Doses they logged must read as logged on
// the web Calendar (the `confirmation` embedded in GET /circles/:id/events) and
// on the History tab (GET /medications/confirmations, paged 30 at a time).
//
// Seed (worker's circle, recipient zone from GET /api/circles/:id):
//   - 25 daily medications through the REAL API, 4 of them with a second dose
//     time (sibling root, `refill_group_id` -> the first time's root, exactly
//     what the add form's "Add another time" creates) = 29 series, started
//     T-41, reminders off.
//   - for every day T-40..T-1 a physical child row per series plus ONE
//     confirmation (UNIQUE(event_id, scheduled_time) holds): 29 x 40 = 1160
//     confirmations, over PostgREST's 1000-row cap.
//   - status by (series, day): skipped / taken_late / taken. `confirmed_at`
//     follows the backend's own lateness rule (isConfirmationLate, 30 min):
//     taken = due + 5 min, skipped = due + 10 min, taken_late = 22:30 that
//     evening for EVERY late dose of the day (an evening catch-up: identical
//     `confirmed_at` across series, so the History paging order needs its id
//     tie-break to neither duplicate nor drop).
// The series' start day (T-41) is left unanswered and never asserted on.
//
// FALSIFY (PW_FALSIFY=<name>[,…] makes the app see WRONG data, the test must go red):
//   heavy-drop-confirmation  strip the embedded confirmation off one seeded dose
//                            in every GET /events response (the "first N
//                            confirmations" bug shape)
//   heavy-history-dup-page   answer page 2 of GET /medications/confirmations with
//                            page 1's rows (an unstable paging order)
// ===========================================================================

const FALSIFY = new Set((process.env.PW_FALSIFY ?? '').split(',').filter(Boolean));

const PREFIX_ROOT = 'ZZ_E2E_HEAVY_';
const MED_COUNT = 25;
const SECOND_TIME_MEDS = 4;
const DAYS = 40;
const DAY_UNDER_TEST = -20;

interface Series {
  idx: number;
  id: string;
  name: string;
  time: string; // HH:MM
}

/** 06:00, 06:30 … 18:00 for the 25 first times; 20:00 … 21:30 for the 4 second times. */
function timeFor(minutesFromMidnight: number): string {
  return `${String(Math.floor(minutesFromMidnight / 60)).padStart(2, '0')}:${String(minutesFromMidnight % 60).padStart(2, '0')}`;
}

function purgePrefix(circleId: string, prefixLike: string): void {
  const c = `${sqlStr(circleId)}::uuid`;
  const ids = `select id from calendar_events where circle_id = ${c} and title like ${sqlStr(prefixLike)}`;
  sqlExec(`
    delete from event_notes where event_id in (${ids});
    delete from medication_confirmations where event_id in (${ids});
    delete from calendar_events where circle_id = ${c} and parent_event_id is not null and title like ${sqlStr(prefixLike)};
    delete from calendar_events where circle_id = ${c} and title like ${sqlStr(prefixLike)};
  `);
}

async function createRoot(
  api: ApiSession,
  circleId: string,
  name: string,
  start: string,
  time: string,
  refillGroupId?: string
): Promise<string> {
  const res = await api.post(`/api/circles/${circleId}/events`, {
    event_type: 'medication',
    title: name,
    medication_name: name,
    medication_dosage: '10mg',
    scheduled_date: start,
    scheduled_time: time,
    recurrence_rule: 'daily',
    notifications_enabled: false,
    ...(refillGroupId ? { refill_group_id: refillGroupId, track_refills: false } : {}),
  });
  expect(res.status(), `create ${name} ${time}: ${await res.text()}`).toBe(201);
  return ((await res.json()) as { data: { event: { id: string } } }).data.event.id;
}

/** Seed 29 series + 1160 dosed days. Returns the series. */
async function seedHeavyCircle(api: ApiSession, circleId: string, ownerId: string, tz: string, prefix: string): Promise<Series[]> {
  const today = dateInZone(tz, 0);
  const start = dateInZone(tz, -(DAYS + 1));
  const series: Series[] = [];
  for (let m = 1; m <= MED_COUNT; m++) {
    const name = `${prefix}M${String(m).padStart(2, '0')}`;
    const time = timeFor(6 * 60 + (m - 1) * 30);
    const id = await createRoot(api, circleId, name, start, time);
    series.push({ idx: series.length, id, name, time });
    if (m <= SECOND_TIME_MEDS) {
      const t2 = timeFor(20 * 60 + (m - 1) * 30);
      const id2 = await createRoot(api, circleId, name, start, t2, id);
      series.push({ idx: series.length, id: id2, name, time: t2 });
    }
  }
  expect(series).toHaveLength(MED_COUNT + SECOND_TIME_MEDS);
  // The create materializes nothing in the past: every past dose below is ours.
  const ids = series.map((s) => `${sqlStr(s.id)}::uuid`).join(',');
  expect(
    dbCount(`select 1 from calendar_events where parent_event_id in (${ids}) and scheduled_date < ${sqlStr(today)}::date`),
    'no past child before the seed'
  ).toBe(0);

  const z = sqlStr(tz);
  for (const s of series) {
    sqlExec(`
      with kids as (
        insert into public.calendar_events (circle_id, parent_event_id, event_type, title, medication_name, medication_dosage,
                                            scheduled_date, scheduled_time, recurrence_rule, created_by, notifications_enabled)
        select ${sqlStr(circleId)}::uuid, ${sqlStr(s.id)}::uuid, 'medication', ${sqlStr(s.name)}, ${sqlStr(s.name)}, '10mg',
               (${sqlStr(today)}::date - k), ${sqlStr(s.time)}::time, null, ${sqlStr(ownerId)}::uuid, false
          from generate_series(1, ${DAYS}) k
        returning id, scheduled_date, scheduled_time
      ), graded as (
        select kids.*, (${sqlStr(today)}::date - kids.scheduled_date) as k,
               case when (${s.idx} + (${sqlStr(today)}::date - kids.scheduled_date)) % 7 = 0 then 'skipped'
                    when (${s.idx} + (${sqlStr(today)}::date - kids.scheduled_date)) % 4 = 0 then 'taken_late'
                    else 'taken' end as status
          from kids
      )
      insert into public.medication_confirmations (event_id, circle_id, confirmed_by, confirmed_at, status, scheduled_time)
      select g.id, ${sqlStr(circleId)}::uuid, ${sqlStr(ownerId)}::uuid,
             case g.status
               when 'taken' then ((g.scheduled_date + g.scheduled_time) at time zone ${z}) + interval '5 minutes'
               when 'skipped' then ((g.scheduled_date + g.scheduled_time) at time zone ${z}) + interval '10 minutes'
               else ((g.scheduled_date + time '22:30') at time zone ${z})
             end,
             g.status, g.scheduled_time
        from graded g;
    `);
  }
  expect(
    dbCount(
      `select 1 from medication_confirmations mc join calendar_events ce on ce.id = mc.event_id
        where ce.parent_event_id in (${ids})`
    ),
    'seeded confirmations (over the 1000-row cap)'
  ).toBe((MED_COUNT + SECOND_TIME_MEDS) * DAYS);
  return series;
}

/** The DB's answer for every seeded dose on `date`: name -> sorted display statuses. */
function dbStatusesOn(circleId: string, prefix: string, date: string): Map<string, string[]> {
  const rows = dbQuery<{ name: string; status: string }>(
    `select ce.medication_name as name, mc.status
       from calendar_events ce join medication_confirmations mc on mc.event_id = ce.id
      where ce.circle_id = ${sqlStr(circleId)}::uuid and ce.title like ${sqlStr(`${prefix}%`)}
        and ce.parent_event_id is not null and ce.scheduled_date = ${sqlStr(date)}::date`
  );
  const out = new Map<string, string[]>();
  for (const r of rows) {
    // The Calendar shows taken_late as Taken (getMedicationStatus); the detail says "Taken late at".
    const shown = r.status === 'taken_late' ? 'taken' : r.status;
    out.set(r.name, [...(out.get(r.name) ?? []), shown].sort());
  }
  return out;
}

async function installFalsifiers(page: Page, dropId: string | null): Promise<void> {
  if (FALSIFY.has('heavy-drop-confirmation') && dropId) {
    await page.route(
      (url) => /\/api\/circles\/[^/]+\/events$/.test(url.pathname),
      async (route: Route) => {
        if (route.request().method() !== 'GET') return route.fallback();
        const res = await route.fetch();
        const body = (await res.json()) as { data: { events: { id: string; confirmation?: unknown }[] } };
        for (const e of body.data.events) if (e.id === dropId) e.confirmation = null;
        await route.fulfill({ response: res, json: body });
      }
    );
  }
  if (FALSIFY.has('heavy-history-dup-page')) {
    await page.route(
      (url) => url.pathname.endsWith('/medications/confirmations'),
      async (route: Route) => {
        const u = new URL(route.request().url());
        if (u.searchParams.get('offset') === '30') {
          u.searchParams.set('offset', '0');
          const res = await route.fetch({ url: u.toString() });
          return route.fulfill({ response: res });
        }
        return route.fallback();
      }
    );
  }
}

test.describe('heavy circle (25 meds, 29 doses a day, >1000 logged doses)', () => {
  test.setTimeout(300_000);

  let prefix = '';
  test.afterEach(async ({ circleId }) => {
    if (prefix) purgePrefix(circleId, `${prefix}%`);
  });

  test('every dose logged on a past day reads as logged on the Calendar, and History lists each logged dose once', async ({
    page,
    request,
    account,
    circleId,
  }) => {
    purgePrefix(circleId, `${PREFIX_ROOT}%`); // a crashed earlier run's leftovers in this worker's circle
    prefix = `${PREFIX_ROOT}${Date.now().toString(36)}_`;
    const api = await apiSession(request, account);
    const tz = await recipientTimezone(api, circleId);
    const today = dateInZone(tz, 0);
    const day = dateInZone(tz, DAY_UNDER_TEST);
    const series = await seedHeavyCircle(api, circleId, account.userId, tz, prefix);
    const expected = dbStatusesOn(circleId, prefix, day);
    expect([...expected.values()].flat()).toHaveLength(series.length);
    expect([...expected.values()].flat()).toEqual(expect.arrayContaining(['taken', 'skipped']));

    const dropTarget = dbQuery<{ id: string }>(
      `select id from calendar_events where parent_event_id = ${sqlStr(series[6].id)}::uuid and scheduled_date = ${sqlStr(day)}::date`
    )[0]?.id ?? null;
    await installFalsifiers(page, dropTarget);

    await test.step('Week view: the day holds every seeded dose and none reads "Not marked"', async () => {
      await gotoCalendarSettled(page, circleId);
      await stepWeeks(page, weekOffset(today, day));
      const cell = dayCell(page, day);
      await expect(cell.first()).toBeVisible({ timeout: 20_000 });
      const chips = cell.getByRole('button', { name: new RegExp(`^${escapeRegExp(prefix)}`) });
      await expect(chips).toHaveCount(series.length, { timeout: 25_000 });
      const labels = await chips.evaluateAll((els) => els.map((e) => e.getAttribute('aria-label') ?? ''));
      expect(labels.filter((l) => /Not marked|Pending/.test(l)), 'week chips without an answer').toEqual([]);
    });

    await test.step('Day view: each medication shows exactly the statuses the database holds', async () => {
      const longDate = new Intl.DateTimeFormat('en-US', {
        timeZone: 'UTC',
        weekday: 'long',
        month: 'long',
        day: 'numeric',
      }).format(new Date(`${day}T12:00:00Z`));
      await page.getByRole('button', { name: new RegExp(`^${escapeRegExp(longDate)}$`) }).click();
      await expect(page.getByTestId('day-view')).toBeVisible({ timeout: 20_000 });
      const rows = page.getByTestId('day-event').filter({ hasText: prefix });
      await expect(rows).toHaveCount(series.length, { timeout: 25_000 });
      const seen = await rows.evaluateAll((els) =>
        els.map((e) => ({
          label: e.getAttribute('aria-label') ?? '',
          status: e.getAttribute('data-med-status') ?? '',
        }))
      );
      const shown = new Map<string, string[]>();
      for (const r of seen) {
        const name = r.label.split(',')[0];
        shown.set(name, [...(shown.get(name) ?? []), r.status].sort());
      }
      expect(Object.fromEntries([...shown].sort()), 'Day view status per medication vs the database').toEqual(
        Object.fromEntries([...expected].sort())
      );
      expect(seen.filter((r) => /Not marked/.test(r.label)).map((r) => r.label)).toEqual([]);

      // A taken-late dose says so in its detail.
      const late = dbQuery<{ name: string }>(
        `select ce.medication_name as name from calendar_events ce join medication_confirmations mc on mc.event_id = ce.id
          where ce.circle_id = ${sqlStr(circleId)}::uuid and ce.title like ${sqlStr(`${prefix}%`)}
            and ce.scheduled_date = ${sqlStr(day)}::date and mc.status = 'taken_late'
            and ce.medication_name not in (${series.slice(0, SECOND_TIME_MEDS * 2).map((s) => sqlStr(s.name)).join(',')})
          limit 1`
      )[0];
      if (late) {
        await rows.filter({ hasText: late.name }).click();
        const detail = page.getByRole('dialog');
        await expect(detail.getByText(/^Taken late at /)).toBeVisible({ timeout: 15_000 });
        await page.getByRole('button', { name: 'Close event details' }).click();
      }
    });

    await test.step('History: after paging to the end, one medication lists each logged dose in the window exactly once', async () => {
      await page.goto(`/circles/${circleId}/meds?tab=history`, { waitUntil: 'domcontentloaded' });
      await expect(page.getByTestId('history-confirmation-row').first()).toBeVisible({ timeout: 30_000 });
      const loadMore = page.getByRole('button', { name: 'Load more' });
      for (let i = 0; i < 80; i++) {
        if (!(await loadMore.isVisible())) break;
        const before = await page.getByTestId('history-confirmation-row').count();
        await loadMore.click();
        await expect
          .poll(async () => page.getByTestId('history-confirmation-row').count(), { timeout: 20_000 })
          .toBeGreaterThan(before);
      }
      await expect(loadMore, 'History paged to the end').toBeHidden();

      // The window is the History tab's 30 recipient days by `confirmed_at` (historyQuery.ts).
      const windowStart = dateInZone(tz, -29);
      for (const target of [series[8], series[0]]) {
        // series[8] = M05 (one time a day); series[0] = M01 (two times a day).
        const truth = dbQuery<{ d: string; status: string }>(
          `select ce.scheduled_date::text as d, mc.status from calendar_events ce
             join medication_confirmations mc on mc.event_id = ce.id
            where ce.circle_id = ${sqlStr(circleId)}::uuid and ce.medication_name = ${sqlStr(target.name)}
              and mc.confirmed_at >= (${sqlStr(windowStart)}::date::timestamp at time zone ${sqlStr(tz)})
            order by 1, 2`
        );
        const perDay = target.idx === 0 ? 2 : 1;
        expect(truth.length, `${target.name}: logged doses inside the 30-day window`).toBe(29 * perDay);

        await page.getByRole('button', { name: `View history for ${target.name}` }).first().click();
        await expect(page.getByRole('button', { name: 'Back to all history' })).toBeVisible({ timeout: 15_000 });
        await expect(loadMore).toBeHidden();
        const sections = await page.locator('section:has([data-testid="history-confirmation-row"])').evaluateAll((els) =>
          els.map((s) => ({
            title: s.querySelector('h3')?.textContent?.trim() ?? '',
            pills: [...s.querySelectorAll('[data-testid="history-confirmation-row"]')].map(
              (c) => c.querySelector('span')?.textContent?.trim() ?? ''
            ),
          }))
        );
        const pills = sections.flatMap((s) => s.pills);
        expect(pills.length, `${target.name}: History rows`).toBe(truth.length);
        expect(sections.length, `${target.name}: one section per logged day`).toBe(truth.length / perDay);
        expect(
          sections.filter((s) => s.pills.length !== perDay).map((s) => `${s.title}: ${s.pills.length}`),
          `${target.name}: days with a duplicated or missing row`
        ).toEqual([]);
        const label = (s: string) => (s === 'taken' ? 'Taken' : s === 'taken_late' ? 'Taken late' : 'Skipped');
        expect([...pills].sort(), `${target.name}: status pills vs the database`).toEqual(
          truth.map((t) => label(t.status)).sort()
        );
        await page.getByRole('button', { name: 'Back to all history' }).click();
      }
    });
  });
});
