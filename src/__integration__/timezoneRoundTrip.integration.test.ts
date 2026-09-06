import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { eventDatesForApi, eventDatesFromApi } from '@/utils/recipientEventDate';
import { eventFormSchema } from '@/api/calendarEvents';

/**
 * FE <-> BE ROUND TRIP, against the real backend and the real Postgres.
 *
 * Everything else in this repo tests the conversion pair against Postgres'
 * tzdata in isolation. This tests the part that isolation cannot: that what
 * `eventDatesForApi` produces is what the BACKEND accepts and stores, and that
 * what the backend RETURNS hydrates back to the same thing.
 *
 * The property is the same one the unit suite asserts —
 * `save(hydrate(stored)) === stored` — but with a real POST, a real DATE/TIME
 * column and a real GET in the middle, so a contract drift between the client's
 * Zod schema and the server's validation shows up as a failure rather than as
 * two suites that each pass alone.
 *
 * OPT-IN. Skipped unless INTEGRATION=1 and the backend answers, so a normal
 * `npm test` (and any CI that lacks a backend) is unaffected:
 *
 *   INTEGRATION=1 npx vitest run src/__integration__ --config vitest.config.ts
 *
 * Needs: backend on :3001, supabase on :55321, and mobile's
 * `seed-cross-timezone.mjs` already run (it creates the TZ * circles).
 */

const SUPABASE_URL = process.env.SEED_SUPABASE_URL || 'http://localhost:55321';
const API = process.env.SEED_BACKEND_URL || 'http://localhost:3001/api';
const PASSWORD = process.env.SEED_PASSWORD || 'DemoPass123!';
const ANON = process.env.VITE_SUPABASE_ANON_KEY || '';
const ENABLED = process.env.INTEGRATION === '1';

/**
 * A tag unique to THIS run, embedded in every probe title.
 *
 * Without it the occurrence count is contaminated by rows a previous run left
 * behind: a mutation test read "60 doses, expected 30" and looked like it had
 * caught the bug when it had really counted two runs of 30. A count assertion
 * has to be isolated from its own history or it reports the wrong thing in
 * both directions.
 */
const RUN = `RT-${Date.now().toString(36)}`;

/**
 * Cross-timezone circles seeded by mobile. The OWNER is the viewer; the
 * RECIPIENT zone is what the client converts into. The pairing matters more
 * than either zone alone — every bug in this area hides in the identity case.
 */
const CIRCLES = [
  'TZ tokyo',
  'TZ kiritimati',
  'TZ chatham',
  'TZ auckland',
  'TZ kolkata',
  'TZ midway',
  'TZ berlin',
  'TZ utc',
];

/** `YYYY-MM-DD` plus whole days, UTC-based so no DST slack. */
function addDays(isoDay: string, days: number): string {
  const [y, m, d] = isoDay.split('-').map(Number);
  const shifted = new Date(Date.UTC(y, m - 1, d + days));
  return `${shifted.getUTCFullYear()}-${String(shifted.getUTCMonth() + 1).padStart(2, '0')}-${String(shifted.getUTCDate()).padStart(2, '0')}`;
}

