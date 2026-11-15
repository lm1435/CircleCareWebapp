/**
 * The cross-zone tables (helpers/zoneTables) cover EVERY zone of the shared sweep list, and every row is still the
 * case its table says it is. Runs the same in every process zone, so a zone added to scripts/timezones.txt without
 * rows fails a plain `npx vitest run` too, not only that zone of the sweep (which is how 28 zones went uncovered).
 * Expected values come from the Intl oracle (helpers/dstTransitions), never the app. Mobile twin:
 * mobile/src/__tests__/utils/zoneTablesCoverSweep.test.ts.
 */
import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { offsetMinutes as offsetMin, oracleInstant } from './helpers/dstTransitions';
import {
  BC1,
  BC8,
  DATE_FRAME_PAIRS,
  EXTRA_CLOCK_FAR,
  GATE,
  RECIPIENT_FRAME_CASES,
  SWEEP_ZONES,
  foldZone,
} from './helpers/zoneTables';

const expectedInstant = (zone: string, day: string, time: string) => oracleInstant(zone, day, time).getTime();
const dayIn = (ms: number, zone: string) =>
  new Intl.DateTimeFormat('en-CA', { year: 'numeric', month: '2-digit', day: '2-digit', timeZone: zone }).format(ms);
const SCREEN_NOW = Date.parse('2027-02-10T18:40:00Z');
const WEB_NOW = Date.parse('2026-11-12T12:00:00Z');
const FORM_NOW = Date.parse('2026-11-11T08:14:00Z');
const zones = [...SWEEP_ZONES];

