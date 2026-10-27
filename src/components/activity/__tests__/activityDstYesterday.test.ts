import { formatDateShort, formatDayLabel } from '../activityFormat';

/**
 * "Yesterday" is the previous CALENDAR day in the zone, not "now minus 24h".
 *
 * On a 23-hour spring-forward day, 24h before 00:30 lands at 23:30 two days
 * back, so the old code called the day-before-yesterday "Yesterday" and showed
 * the real yesterday as a plain date. The zone is an explicit argument, so these
 * cases are independent of the process zone.
 */

const t = (key: string) => key;

// [label, zone, now, yesterday, day before yesterday]
const CASES: Array<[string, string, string, string, string]> = [
  ['Denver, 00:30 MDT the day after spring-forward', 'America/Denver', '2027-03-15T06:30:00Z', '2027-03-14', '2027-03-13'],
  ['Sydney, 00:30 AEDT the day after spring-forward', 'Australia/Sydney', '2026-10-04T13:30:00Z', '2026-10-04', '2026-10-03'],
];

describe.each(CASES)('activity day labels across DST: %s', (_l, zone, nowIso, yesterday, dayBefore) => {
  const now = new Date(nowIso);

  it('formatDayLabel calls the previous calendar day "yesterday"', () => {
    expect(formatDayLabel(yesterday, t, 'en', zone, now)).toBe('yesterday');
    expect(formatDayLabel(dayBefore, t, 'en', zone, now)).not.toBe('yesterday');
  });

  it('formatDateShort calls the previous calendar day "yesterday"', () => {
    expect(formatDateShort(yesterday, t, 'en', zone, now)).toBe('yesterday');
    expect(formatDateShort(dayBefore, t, 'en', zone, now)).not.toBe('yesterday');
  });
});
