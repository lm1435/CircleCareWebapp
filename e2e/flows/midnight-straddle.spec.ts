import { test, expect, type Page } from '@playwright/test';
import { CROSS_TZ, gotoCircleWithRecipientZone, loginAs, openCircle } from '../crossTimezoneLogin';
import { assertLocalDbTargets, sqlExec, sqlStr } from '../db';

/**
 * THE CAREGIVER IS STILL ON YESTERDAY. THE APP MUST NOT BE.
 *
 * It is 11pm for a caregiver in Denver. Their care recipient lives in Tokyo,
 * where it is already tomorrow. Every date the app resolves — today's meds,
 * yesterday's meds, the presence window, the calendar's "now" line — belongs to
 * the RECIPIENT's day, because that is the only clock their schedule is
 * filtered on. The caregiver's own midnight is not an event in this system.
 *
 * ── WHY THIS FILE EXISTS ────────────────────────────────────────────────
 *
 * The straddle was already being tested, but only ever by ACCIDENT.
 *
 *   * `useCircle` used to report `'America/New_York'` unconditionally while the
 *     circle detail was still loading, so "still loading" and "really in New
 *     York" were the same value. Every date derived from it landed in a React
 *     Query key, so the app asked for a New-York-dated window, then asked AGAIN
 *     for the recipient's real one. On most days those two windows are the same
 *     string and the bug is invisible. It is visible only when the placeholder
 *     zone and the recipient's zone are on DIFFERENT DAYS.
 *   * The e2e run that first caught it did so because the wall clock happened to
 *     be 22:37 in Denver, with New York already past midnight. An hour earlier
 *     and the suite would have been green.
 *   * The deterministic coverage that followed (the five `*TimezoneGate` unit
 *     tests, `CalendarMidnightRollover`) pins the straddle properly, but in
 *     jsdom, on five hand-picked surfaces.
 *
 * So this is the same straddle, PINNED, in a real browser, against the real
 * backend: `page.clock.setFixedTime` fixes the instant and Playwright's
 * `timezoneId` fixes the viewer, and neither depends on when the suite runs.
 *
 * ── WHAT IS ASSERTED, AND WHY IT IS THE REQUEST AND NOT THE PIXELS ──────
 *
 * The defect's signature is in the WINDOW THE CLIENT ASKS FOR, not in how the
 * answer is drawn: a wrong anchor shifts both ends of the range by a day, and a
 * placeholder anchor produces two ranges where there should be one. Asserting
 * the requests catches it at the point it happens, before any rendering can
 * paper over it. The calendar test then closes the loop on something a person
 * can actually see.
 *
 * ── NOT A TARGET: THE DATE PICKER ───────────────────────────────────────
 *
 * `DatePickerPanel` marks today with `getDateInTimezone(getDeviceTimezone())` —
 * the VIEWER's day, deliberately (its own header explains why: the picker is
 * the caregiver's calendar, and the save converts). Under this spec's clock it
 * will correctly mark the caregiver's yesterday. That is not a bug and must not
 * be "fixed" to match the assertions below.
 */

// ── The pinned instant ───────────────────────────────────────────────────

/**
 * 02:30 UTC. At that hour of any day, Tokyo (+9) is on 11:30 of date D while
 * Denver (-6/-7), New York (-4/-5) and Midway (-11) are all still on D-1 —
 * true on both sides of every DST transition any of them observe, since none
 * is within 2.5h of the date line's own offset.
 *
 * New York is in the list because it is the literal string the old placeholder
 * used. If that fallback ever comes back, the window it dates will be D-1, and
 * every viewer below — including the New York one — expects D.
 */
const PIN_UTC_HOUR = 2;
const PIN_UTC_MINUTE = 30;

/**
 * The most recent 02:30 UTC at or before `now` — so the fake clock is at most
 * 24h BEHIND the real one, and never ahead.
 *
 * The direction matters. `lib/api.ts`'s `isTokenExpiringSoon` compares the
 * session's `expires_at` against `Date.now()`, and the session is minted by a
 * real login against a real backend. Moving the browser's clock BACKWARD makes
 * that token look further from expiry, so nothing refreshes. Moving it FORWARD
 * would make a freshly-issued token look expired and put the client into a
 * refresh loop against a backend that disagrees.
 */
export function mostRecentStraddleInstant(now: Date = new Date()): Date {
  const at = new Date(
    Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate(), PIN_UTC_HOUR, PIN_UTC_MINUTE)
  );
  if (at.getTime() > now.getTime()) at.setUTCDate(at.getUTCDate() - 1);
  return at;
}

