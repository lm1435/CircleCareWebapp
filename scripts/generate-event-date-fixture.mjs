/**
 * Regenerate `src/test/fixtures/eventDateConversions.json` from POSTGRES.
 *
 * Ground truth for the whole save/hydrate pair — what `scheduled_date` and
 * `scheduled_time` SHOULD be for a given typed wall clock and recipient zone —
 * computed by Postgres rather than by the ICU the app calls:
 *
 *   (timestamp '<typed>' AT TIME ZONE '<viewer>') AT TIME ZONE '<recipient>'
 *
 * The first `AT TIME ZONE` reads the typed naive wall clock in the VIEWER's
 * zone to get a real instant; the second re-expresses that instant as the
 * RECIPIENT's naive wall clock. That is exactly what the save path does, so
 * agreement is meaningful and disagreement is a bug in one of them.
 *
 * Also records the OCCURRENCE COUNT Postgres generates between the converted
 * start and end dates — the property the recurrence-end rule exists to protect:
 * a series the user set to run 30 days must yield 30 daily doses in the
 * recipient's frame no matter which zone either party is in.
 *
 * Keyed by VIEWER zone because the form's inputs are read in the process zone
 * and JS cannot change that at runtime. The test resolves its own row BY
 * BEHAVIOUR (matching offsets), never by name: ICU resolves TZ=Asia/Kolkata to
 * the legacy alias Asia/Calcutta, so a name lookup would miss.
 *
 * Usage:  node scripts/generate-event-date-fixture.mjs
 * Needs:  the local Supabase Postgres container running (`supabase start`).
 */
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const CONTAINER = process.env.PG_CONTAINER || 'supabase_db_CircleCare';
const OUT = path.join(
  path.dirname(fileURLToPath(import.meta.url)),
  '../src/test/fixtures/eventDateConversions.json'
);

// Every zone `scripts/run-unit-timezones.sh` sweeps, plus the ones a dev box or
// CI plausibly sits in. A viewer zone the suite runs under but the fixture
// lacks fails loudly by design.
const VIEWER_ZONES = [
  'America/Denver',
  'UTC',
  'Asia/Tokyo',
  'Pacific/Auckland',
  'Pacific/Midway',
  'Pacific/Kiritimati',
  'Pacific/Chatham',
  'Asia/Kathmandu',
  'Asia/Kolkata',
  'America/St_Johns',
];

// The extremes that broke the old offset lookup, the fractional offsets, and a
// normal spread.
// EVERY IANA zone Postgres knows and this runtime's ICU can resolve — not a
// curated sample. The recipient zone is the data-bearing axis: it decides what
// gets written to scheduled_date/scheduled_time, so "which zones are correct"
// should not depend on which ones someone thought to list.
const RECIPIENT_ZONES = allRecipientZones();

function allRecipientZones() {
  const out = execFileSync(
    'docker',
    ['exec', CONTAINER, 'psql', '-U', 'postgres', '-d', 'postgres', '-t', '-A', '-c',
     "SELECT name FROM pg_timezone_names WHERE name LIKE '%/%' AND name NOT LIKE 'posix/%' ORDER BY name;"],
    { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 }
  );
  return out.split('\n').map((l) => l.trim()).filter(Boolean).filter((name) => {
    try { new Intl.DateTimeFormat('en-US', { timeZone: name }).format(new Date()); return true; }
    catch { return false; }
  });
}

/**
 * NO AMBIGUOUS WALL CLOCKS HERE, deliberately.
 *
 * A local time inside a fall-back repeated hour (America/Denver 2026-11-01
 * 01:30) happens TWICE and names no single instant. Postgres resolves it to
 * standard time, JS's `new Date(y, m, d, h, min)` to daylight time. Neither is
 * wrong, so a fixture row for one would assert a convention rather than a fact
 * and would fail forever. That behaviour is pinned in the test instead, as
 * IDEMPOTENCE, where it can be described.
 *
 * Everything else is here: both DST transition days at unambiguous times, both
 * midnight edges, a year boundary and a leap day.
 */
const TYPED = [
  { date: '2026-09-01', time: '08:00' },
  { date: '2026-09-01', time: '20:00' }, // the founder's worked example
  { date: '2026-09-01', time: '00:00' }, // exact midnight — the "24:00" trap
  { date: '2026-09-01', time: '23:59' }, // last minute of the day
  { date: '2026-09-01', time: '02:30' },
  { date: '2026-03-08', time: '21:30' }, // US spring-forward day, evening
  { date: '2026-11-01', time: '04:30' }, // US fall-back day, AFTER the repeat
  { date: '2026-12-31', time: '23:00' }, // year boundary
  { date: '2028-02-29', time: '22:00' }, // leap day
];

