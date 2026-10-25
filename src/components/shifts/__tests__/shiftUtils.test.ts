import { describe, expect, it } from 'vitest';
import type { CalendarEvent } from '@/api/calendarEvents';
import {
  canCoverShifts,
  canTakeFuture,
  seriesDefaultOpen,
  countOpen,
  countOpenUpcoming,
  hasShiftEnded,
  isWithin24hOfStart,
  patchOccurrences,
  shiftZonesDiffer,
  targetFor,
  formatShiftDuration,
  formatShiftRange,
  groupShiftsByDay,
  isShiftOpen,
  isShiftRepeating,
  lowerFirst,
  openShiftWindow,
  recurrenceEnum,
  reminderEnum,
  shiftEnd,
  shiftRootId,
  sortShifts,
} from '../shiftUtils';

function shift(over: Partial<CalendarEvent>): CalendarEvent {
  return {
    id: 's',
    circle_id: 'c',
    event_type: 'shift',
    title: 'Night',
    scheduled_date: '2026-10-19',
    scheduled_time: '20:00:00',
    duration_minutes: 720,
    created_at: '',
    updated_at: '',
    ...over,
  };
}

describe('shiftEnd (naive local, rolls past midnight)', () => {
  it('a day shift ends the same day', () => {
    expect(shiftEnd('2026-10-19', '08:00:00', 360)).toEqual({
      date: '2026-10-19',
      time: '14:00',
      nextDay: false,
    });
  });
  it('an overnight shift ends the next day, month and year boundaries included', () => {
    expect(shiftEnd('2026-10-19', '20:00', 720)).toEqual({ date: '2026-10-20', time: '08:00', nextDay: true });
    expect(shiftEnd('2026-12-31', '23:00', 120)).toEqual({ date: '2027-01-01', time: '01:00', nextDay: true });
  });
  it('a 24 h shift ends at the same time the next day', () => {
    expect(shiftEnd('2026-10-19', '09:00', 1440)).toEqual({ date: '2026-10-20', time: '09:00', nextDay: true });
  });
});

describe('shift rows', () => {
  it('open = nobody on it', () => {
    expect(isShiftOpen({ assigned_to: null })).toBe(true);
    expect(isShiftOpen({ assigned_to: undefined })).toBe(true);
    expect(isShiftOpen({ assigned_to: 'u1' })).toBe(false);
  });
  it('root id of a virtual occurrence is its parent; a root is itself', () => {
    expect(shiftRootId({ id: 'root_2026-10-20', parent_event_id: 'root' })).toBe('root');
    expect(shiftRootId({ id: 'root', parent_event_id: null })).toBe('root');
  });
  it('repeating = a rule or a parent', () => {
    expect(isShiftRepeating({ recurrence_rule: 'daily' })).toBe(true);
    expect(isShiftRepeating({ parent_event_id: 'r' })).toBe(true);
    expect(isShiftRepeating({})).toBe(false);
  });
  it('sorts by date, then start time; counts open; groups by day', () => {
    const a = shift({ id: 'a', scheduled_time: '20:00:00', assigned_to: 'u' });
    const b = shift({ id: 'b', scheduled_time: '08:00:00' });
    const c = shift({ id: 'c', scheduled_date: '2026-10-20', scheduled_time: '06:00:00' });
    expect(sortShifts([c, a, b]).map((s) => s.id)).toEqual(['b', 'a', 'c']);
    expect(countOpen([a, b, c])).toBe(2);
    const grouped = groupShiftsByDay([c, a, b]);
    expect([...grouped.keys()]).toEqual(['2026-10-19', '2026-10-20']);
    expect(grouped.get('2026-10-19')?.map((s) => s.id)).toEqual(['b', 'a']);
  });
  it('the badge window is today through today + 6', () => {
    expect(openShiftWindow('2026-10-19')).toEqual({ start: '2026-10-19', end: '2026-10-25' });
  });
});

describe('copy helpers', () => {
  it('lowercases the first letter in the locale', () => {
    expect(lowerFirst('Every day', 'en')).toBe('every day');
    expect(lowerFirst('', 'en')).toBe('');
  });
  it('formats a duration', () => {
    const t = (key: string, o?: Record<string, unknown>) => `${key}:${JSON.stringify(o)}`;
    expect(formatShiftDuration(720, t)).toBe('shifts:duration.hours:{"count":12}');
    expect(formatShiftDuration(90, t)).toBe('shifts:duration.mixed:{"hours":1,"minutes":30}');
    expect(formatShiftDuration(45, t)).toBe('shifts:duration.minutes:{"count":45}');
  });
  it('formats a range with the end past midnight on the next day, no zone when viewer == recipient', () => {
    const range = formatShiftRange(
      { scheduled_date: '2026-10-19', scheduled_time: '20:00:00', duration_minutes: 720 },
      Intl.DateTimeFormat().resolvedOptions().timeZone,
      '12h'
    );
    expect(range).toBe('8:00 PM – 8:00 AM');
  });
});