/**
 * A calendar date in `zone`, as YYYY-MM-DD.
 *
 * Deliberately NOT `@/utils/timezone`'s `getDateInTimezone`: a test that calls
 * the implementation to compute what it expects can only confirm the code
 * equals itself. (`yesterdayInTimezone.test.ts` records that exact failure —
 * reverting to the broken implementation left it green.) `formatToParts` is an
 * independent derivation straight from Intl.
 */
function dateInZone(zone: string, at: Date): string {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: zone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(at);
  const part = (type: string): string => parts.find((p) => p.type === type)?.value ?? '';
  return `${part('year')}-${part('month')}-${part('day')}`;
}

/**
 * `date` shifted by whole days. Built out of UTC components — never
 * `toISOString().slice(0, 10)` and never a local-time `setDate` — so the
 * arithmetic cannot inherit a DST-shortened day from whatever zone the test
 * process happens to run in.
 */
function shiftDays(date: string, days: number): string {
  const [y, m, d] = date.split('-').map(Number);
  const at = new Date(Date.UTC(y, m - 1, d));
  at.setUTCDate(at.getUTCDate() + days);
  const pad = (n: number): string => String(n).padStart(2, '0');
  return `${at.getUTCFullYear()}-${pad(at.getUTCMonth() + 1)}-${pad(at.getUTCDate())}`;
}

const PINNED = mostRecentStraddleInstant();
/** The care recipient's day. Everything the app resolves must be anchored here. */
const RECIPIENT_TODAY = dateInZone(CROSS_TZ.recipientZone, PINNED);

/**
 * The presence window's span, mirrored from the two components that ask for it
 * (`TodaysMeds.tsx` and `GettingStartedChecklist.tsx`, both `-30` / `+180`, on
 * purpose so they share one cache key). The span is not what this spec is
 * about — the ANCHOR is — but pinning the whole window is what makes a
 * one-day anchor error show up as a failure rather than as a shrug.
 */
const PRESENCE_BACK_DAYS = 30;
const PRESENCE_FORWARD_DAYS = 180;

type Window = { start: string; end: string };

const EXPECTED_PRESENCE: Window = {
  start: shiftDays(RECIPIENT_TODAY, -PRESENCE_BACK_DAYS),
  end: shiftDays(RECIPIENT_TODAY, PRESENCE_FORWARD_DAYS),
};

// ── The one event the week grid needs ─────────────────────────

/**
 * Fixed id so this is an UPSERT, not a new row per run: the tests below are
 * read-only and the `@tz.test` circle is a shared fixture that globalTeardown
 * does not purge (it only removes `e2e-iso-*` accounts).
 */
const STRADDLE_EVENT_ID = '5b7d1f3a-9c24-4e18-b0a6-1d7c2f84e930';

/**
 * `CalendarPage` renders the week GRID only when `events.length > 0` — an empty
 * week gets an EmptyState card instead, and the current-time indicator lives
 * inside the grid. The seeded cross-timezone circle carries no events at all,
 * so without this the calendar assertion could never run.
 *
 * An APPOINTMENT rather than a medication, deliberately: `TodaysMeds` and
 * `GettingStartedChecklist` both branch on the presence read's `medication`
 * flag, and this spec asserts on the reads those two components make. An
 * appointment puts an event in the week without moving anything the other
 * tests are watching.
 *
 * Dated on the RECIPIENT's day, which moves with the real calendar (`PINNED` is
 * derived from the current date), hence `do update` on the date.
 */
function ensureStraddleAppointment(): void {
  assertLocalDbTargets('to seed the midnight-straddle calendar event');
  sqlExec(`
    insert into calendar_events
      (id, circle_id, event_type, title, scheduled_date, scheduled_time, duration_minutes, created_by)
    select ${sqlStr(STRADDLE_EVENT_ID)}::uuid, c.id, 'appointment', 'Straddle probe',
           ${sqlStr(RECIPIENT_TODAY)}::date, '10:00', 30, c.owner_id
      from care_circles c
      join public.users o on o.id = c.owner_id
     where o.email = ${sqlStr(CROSS_TZ.ownerEmail)}
       and c.recipient_name = ${sqlStr(CROSS_TZ.circleName)}
       and c.archived_at is null
    on conflict (id) do update
       set circle_id      = excluded.circle_id,
           scheduled_date = excluded.scheduled_date;
  `);
}

test.beforeAll(() => {
  ensureStraddleAppointment();
});

// ── Request capture ──────────────────────────────────────────────────────

type Captured = { presence: Window[]; medications: Window[] };

/**
 * Record every date-anchored read the page makes, from BEFORE the first
 * navigation — the placeholder fired its extra request during the very first
 * render, while the circle detail was still in flight, so a listener attached
 * after login would miss the only moment that matters.
 *
 * Windows are collected as a list and compared as a SET by the tests, which
 * keeps them indifferent to how many times the SPA boots (`openCircle` lands on
 * the overview, then `gotoCircleWithRecipientZone` loads it again). Two
 * requests for the same window are one cache key; two requests for DIFFERENT
 * windows are the bug.
 */
