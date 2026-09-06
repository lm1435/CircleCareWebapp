import { describe, it, expect } from 'vitest';
import {
  addDaysToIsoDay,
  eventDatesForApi,
  eventDatesFromApi,
  isoDaysBetween,
} from '../recipientEventDate';
import fixture from '@/test/fixtures/eventDateConversions.json';
import { KNOWN_TZDATA_DIVERGENCE, RUNTIME_IS_AHEAD_OF_FIXTURES } from '@/test/knownTzdataDivergence';

/**
 * The save/hydrate pair vs. POSTGRES.
 *
 * Expected values come from `scripts/generate-event-date-fixture.mjs`, which
 * asks Postgres — a second, independent IANA implementation — what
 *
 *   (timestamp '<typed>' AT TIME ZONE '<viewer>') AT TIME ZONE '<recipient>'
 *
 * is. Deriving them from the same `Intl` the code calls would make this a
 * tautology: it would confirm only that our arithmetic agrees with itself,
 * which every one of these bugs already did. They were MODELLING errors.
 *
 * The viewer zone is the PROCESS zone and JS cannot change it at runtime, so
 * one run covers one side of every pairing — `scripts/run-unit-timezones.sh`
 * runs the rest.
 */

interface Case {
  recipient: string;
  typedDate: string;
  typedTime: string;
  spanDays: number;
  scheduledDate: string;
  scheduledTime: string;
  recurrenceEndDate: string;
  occurrences: number;
}
interface ViewerRow {
  signature: number[];
  cases: Case[];
}
const viewers = fixture.viewers as Record<string, ViewerRow>;

const PROBES = ['2026-01-15T12:00:00Z', '2026-07-15T12:00:00Z', '2026-09-01T12:00:00Z'];

/**
 * A FILE-LOCAL offset, deliberately NOT `timezone.ts`'s `getTimezoneOffsetMinutes`.
 *
 * This is the same argument the header makes about the expected values, applied
 * to the ROW LOOKUP — and it is the sharper half, because getting the lookup
 * wrong does not fail, it SKIPS.
 *
 * The signature keys this run to its fixture row, and the row carries the 4,977
 * conversion cases. Computing it with `getTimezoneOffsetMinutes` made it depend
 * on the very function `instantFromNaiveTimeInZone` — and therefore
 * `eventDatesFromApi` — is built on. Break that function for the PROCESS zone at
 * any of the three probes and the signature stops matching any row: the
 * describe block below drops from 48 tests to 6, prints a "no fixture row"
 * warning that reads like a contributor-machine notice, and the sweep reports
 * `PASS Pacific/Chatham` having asserted nothing about Pacific/Chatham.
 *
 * Mirrors `signature()` in scripts/generate-event-date-fixture.mjs byte for
 * byte, which is what makes the two comparable — the generator already computes
 * it this way, independently of `src/`.
 */
function offsetMinutesViaIntl(zone: string, at: Date): number {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: zone,
    hour12: false,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  }).formatToParts(at);
  const g = (t: string): number =>
    parseInt(parts.find((p) => p.type === t)?.value || '0', 10);
  const wall = Date.UTC(g('year'), g('month') - 1, g('day'), g('hour') % 24, g('minute'));
  return Math.round((wall - Math.floor(at.getTime() / 60000) * 60000) / 60000);
}

/** The offset signature of any zone, on this machine's ICU. */
function signatureOf(zone: string): number[] {
  return PROBES.map((iso) => offsetMinutesViaIntl(zone, new Date(iso)));
}

/** This process's own offset signature — computed WITHOUT the module under test. */
function processSignature(): number[] {
  return signatureOf(new Intl.DateTimeFormat().resolvedOptions().timeZone);
}

/**
 * Find this run's fixture row BY BEHAVIOUR.
 *
 * Never by name. ICU resolves `TZ=Asia/Kolkata` to the legacy alias
 * `Asia/Calcutta`, so a row keyed by the canonical name would simply miss and
 * the suite would skip the very zone it was told to cover. Matching offsets
 * cannot care what the zone is called.
 */
function resolveViewerRow(): { zone: string; row: ViewerRow } | null {
  const mine = processSignature().join(',');
  for (const [zone, row] of Object.entries(viewers)) {
    if (row.signature.join(',') === mine) return { zone, row };
  }
  return null;
}