describe('analytics enums', () => {
  it('reminder', () => {
    expect([null, 60, 120, 240, 1440, 5].map(reminderEnum)).toEqual(['off', '1h', '2h', '4h', '1d', 'off']);
  });
  it('recurrence', () => {
    expect(recurrenceEnum(null, null)).toBe('none');
    expect(recurrenceEnum('daily', null)).toBe('daily');
    expect(recurrenceEnum('weekly', null)).toBe('weekly');
    expect(recurrenceEnum('weekly', [1, 3])).toBe('days');
  });
});

describe('badge: open shifts that have not ended', () => {
  const TZ = 'America/Chicago';
  // 2026-10-19 12:00 Chicago (CDT, UTC-5) = 17:00Z
  const NOW = new Date('2026-10-19T17:00:00Z');
  it('a shift is over once its naive END (past midnight included) has passed in the recipient zone', () => {
    const morning = shift({ scheduled_time: '06:00:00', duration_minutes: 360 }); // ends 12:00 sharp
    const earlier = shift({ scheduled_time: '06:00:00', duration_minutes: 300 }); // ended 11:00
    const overnight = shift({ scheduled_date: '2026-10-18', scheduled_time: '20:00:00', duration_minutes: 960 }); // ends 12:00 on the 19th
    const overnightLive = shift({ scheduled_date: '2026-10-18', scheduled_time: '20:00:00', duration_minutes: 1000 });
    expect(hasShiftEnded(morning, TZ, NOW)).toBe(true);
    expect(hasShiftEnded(earlier, TZ, NOW)).toBe(true);
    expect(hasShiftEnded(overnight, TZ, NOW)).toBe(true);
    expect(hasShiftEnded(overnightLive, TZ, NOW)).toBe(false);
  });
  it('counts open rows only, minus ended ones', () => {
    const ended = shift({ id: 'e', scheduled_time: '06:00:00', duration_minutes: 300 });
    const underway = shift({ id: 'u', scheduled_time: '10:00:00', duration_minutes: 480 });
    const later = shift({ id: 'l', scheduled_date: '2026-10-20' });
    const taken = shift({ id: 't', scheduled_date: '2026-10-20', assigned_to: 'x' });
    expect(countOpenUpcoming([ended, underway, later, taken], TZ, NOW)).toBe(2);
  });
});

describe('isWithin24hOfStart (exact instant)', () => {
  const TZ = 'America/Chicago';
  const NOW = new Date('2026-10-19T17:00:00Z'); // 12:00 CDT
  it('tomorrow 11:59 is within 24 h; tomorrow 12:01 is not (a date-only rule would say yes to both)', () => {
    expect(isWithin24hOfStart({ scheduled_date: '2026-10-20', scheduled_time: '11:59:00' }, TZ, NOW)).toBe(true);
    expect(isWithin24hOfStart({ scheduled_date: '2026-10-20', scheduled_time: '12:00:00' }, TZ, NOW)).toBe(true);
    expect(isWithin24hOfStart({ scheduled_date: '2026-10-20', scheduled_time: '12:01:00' }, TZ, NOW)).toBe(false);
  });
  it('a shift already under way counts', () => {
    expect(isWithin24hOfStart({ scheduled_date: '2026-10-19', scheduled_time: '06:00:00' }, TZ, NOW)).toBe(true);
  });
  it('is judged in the recipient zone, not the viewer\'s', () => {
    // 08:00 on the 20th in Tokyo is 2026-10-19T23:00Z: 6 h away.
    expect(isWithin24hOfStart({ scheduled_date: '2026-10-20', scheduled_time: '08:00:00' }, 'Asia/Tokyo', NOW)).toBe(true);
    expect(isWithin24hOfStart({ scheduled_date: '2026-10-21', scheduled_time: '08:00:00' }, 'Asia/Tokyo', NOW)).toBe(false);
  });
});

