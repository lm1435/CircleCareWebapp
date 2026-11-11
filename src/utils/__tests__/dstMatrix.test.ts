/**
 * THE DST <-> STANDARD-TIME REGRESSION MATRIX (FIX-SPEC section 3), webapp.
 *
 * Runs the changed pure functions over every clock-change day of the spec's zones, in both directions:
 *   - BC-5  `isEventPastDue` / `isDoseConfirmable` flip exactly at the dose INSTANT;
 *   - BC-1  `extraDoseForApi` keeps the picked clock on the primary's circle day;
 *   - BC-8  preset rows are the preset clocks on the circle's own day;
 *   - BC-2  hydrate -> save returns the stored pair (with `heldStored`, gap rows included);
 *   - BC-4  the caption range, over the spec's viewer != circle pairs.
 *
 * The transitions are DISCOVERED from `Intl` (helpers/dstTransitions) and checked against the spec's table first; a
 * runtime whose tzdata differs fails loudly instead of testing the wrong day. Expected instants come from an in-test
 * oracle that reads Intl offsets on both sides, never from the functions under test. The viewer is the process zone
 * (TZ); the suite is green under all six zones the spec names.
 */
import { describe, expect, it } from 'vitest';
import { viewerRangeForCaption } from '@/components/calendar/zoneCaptionRange';
import { buildFirstRunMedication, buildSiblingDoseRequests } from '@/utils/firstRunMedication';
import { eventDatesForApi, eventDatesFromApi, extraDoseForApi } from '@/utils/recipientEventDate';
import { isDoseConfirmable, isEventPastDue } from '@/utils/timezone';
import { wallTimeToInstant } from '@/utils/wallTimeToInstant';
import {
  EXPECTED_2026,
  addDays,
  addMinutes,
  assertTableMatchesRuntime,
  discoverTransitions,
  offsetMinutes,
  oracleInstant,
  wallIn,
  type Transition,
} from './helpers/dstTransitions';

const ZONES = Object.keys(EXPECTED_2026);
const DST_ZONES = ZONES.filter((z) => discoverTransitions(z).length > 0);
const NO_DST_ZONES = ['Asia/Kolkata', 'Asia/Kathmandu', 'Asia/Tehran', 'America/Phoenix', 'America/Regina', 'Asia/Tokyo'];

it('this runtime\'s tzdata matches the spec table (else the matrix would test the wrong day)', () => {
  assertTableMatchesRuntime();
});

/** The wall times the spec asks for around one transition `tr` (D = tr.day), as [day, time, kind]. */
function wallTimes(tr: Transition): Array<[day: string, time: string, role: string]> {
  const D = tr.day;
  const rows: Array<[string, string, string]> = [
    [addDays(D, -1), '08:00', 'D-1 08:00'],
    [addDays(D, -1), '20:00', 'D-1 20:00'],
    [addDays(D, -1), tr.first, 'D-1 transition clock'],
    [D, addMinutes(tr.first, -1), 'D one minute before'],
    [D, tr.first, 'D first inside'],
    [D, addMinutes(tr.first, Math.floor(Math.abs(tr.deltaMinutes) / 2)), 'D middle'],
    [D, tr.last, 'D last inside'],
    [D, addMinutes(tr.last, 1), 'D first after'],
    [D, '08:00', 'D 08:00'],
    [D, '20:00', 'D 20:00'],
    [addDays(D, 1), tr.first, 'D+1 transition clock'],
    [addDays(D, 1), '08:00', 'D+1 08:00'],
    [addDays(D, 1), '20:00', 'D+1 20:00'],
  ];
  return rows;
}

const CASES: Array<[label: string, zone: string, day: string, time: string]> = [];
for (const zone of DST_ZONES) {
  for (const tr of discoverTransitions(zone)) {
    for (const [day, time, role] of wallTimes(tr)) CASES.push([`${zone} ${tr.kind} ${tr.day}: ${role} ${day} ${time}`, zone, day, time]);
  }
}
for (const zone of NO_DST_ZONES) {
  for (const day of ['2026-03-08', '2026-11-01']) {
    for (const time of ['00:00', '02:30', '08:00', '23:59']) CASES.push([`${zone} (no DST) ${day} ${time}`, zone, day, time]);
  }
}