function captureDateReads(page: Page, circleIdRef: { current: string | null }): Captured {
  const captured: Captured = { presence: [], medications: [] };

  page.on('request', (request) => {
    if (request.method() !== 'GET') return;
    let url: URL;
    try {
      url = new URL(request.url());
    } catch {
      return;
    }
    const start = url.searchParams.get('start_date');
    const end = url.searchParams.get('end_date');
    if (!start || !end) return;

    const id = circleIdRef.current;
    if (id && !url.pathname.startsWith(`/api/circles/${id}/`)) return;

    if (url.pathname.endsWith('/events/presence')) {
      captured.presence.push({ start, end });
    } else if (
      url.pathname.endsWith('/events') &&
      url.searchParams.get('event_type') === 'medication'
    ) {
      captured.medications.push({ start, end });
    }
  });

  return captured;
}

function distinct(windows: Window[]): Window[] {
  const seen = new Map<string, Window>();
  for (const w of windows) seen.set(`${w.start}..${w.end}`, w);
  return [...seen.values()].sort((a, b) => a.start.localeCompare(b.start));
}

/**
 * Let the page go quiet before asserting that a SECOND request never happened.
 * An absence is only meaningful after the network has stopped; `networkidle` is
 * the one wait that means exactly that.
 */
async function settle(page: Page): Promise<void> {
  await page.waitForLoadState('networkidle', { timeout: 30_000 });
}

/**
 * Prove the straddle is real INSIDE THE BROWSER, not merely in this file's
 * arithmetic. If `setFixedTime` silently failed to apply, or the project's
 * `timezoneId` were overridden, the two dates would agree and every assertion
 * below would pass for the wrong reason.
 */
async function assertBrowserIsStraddling(page: Page, viewerZone: string): Promise<void> {
  const seen = await page.evaluate(
    ({ recipientZone, viewer }) => {
      const iso = (zone: string): string => {
        const parts = new Intl.DateTimeFormat('en-US', {
          timeZone: zone,
          year: 'numeric',
          month: '2-digit',
          day: '2-digit',
        }).formatToParts(new Date());
        const part = (type: string): string => parts.find((p) => p.type === type)?.value ?? '';
        return `${part('year')}-${part('month')}-${part('day')}`;
      };
      return { recipient: iso(recipientZone), viewer: iso(viewer) };
    },
    { recipientZone: CROSS_TZ.recipientZone, viewer: viewerZone }
  );

  expect(
    seen.recipient,
    `the browser's clock is not pinned: ${CROSS_TZ.recipientZone} should read ${RECIPIENT_TODAY}`
  ).toBe(RECIPIENT_TODAY);
  expect(
    seen.viewer,
    `${viewerZone} should still be on the previous day at ${PINNED.toISOString()} — ` +
      `without that there is no straddle and this spec proves nothing`
  ).toBe(shiftDays(RECIPIENT_TODAY, -1));
}

/** Pin the clock, then open the circle. Login runs on the REAL clock first. */
async function arrive(page: Page, viewerZone: string): Promise<{ circleId: string }> {
  await loginAs(page);
  await page.clock.setFixedTime(PINNED);
  const circleId = await openCircle(page);
  await gotoCircleWithRecipientZone(page, circleId);
  await assertBrowserIsStraddling(page, viewerZone);
  return { circleId };
}

// ── Tests ────────────────────────────────────────────────────────────────

/**
 * All three are on the recipient's YESTERDAY at the pinned instant. Denver is
 * the dev machine, New York is the old placeholder, Midway (-11) is the widest
 * gap the app plausibly sees.
 */
const VIEWER_ZONES = ['America/Denver', 'America/New_York', 'Pacific/Midway'];

