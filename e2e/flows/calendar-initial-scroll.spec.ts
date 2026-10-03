import type { Page } from '@playwright/test';
import { test, expect } from '../fixtures';
import {
  addDaysISO,
  apiSession,
  circleTimezone,
  dateInTz,
  dayOfWeek,
  gotoCalendarSettled,
  uniqueSuffix,
  type ApiSession,
} from '../notesFirstClassShared';

// WEEK VIEW OPENS WITH ITS LEAD-IN HOUR VISIBLE, UNDER THE PINNED HEAD.
//
// WeekView scrolls the timed grid to one hour above the week's earliest timed
// event. The day-header + all-day block is `sticky top-0` inside the SAME
// scroller, so it covers the top `headHeight` px of the viewport at every
// scrollTop. The scroll offset used to have that height ADDED to it
// (`timedRef.offsetTop + ...`), which hid `headHeight` px of the lead-in
// under the head: with an all-day row the head is 110-210px against an 80px
// lead-in, so the first timed chips slid UNDER it (slivers, and axe's
// `target-size` on the 8 AM dose chips); with no all-day row ~57px of the 80
// were hidden.
//
// jsdom has no layout engine (memory: project_jsdom_geometry_blind), so this
// can only be proven in a real browser: every number below is a
// getBoundingClientRect() of the live page.
//
// Each test seeds its OWN circle through the API (so the week's earliest timed
// event is exactly the one the test chose, not whatever the cloned demo
// circle carries) and puts the interesting events in the week's FIRST column
// (Sunday), which is horizontally in view at scrollLeft 0 on every viewport.
//
// Claims, per viewport (desktop 1280, phone 390, small phone 320):
//   1. the first timed chip is entirely BELOW the pinned head's bottom edge
//      and entirely inside the scroller's visible box;
//   2. the lead-in is whole: the gap between the head's bottom edge and the
//      first chip is one hour (measured from two chips an hour apart, not
//      assumed) — or, when the earliest event is within the first hour of the
//      day and there is nothing above to scroll to, exactly its own offset;
//   3. when the earliest event is so late that the grid cannot scroll that
//      far, the browser's clamp must still leave the chip fully in view.

const PREFIX = 'ZZ_E2E_SCROLL_';
const EPS = 1;
// Optional: PW_SCROLL_SCREENSHOT_DIR=<dir> writes one PNG of the scroller per
// scenario and viewport, for looking at what the numbers describe.
const SHOTS = process.env.PW_SCROLL_SCREENSHOT_DIR;

const VIEWPORTS = [
  { name: 'desktop', width: 1280, height: 900 },
  { name: 'phone', width: 390, height: 844 },
  { name: 'small phone', width: 320, height: 568 },
] as const;

interface Rect {
  top: number;
  bottom: number;
  left: number;
  right: number;
}

interface Geometry {
  head: Rect;
  /** The scroller's visible content box (excludes borders and scrollbars). */
  scroller: Rect;
  scrollTop: number;
  maxScrollTop: number;
  /** Chip rects by title; absent when the chip is not in the DOM. */
  chips: Record<string, Rect | undefined>;
}

async function createCircle(session: ApiSession, label: string): Promise<string> {
  const res = await session.post('/api/circles', { recipient_name: `E2E ${label}`.slice(0, 100) });
  expect(res.status(), `create circle: ${await res.text()}`).toBe(201);
  return ((await res.json()) as { data: { circle: { id: string } } }).data.circle.id;
}

async function archiveCircle(session: ApiSession, circleId: string): Promise<void> {
  await session.delete(`/api/circles/${circleId}`).catch(() => {});
}

async function createEvent(
  session: ApiSession,
  circleId: string,
  body: Record<string, unknown>
): Promise<void> {
  const res = await session.post(`/api/circles/${circleId}/events`, body);
  expect(res.ok(), `create ${String(body.title)}: ${res.status()} ${await res.text()}`).toBe(true);
}

const appointment = (
  session: ApiSession,
  circleId: string,
  title: string,
  date: string,
  time: string
): Promise<void> =>
  createEvent(session, circleId, {
    event_type: 'appointment',
    title,
    scheduled_date: date,
    scheduled_time: time,
    duration_minutes: 30,
  });

const allDayTask = (session: ApiSession, circleId: string, title: string, date: string): Promise<void> =>
  createEvent(session, circleId, { event_type: 'task', title, scheduled_date: date });

/** Wait until the grid has stopped moving: the auto-scroll runs once on mount and again when the events arrive. */
async function waitForScrollSettled(page: Page): Promise<void> {
  await page.evaluate(
    () =>
      new Promise<void>((resolve) => {
        const el = document.querySelector('[data-testid="week-scroller"]') as HTMLElement | null;
        let last = Number.NaN;
        let stable = 0;
        const tick = (): void => {
          const now = el ? el.scrollTop : Number.NaN;
          stable = now === last ? stable + 1 : 0;
          last = now;
          if (stable >= 8) resolve();
          else requestAnimationFrame(tick);
        };
        requestAnimationFrame(tick);
      })
  );
}

