import { describe, it, expect } from 'vitest';
import {
  convertTimeBetweenTimezones,
  formatEventTimeForDisplay,
  getTimezoneOffsetMinutes,
  timezonesAreDifferent,
} from '../timezone';
import offsetFixture from '@/test/fixtures/timezoneOffsets.json';

/**
 * Day wraparound at the EXTREMES of the offset range.
 *
 * Offsets run from -11:00 (Pacific/Niue, Pacific/Midway) to +14:00
 * (Pacific/Kiritimati), so two zones can sit TWENTY-FIVE HOURS apart. Code that
 * corrects a day boundary with a single `+/- 1440` step under-corrects there.
 *
 * ── WHY THESE ASSERT VALUES, NOT JUST VALIDITY ────────────────────────────
 *
 * The first version of this file asserted only that each rendered half was a
 * well-formed clock. That catches the LOUD failure — a negative hour, which is
 * what "-1:00 AM GMT-11" is — and misses the quiet one entirely.
 *
 * mobile-63 found the quiet one: with the recipient in Niue and the viewer in
 * Kiritimati, a 23:30 dose totals 2910 minutes; one -1440 step leaves 1470,
 * still >= 1440, so `viewerHours` is 24 — and `24 % 12 || 12` is 12 while
 * `24 >= 12` is PM. It renders "12:30 PM": a perfectly well-formed clock,
 * twelve hours wrong, on a medication time. A validity check passes it.
 *
 * So the expectations here come from POSTGRES offsets in the committed fixture,
 * not from the function under test. That distinction is the whole point —
 * mobile shipped a 53-test cross-zone suite that survived both mutations
 * because its expected values were derived from the code it was testing.
 *
 * `getTimezoneOffsetMinutes` appears on the expectation side in the last block,
 * legitimately: it is itself validated against Postgres for 553 zones x 10
 * instants in `timezoneOffsets.fixture.test.ts`, and shares no code with the
 * wraparound arithmetic under test here.
 */

/** An instant present in the committed Postgres offset fixture. */
const AT_ISO = '2026-06-21T12:00:00Z';
const AT = new Date(AT_ISO);

const PG_OFFSETS: Record<string, number> = (
  offsetFixture.samples as Array<{ instant: string; zones: Record<string, number> }>
).find((s) => s.instant === AT_ISO)!.zones;

// Every pairing that spans more than 24 hours, plus the fractional-offset
// zones, since nothing in this arithmetic may assume a whole hour.
const EXTREMES = [
  'Pacific/Kiritimati', // +14
  'Pacific/Apia', // +13
  'Pacific/Chatham', // +12:45
  'Pacific/Auckland', // +12/+13
  'Asia/Kathmandu', // +5:45
  'Asia/Kolkata', // +5:30
  'Etc/UTC', // the fixture keys only zones with a '/', so not bare 'UTC'
  'America/St_Johns', // -3:30
  'Pacific/Marquesas', // -9:30
  'Pacific/Honolulu', // -10
  'Pacific/Niue', // -11
  'Pacific/Midway', // -11
];

const CLOCKS: Array<[number, number]> = [
  [0, 0],
  [0, 30],
  [8, 0],
  [12, 45],
  [20, 0],
  [23, 30], // mobile's quiet case
  [23, 59],
];

/** Minute-of-day and day shift, from POSTGRES offsets alone. */
function expectedFromPostgres(
  hours: number,
  minutes: number,
  from: string,
  to: string
): { hours: number; minutes: number; dayOffset: number } {
  const total = hours * 60 + minutes + (PG_OFFSETS[to] - PG_OFFSETS[from]);
  const dayOffset = Math.floor(total / 1440);
  const minuteOfDay = total - dayOffset * 1440;
  return { hours: Math.floor(minuteOfDay / 60), minutes: minuteOfDay % 60, dayOffset };
}

