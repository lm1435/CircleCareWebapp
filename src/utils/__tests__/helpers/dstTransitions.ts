/**
 * Test helper for the DST <-> standard-time regression suites: DISCOVER each zone's 2026 clock changes from `Intl`
 * (never hard-code them), and a tiny independent oracle for "the instant of a wall time". The suites assert the
 * discovery matches the spec's section-3 table for this runtime's tzdata, and fail loudly if a row differs.
 */

/** Offset (minutes east of UTC) of `zone` at the instant `ms`, read from Intl. */
const FORMATTERS = new Map<string, Intl.DateTimeFormat>();
export function offsetMinutes(zone: string, ms: number): number {
  const minute = Math.floor(ms / 60000) * 60000;
  let f = FORMATTERS.get(zone);
  if (!f) {
    f = new Intl.DateTimeFormat('en-US', {
      timeZone: zone,
      hourCycle: 'h23',
      calendar: 'gregory',
      numberingSystem: 'latn',
      year: 'numeric',
      month: 'numeric',
      day: 'numeric',
      hour: 'numeric',
      minute: 'numeric',
    });
    FORMATTERS.set(zone, f);
  }
  const p = Object.fromEntries(f.formatToParts(new Date(minute)).map((x) => [x.type, x.value]));
  return (Date.UTC(+p.year, +p.month - 1, +p.day, +p.hour % 24, +p.minute) - minute) / 60000;
}

const pad = (n: number) => String(n).padStart(2, '0');
export const hm = (wallMs: number): string => {
  const d = new Date(wallMs);
  return `${pad(d.getUTCHours())}:${pad(d.getUTCMinutes())}`;
};
export const dayOf = (wallMs: number): string => new Date(wallMs).toISOString().slice(0, 10);

export interface Transition {
  zone: string;
  kind: 'gap' | 'overlap';
  /** The local calendar day the gap / overlap starts on. */
  day: string;
  /** First and last wall-clock minute inside the gap (never happens) / overlap (happens twice). */
  first: string;
  last: string;
  /** The first instant (ms) on the new offset. */
  atUtc: number;
  deltaMinutes: number;
}

/** Every clock change of `zone` in `year`, found by an hourly offset scan refined to the minute. */
const DISCOVERED = new Map<string, Transition[]>();
export function discoverTransitions(zone: string, year = 2026): Transition[] {
  const cached = DISCOVERED.get(`${zone}|${year}`);
  if (cached) return cached;
  const out: Transition[] = [];
  const end = Date.UTC(year + 1, 0, 1);
  let prev = offsetMinutes(zone, Date.UTC(year, 0, 1));
  for (let t = Date.UTC(year, 0, 1) + 3600000; t < end; t += 3600000) {
    const cur = offsetMinutes(zone, t);
    if (cur === prev) continue;
    let lo = t - 3600000; // offset `prev`
    let hi = t; // offset `cur`
    while (hi - lo > 60000) {
      const mid = lo + Math.floor((hi - lo) / 120000) * 60000;
      const m = mid <= lo ? lo + 60000 : mid;
      if (offsetMinutes(zone, m) === prev) lo = m;
      else hi = m;
    }
    const delta = cur - prev;
    // Wall readings: before the change the clock read (hi + prev); right after, (hi + cur).
    if (delta > 0) {
      const startWall = hi + prev * 60000; // first nonexistent wall minute
      out.push({
        zone,
        kind: 'gap',
        day: dayOf(startWall),
        first: hm(startWall),
        last: hm(startWall + (delta - 1) * 60000),
        atUtc: hi,
        deltaMinutes: delta,
      });
    } else {
      const startWall = hi + cur * 60000; // first repeated wall minute
      out.push({
        zone,
        kind: 'overlap',
        day: dayOf(startWall),
        first: hm(startWall),
        last: hm(startWall + (-delta - 1) * 60000),
        atUtc: hi,
        deltaMinutes: delta,
      });
    }
    prev = cur;
  }
  DISCOVERED.set(`${zone}|${year}`, out);
  return out;
}

/**
 * The instant of a wall time in `zone` with Postgres `AT TIME ZONE` semantics, written independently of
 * `wallTimeToInstant`: a repeated time is the SECOND occurrence, a missing time takes the pre-jump offset.
 */
