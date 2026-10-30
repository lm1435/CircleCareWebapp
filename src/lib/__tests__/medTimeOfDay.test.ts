import { describe, expect, it } from 'vitest';
import {
  MED_TIME_CHIPS,
  chipForTime,
  dayPartForTime,
  doseSortKey,
  groupByDayPart,
  minutesOfDay,
} from '../medTimeOfDay';

// The one definition of MORNING / MIDDAY / EVENING / BEDTIME shared by the add
// form's chips and the Medications page groups:
//   MORNING 05:00-10:59 · MIDDAY 11:00-15:59 · EVENING 16:00-20:59 · BEDTIME 21:00-04:59

describe('dayPartForTime: boundaries', () => {
  it.each([
    ['05:00', 'morning'],
    ['07:30', 'morning'],
    ['10:59', 'morning'],
    ['11:00', 'midday'],
    ['12:00', 'midday'],
    ['15:59', 'midday'],
    ['16:00', 'evening'],
    ['18:00', 'evening'],
    ['20:59', 'evening'],
    ['21:00', 'bedtime'],
    ['23:59', 'bedtime'],
    ['00:00', 'bedtime'],
    ['01:30', 'bedtime'],
    ['04:59', 'bedtime'],
    ['08:00:00', 'morning'],
    ['20:00:00', 'evening'],
  ] as const)('%s is %s', (time, part) => {
    expect(dayPartForTime(time)).toBe(part);
  });

  it('stored "24:00" (an old midnight spelling) is bedtime, not an error', () => {
    expect(minutesOfDay('24:00')).toBe(0);
    expect(dayPartForTime('24:00')).toBe('bedtime');
  });

  it('every time chip lands in the group of its own name', () => {
    for (const chip of MED_TIME_CHIPS) expect(dayPartForTime(chip.time)).toBe(chip.id);
  });
});

describe('chipForTime', () => {
  it('matches only the exact chip times, with or without seconds', () => {
    expect(chipForTime('08:00')).toBe('morning');
    expect(chipForTime('12:00:00')).toBe('midday');
    expect(chipForTime('18:00')).toBe('evening');
    expect(chipForTime('21:00')).toBe('bedtime');
    expect(chipForTime('08:05')).toBeNull();
    expect(chipForTime('')).toBeNull();
    expect(chipForTime(null)).toBeNull();
  });
});

describe('groupByDayPart', () => {
  it('orders groups morning to bedtime, omits empty ones, sorts rows by time', () => {
    const rows = [
      { time: '20:00', item: 'Atorvastatin' },
      { time: '08:00', item: 'Lisinopril' },
      { time: '07:30', item: 'Losartan' },
      { time: '12:30', item: 'Metformin' },
    ];
    const groups = groupByDayPart(rows);
    expect(groups.map((g) => g.part)).toEqual(['morning', 'midday', 'evening']);
    expect(groups[0].rows.map((r) => r.item)).toEqual(['Losartan', 'Lisinopril']);
  });

  it('keeps after-midnight doses AFTER 11 PM inside bedtime', () => {
    const groups = groupByDayPart([
      { time: '01:00', item: 'late' },
      { time: '23:00', item: 'night' },
      { time: '21:00', item: 'bed' },
    ]);
    expect(groups).toHaveLength(1);
    expect(groups[0].part).toBe('bedtime');
    expect(groups[0].rows.map((r) => r.item)).toEqual(['bed', 'night', 'late']);
    expect(doseSortKey('01:00')).toBeGreaterThan(doseSortKey('23:00'));
  });

  it('ties on time break by the supplied comparator (name)', () => {
    const groups = groupByDayPart(
      [
        { time: '08:00', item: 'Zinc' },
        { time: '08:00', item: 'Aspirin' },
      ],
      (a, b) => a.localeCompare(b)
    );
    expect(groups[0].rows.map((r) => r.item)).toEqual(['Aspirin', 'Zinc']);
  });

  it('one medication with two times is two rows in two groups', () => {
    const groups = groupByDayPart([
      { time: '08:00', item: 'Metformin' },
      { time: '20:00', item: 'Metformin' },
    ]);
    expect(groups.map((g) => [g.part, g.rows.length])).toEqual([
      ['morning', 1],
      ['evening', 1],
    ]);
  });
});
