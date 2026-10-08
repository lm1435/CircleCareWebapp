import {
  DAILY_UPDATE_OPEN_HOUR,
  MAX_BOUNDARY_TIMER_MS,
  addDaysToDateString,
  evaluateDailyUpdateWindow,
  formatDailyUpdateDate,
  isCalendarDate,
  isDateInDailyUpdateRange,
} from '../dailyUpdateWindow';

/**
 * Window logic twins of the mobile `useDailyUpdate` window cases (plan §8.2/§8.3).
 * Every instant is an explicit UTC `Date`, so nothing depends on the machine zone
 * (dev = America/Denver; `npm run test:timezones` sweeps others).
 */
const at = (iso: string): Date => new Date(iso);

// The same wall times expressed in UTC for each zone on 2026-10-08.
// New York EDT -4, Kolkata +5:30, Auckland NZDT +13.
const ZONES: Array<{ tz: string; at1859: string; at1900: string; at2359: string; atMidnight: string }> = [
  {
    tz: 'America/New_York',
    at1859: '2026-10-08T22:59:00Z',
    at1900: '2026-10-08T23:00:00Z',
    at2359: '2026-10-09T03:59:30Z',
    atMidnight: '2026-10-09T04:00:00Z',
  },
  {
    tz: 'Asia/Kolkata',
    at1859: '2026-10-08T13:29:00Z',
    at1900: '2026-10-08T13:30:00Z',
    at2359: '2026-10-08T18:29:30Z',
    atMidnight: '2026-10-08T18:30:00Z',
  },
  {
    tz: 'Pacific/Auckland',
    at1859: '2026-10-08T05:59:00Z',
    at1900: '2026-10-08T06:00:00Z',
    at2359: '2026-10-08T10:59:30Z',
    atMidnight: '2026-10-08T11:00:00Z',
  },
];