describe('1. wallTimeToInstant (unchanged) agrees with the independent oracle on every row', () => {
  it.each(CASES)('%s', (_label, zone, day, time) => {
    expect(wallTimeToInstant(day, time, zone).toISOString()).toBe(oracleInstant(zone, day, time).toISOString());
  });
});

describe('2. BC-5 reached / past due flips exactly at the instant and never flips back', () => {
  it.each(CASES)('%s', (_label, zone, day, time) => {
    const due = oracleInstant(zone, day, time).getTime();
    // Only the dose's own day uses the instant branch; the day string is the circle's today at `now`.
    const dueDay = wallIn(zone, new Date(due)).day;
    // The dose is "today" for the whole window when `now` is on `day` in the zone; a gap time resolves a clock
    // later (still `day` unless the gap ends the day), so judge on the day the dose's instant is on.
    for (let minute = -180; minute <= 180; minute += 1) {
      const now = new Date(due + minute * 60000);
      if (wallIn(zone, now).day !== dueDay) continue; // the date-string branches are not under test
      if (dueDay !== day) continue;
      const past = isEventPastDue(day, time, zone, now);
      expect(past, `${zone} ${day} ${time} at ${minute} min`).toBe(minute > 0);
    }
  });

  it.each(CASES)('confirmable opens a window before the INSTANT: %s', (_label, zone, day, time) => {
    const due = oracleInstant(zone, day, time).getTime();
    if (wallIn(zone, new Date(due)).day !== day) return;
    const windowMin = 45;
    const opens = due - windowMin * 60000;
    const before = new Date(opens - 60000);
    const at = new Date(opens);
    // Only meaningful while both instants are on the dose's day (otherwise the tomorrow branch answers).
    if (wallIn(zone, before).day === day) expect(isDoseConfirmable(day, time, zone, before, windowMin)).toBe(false);
    if (wallIn(zone, at).day === day) expect(isDoseConfirmable(day, time, zone, at, windowMin)).toBe(true);
  });
});

describe('3. a daily 08:00 / 20:00 dose keeps its wall time across the change', () => {
  it.each(DST_ZONES.flatMap((zone) => discoverTransitions(zone).map((tr) => [zone, tr] as const)))('%s %s', (zone, tr) => {
    for (const time of ['08:00', '20:00']) {
      const days = [addDays(tr.day, -1), tr.day, addDays(tr.day, 1)];
      const instants = days.map((d) => wallTimeToInstant(d, time, zone));
      instants.forEach((instant, i) => expect(wallIn(zone, instant)).toEqual({ day: days[i], time }));
      for (let i = 0; i < 2; i++) {
        const diff = (instants[i + 1].getTime() - instants[i].getTime()) / 60000;
        const expected = 1440 - (offsetMinutes(zone, instants[i + 1].getTime()) - offsetMinutes(zone, instants[i].getTime()));
        expect(diff).toBe(expected);
        expect([1380, 1410, 1440, 1470, 1500, 1395, 1425, 1455]).toContain(diff);
      }
    }
  });
});

describe('4. BC-2 hydrate -> save returns the stored pair, gap and overlap rows included', () => {
  it.each(CASES)('%s', (_label, zone, day, time) => {
    const hydrated = eventDatesFromApi({ scheduledDate: day, scheduledTime: `${time}:00`, timezone: zone });
    const saved = eventDatesForApi({
      dateStr: hydrated.dateStr,
      timeStr: hydrated.timeStr,
      recurrenceEndDateStr: null,
      timezone: zone,
      heldInstant: hydrated.instant,
      heldStored: { scheduledDate: day, scheduledTime: `${time}:00`, instant: hydrated.instant as Date },
    });
    expect({ date: saved.scheduledDate, time: saved.scheduledTime }).toEqual({ date: day, time });
  });
});