describe('convertTimeBetweenTimezones vs Postgres offsets', () => {
  it('matches Postgres for every pairing, including the 25-hour ones', () => {
    const bad: string[] = [];
    for (const from of EXTREMES) {
      for (const to of EXTREMES) {
        for (const [h, m] of CLOCKS) {
          const got = convertTimeBetweenTimezones(h, m, from, to, AT);
          const want = expectedFromPostgres(h, m, from, to);
          if (
            got.hours !== want.hours ||
            got.minutes !== want.minutes ||
            got.dayOffset !== want.dayOffset
          ) {
            bad.push(
              `${from} -> ${to} at ${h}:${String(m).padStart(2, '0')}: expected ` +
                `${want.hours}:${want.minutes} (day ${want.dayOffset}), got ` +
                `${got.hours}:${got.minutes} (day ${got.dayOffset})`
            );
          }
        }
      }
    }
    expect(bad.slice(0, 20)).toEqual([]);
  });

  it('is still a real time of day in every pairing', () => {
    // The loud failure, kept alongside the value check: a negative hour is a
    // different symptom from a merely wrong one and is worth naming separately.
    const bad: string[] = [];
    for (const from of EXTREMES) {
      for (const to of EXTREMES) {
        for (const [h, m] of CLOCKS) {
          const out = convertTimeBetweenTimezones(h, m, from, to, AT);
          if (out.hours < 0 || out.hours > 23 || out.minutes < 0 || out.minutes > 59) {
            bad.push(`${from} -> ${to} at ${h}:${m} = ${out.hours}:${out.minutes}`);
          }
        }
      }
    }
    expect(bad.slice(0, 20)).toEqual([]);
  });

  it('THE QUIET CASE: Niue 23:30 read from Kiritimati is 00:30 +2d, never hour 24', () => {
    // Offsets from the Postgres fixture: Niue -660, Kiritimati +840 — 25 hours.
    expect(PG_OFFSETS['Pacific/Niue']).toBe(-660);
    expect(PG_OFFSETS['Pacific/Kiritimati']).toBe(840);

    // 23:30 in Niue is 10:30 UTC the next day, which is 00:30 in Kiritimati the
    // day after that: total 2910 minutes, i.e. 00:30 two calendar days on.
    const out = convertTimeBetweenTimezones(23, 30, 'Pacific/Niue', 'Pacific/Kiritimati', AT);
    expect(out.hours).toBe(0);
    expect(out.minutes).toBe(30);
    expect(out.dayOffset).toBe(2);

    // THE CORRUPTION, named precisely. One -1440 step leaves 1470, so the old
    // code produced hour 24 — and under a 12-hour clock `24 % 12 || 12` is 12
    // while `24 >= 12` is PM, rendering "12:30 PM". The right answer, 00:30,
    // renders "12:30 AM". Same digits, opposite half of the day, on a
    // medication time; no well-formedness check can tell them apart.
    expect(out.hours).not.toBe(24);
    const period = out.hours >= 12 ? 'PM' : 'AM';
    expect(`${out.hours % 12 || 12}:${out.minutes} ${period}`).toBe('12:30 AM');
  });

  it('THE LOUD CASE: Kiritimati 00:00 read from Niue is 23:00, not -1:00', () => {
    const out = convertTimeBetweenTimezones(0, 0, 'Pacific/Kiritimati', 'Pacific/Niue', AT);
    expect(out.hours).toBe(23);
    expect(out.minutes).toBe(0);
    expect(out.dayOffset).toBe(-2);
  });
});

describe('formatEventTimeForDisplay vs Postgres offsets', () => {
  /**
   * The viewer side is the PROCESS zone, so this covers one side of every
   * pairing per run — the sweep covers the rest.
   *
   * `formatEventTimeForDisplay` carries its OWN copy of the wraparound
   * arithmetic, so it needs its own ground-truth check rather than inheriting
   * the one above.
   */
  const viewerZone = new Intl.DateTimeFormat().resolvedOptions().timeZone;

  it('renders the viewer half at the right clock, not merely a valid one', () => {
    const viewerOffset = getTimezoneOffsetMinutes(viewerZone, AT);
    const bad: string[] = [];

    for (const recipient of EXTREMES) {
      const recipientOffset = PG_OFFSETS[recipient];
      if (recipientOffset === undefined) continue;

      for (const [h, m] of CLOCKS) {
        const clock = `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
        // 24-hour cycle on purpose: a 12-hour rendering is exactly what hides
        // an hour-24 bug behind a plausible "12:30 PM".
        const rendered = formatEventTimeForDisplay(clock, recipient, true, AT, '24h');

        const total = h * 60 + m - recipientOffset + viewerOffset;
        const minuteOfDay = total - Math.floor(total / 1440) * 1440;
        const want =
          `${String(Math.floor(minuteOfDay / 60)).padStart(2, '0')}:` +
          `${String(minuteOfDay % 60).padStart(2, '0')}`;

        const halves = rendered.split(' / ');
        const viewerHalf = halves[1];
        if (!viewerHalf) {
          // Legitimate only when the two zones share an offset — then there is
          // one time and no dual line at all.
          if (recipientOffset !== viewerOffset) {
            bad.push(`${recipient} ${clock} -> "${rendered}" (no viewer half)`);
          }
          continue;
        }
        const got = viewerHalf.trim().split(' ')[0];
        if (got !== want) {
          bad.push(`${recipient} ${clock} -> "${rendered}": viewer half ${got}, expected ${want}`);
        }
      }
    }
    expect(bad.slice(0, 20)).toEqual([]);
  });
});

describe('timezonesAreDifferent is evaluated at the given instant', () => {
  /**
   * The seasonal-divergence case. Phoenix does not observe DST; Denver does.
   * They are the same offset in January and an hour apart in July, so a gate
   * pinned to "now" tells a caregiver nothing on exactly the event whose time
   * is about to be converted.
   */
  const JAN = new Date('2026-01-15T12:00:00Z');
  const JUL = new Date('2026-07-15T12:00:00Z');

  it('says Phoenix and Denver agree in January and differ in July', () => {
    expect(timezonesAreDifferent('America/Phoenix', 'America/Denver', JAN)).toBe(false);
    expect(timezonesAreDifferent('America/Phoenix', 'America/Denver', JUL)).toBe(true);
  });

  it('says Brisbane and Sydney agree in July and differ in December', () => {
    expect(timezonesAreDifferent('Australia/Brisbane', 'Australia/Sydney', JUL)).toBe(false);
    expect(
      timezonesAreDifferent('Australia/Brisbane', 'Australia/Sydney', new Date('2026-12-15T12:00:00Z'))
    ).toBe(true);
  });

  it('still treats an ICU alias as the same zone', () => {
    // Behaviour, not names: a name compare would call these different.
    expect(timezonesAreDifferent('Asia/Kolkata', 'Asia/Calcutta', JUL)).toBe(false);
  });
});