/** Whole calendar days between two `YYYY-MM-DD` strings (UTC, so DST-free). */
function daysBetween(from: string, to: string): number {
  return Math.round((Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / 86400000);
}

/**
 * The VIEWER's own calendar day, right now.
 *
 * Local getters are correct HERE and nowhere else in this file: the values this
 * seeds are `dateStr` inputs — viewer-frame strings, exactly what an
 * `<input type="date">` holds — so the process zone IS the frame being read.
 * Nothing STORED is ever derived from a local getter.
 */
function viewerToday(): string {
  const n = new Date();
  const mm = String(n.getMonth() + 1).padStart(2, '0');
  const dd = String(n.getDate()).padStart(2, '0');
  return `${n.getFullYear()}-${mm}-${dd}`;
}

/** The viewer zone is the PROCESS zone; the sweep script varies it. */
const VIEWER_TZ = Intl.DateTimeFormat().resolvedOptions().timeZone;

/**
 * Minutes east of UTC for `instant`, as seen in `zone`.
 *
 * Deliberately LOCAL to this file rather than imported from
 * `@/utils/timezone`. A fixture that derives its own expectations from the
 * module under test cannot fail when that module is wrong — the same reason
 * `addDays` above is a local copy of `addDaysToIsoDay`.
 */
function zoneOffsetMinutes(instant: Date, zone: string): number {
  const parts = new Intl.DateTimeFormat('en-CA', {
    calendar: 'gregory',
    numberingSystem: 'latn',
    timeZone: zone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  }).formatToParts(instant);
  const get = (t: string) => parseInt(parts.find((p) => p.type === t)?.value || '0', 10);
  const asUtc = Date.UTC(get('year'), get('month') - 1, get('day'), get('hour') % 24, get('minute'));
  return Math.round((asUtc - instant.getTime()) / 60000);
}

/**
 * The offset in force at LOCAL NOON on `isoDay` in `zone`.
 *
 * Noon, not midnight: every real transition happens in the small hours (US and
 * NZ at 02:00, Chatham at 02:45, Berlin at 02:00/03:00), so local noon is never
 * inside a spring-forward gap or a fall-back repeat and the reading is
 * unambiguous. Two passes for the usual reason — the offset has to be looked up
 * AT some instant, and the only one available up front is the naive reading
 * treated as UTC.
 */
function offsetAtLocalNoon(isoDay: string, zone: string): number {
  const naiveNoonAsUtc = Date.parse(`${isoDay}T12:00:00Z`);
  const first = zoneOffsetMinutes(new Date(naiveNoonAsUtc), zone);
  return zoneOffsetMinutes(new Date(naiveNoonAsUtc - first * 60000), zone);
}

/**
 * The next day STRICTLY AFTER `fromIsoDay` on which `zone`'s UTC offset differs
 * from the day before — its next DST transition day — or `null` if the zone
 * does not change offset within `horizonDays`.
 *
 * 400 days so a single call finds one in either hemisphere whatever the day of
 * year, and `null` is a real answer for the fixed-offset zones in the seed
 * (UTC, Asia/Tokyo, Asia/Kolkata, Pacific/Midway, Pacific/Kiritimati).
 */
function nextDstTransitionDay(zone: string, fromIsoDay: string, horizonDays = 400): string | null {
  let prev = offsetAtLocalNoon(fromIsoDay, zone);
  for (let i = 1; i <= horizonDays; i += 1) {
    const day = addDays(fromIsoDay, i);
    const cur = offsetAtLocalNoon(day, zone);
    if (cur !== prev) return day;
    prev = cur;
  }
  return null;
}

/**
 * ── WHY NOT ONE DATE LITERAL IN THIS FILE ────────────────────────────────
 *
 * This file used to hardcode `2026-09-01`, and on 2026-09-01 at 20:00 it went
 * red in four of the seven viewer zones with no code change. The cause was not
 * a timezone bug: the backend has a documented MEDICATION PAST-TIME START ROLL
 * (`backend/src/utils/medicationStartRoll.ts`) which moves a new medication's
 * start date forward when the submitted date IS TODAY in the recipient's zone
 * and its dose time has already passed. So `08:00`, `00:00` and `20:00` on
 * "today" were rolled by a day — which reads as "server-side reinterpretation"
 * and as a series of 29 doses instead of 30, and is indistinguishable from the
 * real bug these tests exist to catch. Zones still passing were only the ones
 * where the derived instant had not yet arrived. (Same defect, same fix, in the
 * mobile twin: `mobile/src/__tests__/integration/crossTimezone.integration.test.ts`.)
 *
 * Two independent failure modes, both cured by deriving:
 *   1. the start roll, above — cured by putting every probe A WEEK OUT, which
 *      no recipient zone can reach even at +14;
 *   2. plain expiry — a hardcoded day is wrong on every day that is not it.
 *
 * WHAT WAS LOAD-BEARING AND SURVIVES. The literal `2026-09-30` end date paired
 * with `2026-09-01` was not an arbitrary month: NZ enters DST on 2026-09-27, so
 * the 30-day series crossed an offset change mid-flight, which is the entire
 * point of "30 doses at a CONSTANT wall clock". Shifting the window naively
 * would have deleted that property and left a green test proving nothing. So
 * the window is not shifted — it is AIMED, at the recipient zone's next real
 * transition, found in tzdata rather than written down. The materialization
 * test re-proves the crossing at run time rather than trusting this comment.
 * Likewise `2026-03-08 21:30` was US spring-forward day; that probe now lands
 * on the VIEWER's own next transition day, which generalises it to the
 * DST-observing zones the sweep runs under (Chatham and St_Johns as well as
 * Denver) instead of only the US ones.
 */
const BASE_DAY = addDays(viewerToday(), 7);

/**
 * The recipient zone the 30-day window is aimed at. Auckland is the one the
 * original window was chosen for, and Chatham (also in the seed) transitions on
 * the same instant, so aiming at one covers both.
 */
const DST_RECIPIENT_TZ = 'Pacific/Auckland';
const RECIPIENT_DST_DAY = nextDstTransitionDay(DST_RECIPIENT_TZ, BASE_DAY);

/**
 * A 30-day series START placed so the recipient's transition falls STRICTLY
 * INSIDE `[start, start + 29]`, never on either endpoint (an endpoint would let
 * an off-by-one hide in the clipping rather than showing up as 31 doses).
 *
 * `nextDstTransitionDay` returns a day at least `BASE_DAY + 1`, so:
 *   * transition >= BASE_DAY + 10  ->  start = transition - 10, crossing at
 *     start + 10;
 *   * transition within 1..9 days  ->  start = BASE_DAY, crossing at
 *     start + 1..9.
 * Either way the crossing is inside and the start is never nearer than a week,
 * so the past-time roll cannot fire in ANY recipient zone.
 */
const SERIES_START =
  RECIPIENT_DST_DAY && daysBetween(BASE_DAY, RECIPIENT_DST_DAY) >= 10
    ? addDays(RECIPIENT_DST_DAY, -10)
    : BASE_DAY;
/** 30 doses: the start day plus 29. */
const SERIES_END = addDays(SERIES_START, 29);

/** The viewer's own next DST transition day, or `null` in a fixed-offset zone. */
const VIEWER_DST_DAY = nextDstTransitionDay(VIEWER_TZ, BASE_DAY);

/**
 * Typed wall clocks, in the VIEWER's frame — what the caregiver enters.
 *
 * The CLOCKS are the fixture; the day is only a carrier. `00:00` and `23:59`
 * are the day-boundary edges, `20:00` is the evening that rolls the calendar
 * day over in a zone ahead, `08:00` the ordinary morning. The last entry is the
 * transition-day probe and is absent in a fixed-offset viewer zone, where there
 * is no such day to probe (the old `2026-03-08` literal was likewise inert
 * there — it was an ordinary date unless the viewer followed the US rules).
 */
const TYPED: { date: string; time: string }[] = [
  { date: BASE_DAY, time: '08:00' },
  { date: BASE_DAY, time: '20:00' },
  { date: BASE_DAY, time: '00:00' },
  { date: BASE_DAY, time: '23:59' },
  ...(VIEWER_DST_DAY ? [{ date: VIEWER_DST_DAY, time: '21:30' }] : []),
];

/**
 * Query windows covering every day this run could have written a probe on,
 * chunked below the backend's 366-day `RANGE_TOO_LARGE` cap.
 */
function cleanupWindows(): { from: string; to: string }[] {
  const lastProbeDay = [SERIES_END, BASE_DAY, VIEWER_DST_DAY ?? BASE_DAY].sort().pop() as string;
  const first = addDays(BASE_DAY, -5);
  const last = addDays(lastProbeDay, 10);
  const windows: { from: string; to: string }[] = [];
  let cursor = first;
  while (daysBetween(cursor, last) >= 0) {
    const to = daysBetween(cursor, last) > 360 ? addDays(cursor, 360) : last;
    windows.push({ from: cursor, to });
    cursor = addDays(to, 1);
  }
  return windows;
}

interface Ctx {
  token: string;
  circleId: string;
  recipientTz: string;
  ownerEmail: string;
}

async function signIn(email: string): Promise<string> {
  const res = await fetch(`${SUPABASE_URL}/auth/v1/token?grant_type=password`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', apikey: ANON },
    body: JSON.stringify({ email, password: PASSWORD }),
  });
  const body = (await res.json()) as { access_token?: string };
  if (!body.access_token) throw new Error(`sign-in failed for ${email}`);
  return body.access_token;
}