for (const timezoneId of VIEWER_ZONES) {
  test.describe(`caregiver in ${timezoneId}, recipient already on tomorrow`, () => {
    test.use({ timezoneId, storageState: { cookies: [], origins: [] } });

    test('asks for ONE presence window, anchored on the recipient’s day', async ({ page }) => {
      const circleIdRef: { current: string | null } = { current: null };
      const captured = captureDateReads(page, circleIdRef);

      const { circleId } = await arrive(page, timezoneId);
      circleIdRef.current = circleId;
      await settle(page);

      // Positive precondition: something was actually asked. Without it the
      // set comparison below would be satisfied by a page that never loaded.
      expect(
        captured.presence.length,
        'the overview made no presence read at all — the assertion below would be vacuous'
      ).toBeGreaterThan(0);

      /**
       * Exactly ONE window, and it is the recipient's.
       *
       * A viewer-anchored read would be [D-31, D+179]; the placeholder bug
       * produced BOTH that and [D-30, D+180], which is why this compares the
       * distinct set rather than just the last request.
       */
      expect(
        distinct(captured.presence),
        `presence was read for a window that is not the recipient's. Viewer ${timezoneId} is on ` +
          `${shiftDays(RECIPIENT_TODAY, -1)}; the recipient (${CROSS_TZ.recipientZone}) is on ` +
          `${RECIPIENT_TODAY}, and every read must be anchored there. More than one window means ` +
          `a placeholder zone dated one of them.`
      ).toEqual([EXPECTED_PRESENCE]);
    });

    test('reads today’s medications for the recipient’s day', async ({ page }) => {
      const circleIdRef: { current: string | null } = { current: null };
      const captured = captureDateReads(page, circleIdRef);

      const { circleId } = await arrive(page, timezoneId);
      circleIdRef.current = circleId;
      await settle(page);

      const windows = distinct(captured.medications);
      expect(
        windows.length,
        'the overview made no medication read at all — the assertions below would be vacuous'
      ).toBeGreaterThan(0);

      /**
       * `TodaysMeds` reads TWO single days: the recipient's today, and the
       * recipient's yesterday (the "Needs attention" group). So the legitimate
       * set is {D-1, D} — and note that D-1 is ALSO the viewer's today, which
       * is exactly why "no request mentions the viewer's date" would be the
       * wrong assertion here. What a viewer-anchored app would produce is the
       * set shifted down a day: {D-2, D-1}. Hence: D must be present, and
       * D-2 must not.
       */
      const days = windows.map((w) => {
        expect(w.end, 'a medication read spanned more than one day').toBe(w.start);
        return w.start;
      });
      expect(
        days,
        `today's medications were not read for the recipient's day (${RECIPIENT_TODAY})`
      ).toContain(RECIPIENT_TODAY);
      expect(
        days,
        `a medication read was anchored on the viewer's yesterday — the whole window slid back a day`
      ).not.toContain(shiftDays(RECIPIENT_TODAY, -2));
    });

    test('puts the calendar’s now-line in the recipient’s day column', async ({ page }) => {
      await loginAs(page);
      await page.clock.setFixedTime(PINNED);
      const circleId = await openCircle(page);
      await gotoCircleWithRecipientZone(page, circleId, '/calendar');
      await assertBrowserIsStraddling(page, timezoneId);

      /**
       * The one piece of this a person can see. `WeekView` renders the
       * current-time indicator in today's column only, and "today" there is
       * `CalendarPage`'s `todayStr` — resolved in the recipient's zone. Its
       * gridcell carries `data-date`, so the column it landed in can be read
       * back directly.
       *
       * Asserted by ATTACHMENT, not visibility: the indicator sits at
       * hour-of-day × 60px inside a 24-hour column, which at the recipient's
       * 11:30 is below the fold until something scrolls.
       */
      const nowLine = page.getByTestId('current-time-indicator');
      await expect(
        nowLine,
        'the week grid never rendered a current-time indicator'
      ).toBeAttached({ timeout: 20_000 });

      const column = page.locator('[role="gridcell"]').filter({ has: nowLine });
      await expect(
        column,
        `the "now" line is in the wrong day's column: the caregiver in ${timezoneId} is on ` +
          `${shiftDays(RECIPIENT_TODAY, -1)}, but the calendar belongs to the recipient in ` +
          `${CROSS_TZ.recipientZone}, who is on ${RECIPIENT_TODAY}`
      ).toHaveAttribute('data-date', RECIPIENT_TODAY);
    });
  });
}

/**
 * The control. With the viewer in the recipient's own zone there is no straddle
 * — the app cannot get the anchor wrong, because both candidates are the same
 * day. It must still ask for the same window, which is what makes the failures
 * above attributable to the STRADDLE rather than to anything else about these
 * three viewer zones.
 */
test.describe('caregiver in the recipient’s own zone (control)', () => {
  test.use({ timezoneId: CROSS_TZ.recipientZone, storageState: { cookies: [], origins: [] } });

  test('asks for the same presence window when there is no straddle', async ({ page }) => {
    const circleIdRef: { current: string | null } = { current: null };
    const captured = captureDateReads(page, circleIdRef);

    await loginAs(page);
    await page.clock.setFixedTime(PINNED);
    const circleId = await openCircle(page);
    circleIdRef.current = circleId;
    await gotoCircleWithRecipientZone(page, circleId);
    await settle(page);

    expect(captured.presence.length, 'no presence read was made').toBeGreaterThan(0);
    expect(distinct(captured.presence)).toEqual([EXPECTED_PRESENCE]);
  });
});