describe('5. BC-1 extra doses keep the picked clock on the primary circle day', () => {
  const cases = DST_ZONES.flatMap((zone) => discoverTransitions(zone).map((tr) => [zone, tr.day] as const));
  it.each(cases)('%s on %s (and the days either side): 18:00 and 21:00', (zone, day) => {
    for (const d of [addDays(day, -1), day, addDays(day, 1)]) {
      for (const extra of ['18:00', '21:00']) {
        const p = eventDatesFromApi({ scheduledDate: d, scheduledTime: '08:00', timezone: zone });
        const e = eventDatesFromApi({ scheduledDate: d, scheduledTime: extra, timezone: zone });
        expect(
          extraDoseForApi({ dateStr: p.dateStr, timeStr: p.timeStr, extraTimeStr: e.timeStr, timezone: zone, heldInstant: p.instant, heldExtraInstant: e.instant })
        ).toEqual({ scheduledDate: d, scheduledTime: extra });
      }
    }
  });
});

describe('6. BC-8 preset rows are the preset clocks on the circle day', () => {
  const cases = DST_ZONES.flatMap((zone) => discoverTransitions(zone).map((tr) => [zone, tr.day] as const));
  it.each(cases)('%s on %s: twice daily saves 08:00 and 20:00', (zone, day) => {
    for (const d of [addDays(day, -1), day, addDays(day, 1)]) {
      const { primary, additionalTimes } = buildFirstRunMedication({
        name: 'Metformin',
        dosage: '',
        presetKey: 'twiceDaily',
        customTime: null,
        recurrence: 'daily',
        timezone: zone,
        circleTodayStr: d,
      });
      const rows = [primary, ...buildSiblingDoseRequests({ primary, additionalTimes, timezone: zone })];
      expect(rows.map((r) => [r.scheduled_date, r.scheduled_time])).toEqual([
        [d, '08:00'],
        [d, '20:00'],
      ]);
    }
  });
});

describe('7. BC-4 the caption range over the spec\'s viewer != circle pairs (both zones are arguments)', () => {
  const PAIRS: Array<[viewer: string, circle: string]> = [
    ['America/New_York', 'America/Phoenix'],
    ['America/Phoenix', 'America/Denver'],
    ['America/Denver', 'Asia/Tokyo'],
    ['Asia/Tokyo', 'America/Denver'],
    ['Europe/London', 'America/Denver'],
    ['Pacific/Auckland', 'America/Denver'],
    ['Asia/Kolkata', 'Australia/Lord_Howe'],
    ['America/Regina', 'America/Havana'],
  ];
  const f12 = (hm: string) => {
    const [h, m] = hm.split(':').map(Number);
    return { digits: `${h % 12 === 0 ? 12 : h % 12}:${String(m).padStart(2, '0')}`, suffix: h < 12 ? 'AM' : 'PM' };
  };
  const range12 = (from: string, to: string) => {
    const a = f12(from);
    const b = f12(to);
    return a.suffix === b.suffix ? `${a.digits} – ${b.digits} ${b.suffix}` : `${a.digits} ${a.suffix} – ${b.digits} ${b.suffix}`;
  };
  const norm = (text: string) => text.replace(/[  ]/g, ' ');

  it.each(PAIRS)('%s viewer, %s circle', (viewer, circle) => {
    const days = new Set<string>();
    for (const zone of [viewer, circle]) {
      for (const tr of discoverTransitions(zone)) [-1, 0, 1].forEach((n) => days.add(addDays(tr.day, n)));
    }
    expect(days.size).toBeGreaterThan(0);
    for (const day of days) {
      for (const [start, minutes] of [['17:00', 120], ['23:00', 180], ['01:00', 120]] as const) {
        const endWall = (() => {
          const [h, m] = start.split(':').map(Number);
          const total = h * 60 + m + minutes;
          return { day: addDays(day, Math.floor(total / 1440)), time: addMinutes(start, minutes) };
        })();
        const expected = range12(
          wallIn(viewer, oracleInstant(circle, day, start)).time,
          wallIn(viewer, oracleInstant(circle, endWall.day, endWall.time)).time
        );
        expect(
          norm(viewerRangeForCaption({ scheduledDate: day, startHm: start, durationMinutes: minutes, circleZone: circle, viewerZone: viewer, cycle: '12h' })),
          `${viewer} / ${circle} ${day} ${start} +${minutes}`
        ).toBe(expected);
      }
    }
  });
});