describe('evaluateDailyUpdateWindow', () => {
  it('opens at 19:00', () => {
    expect(DAILY_UPDATE_OPEN_HOUR).toBe(19);
  });

  describe.each(ZONES)('$tz', ({ tz, at1859, at1900, at2359, atMidnight }) => {
    it('is closed at 18:59 and counts down exactly one minute to 19:00', () => {
      const s = evaluateDailyUpdateWindow(tz, at(at1859));
      expect(s.inWindow).toBe(false);
      expect(s.localDate).toBe('2026-10-08');
      expect(s.msToNextBoundary).toBe(60_000);
    });

    it('is open at 19:00 on the recipient\'s date', () => {
      const s = evaluateDailyUpdateWindow(tz, at(at1900));
      expect(s.inWindow).toBe(true);
      expect(s.localDate).toBe('2026-10-08');
    });

    it('is still open at 23:59:30 and counts down 30 s to midnight', () => {
      const s = evaluateDailyUpdateWindow(tz, at(at2359));
      expect(s.inWindow).toBe(true);
      expect(s.localDate).toBe('2026-10-08');
      expect(s.msToNextBoundary).toBe(30_000);
    });

    it('closes at midnight and the local date rolls over', () => {
      const s = evaluateDailyUpdateWindow(tz, at(atMidnight));
      expect(s.inWindow).toBe(false);
      expect(s.localDate).toBe('2026-10-09');
    });
  });

  it('uses the RECIPIENT frame, not the viewer\'s: one instant, two zones, two answers', () => {
    // 23:30Z: 19:30 in New York (open) but 05:00 next day in Kolkata (closed).
    const instant = at('2026-10-08T23:30:00Z');
    expect(evaluateDailyUpdateWindow('America/New_York', instant).inWindow).toBe(true);
    const kolkata = evaluateDailyUpdateWindow('Asia/Kolkata', instant);
    expect(kolkata.inWindow).toBe(false);
    expect(kolkata.localDate).toBe('2026-10-09');
  });

  it('a Denver viewer of a Miami recipient sees it from 17:00 Denver time', () => {
    // 17:00 MDT = 23:00Z = 19:00 EDT.
    expect(evaluateDailyUpdateWindow('America/New_York', at('2026-10-08T23:00:00Z')).inWindow).toBe(
      true
    );
  });

  describe('midnight-DST zone (America/Santiago: 2026-09-06 00:00 does not exist)', () => {
    it('closes at the instant the clocks jump, and the next day is closed', () => {
      // 23:59 on Sep 5 at -04 is open; one minute later it is 01:00 Sep 6 at -03.
      const before = evaluateDailyUpdateWindow('America/Santiago', at('2026-09-06T03:59:00Z'));
      expect(before.inWindow).toBe(true);
      expect(before.localDate).toBe('2026-09-05');
      expect(before.msToNextBoundary).toBe(60_000);
      const after = evaluateDailyUpdateWindow('America/Santiago', at('2026-09-06T04:00:00Z'));
      expect(after.inWindow).toBe(false);
      expect(after.localDate).toBe('2026-09-06');
    });

    it('opens at 19:00 on the 23-hour day', () => {
      // 19:00 at -03 = 22:00Z.
      expect(
        evaluateDailyUpdateWindow('America/Santiago', at('2026-09-06T22:00:00Z')).inWindow
      ).toBe(true);
      expect(
        evaluateDailyUpdateWindow('America/Santiago', at('2026-09-06T21:59:00Z')).inWindow
      ).toBe(false);
    });
  });

  it('caps the wait so a DST jump before 19:00 cannot make the opening late by an hour', () => {
    // 00:30 EST on the spring-forward day: 18.5 wall hours to 19:00, 17.5 real ones.
    const s = evaluateDailyUpdateWindow('America/New_York', at('2026-03-08T05:30:00Z'));
    expect(s.inWindow).toBe(false);
    expect(s.msToNextBoundary).toBe(MAX_BOUNDARY_TIMER_MS);
  });

  it('subtracts the seconds already elapsed in the current minute', () => {
    const s = evaluateDailyUpdateWindow('America/New_York', at('2026-10-08T22:59:45.500Z'));
    expect(s.msToNextBoundary).toBe(14_500);
  });
});

describe('dated-view range', () => {
  it('accepts today and the seven days before it, nothing else', () => {
    expect(isDateInDailyUpdateRange('2026-10-08', '2026-10-08')).toBe(true);
    expect(isDateInDailyUpdateRange('2026-10-01', '2026-10-08')).toBe(true);
    expect(isDateInDailyUpdateRange('2026-09-30', '2026-10-08')).toBe(false);
    expect(isDateInDailyUpdateRange('2026-10-09', '2026-10-08')).toBe(false);
  });

  it('crosses month, year and DST boundaries by calendar day, never by 24 h', () => {
    expect(isDateInDailyUpdateRange('2026-02-26', '2026-03-05')).toBe(true);
    expect(isDateInDailyUpdateRange('2025-12-27', '2027-01-03')).toBe(false);
    expect(isDateInDailyUpdateRange('2026-12-27', '2027-01-03')).toBe(true);
    // Spring-forward week in the US.
    expect(addDaysToDateString('2026-03-08', 1)).toBe('2026-03-09');
    expect(addDaysToDateString('2026-03-01', -7)).toBe('2026-02-22');
  });

  it('rejects malformed and impossible dates', () => {
    for (const bad of ['2026-10-8', '20261008', '2026-02-30', 'yesterday', '', '2026-13-01']) {
      expect(isCalendarDate(bad)).toBe(false);
      expect(isDateInDailyUpdateRange(bad, '2026-10-08')).toBe(false);
    }
  });
});

describe('formatDailyUpdateDate', () => {
  it('formats a date-only string without any zone moving it', () => {
    expect(formatDailyUpdateDate('2026-10-08', 'en')).toBe('Thursday, Oct 8');
    expect(formatDailyUpdateDate('2026-10-08', 'es')).toBe('jueves, 8 oct');
  });
});