describe('optimistic patch targets (mobile parity)', () => {
  const mk = (id: string, date: string, who: string | null): CalendarEvent =>
    shift({ id: `${id}_${date}`, parent_event_id: 'root', scheduled_date: date, assigned_to: who });
  const rows = [
    mk('r', '2026-10-19', null),
    mk('r', '2026-10-20', null),
    mk('r', '2026-10-21', 'ana'),
    mk('r', '2026-10-22', null),
    shift({ id: 'other', parent_event_id: 'other', scheduled_date: '2026-10-22', assigned_to: null }),
  ];
  it('a future TAKE moves the tapped row and later OPEN rows only; someone else\'s rows keep their person', () => {
    const out = patchOccurrences(rows, targetFor(rows[0], 'future', 'take'), { assigned_to: 'me' });
    expect(out.map((r) => r.assigned_to)).toEqual(['me', 'me', 'ana', 'me', null]);
  });
  it('a future DROP / ASSIGN moves the rows held by the same person as the tapped one', () => {
    const dropped = patchOccurrences(rows, targetFor(rows[2], 'future', 'other'), { assigned_to: null });
    expect(dropped.map((r) => r.assigned_to)).toEqual([null, null, null, null, null]);
    const assign = patchOccurrences(rows, targetFor(rows[0], 'future', 'other'), { assigned_to: 'bo' });
    expect(assign.map((r) => r.assigned_to)).toEqual(['bo', 'bo', 'ana', 'bo', null]);
  });
  it('an occurrence patch touches only that date, and an untouched list keeps its reference', () => {
    const out = patchOccurrences(rows, targetFor(rows[1], 'occurrence', 'take'), { assigned_to: 'me' });
    expect(out.map((r) => r.assigned_to)).toEqual([null, 'me', 'ana', null, null]);
    expect(patchOccurrences(rows, { ...targetFor(rows[0], 'occurrence', 'take'), date: '2030-01-01' }, {})).toBe(rows);
  });
});

describe('zones are compared at the shift date', () => {
  it('Phoenix vs Denver agree in January, differ in July', () => {
    const spy = vi.spyOn(Intl.DateTimeFormat.prototype, 'resolvedOptions').mockReturnValue({
      timeZone: 'America/Phoenix',
    } as Intl.ResolvedDateTimeFormatOptions);
    try {
      expect(shiftZonesDiffer('2026-01-15', 'America/Denver')).toBe(false);
      expect(shiftZonesDiffer('2026-07-15', 'America/Denver')).toBe(true);
    } finally {
      spy.mockRestore();
    }
  });
});

describe('seriesDefaultOpen / canTakeFuture (mobile parity)', () => {
  const root = shift({ id: 'root', parent_event_id: null, recurrence_rule: 'daily', assigned_to: null });
  const physical = shift({ id: 'child', parent_event_id: 'root', recurrence_rule: null, assigned_to: null });

  it('reads the series default from the root, a virtual row or a loaded virtual sibling', () => {
    expect(seriesDefaultOpen(physical, [root])).toBe(true);
    expect(seriesDefaultOpen(physical, [{ ...root, assigned_to: 'ana' }])).toBe(false);
    const virtual = shift({ id: 'root_2026-10-21', parent_event_id: 'root', is_virtual: true, assigned_to: 'ana' });
    expect(seriesDefaultOpen(virtual, [])).toBe(false);
    expect(seriesDefaultOpen(physical, [virtual])).toBe(false);
  });

  it('is unknown (undefined) until the root is fetched, then read from it', () => {
    expect(seriesDefaultOpen(physical, [])).toBeUndefined();
    expect(seriesDefaultOpen(physical, [], { id: 'root', assigned_to: null })).toBe(true);
    expect(seriesDefaultOpen(physical, [], { id: 'root', assigned_to: 'ana' })).toBe(false);
    // A fetched root of ANOTHER series says nothing.
    expect(seriesDefaultOpen(physical, [], { id: 'other', assigned_to: null })).toBeUndefined();
  });

  it('future is offered for a repeating shift only when the default is open, or to owner / manager', () => {
    expect(canTakeFuture(physical, [], false)).toBe(false); // unknown: not offered yet
    expect(canTakeFuture(physical, [], false, { id: 'root', assigned_to: null })).toBe(true);
    expect(canTakeFuture(physical, [], false, { id: 'root', assigned_to: 'ana' })).toBe(false);
    expect(canTakeFuture(physical, [], true, { id: 'root', assigned_to: 'ana' })).toBe(true);
    expect(canTakeFuture(shift({ id: 'one', recurrence_rule: null, parent_event_id: null }), [], true)).toBe(false);
  });
});

describe('canCoverShifts (may put THEMSELVES on a shift)', () => {
  const people = [
    { id: 'u-ana', is_care_recipient: false },
    { id: 'u-rosa', is_care_recipient: true },
    { id: 'u-bare' },
  ];
  it('is true for a normal member and for a viewer not in the list', () => {
    expect(canCoverShifts(people, 'u-ana')).toBe(true);
    expect(canCoverShifts(people, 'u-bare')).toBe(true);
    expect(canCoverShifts(people, 'u-gone')).toBe(true);
    expect(canCoverShifts(people, null)).toBe(true);
  });
  it('is false for the care recipient', () => {
    expect(canCoverShifts(people, 'u-rosa')).toBe(false);
  });
});