const resolved = resolveViewerRow();
const processZone = new Intl.DateTimeFormat().resolvedOptions().timeZone;

/**
 * A zone id as ICU canonicalises it — `Asia/Kolkata` comes back `Asia/Calcutta`
 * on the ICU builds this repo runs on.
 *
 * Used ONLY to answer "is this machine running one of the sweep zones?", and
 * deliberately by NAME rather than by offset signature. The signature is the
 * thing under suspicion whenever that question matters: comparing a possibly
 * regressed process signature against sweep-zone signatures computed the same
 * way moves both sides together, and the guard below excuses itself instead of
 * firing. Canonical names cannot move together with an arithmetic bug.
 */
function canonicalZone(zone: string): string {
  try {
    return new Intl.DateTimeFormat('en-US', { timeZone: zone }).resolvedOptions().timeZone;
  } catch {
    return zone;
  }
}

/**
 * Zones the sweep actually runs under. The fixture MUST cover these — a gap
 * here is a real hole, and is asserted as one below.
 */
const SWEEP_ZONES = [
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

/** Is THIS machine running one of them? (Alias-safe — see `canonicalZone`.) */
const processIsSweepZone = SWEEP_ZONES.some(
  (z) => canonicalZone(z) === canonicalZone(processZone)
);

describe('eventDatesForApi / eventDatesFromApi vs Postgres', () => {
  /**
   * The fixture must cover every zone the sweep runs — asserted unconditionally,
   * on every machine, because a missing sweep zone IS a defect.
   */
  it('covers every zone the sweep runs under', () => {
    const missing = SWEEP_ZONES.filter((z) => !(z in viewers));
    expect(missing, 'regenerate scripts/generate-event-date-fixture.mjs').toEqual([]);
  });

  /**
   * A CONTRIBUTOR'S machine zone is not a defect.
   *
   * This used to assert `resolved` was non-null, so the whole suite went red on
   * any machine outside the ten generated zones — `TZ=Europe/Berlin` failed with
   * "No fixture row for process zone", which is not a bug in the code under
   * test. It also violated the standing rule that tests must never depend on the
   * machine's local time.
   *
   * Skipping instead, LOUDLY: the console line means a skip cannot be mistaken
   * for coverage, and the assertion above still fails if a SWEEP zone is
   * missing — so the zones that matter are enforced while a contributor in
   * Berlin gets a green suite.
   */
  /**
   * A SWEEP ZONE MAY NEVER SKIP.
   *
   * The skip below is for a contributor in Berlin; it is NOT for one of the ten
   * zones `run-unit-timezones.sh` exists to cover. Those are asserted here so a
   * lookup that stops finding its row fails LOUDLY on the machine that was told
   * to run it, rather than dropping 42 assertions and reporting PASS.
   *
   * Membership is decided by CANONICAL NAME (`processIsSweepZone`), never by
   * offset signature. A signature comparison would be circular here: the
   * signature is precisely what is under suspicion when this guard matters, so a
   * regression moves the process side and the sweep-zone side together and the
   * guard excuses itself instead of firing. `canonicalZone` handles the alias
   * this file already documents — `TZ=Asia/Kolkata` resolving to
   * `Asia/Calcutta` — which is why a bare `SWEEP_ZONES.includes()` will not do.
   */
  it('resolves a fixture row whenever the process zone is one the sweep runs', () => {
    if (!processIsSweepZone) return;
    expect(
      resolved,
      `${processZone} is a sweep zone but matched no fixture row — the row lookup ` +
        `regressed, or the fixture needs regenerating. The cross-zone assertions ` +
        `would otherwise have SKIPPED and reported a pass.`
    ).not.toBeNull();
  });

  if (!resolved) {
    // eslint-disable-next-line no-console
    console.warn(
      `[recipientEventDate.fixture] SKIPPED: no fixture row for ${processZone}. ` +
        `The cross-zone conversion assertions did not run on this machine. ` +
        `Run scripts/run-unit-timezones.sh, or add ${processZone} to VIEWER_ZONES ` +
        `in scripts/generate-event-date-fixture.mjs and regenerate.`
    );
    it.skip(`cross-zone assertions (no fixture row for ${processZone})`, () => {});
    return;
  }

  const { zone, row } = resolved;

  /**
   * The four tests below each walk all 4,977 fixture cases, and every case runs
   * the full save path — several `Intl` conversions apiece. Alone that is ~13s
   * of work for the file; sharing cores with the rest of the suite it is more.
   * Vitest's 5s default timed all three of the heaviest out in a full-suite run
   * while they passed in isolation, which is the worst failure shape available:
   * red on CI, green when you go looking. The budget is generous on purpose —
   * it exists to absorb scheduling noise, not to hide a real hang.
   */
  const FIXTURE_SWEEP_TIMEOUT_MS = 60_000;

  it(`covers a real spread of recipients from ${zone}`, () => {
    expect(row.cases.length).toBeGreaterThan(100);
  });

  it('converts the typed wall clock exactly as Postgres does', () => {
    const mismatches: string[] = [];
    for (const c of row.cases) {
      // Recipient zones whose IANA rules changed after the fixture's Postgres
      // release are compared in the self-destruct test below, not here — see
      // src/test/knownTzdataDivergence.ts.
      if (KNOWN_TZDATA_DIVERGENCE.has(c.recipient)) continue;
      const out = eventDatesForApi({
        dateStr: c.typedDate,
        timeStr: c.typedTime,
        // The end date as the USER picked it: span days on the viewer's own
        // calendar. The save counts that span and adds it to the recipient's
        // start day, which is what Postgres' `start_local::date + N` does.
        recurrenceEndDateStr: addDaysToIsoDay(c.typedDate, c.spanDays),
        timezone: c.recipient,
      });
      if (out.scheduledDate !== c.scheduledDate || out.scheduledTime !== c.scheduledTime) {
        mismatches.push(
          `${c.recipient} ${c.typedDate} ${c.typedTime}: expected ` +
            `${c.scheduledDate} ${c.scheduledTime}, got ${out.scheduledDate} ${out.scheduledTime}`
        );
      }
    }
    expect(mismatches.slice(0, 20)).toEqual([]);
  }, FIXTURE_SWEEP_TIMEOUT_MS);

  it('keeps a 30-day series exactly 30 doses long in the recipient calendar', () => {
    // The bug this protects: converting the END instant separately produced 31
    // occurrences from a Tokyo device when NZ entered DST mid-series — one of
    // them a day with no dose at all.
    const mismatches: string[] = [];
    for (const c of row.cases) {
      if (KNOWN_TZDATA_DIVERGENCE.has(c.recipient)) continue;
      const out = eventDatesForApi({
        dateStr: c.typedDate,
        timeStr: c.typedTime,
        recurrenceEndDateStr: addDaysToIsoDay(c.typedDate, c.spanDays),
        timezone: c.recipient,
      });
      if (out.recurrenceEndDate !== c.recurrenceEndDate) {
        mismatches.push(
          `${c.recipient} ${c.typedDate} ${c.typedTime}: end expected ` +
            `${c.recurrenceEndDate}, got ${out.recurrenceEndDate}`
        );
        continue;
      }
      // Postgres counted the occurrences; the span must reproduce that count.
      const doses = isoDaysBetween(out.scheduledDate, out.recurrenceEndDate as string) + 1;
      if (doses !== c.occurrences) {
        mismatches.push(
          `${c.recipient} ${c.typedDate} ${c.typedTime}: ${doses} doses, Postgres says ${c.occurrences}`
        );
      }
    }
    expect(mismatches.slice(0, 20)).toEqual([]);
  }, FIXTURE_SWEEP_TIMEOUT_MS);

  /**
   * The pin list's self-destruct, for THIS fixture. Every pinned recipient zone
   * present in the row must still produce at least one wall-clock mismatch
   * against Postgres under a runtime that is ahead of the fixtures. When the
   * fixture is regenerated from an upgraded Postgres this FAILS, which is the
   * point: the pin list has to be emptied, not left to hide a real regression.
   */
  it('every pinned recipient zone still actually diverges (else clear the pin list)', () => {
    if (!RUNTIME_IS_AHEAD_OF_FIXTURES) {
      expect(KNOWN_TZDATA_DIVERGENCE.size).toBe(0);
      return;
    }
    const present = new Set(row.cases.map((c) => c.recipient).filter((z) => KNOWN_TZDATA_DIVERGENCE.has(z)));
    expect(present.size).toBeGreaterThan(0);

    const stillDiverging = new Set<string>();
    for (const c of row.cases) {
      if (!present.has(c.recipient) || stillDiverging.has(c.recipient)) continue;
      const out = eventDatesForApi({
        dateStr: c.typedDate,
        timeStr: c.typedTime,
        recurrenceEndDateStr: addDaysToIsoDay(c.typedDate, c.spanDays),
        timezone: c.recipient,
      });
      if (
        out.scheduledDate !== c.scheduledDate ||
        out.scheduledTime !== c.scheduledTime ||
        out.recurrenceEndDate !== c.recurrenceEndDate
      ) {
        stillDiverging.add(c.recipient);
      }
    }
    const healed = [...present].filter((z) => !stillDiverging.has(z)).sort();
    expect(healed).toEqual([]);
  }, FIXTURE_SWEEP_TIMEOUT_MS);

  it('never lets the end date precede the start date', () => {
    // An inverted pair is a 400 on the current backend and, on the older one, a
    // series that silently generates ZERO occurrences.
    //
    // THIS TEST USED TO BE UNFALSIFIABLE. It passed `recurrenceEndDateStr:
    // c.typedDate` — end EQUALS start — so `isoDaysBetween` was always 0, the
    // `Math.max(0, …)` floor never engaged, and `end >= start` held by
    // construction. Deleting the floor left the whole suite green. It needs an
    // input where the end genuinely PRECEDES the start, which is the only case
    // the floor exists for.
    for (const c of row.cases) {
      // The user picked a repeat-until date 29 days BEFORE the start.
      const inverted = addDaysToIsoDay(c.typedDate, -29);
      const out = eventDatesForApi({
        dateStr: c.typedDate,
        timeStr: c.typedTime,
        recurrenceEndDateStr: inverted,
        timezone: c.recipient,
      });
      expect(
        (out.recurrenceEndDate as string) >= out.scheduledDate,
        `${c.recipient} ${c.typedDate} ${c.typedTime}: ${out.recurrenceEndDate} < ${out.scheduledDate}`
      ).toBe(true);
      // Floored to the start day exactly — a one-occurrence series, not a
      // negative span quietly reinterpreted as some other length.
      expect(out.recurrenceEndDate).toBe(out.scheduledDate);
    }
  }, FIXTURE_SWEEP_TIMEOUT_MS);

  it('still handles "repeat until the day it starts" as one occurrence', () => {
    for (const c of row.cases.slice(0, 40)) {
      const out = eventDatesForApi({
        dateStr: c.typedDate,
        timeStr: c.typedTime,
        recurrenceEndDateStr: c.typedDate,
        timezone: c.recipient,
      });
      expect(out.recurrenceEndDate).toBe(out.scheduledDate);
    }
  });

  /**
   * THE PROPERTY THAT KEEPS DATA STILL.
   *
   * `save(hydrate(stored)) === stored`, for every recipient zone, from this
   * viewer zone. An exact wall-clock assertion can be satisfied by a form that
   * converts consistently in ONE direction; only idempotence catches a
   * hydration that is not the inverse of its save — which is the shape of the
   * bug that reopened an 8 PM dose as 2 AM and moved it on save.
   */
  it('round-trips stored values unchanged (hydrate -> save is the identity)', () => {
    const mismatches: string[] = [];
    for (const c of row.cases) {
      const stored = {
        scheduledDate: c.scheduledDate,
        scheduledTime: c.scheduledTime,
        recurrenceEndDate: c.recurrenceEndDate,
      };
      const form = eventDatesFromApi({
        scheduledDate: stored.scheduledDate,
        scheduledTime: stored.scheduledTime,
        recurrenceEndDate: stored.recurrenceEndDate,
        timezone: c.recipient,
      });
      const back = eventDatesForApi({
        dateStr: form.dateStr,
        timeStr: form.timeStr,
        recurrenceEndDateStr: form.recurrenceEndDateStr,
        timezone: c.recipient,
      });
      if (
        back.scheduledDate !== stored.scheduledDate ||
        back.scheduledTime !== stored.scheduledTime ||
        back.recurrenceEndDate !== stored.recurrenceEndDate
      ) {
        mismatches.push(
          `${c.recipient}: ${stored.scheduledDate} ${stored.scheduledTime} ${stored.recurrenceEndDate}` +
            ` -> ${back.scheduledDate} ${back.scheduledTime} ${back.recurrenceEndDate}`
        );
      }
    }
    expect(mismatches.slice(0, 20)).toEqual([]);
  }, FIXTURE_SWEEP_TIMEOUT_MS);

  it('does not DRIFT across repeated open-and-save cycles', () => {
    // A one-time offset and an accumulating one look identical after a single
    // round trip. Mobile's compounded.
    const mismatches: string[] = [];
    for (const c of row.cases.slice(0, 60)) {
      let date = c.scheduledDate;
      let time = c.scheduledTime;
      let end = c.recurrenceEndDate;
      for (let cycle = 0; cycle < 4; cycle += 1) {
        const form = eventDatesFromApi({
          scheduledDate: date,
          scheduledTime: time,
          recurrenceEndDate: end,
          timezone: c.recipient,
        });
        const back = eventDatesForApi({
          dateStr: form.dateStr,
          timeStr: form.timeStr,
          recurrenceEndDateStr: form.recurrenceEndDateStr,
          timezone: c.recipient,
        });
        date = back.scheduledDate;
        time = back.scheduledTime as string;
        end = back.recurrenceEndDate as string;
      }
      if (date !== c.scheduledDate || time !== c.scheduledTime || end !== c.recurrenceEndDate) {
        mismatches.push(
          `${c.recipient}: drifted to ${date} ${time} ${end} from ${c.scheduledDate} ${c.scheduledTime} ${c.recurrenceEndDate}`
        );
      }
    }
    expect(mismatches.slice(0, 20)).toEqual([]);
  });
});

describe('DST-ambiguous wall clocks', () => {
  /**
   * A naive local time on a transition day may name TWO instants (the
   * fall-back repeated hour) or NONE (the spring-forward gap). Postgres
   * resolves the repeated hour to standard time, JS to daylight — neither is
   * wrong, so asserting an exact wall clock here would be asserting a
   * convention.
   *
   * IDEMPOTENCE is the property that actually matters, and it is reachable even
   * when the user picked an unambiguous time: from a -3:30 viewer, 04:30
   * converts to exactly Denver's fall-back instant.
   */
  const AMBIGUOUS = [
    { zone: 'America/Denver', date: '2026-11-01', time: '01:30' }, // repeated hour
    { zone: 'America/Denver', date: '2026-03-08', time: '02:30' }, // gap
    { zone: 'Pacific/Auckland', date: '2026-04-05', time: '02:30' }, // southern fall-back
    { zone: 'Pacific/Chatham', date: '2026-04-05', time: '03:15' }, // +12:45 fall-back
  ];

  it.each(AMBIGUOUS)('stays still across saves for $zone $date $time', ({ zone, date, time }) => {
    let d = date;
    let t = time;
    // The first hydrate/save may legitimately MOVE the value (a gap time names
    // no instant, so it resolves to a neighbouring one). What must not happen
    // is continued movement: after it settles, it stays settled.
    for (let i = 0; i < 2; i += 1) {
      const form = eventDatesFromApi({
        scheduledDate: d,
        scheduledTime: t,
        timezone: zone,
      });
      const back = eventDatesForApi({
        dateStr: form.dateStr,
        timeStr: form.timeStr,
        recurrenceEndDateStr: null,
        timezone: zone,
      });
      d = back.scheduledDate;
      t = back.scheduledTime as string;
    }
    const settledDate = d;
    const settledTime = t;

    for (let i = 0; i < 3; i += 1) {
      const form = eventDatesFromApi({
        scheduledDate: d,
        scheduledTime: t,
        timezone: zone,
      });
      const back = eventDatesForApi({
        dateStr: form.dateStr,
        timeStr: form.timeStr,
        recurrenceEndDateStr: null,
        timezone: zone,
      });
      d = back.scheduledDate;
      t = back.scheduledTime as string;
    }
    expect(`${d} ${t}`).toBe(`${settledDate} ${settledTime}`);
  });
});
