// Pure date-string arithmetic — must be timezone-independent (dev machine is
// America/Denver; everything below uses UTC methods on YYYY-MM-DD strings).

import i18n from '@/i18n';
import {
  addDays,
  addMonths,
  daysBetween,
  formatDateForDisplay,
  formatTimestampInTimezone,
  getDayOfWeek,
  getMonthGridDays,
  getWeekDays,
  getWeekdayName,
  isSameMonth,
  startOfMonth,
  startOfWeek,
} from '../dateMath';

describe('addDays', () => {
  it('adds within a month', () => {
    expect(addDays('2026-06-07', 6)).toBe('2026-06-13');
  });

  it('crosses month and year boundaries', () => {
    expect(addDays('2026-06-30', 1)).toBe('2026-07-01');
    expect(addDays('2026-01-01', -1)).toBe('2025-12-31');
  });

  it('is unaffected by US DST transitions (UTC arithmetic)', () => {
    // 2026-03-08 is the US spring-forward date
    expect(addDays('2026-03-07', 1)).toBe('2026-03-08');
    expect(addDays('2026-03-08', 1)).toBe('2026-03-09');
  });
});

describe('daysBetween', () => {
  it('returns whole day spans', () => {
    expect(daysBetween('2026-06-07', '2026-06-13')).toBe(6);
    expect(daysBetween('2026-06-13', '2026-06-07')).toBe(-6);
  });
});

describe('getDayOfWeek / startOfWeek / getWeekDays', () => {
  it('uses 0=Sun..6=Sat (recurrence_days convention)', () => {
    expect(getDayOfWeek('2026-06-07')).toBe(0); // Sunday
    expect(getDayOfWeek('2026-06-12')).toBe(5); // Friday
  });

  it('startOfWeek returns the Sunday on/before the date', () => {
    expect(startOfWeek('2026-06-12')).toBe('2026-06-07');
    expect(startOfWeek('2026-06-07')).toBe('2026-06-07');
  });

  it('getWeekDays returns 7 consecutive days', () => {
    const days = getWeekDays('2026-06-07');
    expect(days).toHaveLength(7);
    expect(days[0]).toBe('2026-06-07');
    expect(days[6]).toBe('2026-06-13');
  });
});

describe('months', () => {
  it('startOfMonth / isSameMonth', () => {
    expect(startOfMonth('2026-06-12')).toBe('2026-06-01');
    expect(isSameMonth('2026-06-01', '2026-06-30')).toBe(true);
    expect(isSameMonth('2026-05-31', '2026-06-01')).toBe(false);
  });

  it('addMonths normalizes to the first of the target month', () => {
    expect(addMonths('2026-01-15', 1)).toBe('2026-02-01');
    expect(addMonths('2026-01-15', -1)).toBe('2025-12-01');
    expect(addMonths('2026-12-10', 1)).toBe('2027-01-01');
  });

  it('getMonthGridDays returns a 42-cell Sunday-first grid', () => {
    const grid = getMonthGridDays('2026-06-12'); // June 2026 starts on a Monday
    expect(grid).toHaveLength(42);
    expect(grid[0]).toBe('2026-05-31'); // Sunday before Jun 1
    expect(grid[41]).toBe('2026-07-11');
    expect(getDayOfWeek(grid[0])).toBe(0);
  });
});

describe('display formatting', () => {
  it('formats date-only strings without day rollover (UTC-noon pattern)', () => {
    expect(formatDateForDisplay('2026-06-12', { weekday: 'long' }, 'en')).toBe('Friday');
    expect(
      formatDateForDisplay('2026-06-12', { month: 'short', day: 'numeric', year: 'numeric' }, 'en')
    ).toBe('Jun 12, 2026');
  });

  it('getWeekdayName maps 0=Sun..6=Sat via Intl', () => {
    expect(getWeekdayName(0, 'short', 'en')).toBe('Sun');
    expect(getWeekdayName(3, 'short', 'en')).toBe('Wed');
    expect(getWeekdayName(6, 'short', 'en')).toBe('Sat');
  });

  it('formatTimestampInTimezone renders an ISO UTC instant in the target TZ', () => {
    expect(formatTimestampInTimezone('2026-06-12T13:05:00Z', 'America/Chicago', 'en')).toBe(
      '8:05 AM'
    );
  });
});

describe('formatDateForDisplay default locale', () => {
  // The `locale` param is now optional and trailing; when omitted it must
  // resolve from the live i18next language (no more manual `i18n.language`
  // threading at call sites). Isolate the global language change so it never
  // bleeds into sibling tests.
  const originalLanguage = i18n.language;

  afterEach(async () => {
    await i18n.changeLanguage(originalLanguage);
  });

  it('renders the localized short date from the active i18next language when no locale is passed', async () => {
    await i18n.changeLanguage('es');
    expect(formatDateForDisplay('2026-06-12', { month: 'short', day: 'numeric' })).toBe('12 jun');

    await i18n.changeLanguage('en');
    expect(formatDateForDisplay('2026-06-12', { month: 'short', day: 'numeric' })).toBe('Jun 12');
  });
});