async function measure(page: Page, titles: string[]): Promise<Geometry> {
  return page.evaluate((wanted) => {
    const rect = (r: DOMRect): { top: number; bottom: number; left: number; right: number } => ({
      top: r.top,
      bottom: r.bottom,
      left: r.left,
      right: r.right,
    });
    const scroller = document.querySelector('[data-testid="week-scroller"]') as HTMLElement;
    const head = document.querySelector('[data-testid="week-pinned-head"]') as HTMLElement;
    const sr = scroller.getBoundingClientRect();
    // clientTop/clientLeft = the border; clientWidth/clientHeight exclude scrollbars.
    const box = {
      top: sr.top + scroller.clientTop,
      left: sr.left + scroller.clientLeft,
      bottom: sr.top + scroller.clientTop + scroller.clientHeight,
      right: sr.left + scroller.clientLeft + scroller.clientWidth,
    };
    const buttons = Array.from(scroller.querySelectorAll('button'));
    const chips: Record<string, ReturnType<typeof rect> | undefined> = {};
    for (const title of wanted) {
      const b = buttons.find((x) => (x.getAttribute('aria-label') ?? '').startsWith(`${title},`));
      chips[title] = b ? rect(b.getBoundingClientRect()) : undefined;
    }
    return {
      head: rect(head.getBoundingClientRect()),
      scroller: box,
      scrollTop: scroller.scrollTop,
      maxScrollTop: scroller.scrollHeight - scroller.clientHeight,
      chips,
    };
  }, titles);
}

interface Expectation {
  /** Chip that is the week's earliest timed event. */
  first: string;
  /** A chip exactly one hour after `first` — measures the hour height instead of assuming it. */
  anHourLater?: string;
  /** Hour-of-day of `first` (fractional). */
  firstHour: number;
  /** True when the grid is too short to scroll the full lead-in (bottom clamp). */
  mayClamp?: boolean;
}

async function assertLeadIn(page: Page, label: string, ex: Expectation): Promise<void> {
  await waitForScrollSettled(page);
  if (SHOTS) {
    const slug = label.toLowerCase().replace(/[^a-z0-9]+/g, '-').slice(0, 90);
    await page.getByTestId('week-scroller').screenshot({ path: `${SHOTS}/${slug}.png` });
  }
  const titles = [ex.first, ...(ex.anHourLater ? [ex.anHourLater] : [])];
  const g = await measure(page, titles);
  const first = g.chips[ex.first];
  expect(first, `${label}: first timed chip "${ex.first}" is not rendered`).toBeTruthy();
  const c = first as Rect;
  const note = `head bottom ${g.head.bottom.toFixed(1)}, chip ${c.top.toFixed(1)}-${c.bottom.toFixed(1)}, scroller ${g.scroller.top.toFixed(1)}-${g.scroller.bottom.toFixed(1)}, scrollTop ${g.scrollTop}/${g.maxScrollTop}`;

  // 0. The head really is pinned at the top of the scroller (otherwise "below
  //    the head" would be measuring nothing).
  expect(g.head.top, `${label}: the head is not pinned at the scroller's top (${note})`).toBeCloseTo(
    g.scroller.top,
    0
  );

  // 1. Entirely below the pinned head, entirely inside the scroller.
  expect(c.top, `${label}: first chip is UNDER the pinned head (${note})`).toBeGreaterThanOrEqual(
    g.head.bottom - EPS
  );
  expect(c.bottom, `${label}: first chip runs past the scroller's bottom (${note})`).toBeLessThanOrEqual(
    g.scroller.bottom + EPS
  );
  expect(c.left, `${label}: first chip is left of the scroller (${note})`).toBeGreaterThanOrEqual(
    g.scroller.left - EPS
  );
  expect(c.right, `${label}: first chip is right of the scroller (${note})`).toBeLessThanOrEqual(
    g.scroller.right + EPS
  );

  // 2. The lead-in is whole. Hour height comes from two chips an hour apart.
  let hourPx = 80;
  if (ex.anHourLater) {
    const later = g.chips[ex.anHourLater];
    expect(later, `${label}: "${ex.anHourLater}" is not rendered`).toBeTruthy();
    hourPx = (later as Rect).top - c.top;
    expect(hourPx, `${label}: hour height is not the 80px the lead-in is sized for`).toBeCloseTo(80, 0);
  }
  const gap = c.top - g.head.bottom;
  const wantGap = Math.min(ex.firstHour, 1) * hourPx;
  expect(gap, `${label}: the lead-in is cut short (${note})`).toBeGreaterThanOrEqual(wantGap - EPS);
  if (!ex.mayClamp) {
    expect(gap, `${label}: scrolled further than the lead-in (${note})`).toBeLessThanOrEqual(wantGap + EPS);
  }
}

