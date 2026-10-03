import { defaultNewEventDate } from '../recipientEventDate';

/** The new-event default date is the RECIPIENT's day, whatever the device zone is. */
const CASES: Array<[string, string, string]> = [
  ['Pacific/Kiritimati', '2026-09-30T23:30:00Z', '2026-10-01'],
  ['Pacific/Kiritimati', '2026-10-01T10:30:00Z', '2026-10-02'],
  ['Pacific/Midway', '2026-10-01T10:30:00Z', '2026-09-30'],
  ['Asia/Tokyo', '2026-09-30T23:30:00Z', '2026-10-01'],
  ['America/Denver', '2026-10-01T05:30:00Z', '2026-09-30'],
  ['Asia/Kathmandu', '2026-09-30T18:20:00Z', '2026-10-01'],
  ['UTC', '2026-10-01T00:00:00Z', '2026-10-01'],
];

describe('defaultNewEventDate', () => {
  it.each(CASES)('%s at %s is %s', (tz, clock, expected) => {
    expect(defaultNewEventDate(tz, new Date(clock))).toBe(expected);
  });

  it('is empty (not a guessed day) while the zone is loading', () => {
    expect(defaultNewEventDate(null)).toBe('');
  });
});