/**
 * The repeat runs 29 days from EACH start, not to one fixed calendar day: a
 * shared end date would sit before the later starts, so the save would
 * (correctly) floor the pair and the fixture would assert the floor rather than
 * the conversion. Every row is a real 30-dose series.
 */
const SPAN_DAYS = 29;

/** SQL on STDIN: the generated VALUES list blows the exec argument limit. */
function query(sql) {
  return execFileSync(
    'docker',
    ['exec', '-i', CONTAINER, 'psql', '-U', 'postgres', '-d', 'postgres', '-t', '-A', '-f', '-'],
    { encoding: 'utf8', input: sql, maxBuffer: 64 * 1024 * 1024 }
  );
}

const rows = [];
for (const viewer of VIEWER_ZONES) {
  for (const recipient of RECIPIENT_ZONES) {
    for (const typed of TYPED) {
      rows.push({ viewer, recipient, typed });
    }
  }
}

const values = rows
  .map(
    (r, i) => `(${i}, '${r.viewer}', '${r.recipient}', timestamp '${r.typed.date} ${r.typed.time}')`
  )
  .join(',\n    ');

const sql = `
  WITH input(idx, viewer, recipient, typed) AS (VALUES
    ${values}
  ),
  converted AS (
    SELECT idx,
           (typed AT TIME ZONE viewer) AT TIME ZONE recipient AS start_local,
           -- THE SPAN, ADDED IN THE RECIPIENT'S CALENDAR — not a second instant
           -- conversion of a typed end date. A daily series advances one
           -- recipient-local day at a time, so "30 days" has to mean 30 doses.
           (((typed AT TIME ZONE viewer) AT TIME ZONE recipient)::date + ${SPAN_DAYS}) AS end_local
    FROM input
  )
  SELECT idx || '|' ||
         to_char(start_local, 'YYYY-MM-DD') || '|' ||
         to_char(start_local, 'HH24:MI') || '|' ||
         to_char(end_local, 'YYYY-MM-DD') || '|' ||
         (SELECT count(*) FROM generate_series(
            date_trunc('day', start_local), end_local::timestamp, interval '1 day'))
  FROM converted
  ORDER BY idx;`;

const byIdx = new Map();
for (const line of query(sql).split('\n')) {
  const parts = line.trim().split('|');
  if (parts.length < 5) continue;
  const [idx, date, time, endDate, occurrences] = parts;
  byIdx.set(Number(idx), {
    scheduledDate: date,
    scheduledTime: time,
    recurrenceEndDate: endDate,
    occurrences: Number(occurrences),
  });
}

/**
 * The offset signature the TEST uses to find its own row without trusting zone
 * names. Two instants on opposite sides of the year separate zones that share a
 * standard offset but differ on DST.
 */
const PROBES = ['2026-01-15T12:00:00Z', '2026-07-15T12:00:00Z', '2026-09-01T12:00:00Z'];
function signature(zone) {
  return PROBES.map((iso) => {
    const at = new Date(iso);
    const parts = new Intl.DateTimeFormat('en-US', {
      timeZone: zone,
      hour12: false,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
    }).formatToParts(at);
    const g = (t) => parseInt(parts.find((p) => p.type === t)?.value || '0', 10);
    const wall = Date.UTC(g('year'), g('month') - 1, g('day'), g('hour') % 24, g('minute'));
    return Math.round((wall - Math.floor(at.getTime() / 60000) * 60000) / 60000);
  });
}

const byViewer = {};
rows.forEach((r, i) => {
  const result = byIdx.get(i);
  if (!result) return;
  (byViewer[r.viewer] ??= { signature: signature(r.viewer), cases: [] }).cases.push({
    recipient: r.recipient,
    typedDate: r.typed.date,
    typedTime: r.typed.time,
    spanDays: SPAN_DAYS,
    ...result,
  });
});

const payload = {
  _generator: 'scripts/generate-event-date-fixture.mjs',
  _source: 'Postgres AT TIME ZONE (independent of JS Intl)',
  _spanDays: SPAN_DAYS,
  _note: 'Resolve a viewer zone by `signature`, never by name (ICU aliases Asia/Kolkata).',
  viewers: byViewer,
};
// MINIFIED on purpose. Pretty-printing 49,770 cases costs ~7MB of indentation
// in a committed file for no benefit: nobody reads this by eye, and the
// generator is the thing you inspect when a value looks wrong.
fs.writeFileSync(OUT, JSON.stringify(payload) + '\n');
console.log(
  `Wrote ${OUT}: ${Object.keys(byViewer).length} viewer zones x ${RECIPIENT_ZONES.length} recipients x ${TYPED.length} times = ${rows.length} cases`
);
