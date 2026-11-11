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
        let last = '';
        let stable = 0;
        const tick = (): void => {
          // Below lg the opening scroll moves the PAGE; at lg+ the grid box.
          const now = `${el ? el.scrollTop : 'none'}/${window.scrollY}`;
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
    // Below lg (64rem) the grid is full height and the page scrolls, so what
    // is visible vertically is the scroller box clipped to the window. At lg+
    // the grid's own 70vh box is the frame (as before 2026-11-10).
    const pageScrolls = !window.matchMedia('(min-width: 64rem)').matches;
    const box = {
      top: pageScrolls ? Math.max(0, sr.top + scroller.clientTop) : sr.top + scroller.clientTop,
      left: sr.left + scroller.clientLeft,
      bottom: pageScrolls
        ? Math.min(window.innerHeight, sr.top + scroller.clientTop + scroller.clientHeight)
        : sr.top + scroller.clientTop + scroller.clientHeight,
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
  const inner = (page.viewportSize()?.width ?? 0) >= 1024;
  const first = g.chips[ex.first];
  expect(first, `${label}: first timed chip "${ex.first}" is not rendered`).toBeTruthy();
  const c = first as Rect;
  const note = `head bottom ${g.head.bottom.toFixed(1)}, chip ${c.top.toFixed(1)}-${c.bottom.toFixed(1)}, scroller ${g.scroller.top.toFixed(1)}-${g.scroller.bottom.toFixed(1)}, scrollTop ${g.scrollTop}/${g.maxScrollTop}`;

  // Below lg there is NO opening lead-in (owner follow-up 2026-11-10): the
  // page is left alone and the grid box has no vertical scroll of its own.
  // The lead-in there is the "Now" control (see the iPhone test below).
  if (!inner) {
    const scrollY = await page.evaluate(() => window.scrollY);
    expect(scrollY, `${label}: the page moved by itself on open (${note})`).toBe(0);
    expect(g.scrollTop, `${label}: the grid box scrolled on a phone (${note})`).toBe(0);
    expect(g.maxScrollTop, `${label}: the grid box has its own vertical scroll (${note})`).toBe(0);
    return;
  }

  // 0. The head really is pinned (otherwise "below the head" would be
  //    measuring nothing): at lg+ it sits directly on top of the grid's own
  //    scroller.
  expect(g.head.bottom, `${label}: the head is not on top of the grid scroller (${note})`).toBeCloseTo(
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

function minutePast(time: string, n: number): string {
  const [h, m] = time.split(':').map(Number);
  const total = h * 60 + m + n;
  return `${String(Math.floor(total / 60)).padStart(2, '0')}:${String(total % 60).padStart(2, '0')}`;
}

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
        // 5 minutes later, not the same minute: same-type items at one minute fold into one "N appointments" chip.
        await appointment(session, circleId, `${PREFIX}pair_${tag}`, sunday, minutePast(sc.firstTime, 5));
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

// ONE VERTICAL SCROLL ON A PHONE (owner 2026-11-10, iPhone Safari dark): the
// timed grid used to be a `max-h-[70vh]` scroll box inside the scrolling page,
// so the user scrolled the card AND the page. Below lg the grid now lays out at
// full height, the page is the only vertical scroll, the head (day headers +
// all-day row) stays stuck under the app header, and the week still pans
// sideways INSIDE the card (~2 day columns fit), never the page.
test.describe('Week view at iPhone width: the page is the only vertical scroll', () => {
  test('390x844: no inner vertical scroll, page scrolls, head pinned and aligned, last row clears the nav pill', async ({
    page,
    request,
    account,
  }) => {
    test.slow();
    const session = await apiSession(request, account);
    const circleId = await createCircle(session, `one scroll ${uniqueSuffix()}`);
    try {
      const tz = await circleTimezone(session, circleId);
      const today = dateInTz(tz, 0);
      const sunday = addDaysISO(today, -dayOfWeek(today));
      const tag = uniqueSuffix();
      await appointment(session, circleId, `${PREFIX}bathe_${tag}`, sunday, '13:00');
      await appointment(session, circleId, `${PREFIX}late_${tag}`, addDaysISO(sunday, 1), '23:00');
      await allDayTask(session, circleId, `${PREFIX}task_${tag}`, sunday);

      await page.setViewportSize({ width: 390, height: 844 });
      await gotoCalendarSettled(page, circleId);
      await waitForScrollSettled(page);

      const g = await page.evaluate(() => {
        const scroller = document.querySelector('[data-testid="week-scroller"]') as HTMLElement;
        const doc = document.scrollingElement as HTMLElement;
        return {
          innerScrollHeight: scroller.scrollHeight,
          innerClientHeight: scroller.clientHeight,
          innerScrollWidth: scroller.scrollWidth,
          innerClientWidth: scroller.clientWidth,
          docScrollHeight: doc.scrollHeight,
          docClientHeight: doc.clientHeight,
          docScrollWidth: doc.scrollWidth,
          docClientWidth: doc.clientWidth,
          docScrollTop: doc.scrollTop,
        };
      });
      // No inner vertical scroll: the grid box is exactly as tall as its content.
      expect(g.innerScrollHeight, JSON.stringify(g)).toBe(g.innerClientHeight);
      // The page has room to scroll, and opening the week did NOT move it
      // (owner follow-up 2026-11-10: the page is never scrolled by itself).
      expect(g.docScrollHeight, JSON.stringify(g)).toBeGreaterThan(g.docClientHeight);
      expect(g.docScrollTop, JSON.stringify(g)).toBe(0);
      // The week pans sideways inside the card; the page never scrolls sideways.
      expect(g.innerScrollWidth, JSON.stringify(g)).toBeGreaterThan(g.innerClientWidth);
      expect(g.docScrollWidth, JSON.stringify(g)).toBeLessThanOrEqual(g.docClientWidth);

      // document.scrollingElement really scrolls (not just "is tall").
      const moved = await page.evaluate(() => {
        const doc = document.scrollingElement as HTMLElement;
        doc.scrollTo({ top: 0, behavior: 'instant' });
        const before = doc.scrollTop;
        doc.scrollTo({ top: 600, behavior: 'instant' });
        return { before, after: doc.scrollTop };
      });
      expect(moved.before).toBe(0);
      expect(moved.after).toBe(600);

      // Mid-page the head is stuck under the 60px app header.
      const headTop = await page.getByTestId('week-pinned-head').evaluate((el) => el.getBoundingClientRect().top);
      expect(headTop).toBeCloseTo(60, 0);

      // Pan the grid one column: the head pans with it, so Monday's header sits over Monday's column.
      const monday = addDaysISO(sunday, 1);
      await page.getByTestId('week-scroller').evaluate((el) => {
        el.scrollTo({ left: 400, behavior: 'instant' });
      });
      await expect
        .poll(() =>
          page.evaluate(() => {
            const head = document.querySelector('[data-testid="week-head-scroller"]') as HTMLElement;
            const grid = document.querySelector('[data-testid="week-scroller"]') as HTMLElement;
            return grid.scrollLeft > 0 && head.scrollLeft === grid.scrollLeft;
          })
        )
        .toBe(true);
      const align = await page.evaluate((day) => {
        const heads = Array.from(
          document.querySelectorAll('[data-testid="week-pinned-head"] [role="columnheader"]')
        ) as HTMLElement[];
        // Header 0 is the time-rail corner; day columns follow in order.
        const cols = Array.from(
          document.querySelectorAll('[data-testid="week-scroller"] [role="gridcell"]')
        ) as HTMLElement[];
        const i = cols.findIndex((c) => c.dataset.date === day);
        return { head: heads[i + 1].getBoundingClientRect().left, col: cols[i].getBoundingClientRect().left };
      }, monday);
      expect(align.head).toBeCloseTo(align.col, 0);

      // At the page's end the grid's last row clears the floating nav pill.
      const bottom = await page.evaluate(() => {
        const doc = document.scrollingElement as HTMLElement;
        doc.scrollTo({ top: doc.scrollHeight, behavior: 'instant' });
        const grid = document.querySelector('[data-testid="week-scroller"]') as HTMLElement;
        const nav = document.querySelector('[data-testid="floating-nav"]') as HTMLElement | null;
        return { gridBottom: grid.getBoundingClientRect().bottom, navTop: nav ? nav.getBoundingClientRect().top : window.innerHeight };
      });
      expect(bottom.gridBottom, JSON.stringify(bottom)).toBeLessThanOrEqual(bottom.navTop);
    } finally {
      await archiveCircle(session, circleId);
    }
  });
});

// THE PAGE IS LEFT ALONE; "NOW" IS THE JUMP (owner follow-up 2026-11-10).
// Switching Day -> Week or changing week used to scroll the page down to the
// lead-in hour, taking the week controls off screen. Now nothing moves the
// page by itself; the toolbar's "Now" control (below lg, only when the week
// holds today) scrolls it so the now-line sits an hour under the pinned head.
test.describe('Week view at iPhone width: the page never scrolls by itself; "Now" does', () => {
  test('390x844: Day -> Week and next/previous week keep scrollY; Now puts the now-line under the head', async ({
    page,
    request,
    account,
  }) => {
    test.slow();
    const session = await apiSession(request, account);
    const circleId = await createCircle(session, `now ${uniqueSuffix()}`);
    try {
      const tz = await circleTimezone(session, circleId);
      const today = dateInTz(tz, 0);
      const tag = uniqueSuffix();
      // An early event, so the old opening lead-in (earliest event) would have scrolled.
      await appointment(session, circleId, `${PREFIX}early_${tag}`, today, '07:00');
      await allDayTask(session, circleId, `${PREFIX}task_${tag}`, today);

      await page.setViewportSize({ width: 390, height: 844 });
      await gotoCalendarSettled(page, circleId);
      await waitForScrollSettled(page);
      const scrollY = (): Promise<number> => page.evaluate(() => window.scrollY);
      expect(await scrollY(), 'opening Week moved the page').toBe(0);

      const nowButton = page.getByRole('button', { name: 'Now', exact: true });
      await expect(nowButton).toBeVisible();

      // Day -> Week.
      await page.getByRole('tab', { name: 'Day' }).click();
      await expect(nowButton).toHaveCount(0);
      await page.getByRole('tab', { name: 'Week' }).click();
      await expect(page.getByRole('grid', { name: 'Week view calendar' })).toBeVisible();
      await waitForScrollSettled(page);
      expect(await scrollY(), 'Day -> Week moved the page').toBe(0);

      // Next week: no today -> no Now; previous week: back, and still no page move.
      const range = page.getByRole('heading', { level: 2 }).filter({ hasText: /\d{4}$/ });
      const from = (await range.textContent())?.trim() ?? '';
      await page.getByRole('button', { name: 'Next week' }).click();
      await expect(range).not.toHaveText(from);
      await waitForScrollSettled(page);
      expect(await scrollY(), 'Next week moved the page').toBe(0);
      await expect(nowButton).toHaveCount(0);
      await page.getByRole('button', { name: 'Previous week' }).click();
      await expect(range).toHaveText(from);
      await expect(page.getByRole('grid', { name: 'Week view calendar' })).toBeVisible();
      await waitForScrollSettled(page);
      expect(await scrollY(), 'Previous week moved the page').toBe(0);

      // Now: the now-line ends up visible, under the stuck head, an hour of lead-in above it.
      await nowButton.click();
      await waitForScrollSettled(page);
      const g = await page.evaluate(() => {
        const head = document.querySelector('[data-testid="week-pinned-head"]') as HTMLElement;
        const line = document.querySelector('[data-testid="current-time-indicator"]') as HTMLElement;
        const nav = document.querySelector('[data-testid="floating-nav"]') as HTMLElement | null;
        const doc = document.scrollingElement as HTMLElement;
        return {
          headTop: head.getBoundingClientRect().top,
          headBottom: head.getBoundingClientRect().bottom,
          lineTop: line.getBoundingClientRect().top,
          gridTop: (document.querySelector('[data-testid="week-scroller"]') as HTMLElement).getBoundingClientRect().top,
          navTop: nav ? nav.getBoundingClientRect().top : window.innerHeight,
          scrollY: window.scrollY,
          maxScrollY: doc.scrollHeight - doc.clientHeight,
        };
      });
      const note = JSON.stringify(g);
      expect(g.lineTop, `now-line hidden under the head (${note})`).toBeGreaterThanOrEqual(g.headBottom - EPS);
      expect(g.lineTop, `now-line below the nav pill (${note})`).toBeLessThanOrEqual(g.navTop);
      if (g.scrollY > 0 && g.scrollY < g.maxScrollY - EPS) {
        // Not clamped at either end: the head is stuck and the lead-in is exactly one hour.
        expect(g.headTop, note).toBeCloseTo(60, 0);
        // Within the day's first hour the lead-in is the line's own offset.
        const want = Math.min(g.lineTop - g.gridTop, 80);
        expect(g.lineTop - g.headBottom, `lead-in is not one hour (${note})`).toBeCloseTo(want, 0);
      }
    } finally {
      await archiveCircle(session, circleId);
    }
  });
});
