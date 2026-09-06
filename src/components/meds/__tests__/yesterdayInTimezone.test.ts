import { describe, it, expect, afterEach, vi } from 'vitest';
import { getYesterdayInTimezone } from '../TodaysMeds';
import { getDateInTimezone } from '@/utils/timezone';

/**
 * "Yesterday" for the Needs Attention group must be resolved in the CARE
 * RECIPIENT's frame, and must not borrow the caregiver's calendar arithmetic.
 *
 * The implementation this replaced did `d.setDate(d.getDate() - 1)` and then
 * formatted the result in the recipient's zone. `setDate` is DEVICE-LOCAL, so
 * on the caregiver's own DST-transition days it steps 23h or 25h rather than
 * 24h, and when the recipient's local clock sits inside that slack of midnight
 * the reformatted day lands one short.
 */
afterEach(() => {
  vi.useRealTimers();
});

describe('getYesterdayInTimezone', () => {
  /**
   * Literal expectations at a pinned instant — NOT `addDays(getDateInTimezone(
   * timezone), -1)`, which is the implementation restated.
   *
   * That is what this test used to assert, and it was worthless: reverting to
   * the old device-local `setDate` implementation left it GREEN, because both
   * implementations agree on any day that is not a device DST transition. A
   * test that restates the code can only ever confirm the code equals itself.
   */
  it('is the recipient calendar day before, across the offset range', () => {
    // 2026-06-21T12:00:00Z — mid-year, no DST transition anywhere in this set,
    // so every expectation below is a plain fact about the offset.
    vi.setSystemTime(new Date('2026-06-21T12:00:00Z'));

    const cases: Array<[string, string, string]> = [
      // zone,                 recipient today, recipient yesterday
      ['Pacific/Kiritimati', '2026-06-22', '2026-06-21'], // +14 — already tomorrow
      ['Pacific/Chatham', '2026-06-22', '2026-06-21'], // +12:45
      ['Asia/Tokyo', '2026-06-21', '2026-06-20'], // +9
      ['Asia/Kathmandu', '2026-06-21', '2026-06-20'], // +5:45
      ['Etc/UTC', '2026-06-21', '2026-06-20'],
      ['America/Denver', '2026-06-21', '2026-06-20'], // -6
      ['America/St_Johns', '2026-06-21', '2026-06-20'], // -2:30 in DST
      ['Pacific/Midway', '2026-06-21', '2026-06-20'], // -11 — still yesterday
    ];

    for (const [zone, today, yesterday] of cases) {
      expect(getDateInTimezone(zone), `${zone} today`).toBe(today);
      expect(getYesterdayInTimezone(zone), `${zone} yesterday`).toBe(yesterday);
    }
  });

  /**
   * THE REGRESSION, pinned to the instant that produced it.
   *
   * 2026-11-01T17:00:00Z is 10:00 on Denver's fall-back morning — the device
   * day that `setDate(-1)` steps back by 25 hours, not 24. For a Bangkok
   * (UTC+7) recipient that instant is 2026-11-02 00:00 local, i.e. barely past
   * midnight, so a 25-hour step overshoots into 2026-10-31 and the group
   * silently drops a whole day of unanswered doses.
   *
   * The expectation is written as a literal, NOT derived from the function
   * under test: an expectation computed the same way the code computes it
   * would agree with the bug.
   */
  it('does not overshoot on the caregivers own fall-back day (Denver -> Bangkok)', () => {
    vi.setSystemTime(new Date('2026-11-01T17:00:00Z'));

    // Sanity: this really is just-past-midnight for the recipient.
    expect(getDateInTimezone('Asia/Bangkok')).toBe('2026-11-02');

    expect(getYesterdayInTimezone('Asia/Bangkok')).toBe('2026-11-01');
  });

  it('holds at the recipients own midnight boundary in a +14 zone', () => {
    vi.setSystemTime(new Date('2026-11-01T10:30:00Z'));
    expect(getDateInTimezone('Pacific/Kiritimati')).toBe('2026-11-02');
    expect(getYesterdayInTimezone('Pacific/Kiritimati')).toBe('2026-11-01');
  });
});
