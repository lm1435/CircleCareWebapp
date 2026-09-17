import type { Page, Request } from '@playwright/test';
import { test, expect, uniqueLabel } from '../../fixtures';
import { apiSession } from '../../unhappy';
import { apiCreateEvent, dateInZone, recipientTimezone } from './_helpers';

// HOME MUST NOT OVER-FETCH EVENTS.
//
// Measured before the fix, one cold Home load of the demo circle sent 8 GET
// /events requests spanning 680 days (~3.2 MB):
//   - the checklist + TodaysMeds presence check read a 211-day LIST
//     (today-30..today+180, ~1,511 rows, ~1.4 MB) to answer "is there a med?";
//   - `useCalendarEvents` then PREFETCHED the previous and next same-size
//     windows after every success — two more 211-day lists, and two more
//     15-day lists behind UpcomingAppointments' today..+14 window.
// Only the Calendar page navigates window-to-window, so prefetch is now opt-in
// there, and presence is one GET /events/presence returning booleans.
//
// This spec records EVERY GET /api/circles/:id/events and /events/presence
// request of a cold Home load (after a positive loaded signal, then a quiet
// period) and asserts the exact set; then asserts the Calendar page still
// prefetches its neighbours, so the opt-in is proven live and not just absent.

test.use({ persona: 'premiumOwner' });

const MEDS_CARD = 'section[aria-labelledby="todays-meds-heading"]';
const APPOINTMENTS_CARD = 'section[aria-labelledby="upcoming-appointments-heading"]';

interface EventRead {
  kind: 'events' | 'presence';
  start: string | null;
  end: string | null;
  eventType: string | null;
  request: Request;
  /** Decoded response body size, once the response finished. */
  bytes?: number;
}

const DAY_MS = 86_400_000;
const dayNumber = (date: string) => Date.parse(`${date}T12:00:00Z`) / DAY_MS;
/** Inclusive day count of a start..end window. */
const spanDays = (r: EventRead) => (r.start && r.end ? dayNumber(r.end) - dayNumber(r.start) + 1 : Infinity);
const label = (r: EventRead) =>
  `${r.kind} ${r.start}..${r.end}${r.eventType ? ` event_type=${r.eventType}` : ''}`;

function recordEventReads(page: Page, circleId: string) {
  const base = `/api/circles/${circleId}/events`;
  const reads: EventRead[] = [];
  let lastAt = Date.now();
  page.on('request', (request) => {
    if (request.method() !== 'GET' || request.resourceType() === 'document') return;
    const url = new URL(request.url());
    const kind = url.pathname === base ? 'events' : url.pathname === `${base}/presence` ? 'presence' : null;
    if (!kind) return;
    reads.push({
      kind,
      start: url.searchParams.get('start_date'),
      end: url.searchParams.get('end_date'),
      eventType: url.searchParams.get('event_type'),
      request,
    });
    lastAt = Date.now();
  });
  page.on('requestfinished', async (request) => {
    const read = reads.find((r) => r.request === request);
    if (!read) return;
    try {
      read.bytes = (await (await request.response())?.body())?.length;
    } catch {
      // Page navigated away mid-read; size is informational only.
    }
  });
  return {
    reads,
    /** Resolve once no matching request has started for `quietMs` (bounded). */
    async settle(quietMs = 3_000, timeoutMs = 20_000): Promise<void> {
      const started = Date.now();
      lastAt = Math.max(lastAt, started);
      while (Date.now() - lastAt < quietMs) {
        expect(Date.now() - started, 'event reads never went quiet').toBeLessThan(timeoutMs + quietMs);
        await page.waitForTimeout(200);
      }
    },
  };
}

/** Windows W (list reads, no event_type) that have BOTH same-span neighbours also requested. */
function prefetchTriples(reads: EventRead[]): string[] {
  const lists = reads.filter((r) => r.kind === 'events' && !r.eventType && r.start && r.end);
  const has = (start: number, end: number) =>
    lists.some((r) => dayNumber(r.start as string) === start && dayNumber(r.end as string) === end);
  return lists
    .filter((w) => {
      const s = dayNumber(w.start as string);
      const e = dayNumber(w.end as string);
      const span = e - s + 1;
      return has(s - span, s - 1) && has(e + 1, e + span);
    })
    .map(label);
}

