import type { Page, Route } from '@playwright/test';
import { sqlExec, sqlRows, sqlStr } from './db';

// ===========================================================================
// DAILY UPDATE e2e helpers (docs/plans/daily-update.md §8.3)
// ===========================================================================
//
// The card is visible 19:00-24:00 in the RECIPIENT's zone and only on days with
// recorded activity. Real activity at a real local hour cannot be produced on
// demand, so the specs:
//
//   * pin the circle's recipient zone to the browser's (`pinRecipientZoneToBrowser`),
//   * install Playwright's clock at a chosen recipient wall time, ALWAYS at or
//     before the real now (a clock ahead of the backend makes the freshly minted
//     session look expired; see midnight-straddle.spec.ts), and
//   * answer GET /circles/:id/daily-update from a fixture built on the §4.1
//     contract, echoing the date the client asked for. Everything else (auth,
//     circle, members, preferences) is the real backend.

/** YYYY-MM-DD of `instant` in `tz`. */
export function localDateOf(instant: Date, tz: string): string {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: tz,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(instant);
}

function offsetMs(instant: Date, tz: string): number {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: tz,
    hourCycle: 'h23',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  }).formatToParts(instant);
  const n = (t: string) => Number(parts.find((p) => p.type === t)?.value);
  const asUtc = Date.UTC(n('year'), n('month') - 1, n('day'), n('hour') % 24, n('minute'), n('second'));
  return asUtc - Math.floor(instant.getTime() / 1000) * 1000;
}

/** The instant at which `tz`'s wall clock reads `date` `hh:mm:ss`. */
export function zonedInstant(date: string, time: string, tz: string): Date {
  const [y, m, d] = date.split('-').map(Number);
  const [hh, mm, ss = 0] = time.split(':').map(Number);
  const wall = Date.UTC(y, m - 1, d, hh, mm, ss);
  let guess = wall - offsetMs(new Date(wall), tz);
  guess = wall - offsetMs(new Date(guess), tz);
  return new Date(guess);
}

export function addDays(date: string, days: number): string {
  const [y, m, d] = date.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, d + days)).toISOString().slice(0, 10);
}

/** The most recent instant at or before `now` whose wall time in `tz` is `time`. */
export function mostRecentWallTime(time: string, tz: string, now: Date = new Date()): Date {
  const today = localDateOf(now, tz);
  const candidate = zonedInstant(today, time, tz);
  return candidate.getTime() <= now.getTime()
    ? candidate
    : zonedInstant(addDays(today, -1), time, tz);
}

export interface DailyUpdateFixture {
  recipient_name?: string | null;
  is_solo?: boolean;
  has_activity?: boolean;
  enabled?: boolean;
  eligible?: boolean;
}

/**
 * Answer every daily-update read from a §4.1-shaped fixture for the date the
 * client asked for. Returns the list of requested dates (the request IS the
 * thing a wrong recipient frame would get wrong).
 */
export async function mockDailyUpdate(
  page: Page,
  tz: string,
  today: string,
  fixture: DailyUpdateFixture = {}
): Promise<string[]> {
  const asked: string[] = [];
  // Both the dated read (`?date=`) and the date-less rollout check (invite line).
  await page.route(/\/api\/circles\/[^/]+\/daily-update(\?.*)?$/, async (route: Route) => {
    const url = new URL(route.request().url());
    const date = url.searchParams.get('date') ?? today;
    asked.push(date);
    if (fixture.enabled === false) {
      await route.fulfill({ json: { success: true, data: { enabled: false } } });
      return;
    }
    const isToday = date === today;
    await route.fulfill({
      json: {
        success: true,
        data: {
          enabled: true,
          date,
          is_today: isToday,
          timezone: tz,
          window: {
            opens_at: zonedInstant(date, '19:00', tz).toISOString(),
            closes_at: zonedInstant(addDays(date, 1), '00:00', tz).toISOString(),
          },
          eligible: fixture.eligible ?? true,
          has_activity: fixture.has_activity ?? true,
          recipient_name: fixture.recipient_name === undefined ? 'Rose' : fixture.recipient_name,
          is_solo: fixture.is_solo ?? false,
          doses: { taken: 3, taken_late: 0, skipped: 1, not_marked: 1, upcoming: 1 },
          as_needed: null,
          tasks: { done: 2 },
          appointments: { past_count: 0 },
          notes: { count: 1, authors: ['Ana'], more_authors: 0 },
          still_to_do: isToday
            ? [
                { kind: 'dose', id: 'e1', title: 'Metformin', time: '21:00:00', status: 'upcoming' },
                { kind: 'dose', id: 'e2', title: 'Lisinopril', time: '19:30:00', status: 'not_marked' },
              ]
            : [{ kind: 'task', id: 't1', title: 'Groceries', time: null, status: 'open' }],
          still_to_do_more: 0,
        },
      },
    });
  });
  return asked;
}

/** Set the account's "Daily update & tips" preference directly (stored input, not a derived flag). */
export function setTipsPref(userId: string, on: boolean): void {
  sqlExec(
    `update users set notification_preferences =
       coalesce(notification_preferences, '{}'::jsonb) || jsonb_build_object('tips_and_suggestions', ${on})
     where id = ${sqlStr(userId)}::uuid;`
  );
}

export function readTipsPref(userId: string): boolean | null {
  const rows = sqlRows<{ v: boolean | null }>(
    `select (notification_preferences->>'tips_and_suggestions')::boolean as v
       from users where id = ${sqlStr(userId)}::uuid`
  );
  return rows[0]?.v ?? null;
}
