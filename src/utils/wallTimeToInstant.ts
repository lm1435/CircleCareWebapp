/**
 * THE ONE WAY A STORED NAIVE WALL TIME BECOMES AN INSTANT.
 *
 * Doses, events and shifts are stored as naive local `scheduled_date` +
 * `scheduled_time` in the circle's zone. The pg_cron reminder / escalation SQL
 * turns that into an instant with `(date + time) AT TIME ZONE zone`, so any JS
 * decision about the same row ("is this confirmation late?", "has it passed?",
 * "what time is it on the reader's clock?") must resolve it the SAME way, or the
 * app and the push disagree by an hour twice a year.
 *
 * Postgres's rule (measured on the live DB, pinned in the circleTimezone
 * integration tests):
 *   - REPEATED wall time (fall-back): the offset in force just AFTER the
 *     transition, i.e. the SECOND occurrence. NY 01:30 2027-11-07 -> 06:30Z.
 *   - MISSING wall time (spring-forward gap): the offset in force just BEFORE
 *     the transition. NY 02:30 2027-03-14 -> 07:30Z (= 03:30 EDT).
 * date-fns-tz `fromZonedTime` answers one hour EARLIER in those cases and, for
 * some of them, depends on the server's own process TZ. This does not: it reads
 * offsets from `Intl` only.
 *
 * ALGORITHM. offA = zone offset 24h before wall-as-UTC, offB = offset 24h after.
 * Candidates t = wall-as-UTC - off for off in {offA, offB}; a candidate is valid
 * when the zone's offset AT t equals the off it was built from.
 *   both valid and distinct -> ambiguous -> offB's (later offset, second occurrence)
 *   exactly one valid       -> that one
 *   none valid              -> gap -> offA's (pre-transition offset)
 * The probes sit 24h (not 12h) away because zone offsets reach +14h: at +-12h a
 * Pacific/Chatham (+12:45/+13:45) probe can land ON the transition and see the
 * same offset on both sides.
 *
 * Identical copies (same algorithm, same exports) live in backend/src/utils/,
 * mobile/src/utils/ and webapp/src/utils/wallTimeToInstant.ts: change all three together.
 *
 * @param date YYYY-MM-DD
 * @param time HH:MM or HH:MM:SS (fraction tolerated; 24:00 = next midnight, as Postgres)
 * @param zone IANA zone (callers pass it through `safeTimezone` first)
 * @returns the instant, or an Invalid Date for unparseable input / an unknown zone
 */

const FORMATTERS = new Map<string, Intl.DateTimeFormat>();
const FORMATTER_CACHE_MAX = 200;

function formatterFor(zone: string): Intl.DateTimeFormat {
  let f = FORMATTERS.get(zone);
  if (!f) {
    f = new Intl.DateTimeFormat('en-US', {
      timeZone: zone,
      hour12: false,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
    });
    if (FORMATTERS.size >= FORMATTER_CACHE_MAX) FORMATTERS.clear();
    FORMATTERS.set(zone, f);
  }
  return f;
}

/** Zone UTC offset (ms) at instant `ms`. */
function zoneOffsetMs(zone: string, ms: number): number {
  const instant = ms - (((ms % 1000) + 1000) % 1000);
  const p: Record<string, string> = {};
  for (const part of formatterFor(zone).formatToParts(new Date(instant))) p[part.type] = part.value;
  // `% 24`: some ICU builds render midnight as hour 24 under `hour12: false`.
  const wall = Date.UTC(+p.year, +p.month - 1, +p.day, +p.hour % 24, +p.minute, +p.second);
  return wall - instant;
}

const DATE_RE = /^(\d{4})-(\d{2})-(\d{2})$/;
const TIME_RE = /^(\d{1,2}):(\d{2})(?::(\d{2})(?:\.\d+)?)?$/;
const PROBE_MS = 24 * 60 * 60 * 1000;

/**
 * The core: a wall clock already packed as "its fields read as UTC" (`Date.UTC(y, m - 1, d, h, mi, s)`)
 * -> the instant, by the Postgres rule above. Invalid Date for a NaN input or an unknown zone.
 */
export function wallClockMsToInstant(wallAsUtcMs: number, zone: string): Date {
  try {
    if (!Number.isFinite(wallAsUtcMs)) return new Date(NaN);
    const offA = zoneOffsetMs(zone, wallAsUtcMs - PROBE_MS);
    const offB = zoneOffsetMs(zone, wallAsUtcMs + PROBE_MS);
    const tA = wallAsUtcMs - offA;
    const tB = wallAsUtcMs - offB;
    const aValid = zoneOffsetMs(zone, tA) === offA;
    const bValid = zoneOffsetMs(zone, tB) === offB;

    if (bValid) return new Date(tB); // ambiguous (second occurrence) or the only valid one
    if (aValid) return new Date(tA);
    return new Date(tA); // gap: pre-transition offset
  } catch {
    return new Date(NaN);
  }
}

/** `YYYY-MM-DD` + `HH:MM[:SS]` naive in `zone` -> the instant Postgres `AT TIME ZONE` gives. */
export function wallTimeToInstant(date: string, time: string, zone: string): Date {
  const d = DATE_RE.exec(date);
  const t = TIME_RE.exec(time);
  if (!d || !t) return new Date(NaN);
  return wallClockMsToInstant(Date.UTC(+d[1], +d[2] - 1, +d[3], +t[1], +t[2], +(t[3] ?? 0)), zone);
}