async function forEachViewport(
  page: Page,
  circleId: string,
  run: (label: string) => Promise<void>
): Promise<void> {
  for (const vp of VIEWPORTS) {
    await page.setViewportSize({ width: vp.width, height: vp.height });
    await gotoCalendarSettled(page, circleId);
    await run(`${vp.name} ${vp.width}x${vp.height}`);
  }
}

interface Scenario {
  name: string;
  allDay: 'overflow' | 'one' | 'none';
  /** HH:MM of the earliest timed event, on Sunday. */
  firstTime: string;
  firstHour: number;
  /** Add a chip one hour after the first, to measure the hour height. */
  withHourLater: boolean;
  mayClamp?: boolean;
}

const SCENARIOS: Scenario[] = [
  {
    name: 'all-day row at its tallest (3 tasks on one day: 2 chips + "+N"), first event 08:00',
    allDay: 'overflow',
    firstTime: '08:00',
    firstHour: 8,
    withHourLater: true,
  },
  {
    name: 'a single all-day task, first event 08:00',
    allDay: 'one',
    firstTime: '08:00',
    firstHour: 8,
    withHourLater: true,
  },
  {
    name: 'NO all-day row, first event 08:00',
    allDay: 'none',
    firstTime: '08:00',
    firstHour: 8,
    withHourLater: true,
  },
  {
    name: 'all-day row, first event 00:30 (nothing above it to scroll to)',
    allDay: 'overflow',
    firstTime: '00:30',
    firstHour: 0.5,
    withHourLater: true,
  },
  {
    name: 'all-day row, first event 22:00 (the grid cannot scroll that far)',
    allDay: 'overflow',
    firstTime: '22:00',
    firstHour: 22,
    withHourLater: false,
    mayClamp: true,
  },
];

function hourLater(time: string): string {
  const [h, m] = time.split(':').map(Number);
  return `${String(h + 1).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
}

test.describe('Week view: initial auto-scroll leaves the lead-in visible below the pinned head', () => {
  for (const sc of SCENARIOS) {
    test(sc.name, async ({ page, request, account }) => {
      test.slow();
      const session = await apiSession(request, account);
      const circleId = await createCircle(session, `scroll ${uniqueSuffix()}`);
      try {
        const tz = await circleTimezone(session, circleId);
        const today = dateInTz(tz, 0);
        const sunday = addDaysISO(today, -dayOfWeek(today));
        const monday = addDaysISO(sunday, 1);
        const tag = uniqueSuffix();
        const first = `${PREFIX}first_${tag}`;
        const later = `${PREFIX}later_${tag}`;

        // Timed events: the earliest of the WEEK is `first`, on Sunday (column 1,
        // in view at scrollLeft 0 at every width). Monday gets later ones so
        // the week has more than one busy day.
        await appointment(session, circleId, first, sunday, sc.firstTime);
        await appointment(session, circleId, `${PREFIX}pair_${tag}`, sunday, sc.firstTime);
        if (sc.withHourLater) await appointment(session, circleId, later, sunday, hourLater(sc.firstTime));
        await appointment(session, circleId, `${PREFIX}mon_${tag}`, monday, '23:00');

        if (sc.allDay !== 'none') {
          await allDayTask(session, circleId, `${PREFIX}task1_${tag}`, sunday);
          await allDayTask(session, circleId, `${PREFIX}task_mon_${tag}`, monday);
        }
        if (sc.allDay === 'overflow') {
          await allDayTask(session, circleId, `${PREFIX}task2_${tag}`, sunday);
          await allDayTask(session, circleId, `${PREFIX}task3_${tag}`, sunday);
        }

        await forEachViewport(page, circleId, async (label) => {
          // The all-day row's presence is part of the scenario, not an assumption.
          const allDayLabel = page.getByRole('rowheader', { name: 'All day', exact: true });
          await expect(allDayLabel, `${label}: all-day row presence`).toHaveCount(
            sc.allDay === 'none' ? 0 : 1
          );
          if (sc.allDay === 'overflow') {
            await expect(page.getByRole('button', { name: /^\d+ more all-day event/ }).first()).toBeVisible();
          }
          await assertLeadIn(page, `${sc.name} @ ${label}`, {
            first,
            anHourLater: sc.withHourLater ? later : undefined,
            firstHour: sc.firstHour,
            mayClamp: sc.mayClamp,
          });
        });
      } finally {
        await archiveCircle(session, circleId);
      }
    });
  }
});