export function oracleInstant(zone: string, day: string, time: string): Date {
  const wall = Date.parse(`${day}T${time.slice(0, 5)}:00Z`);
  const before = offsetMinutes(zone, wall - 36 * 3600000);
  const after = offsetMinutes(zone, wall + 36 * 3600000);
  const valid = [before, after]
    .filter((off, i, all) => all.indexOf(off) === i)
    .map((off) => wall - off * 60000)
    .filter((t) => wall - t === offsetMinutes(zone, t) * 60000);
  if (valid.length === 0) return new Date(wall - before * 60000);
  return new Date(Math.max(...valid));
}

/** `YYYY-MM-DD` and `HH:MM` of `instant` on `zone`'s clock. */
export function wallIn(zone: string, instant: Date): { day: string; time: string } {
  const wall = instant.getTime() + offsetMinutes(zone, instant.getTime()) * 60000;
  return { day: dayOf(wall), time: hm(wall) };
}

export function addDays(day: string, n: number): string {
  return new Date(Date.parse(`${day}T00:00:00Z`) + n * 86400000).toISOString().slice(0, 10);
}

/** Minutes after the wall `HH:MM`. */
export function addMinutes(time: string, minutes: number): string {
  const [h, m] = time.split(':').map(Number);
  const total = (((h * 60 + m + minutes) % 1440) + 1440) % 1440;
  return `${pad(Math.floor(total / 60))}:${pad(total % 60)}`;
}

/** The spec's section-3 table. Santiago's overlap is the wall day it starts on (Sat 04-04 23:00). */
export const EXPECTED_2026: Record<
  string,
  { spring?: [day: string, first: string, last: string]; fall?: [day: string, first: string, last: string] }
> = {
  'America/New_York': { spring: ['2026-03-08', '02:00', '02:59'], fall: ['2026-11-01', '01:00', '01:59'] },
  'America/Denver': { spring: ['2026-03-08', '02:00', '02:59'], fall: ['2026-11-01', '01:00', '01:59'] },
  'America/Adak': { spring: ['2026-03-08', '02:00', '02:59'], fall: ['2026-11-01', '01:00', '01:59'] },
  'Europe/London': { spring: ['2026-03-29', '01:00', '01:59'], fall: ['2026-10-25', '01:00', '01:59'] },
  'Europe/Berlin': { spring: ['2026-03-29', '02:00', '02:59'], fall: ['2026-10-25', '02:00', '02:59'] },
  'Pacific/Auckland': { spring: ['2026-09-27', '02:00', '02:59'], fall: ['2026-04-05', '02:00', '02:59'] },
  'Australia/Sydney': { spring: ['2026-10-04', '02:00', '02:59'], fall: ['2026-04-05', '02:00', '02:59'] },
  'America/Santiago': { spring: ['2026-09-06', '00:00', '00:59'], fall: ['2026-04-04', '23:00', '23:59'] },
  'America/Havana': { spring: ['2026-03-08', '00:00', '00:59'], fall: ['2026-11-01', '00:00', '00:59'] },
  'Australia/Lord_Howe': { spring: ['2026-10-04', '02:00', '02:29'], fall: ['2026-04-05', '01:30', '01:59'] },
  'Pacific/Chatham': { spring: ['2026-09-27', '02:45', '03:44'], fall: ['2026-04-05', '02:45', '03:44'] },
  'Asia/Kolkata': {},
  'Asia/Kathmandu': {},
  'Asia/Tehran': {},
  'America/Phoenix': {},
  'America/Regina': {},
  'Asia/Tokyo': {},
};

/** Fails with a clear message when this runtime's tzdata disagrees with the table (never test the wrong day). */
export function assertTableMatchesRuntime(): void {
  const problems: string[] = [];
  for (const [zone, exp] of Object.entries(EXPECTED_2026)) {
    const found = discoverTransitions(zone);
    const spring = found.find((x) => x.kind === 'gap');
    const fall = found.find((x) => x.kind === 'overlap');
    const same = (got: Transition | undefined, want: [string, string, string] | undefined) =>
      want ? !!got && got.day === want[0] && got.first === want[1] && got.last === want[2] : !got;
    if (!same(spring, exp.spring)) problems.push(`${zone} spring-forward: runtime ${JSON.stringify(spring)} vs table ${JSON.stringify(exp.spring)}`);
    if (!same(fall, exp.fall)) problems.push(`${zone} fall-back: runtime ${JSON.stringify(fall)} vs table ${JSON.stringify(exp.fall)}`);
  }
  if (problems.length) throw new Error(`tzdata differs from FIX-SPEC section 3:\n${problems.join('\n')}`);
}