describe('cross-zone tables cover the sweep list', () => {
  it('SWEEP_ZONES is exactly the shared sweep list (CircleCare/scripts/timezones.txt)', () => {
    // The list lives outside this repo (the CircleCare/ root links to mobile/scripts/timezones.txt); the sweep script
    // exports TZ_LIST_FILE. A clone of webapp alone has neither, and then only the table itself can be checked.
    const candidates = [
      process.env.TZ_LIST_FILE,
      path.resolve(__dirname, '..', '..', '..', '..', 'scripts', 'timezones.txt'),
      path.resolve(__dirname, '..', '..', '..', '..', 'mobile', 'scripts', 'timezones.txt'),
    ].filter((f): f is string => !!f && fs.existsSync(f));
    expect(zones.length).toBeGreaterThan(0);
    if (candidates.length === 0) return;
    const listed = fs
      .readFileSync(candidates[0], 'utf8')
      .split('\n')
      .filter((l) => l.trim() && !l.trim().startsWith('#'))
      .map((l) => l.trim().split(/\s+/)[0]);
    expect(zones).toEqual(listed);
  });

  it('every sweep zone, as the process reports it (ICU legacy spellings), folds back to its table key', () => {
    // Under TZ=Asia/Kathmandu the process says Asia/Katmandu: an unfolded spelling finds no row in any table.
    const unfolded = zones.filter((z) => foldZone(new Intl.DateTimeFormat('en', { timeZone: z }).resolvedOptions().timeZone) !== z);
    expect(unfolded).toEqual([]);
  });

  it('every table has a row for every sweep zone', () => {
    const missing = zones.flatMap((z) =>
      Object.entries({ BC1, BC8, GATE, DATE_FRAME_PAIRS, RECIPIENT_FRAME_CASES, EXTRA_CLOCK_FAR })
        .filter(([, table]) => !(table as Record<string, unknown>)[z])
        .map(([name]) => `${name}:${z}`)
    );
    expect(missing).toEqual([]);
  });

  it('BC-1 rows: primary 08:00 and the extra are on different viewer days, on both suite days', () => {
    const bad = zones.filter((z) => {
      const { circle, extra } = BC1[z];
      if (circle === z || dayIn(WEB_NOW, circle) !== '2026-11-12') return true;
      return ['2026-11-12', dayIn(SCREEN_NOW, circle)].some(
        (day) => dayIn(expectedInstant(circle, day, '08:00'), z) === dayIn(expectedInstant(circle, day, extra), z)
      );
    });
    expect(bad).toEqual([]);
  });

  it('BC-8 rows: the circle clock differs from the viewer clock at every chip, on both suite days', () => {
    const bad = zones.filter((z) => {
      const circle = BC8[z];
      if (circle === z || dayIn(WEB_NOW, circle) !== '2026-11-12') return true;
      return ['2026-11-12', dayIn(SCREEN_NOW, circle)].some((day) =>
        ['08:00', '18:00', '20:00', '21:00'].some((t) => {
          const ms = expectedInstant(circle, day, t);
          return offsetMin(z, ms) === offsetMin(circle, ms);
        })
      );
    });
    expect(bad).toEqual([]);
  });

  it('BC-3 rows: each "shown" is what the two zones say at the device instant', () => {
    const wrong = zones.flatMap((z) =>
      GATE[z]
        .filter((r) => {
          const ms = expectedInstant(z, r.date, r.time);
          return (r.circle !== z && offsetMin(z, ms) !== offsetMin(r.circle, ms)) !== r.shown;
        })
        .map((r) => `${z} ${r.circle} ${r.date} ${r.time}`)
    );
    expect(wrong).toEqual([]);
  });

  it('BC-3 rows: each device clock happens exactly once that day (never in a skipped or repeated hour)', () => {
    // A repeated clock has two instants and the answer depends on which reading is meant (the Jerusalem 01:00 row
    // on 2026-10-25 did); a skipped one has none.
    const wallOf = (zone: string, ms: number) =>
      new Intl.DateTimeFormat('en-CA', { timeZone: zone, hourCycle: 'h23', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' })
        .format(ms)
        .replace(', ', 'T');
    const occurrences = (zone: string, day: string, time: string) => {
      const wall = Date.parse(`${day}T${time}:00Z`);
      const offsets = new Set([-36, -12, 0, 12, 36].map((h) => offsetMin(zone, wall + h * 3600000)));
      return [...offsets].map((o) => wall - o * 60000).filter((ms) => wallOf(zone, ms) === `${day}T${time}`).length;
    };
    const bad = zones.flatMap((z) => GATE[z].filter((r) => occurrences(z, r.date, r.time) !== 1).map((r) => `${z} ${r.date} ${r.time}`));
    expect(bad).toEqual([]);
  });

  it('BC-3 rows on a clock-change day discriminate: one answer differs from the answer at device midnight', () => {
    // Every pair on one day whose answers differ is the bug's case; the zones listed in zoneTables without one have
    // no zone changing clocks to or from their offset in 2026.
    const NO_CLOCK_CHANGE_PARTNER = [
      'America/St_Johns', 'Asia/Tehran', 'Asia/Dubai', 'Asia/Kolkata', 'Asia/Kathmandu', 'Asia/Shanghai', 'Asia/Tokyo',
      'Pacific/Chatham', 'Pacific/Kiritimati', 'Pacific/Midway',
    ];
    const bad = zones
      .filter((z) => !NO_CLOCK_CHANGE_PARTNER.includes(z))
      .filter((z) => {
        const [a, b] = GATE[z];
        if (a.circle !== b.circle || a.date !== b.date || a.shown === b.shown) return true;
        const mid = expectedInstant(z, a.date, '00:00');
        const atMidnight = offsetMin(z, mid) !== offsetMin(a.circle, mid);
        return a.shown === atMidnight && b.shown === atMidnight;
      });
    expect(bad).toEqual([]);
  });

  it('date-frame pairs: two distinct circles, each at least 3 h from the viewer at every guard instant', () => {
    const DST_DAYS = ['2026-11-01', '2026-03-08', '2026-04-05'];
    const bad = zones.filter((z) => {
      const [c1, c2] = DATE_FRAME_PAIRS[z];
      if (c1 === c2) return true;
      return [c1, c2].some((c) =>
        c === z ||
        DST_DAYS.flatMap((d) => [expectedInstant(z, d, '23:50'), expectedInstant(c, d, '00:10')]).some(
          (ms) => Math.abs(offsetMin(c, ms) - offsetMin(z, ms)) < 180
        )
      );
    });
    expect(bad).toEqual([]);
  });

  it('recipient-frame cases: the chip\'s circle day is not its viewer day at the form\'s now', () => {
    const bad = zones.filter((z) => {
      const { circle, chip } = RECIPIENT_FRAME_CASES[z];
      const day = dayIn(FORM_NOW, circle);
      return dayIn(expectedInstant(circle, day, chip === 'morning' ? '08:00' : '21:00'), z) === day;
    });
    expect(bad).toEqual([]);
  });

  it('extra-clock far circles: two distinct circles whose clock differs from the viewer at 08:00', () => {
    const bad = zones.filter((z) => {
      const [c1, c2] = EXTRA_CLOCK_FAR[z];
      if (c1 === c2) return true;
      return [c1, c2].some((c) => {
        const ms = expectedInstant(c, dayIn(FORM_NOW, c), '08:00');
        return c === z || offsetMin(z, ms) === offsetMin(c, ms);
      });
    });
    expect(bad).toEqual([]);
  });
});
