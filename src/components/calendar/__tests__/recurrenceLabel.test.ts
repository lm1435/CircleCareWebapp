import { formatRecurrenceLabel, formatWeekdayList } from '../recurrenceLabel';
import { nextDateOnWeekdays, orderedWeekdays } from '../dateMath';

/** Passes the key through with its interpolations, so the exact output is visible. */
const t = (key: string, opts?: Record<string, unknown>): string =>
  opts && Object.keys(opts).length ? `${key}(${JSON.stringify(opts)})` : key;

describe('weekday order follows the locale week start', () => {
  it('en starts on Sunday, es on Monday — 0=Sun throughout, never 7', () => {
    expect(orderedWeekdays('en')).toEqual([0, 1, 2, 3, 4, 5, 6]);
    expect(orderedWeekdays('es')).toEqual([1, 2, 3, 4, 5, 6, 0]);
  });

  it('orders by the BASE language, so a regional PDF locale reads like the app', () => {
    // CLDR starts es-MX on Sunday; the app UI (bare `es`) and mobile start on
    // Monday. The day list must read the same everywhere it appears.
    expect(orderedWeekdays('es-MX')).toEqual(orderedWeekdays('es'));
    expect(orderedWeekdays('en-GB')).toEqual(orderedWeekdays('en'));
  });
});

describe('formatWeekdayList', () => {
  it('renders short names in week order, whatever order the set was stored in', () => {
    expect(formatWeekdayList([5, 1, 3], 'en')).toBe('Mon, Wed, Fri');
    expect(formatWeekdayList([5, 1, 3], 'es')).toBe('lun, mié, vie');
  });

  it('puts Sunday LAST in Spanish and FIRST in English', () => {
    expect(formatWeekdayList([0, 3], 'en')).toBe('Sun, Wed');
    expect(formatWeekdayList([0, 3], 'es')).toBe('mié, dom');
  });

  it('drops values outside 0..6 and duplicates; empty for nothing valid', () => {
    expect(formatWeekdayList([7, -1, 2, 2, 1.5], 'en')).toBe('Tue');
    expect(formatWeekdayList([], 'en')).toBe('');
    expect(formatWeekdayList(null, 'en')).toBe('');
  });
});

describe('formatRecurrenceLabel — weekly with days', () => {
  it('labels a days series in the locale order', () => {
    const event = { recurrence_rule: 'weekly', recurrence_days: [5, 3, 1] };
    expect(formatRecurrenceLabel(event, t, 'en')).toBe(
      'calendar:recurrence.weeklyOn({"days":"Mon, Wed, Fri"})'
    );
    expect(formatRecurrenceLabel(event, t, 'es')).toBe(
      'calendar:recurrence.weeklyOn({"days":"lun, mié, vie"})'
    );
  });

  it('a weekly series without days, or with only invalid ones, is plain Weekly', () => {
    expect(formatRecurrenceLabel({ recurrence_rule: 'weekly', recurrence_days: null }, t, 'en')).toBe(
      'calendar:recurrence.weekly'
    );
    expect(formatRecurrenceLabel({ recurrence_rule: 'weekly', recurrence_days: [9] }, t, 'en')).toBe(
      'calendar:recurrence.weekly'
    );
  });
});

describe('nextDateOnWeekdays (string date math, 0=Sun)', () => {
  it('returns the date itself when it is on the set', () => {
    expect(nextDateOnWeekdays('2026-06-15', [1])).toBe('2026-06-15'); // Monday
  });

  it('moves forward to the next selected weekday, at most six days', () => {
    expect(nextDateOnWeekdays('2026-06-16', [1, 3, 5])).toBe('2026-06-17'); // Tue → Wed
    expect(nextDateOnWeekdays('2026-06-16', [1])).toBe('2026-06-22'); // Tue → next Mon
    expect(nextDateOnWeekdays('2026-06-15', [0])).toBe('2026-06-21'); // Mon → Sun (0)
  });

  it('crosses a month and a year boundary', () => {
    expect(nextDateOnWeekdays('2026-12-30', [5])).toBe('2027-01-01'); // Wed → Fri
  });

  it('is null for a set with no valid weekday', () => {
    expect(nextDateOnWeekdays('2026-06-15', [])).toBeNull();
    expect(nextDateOnWeekdays('2026-06-15', [7])).toBeNull();
  });
});
