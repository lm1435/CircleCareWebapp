/**
 * Regenerate `src/test/fixtures/timezoneOffsets.json` from POSTGRES.
 *
 * Ground truth for `getTimezoneOffsetMinutes` comes from a second, INDEPENDENT
 * implementation of the IANA database — Postgres' `pg_timezone_names` and
 * `AT TIME ZONE` — rather than from the same ICU the code under test calls.
 *
 * This distinction is the whole point. A test written against `Intl` can only
 * ever confirm that our arithmetic agrees with itself, and none of the bugs
 * this fixture exists to catch were arithmetic slips — they were MODELLING
 * errors. The old hour-of-day fold reported Pacific/Kiritimati (+14:00) as
 * -10:00, and an Intl-derived expectation would have happily agreed.
 *
 * The output is COMMITTED so the suite runs offline and in CI. Re-run this only
 * when refreshing the sample, and read the diff: a changed offset is either a
 * real IANA update or a regression worth understanding.
 *
 * Usage:  node scripts/generate-timezone-offset-fixture.mjs
 * Needs:  the local Supabase Postgres container running (`supabase start`).
 */
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const CONTAINER = process.env.PG_CONTAINER || 'supabase_db_CircleCare';
const OUT = path.join(
  path.dirname(fileURLToPath(import.meta.url)),
  '../src/test/fixtures/timezoneOffsets.json'
);

// Instants chosen to straddle the transitions that break naive implementations:
// both hemispheres' DST changeovers, both solstices, and a leap day.
const INSTANTS = [
  '2026-01-15T12:00:00Z', // N hemisphere winter / S summer
  '2026-03-08T09:00:00Z', // US spring-forward
  '2026-03-29T02:00:00Z', // EU spring-forward
  '2026-04-05T16:00:00Z', // AU/NZ autumn transition
  '2026-06-21T12:00:00Z', // N summer solstice
  '2026-09-27T14:00:00Z', // NZ spring-forward
  '2026-10-25T02:00:00Z', // EU fall-back
  '2026-11-01T09:00:00Z', // US fall-back
  '2026-12-21T00:00:00Z', // S summer solstice, midnight UTC
  '2028-02-29T23:30:00Z', // leap day, late in the UTC day
];

function offsetsAt(instant) {
  const sql = `
    SELECT name || '|' || round(EXTRACT(EPOCH FROM (
      (timestamptz '${instant}' AT TIME ZONE name)
      - (timestamptz '${instant}' AT TIME ZONE 'UTC')
    )) / 60)
    FROM pg_timezone_names
    WHERE name LIKE '%/%' AND name NOT LIKE 'posix/%'
    ORDER BY name;`;
  const out = execFileSync(
    'docker',
    ['exec', CONTAINER, 'psql', '-U', 'postgres', '-d', 'postgres', '-t', '-A', '-c', sql],
    { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 }
  );
  const result = {};
  for (const line of out.split('\n')) {
    const [name, minutes] = line.trim().split('|');
    if (name && minutes !== undefined) result[name] = Number(minutes);
  }
  return result;
}

// Only zones THIS runtime's ICU also knows: a zone Node cannot resolve is a
// platform gap, not a bug in the function, and asserting on it would make the
// suite fail for reasons unrelated to the code.
function knownToRuntime(name) {
  try {
    new Intl.DateTimeFormat('en-US', { timeZone: name }).format(new Date());
    return true;
  } catch {
    return false;
  }
}

const samples = [];
const skipped = new Set();
for (const instant of INSTANTS) {
  const offsets = offsetsAt(instant);
  const zones = {};
  for (const [name, minutes] of Object.entries(offsets)) {
    if (!knownToRuntime(name)) {
      skipped.add(name);
      continue;
    }
    zones[name] = minutes;
  }
  samples.push({ instant, zones });
}

const payload = {
  _generator: 'scripts/generate-timezone-offset-fixture.mjs',
  _source: 'Postgres pg_timezone_names / AT TIME ZONE (independent of JS Intl)',
  _zoneCount: Object.keys(samples[0].zones).length,
  samples,
};
fs.writeFileSync(OUT, JSON.stringify(payload, null, 2) + '\n');
console.log(
  `Wrote ${OUT}: ${samples.length} instants x ${payload._zoneCount} zones` +
    (skipped.size ? ` (skipped ${skipped.size} unknown to this runtime)` : '')
);