async function api(
  token: string,
  path: string,
  init?: RequestInit
): Promise<{ status: number; body: any }> {
  const res = await fetch(`${API}${path}`, {
    ...init,
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${token}`,
      ...(init?.headers || {}),
    },
  });
  const text = await res.text();
  let body: any = null;
  try {
    body = text ? JSON.parse(text) : null;
  } catch {
    body = text;
  }
  return { status: res.status, body };
}

const contexts: Ctx[] = [];
let reachable = false;

beforeAll(async () => {
  if (!ENABLED) return;
  try {
    const health = await fetch('http://localhost:3001/health');
    reachable = health.ok;
  } catch {
    reachable = false;
  }
  if (!reachable) return;

  for (const name of CIRCLES) {
    const slug = name.replace('TZ ', '');
    const email = `tz-owner-${slug}@tz.test`;
    try {
      const token = await signIn(email);
      const list = await api(token, '/circles');
      const circle = list.body?.data?.circles?.find((c: any) => c.name === name);
      if (!circle) continue;
      const detail = await api(token, `/circles/${circle.id}`);
      const recipientTz = detail.body?.data?.circle?.care_recipient_timezone;
      if (!recipientTz) continue;
      contexts.push({ token, circleId: circle.id, recipientTz, ownerEmail: email });
    } catch {
      /* a circle the seed did not create — skipped, and reported below */
    }
  }
}, 60_000);

describe.skipIf(!ENABLED)('FE <-> BE timezone round trip', () => {
  it('reached the backend and resolved cross-timezone circles', () => {
    expect(reachable, 'backend not answering on :3001').toBe(true);
    expect(contexts.length, 'no cross-timezone circles resolved').toBeGreaterThan(3);
  });

  it('the client payload is ACCEPTED by the backend for every zone pairing', async () => {
    const failures: string[] = [];
    for (const ctx of contexts) {
      for (const typed of TYPED) {
        const dates = eventDatesForApi({
          dateStr: typed.date,
          timeStr: typed.time,
          recurrenceEndDateStr: null,
          timezone: ctx.recipientTz,
        });
        const payload = {
          event_type: 'medication' as const,
          title: `${RUN} probe`,
          medication_name: `${RUN} probe`,
          scheduled_date: dates.scheduledDate,
          scheduled_time: dates.scheduledTime,
          notifications_enabled: false,
        };
        // The client's OWN schema first: a mismatch here means the FE would
        // have blocked the save before the network even happened.
        const parsed = eventFormSchema.safeParse(payload);
        if (!parsed.success) {
          failures.push(`${ctx.recipientTz} ${typed.date} ${typed.time}: client schema rejected`);
          continue;
        }
        const res = await api(ctx.token, `/circles/${ctx.circleId}/events`, {
          method: 'POST',
          body: JSON.stringify(payload),
        });
        if (res.status !== 200 && res.status !== 201) {
          failures.push(
            `${ctx.recipientTz} ${typed.date} ${typed.time}: HTTP ${res.status} ` +
              `${JSON.stringify(res.body?.error ?? res.body).slice(0, 160)}`
          );
        }
      }
    }
    expect(failures.slice(0, 12)).toEqual([]);
  }, 120_000);

  it('STORES and RETURNS exactly what the client sent (no server-side reinterpretation)', async () => {
    const failures: string[] = [];
    for (const ctx of contexts) {
      const dates = eventDatesForApi({
        dateStr: BASE_DAY,
        timeStr: '20:00',
        recurrenceEndDateStr: null,
        timezone: ctx.recipientTz,
      });
      const created = await api(ctx.token, `/circles/${ctx.circleId}/events`, {
        method: 'POST',
        body: JSON.stringify({
          event_type: 'medication',
          title: `${RUN} store probe`,
          medication_name: `${RUN} store probe`,
          scheduled_date: dates.scheduledDate,
          scheduled_time: dates.scheduledTime,
          notifications_enabled: false,
        }),
      });
      const id = created.body?.data?.event?.id;
      if (!id) {
        failures.push(`${ctx.recipientTz}: create returned no id (HTTP ${created.status})`);
        continue;
      }
      const got = await api(ctx.token, `/circles/${ctx.circleId}/events/${id}`);
      const ev = got.body?.data?.event;
      if (!ev) {
        failures.push(`${ctx.recipientTz}: GET returned no event`);
        continue;
      }
      if (ev.scheduled_date !== dates.scheduledDate) {
        failures.push(
          `${ctx.recipientTz}: date sent ${dates.scheduledDate}, got back ${ev.scheduled_date}`
        );
      }
      // The server returns TIME with seconds; compare on HH:MM.
      if ((ev.scheduled_time ?? '').slice(0, 5) !== dates.scheduledTime) {
        failures.push(
          `${ctx.recipientTz}: time sent ${dates.scheduledTime}, got back ${ev.scheduled_time}`
        );
      }
    }
    expect(failures.slice(0, 12)).toEqual([]);
  }, 120_000);

  /**
   * THE PROPERTY THAT KEEPS DATA STILL, end to end.
   *
   * Open a stored event, change nothing, save. The row must not move — with a
   * real PATCH and a real column in the middle.
   */
  it('an untouched re-save through the real API does not move the row', async () => {
    const failures: string[] = [];
    for (const ctx of contexts) {
      const dates = eventDatesForApi({
        dateStr: BASE_DAY,
        timeStr: '20:00',
        recurrenceEndDateStr: null,
        timezone: ctx.recipientTz,
      });
      const created = await api(ctx.token, `/circles/${ctx.circleId}/events`, {
        method: 'POST',
        body: JSON.stringify({
          event_type: 'medication',
          title: `${RUN} idempotence probe`,
          medication_name: `${RUN} idempotence probe`,
          scheduled_date: dates.scheduledDate,
          scheduled_time: dates.scheduledTime,
          notifications_enabled: false,
        }),
      });
      const id = created.body?.data?.event?.id;
      if (!id) continue;

      let current = { date: dates.scheduledDate, time: dates.scheduledTime as string };
      for (let cycle = 0; cycle < 2; cycle += 1) {
        const got = await api(ctx.token, `/circles/${ctx.circleId}/events/${id}`);
        const ev = got.body?.data?.event;
        if (!ev) break;

        // Exactly what the edit form does: hydrate into the viewer frame…
        const form = eventDatesFromApi({
          scheduledDate: ev.scheduled_date,
          scheduledTime: ev.scheduled_time ?? null,
          timezone: ctx.recipientTz,
        });
        // …then save it back untouched.
        const back = eventDatesForApi({
          dateStr: form.dateStr,
          timeStr: form.timeStr,
          recurrenceEndDateStr: null,
          timezone: ctx.recipientTz,
        });
        await api(ctx.token, `/circles/${ctx.circleId}/events/${id}`, {
          method: 'PATCH',
          body: JSON.stringify({
            scheduled_date: back.scheduledDate,
            scheduled_time: back.scheduledTime,
          }),
        });

        const after = await api(ctx.token, `/circles/${ctx.circleId}/events/${id}`);
        const ae = after.body?.data?.event;
        const gotPair = `${ae?.scheduled_date} ${(ae?.scheduled_time ?? '').slice(0, 5)}`;
        const wantPair = `${current.date} ${current.time}`;
        if (gotPair !== wantPair) {
          failures.push(`${ctx.recipientTz} cycle ${cycle + 1}: ${wantPair} -> ${gotPair}`);
          break;
        }
      }
    }
    expect(failures.slice(0, 12)).toEqual([]);
  }, 180_000);

  /**
   * THE PAYOFF. The span rule says "30 days" must mean 30 doses in the
   * RECIPIENT's calendar. The unit fixture asserts that against Postgres'
   * `generate_series`; this asserts it against the BACKEND's own materializer,
   * which is the thing that actually decides what a caregiver sees.
   *
   * The window deliberately extends past the series end, so an off-by-one
   * shows up as 31 rather than being clipped back to 30 by the query range.
   *
   * AND THE SERIES MUST CROSS A DST TRANSITION, or it proves only the easy
   * half. That is asserted below rather than arranged by a comment: the window
   * is aimed at `Pacific/Auckland`'s next real offset change (see SERIES_START),
   * and the first thing this test does is re-derive, from tzdata, that some
   * SEEDED recipient zone really does change offset strictly inside the span.
   * If a future edit moves the window off the transition, this fails LOUDLY
   * instead of quietly degrading into a same-offset series that any broken span
   * rule would also satisfy.
   */
  it('materializes exactly 30 doses for a 30-day series, at a constant wall clock', async () => {
    const crossing = contexts
      .map((c) => c.recipientTz)
      .filter((tz) => {
        const t = nextDstTransitionDay(tz, SERIES_START);
        // Strictly inside: `nextDstTransitionDay` already returns >= start + 1,
        // so bounding it below 29 keeps it off BOTH endpoints.
        return t !== null && daysBetween(SERIES_START, t) < 29;
      });
    expect(
      crossing,
      `the 30-day window ${SERIES_START}..${SERIES_END} crosses no DST transition in any ` +
        `seeded recipient zone (${contexts.map((c) => c.recipientTz).join(', ')}) — ` +
        `the constant-wall-clock assertion below would be vacuous`
    ).not.toEqual([]);

    const failures: string[] = [];
    for (const ctx of contexts) {
      const dates = eventDatesForApi({
        dateStr: SERIES_START,
        timeStr: '20:00',
        recurrenceEndDateStr: SERIES_END,
        timezone: ctx.recipientTz,
      });
      const created = await api(ctx.token, `/circles/${ctx.circleId}/events`, {
        method: 'POST',
        body: JSON.stringify({
          event_type: 'medication',
          title: `${RUN} count probe`,
          medication_name: `${RUN} count probe`,
          scheduled_date: dates.scheduledDate,
          scheduled_time: dates.scheduledTime,
          recurrence_rule: 'daily',
          recurrence_end_date: dates.recurrenceEndDate,
          notifications_enabled: false,
        }),
      });
      if (created.status !== 200 && created.status !== 201) continue;

      // Query a window WIDER than the series on both sides.
      const from = addDays(dates.scheduledDate, -3);
      const to = addDays(dates.recurrenceEndDate as string, 5);
      const list = await api(
        ctx.token,
        `/circles/${ctx.circleId}/events?start_date=${from}&end_date=${to}`
      );
      const instances = (list.body?.data?.events ?? []).filter(
        (e: any) => e.title === `${RUN} count probe`
      );
      if (instances.length !== 30) {
        failures.push(`${ctx.recipientTz}: ${instances.length} doses, expected 30`);
        continue;
      }
      // A daily series advances one RECIPIENT-LOCAL day, so the wall clock must
      // not drift when the recipient's zone changes offset mid-series. The
      // window is aimed at exactly that: `RECIPIENT_DST_DAY` is Auckland's next
      // real transition and sits strictly inside `SERIES_START..SERIES_END`,
      // proven from tzdata by the `crossing` guard at the top of this test.
      const clocks = new Set(instances.map((e: any) => (e.scheduled_time ?? '').slice(0, 5)));
      if (clocks.size !== 1) {
        failures.push(`${ctx.recipientTz}: wall clock drifted across the series: ${[...clocks]}`);
      }
      const days = instances.map((e: any) => e.scheduled_date).sort();
      if (days[0] !== dates.scheduledDate || days[days.length - 1] !== dates.recurrenceEndDate) {
        failures.push(
          `${ctx.recipientTz}: span ${days[0]}..${days[days.length - 1]}, ` +
            `expected ${dates.scheduledDate}..${dates.recurrenceEndDate}`
        );
      }
    }
    expect(failures.slice(0, 12)).toEqual([]);
  }, 180_000);

  /**
   * A TIMED and a TIMELESS event created from the SAME visible date do not
   * necessarily land on the same recipient day — `eventDatesForApi` converts
   * the first and passes the second through verbatim.
   *
   * That passthrough is canonical (mobile's `formatDateDeviceLocal` does the
   * same: with no time there is no instant to re-express). This test exists to
   * make the divergence VISIBLE rather than to condemn it — and to fail loudly
   * if the timeless branch ever starts converting, which would silently move
   * every all-day task ever created.
   */
  it('documents the timed/timeless divergence from one visible date', async () => {
    const observed: string[] = [];
    for (const ctx of contexts) {
      const timed = eventDatesForApi({
        dateStr: BASE_DAY,
        timeStr: '20:00',
        recurrenceEndDateStr: null,
        timezone: ctx.recipientTz,
      });
      const timeless = eventDatesForApi({
        dateStr: BASE_DAY,
        timeStr: null,
        recurrenceEndDateStr: null,
        timezone: ctx.recipientTz,
      });
      // The timeless date is ALWAYS the date the user picked, unconverted.
      expect(timeless.scheduledDate, `${ctx.recipientTz} timeless must not convert`).toBe(
        BASE_DAY
      );
      expect(timeless.scheduledTime).toBeUndefined();
      if (timed.scheduledDate !== timeless.scheduledDate) {
        observed.push(`${ctx.recipientTz}: timed ${timed.scheduledDate} vs all-day ${timeless.scheduledDate}`);
      }
    }
    // Not an assertion of zero — a record of which pairings diverge, so the set
    // changing is noticeable in a diff.
    expect(Array.isArray(observed)).toBe(true);
  }, 60_000);

  /**
   * The pair the backend compares directly
   * (adherenceSchedule.ts: `if (current > recurrence_end_date) break`).
   */
  it('a 30-day series is accepted and comes back with end >= start', async () => {
    const failures: string[] = [];
    for (const ctx of contexts) {
      const dates = eventDatesForApi({
        dateStr: SERIES_START,
        timeStr: '20:00',
        // 30 doses: the start day plus 29.
        recurrenceEndDateStr: SERIES_END,
        timezone: ctx.recipientTz,
      });
      const created = await api(ctx.token, `/circles/${ctx.circleId}/events`, {
        method: 'POST',
        body: JSON.stringify({
          event_type: 'medication',
          title: `${RUN} series probe`,
          medication_name: `${RUN} series probe`,
          scheduled_date: dates.scheduledDate,
          scheduled_time: dates.scheduledTime,
          recurrence_rule: 'daily',
          recurrence_end_date: dates.recurrenceEndDate,
          notifications_enabled: false,
        }),
      });
      if (created.status !== 200 && created.status !== 201) {
        failures.push(
          `${ctx.recipientTz}: series rejected HTTP ${created.status} ` +
            `${JSON.stringify(created.body?.error ?? '').slice(0, 140)}`
        );
        continue;
      }
      const ev = created.body?.data?.event;
      if (ev?.recurrence_end_date && ev.recurrence_end_date < ev.scheduled_date) {
        failures.push(
          `${ctx.recipientTz}: end ${ev.recurrence_end_date} < start ${ev.scheduled_date}`
        );
      }
    }
    expect(failures.slice(0, 12)).toEqual([]);
  }, 120_000);
});

/**
 * Remove the probe rows. This runs against a SHARED local Postgres — other
 * sessions test here too, and leaving dozens of "RT *" events behind is how a
 * neighbouring suite starts failing for reasons that have nothing to do with it.
 */
afterAll(async () => {
  if (!ENABLED || !reachable) return;
  // The backend caps a query range at 366 DAYS (RANGE_TOO_LARGE). The first
  // version of this cleanup asked for three years, got a 400, and swallowed it
  // in a catch — so nothing was ever deleted and every run left ~30 rows in a
  // database three other sessions also test against.
  //
  // DERIVED from the days this run actually wrote, for the same reason the
  // probes are: the two hardcoded calendar years stopped covering the probes
  // the moment the probes stopped being in 2026. The transition-day probe can
  // sit up to 400 days out, so the span is chunked to stay under the cap.
  const WINDOWS = cleanupWindows();
  const problems: string[] = [];
  for (const ctx of contexts) {
    const ids = new Set<string>();
    for (const w of WINDOWS) {
      const list = await api(
        ctx.token,
        `/circles/${ctx.circleId}/events?start_date=${w.from}&end_date=${w.to}`
      );
      if (list.status !== 200) {
        problems.push(`${ctx.recipientTz} list ${w.from}: HTTP ${list.status}`);
        continue;
      }
      for (const e of list.body?.data?.events ?? []) {
        if (String(e.title ?? '').startsWith(RUN)) ids.add(e.parent_event_id || e.id);
      }
    }
    for (const id of ids) {
      const del = await api(ctx.token, `/circles/${ctx.circleId}/events/${id}`, {
        method: 'DELETE',
      });
      if (del.status !== 200) problems.push(`${ctx.recipientTz} delete ${id}: HTTP ${del.status}`);
    }
  }
  // Reported, not thrown: a cleanup failure must not mask a real result, but it
  // must not be invisible either.
  if (problems.length) console.warn('[integration cleanup]', problems.slice(0, 10));
}, 180_000);