/** List reads that are the same-span neighbour of ANOTHER list read. */
function adjacentReads(reads: EventRead[]): string[] {
  const lists = reads.filter((r) => r.kind === 'events' && !r.eventType && r.start && r.end);
  return lists
    .filter((a) =>
      lists.some((w) => {
        if (w === a || spanDays(w) !== spanDays(a)) return false;
        const span = spanDays(w);
        return (
          dayNumber(a.start as string) === dayNumber(w.start as string) - span ||
          dayNumber(a.start as string) === dayNumber(w.end as string) + 1
        );
      })
    )
    .map(label);
}

function logReads(title: string, reads: EventRead[]): void {
  const total = reads.reduce((sum, r) => sum + (r.bytes ?? 0), 0);
  const days = reads.filter((r) => r.kind === 'events').reduce((sum, r) => sum + spanDays(r), 0);
  console.log(
    `${title}: ${reads.length} requests, ${days} list days, ${total} bytes\n` +
      reads.map((r) => `  ${label(r)}  (${spanDays(r)}d, ${r.bytes ?? '?'} B)`).join('\n')
  );
}

test('a cold Home load reads only the windows it renders: no list over 15 days, no prefetch, one presence read', async ({
  page,
  request,
  account,
  circleId,
}) => {
  test.setTimeout(90_000);
  const api = await apiSession(request, account);
  const tz = await recipientTimezone(api, circleId);

  // A known upcoming appointment, so UpcomingAppointments rendering is a POSITIVE signal (it renders
  // nothing at all when the next 14 days are empty).
  const apptTitle = uniqueLabel('Home fetch appt');
  const appt = await apiCreateEvent(api, circleId, {
    event_type: 'appointment',
    title: apptTitle,
    scheduled_date: dateInZone(tz, 1),
    scheduled_time: '10:00',
  });

  try {
    const rec = recordEventReads(page, circleId);
    await page.goto(`/circles/${circleId}`, { waitUntil: 'domcontentloaded' });

    // Loaded: TodaysMeds settled (mounted, no skeleton) and the appointments card shows our appointment.
    const meds = page.locator(MEDS_CARD);
    await expect(meds).toBeVisible({ timeout: 20_000 });
    await expect(meds.locator('[aria-busy="true"]')).toHaveCount(0, { timeout: 20_000 });
    await expect(page.locator(APPOINTMENTS_CARD).getByText(apptTitle)).toBeVisible({ timeout: 20_000 });
    await rec.settle();
    logReads('Home cold load', rec.reads);

    const today = dateInZone(tz, 0);
    const events = rec.reads.filter((r) => r.kind === 'events');
    const presence = rec.reads.filter((r) => r.kind === 'presence');

    expect(
      events.filter((r) => spanDays(r) > 15).map(label),
      'GET /events requests spanning more than 15 days'
    ).toEqual([]);
    expect(adjacentReads(rec.reads), 'adjacent-window prefetch requests on Home').toEqual([]);
    expect(presence.map(label), 'exactly one presence read, over today-30..today+180').toEqual([
      `presence ${dateInZone(tz, -30)}..${dateInZone(tz, 180)}`,
    ]);
    expect(events.map(label).sort(), 'the exact set of GET /events requests on Home').toEqual(
      [
        `events ${today}..${today} event_type=medication`,
        `events ${dateInZone(tz, -1)}..${dateInZone(tz, -1)} event_type=medication`,
        `events ${today}..${dateInZone(tz, 14)}`,
      ].sort()
    );
  } finally {
    const res = await api.delete(`/api/circles/${circleId}/events/${appt.id}`);
    expect(res.ok(), await res.text()).toBe(true);
  }
});

test('the Calendar page still prefetches the previous and next windows (prefetch is opt-in, not gone)', async ({
  page,
  request,
  account,
  circleId,
}) => {
  test.setTimeout(60_000);
  const tz = await recipientTimezone(await apiSession(request, account), circleId);
  const rec = recordEventReads(page, circleId);
  await page.goto(`/circles/${circleId}/calendar`, { waitUntil: 'domcontentloaded' });
  await expect(page.getByRole('grid')).toBeVisible({ timeout: 20_000 });

  const today = dayNumber(dateInZone(tz, 0));
  // A visible window containing today, with both same-span neighbours requested.
  await expect
    .poll(
      () =>
        prefetchTriples(rec.reads).filter((w) => {
          const [, range] = w.split(' ');
          const [s, e] = range.split('..');
          return dayNumber(s) <= today && today <= dayNumber(e);
        }),
      { timeout: 20_000, message: 'visible calendar window with both neighbours prefetched' }
    )
    .not.toEqual([]);
  logReads('Calendar load', rec.reads);
});
