// VERBATIM PORT of mobile/src/__tests__/utils/timezone.test.ts.
// Adaptations: jest → vitest syntax, import paths, and the device timezone is
// pinned to America/New_York by spying on Intl.resolvedOptions (mobile pins it
// by mocking expo-localization in its global setup).

vi.mock('../../api/users', () => ({
  getCurrentUser: vi.fn(),
  updateProfile: vi.fn(),
}));

vi.mock('../../constants/config', () => ({
  devLog: vi.fn(),
  devWarn: vi.fn(),
  devError: vi.fn(),
  API_TIMEOUT: 30000,
  IS_DEV: false,
}));

import { getCurrentUser, updateProfile } from '../../api/users';
import type { User } from '../../api/users';
import {
  getDeviceTimezone,
  getTimezoneAbbreviation,
  getTimezoneLabel,
  formatTimeDisplay,
  formatTimeWithTimezone,
  formatDualTimezoneDisplay,
  convertTimeBetweenTimezones,
  formatEventTimeForDisplay,
  formatEventTimeCompact,
  timezonesAreDifferent,
  getTimezoneOffsetMinutes,
  convertDateToRecipientTimezone,
  syncDeviceTimezone,
} from '../../utils/timezone';

// Pin the "device" timezone to America/New_York for deterministic tests
// (the dev machine is America/Denver — tests must never depend on it).
// Only getDeviceTimezone() calls resolvedOptions(); formatToParts/format are unaffected.
vi.spyOn(Intl.DateTimeFormat.prototype, 'resolvedOptions').mockReturnValue({
  timeZone: 'America/New_York',
} as Intl.ResolvedDateTimeFormatOptions);

// ============================================================================
// getDeviceTimezone
// ============================================================================
describe('getDeviceTimezone', () => {
  it('should return a valid IANA timezone string', () => {
    const tz = getDeviceTimezone();
    expect(typeof tz).toBe('string');
    expect(tz.length).toBeGreaterThan(0);
  });

  it('should default to America/New_York when calendar timezone is unavailable', () => {
    // The mock returns America/New_York
    const tz = getDeviceTimezone();
    expect(tz).toBe('America/New_York');
  });
});

// ============================================================================
// getTimezoneAbbreviation
// ============================================================================
describe('getTimezoneAbbreviation', () => {
  // Positive tests
  it('should return ET for America/New_York', () => {
    expect(getTimezoneAbbreviation('America/New_York')).toBe('ET');
  });

  it('should return CT for America/Chicago', () => {
    expect(getTimezoneAbbreviation('America/Chicago')).toBe('CT');
  });

  it('should return MT for America/Denver', () => {
    expect(getTimezoneAbbreviation('America/Denver')).toBe('MT');
  });

  it('should return PT for America/Los_Angeles', () => {
    expect(getTimezoneAbbreviation('America/Los_Angeles')).toBe('PT');
  });

  it('should return AZ for America/Phoenix', () => {
    expect(getTimezoneAbbreviation('America/Phoenix')).toBe('AZ');
  });

  it('should return HT for Pacific/Honolulu', () => {
    expect(getTimezoneAbbreviation('Pacific/Honolulu')).toBe('HT');
  });

  it('should return ET for America/Detroit (alias)', () => {
    expect(getTimezoneAbbreviation('America/Detroit')).toBe('ET');
  });

  // Negative tests
  it('should fall back to last segment for unknown timezone', () => {
    expect(getTimezoneAbbreviation('Europe/London')).toBe('London');
  });

  it('should fall back to last segment for Asia timezone', () => {
    expect(getTimezoneAbbreviation('Asia/Tokyo')).toBe('Tokyo');
  });

  it('should return the full string if no slash present', () => {
    expect(getTimezoneAbbreviation('UTC')).toBe('UTC');
  });

  it('should handle empty string gracefully', () => {
    expect(getTimezoneAbbreviation('')).toBe('');
  });
});

// ============================================================================
// getTimezoneLabel
// ============================================================================
describe('getTimezoneLabel', () => {
  // Positive tests
  it('should return "Eastern Time" for America/New_York', () => {
    expect(getTimezoneLabel('America/New_York')).toBe('Eastern Time');
  });

  it('should return "Pacific Time" for America/Los_Angeles', () => {
    expect(getTimezoneLabel('America/Los_Angeles')).toBe('Pacific Time');
  });

  it('should return "Hawaii Time" for Pacific/Honolulu', () => {
    expect(getTimezoneLabel('Pacific/Honolulu')).toBe('Hawaii Time');
  });

  // Negative tests
  it('should return IANA timezone as-is for unknown timezone', () => {
    expect(getTimezoneLabel('Europe/London')).toBe('Europe/London');
  });

  it('should return empty string for empty input', () => {
    expect(getTimezoneLabel('')).toBe('');
  });
});

// ============================================================================
// formatTimeDisplay
// ============================================================================
describe('formatTimeDisplay', () => {
  // Positive tests
  it('should format midnight correctly', () => {
    expect(formatTimeDisplay(0, 0)).toBe('12:00 AM');
  });

  it('should format noon correctly', () => {
    expect(formatTimeDisplay(12, 0)).toBe('12:00 PM');
  });

  it('should format morning time correctly', () => {
    expect(formatTimeDisplay(8, 30)).toBe('8:30 AM');
  });

  it('should format evening time correctly', () => {
    expect(formatTimeDisplay(20, 45)).toBe('8:45 PM');
  });

  it('should format 1 PM correctly', () => {
    expect(formatTimeDisplay(13, 0)).toBe('1:00 PM');
  });

  it('should format 11 PM correctly', () => {
    expect(formatTimeDisplay(23, 59)).toBe('11:59 PM');
  });

  it('should pad single-digit minutes', () => {
    expect(formatTimeDisplay(9, 5)).toBe('9:05 AM');
  });

  // Edge cases
  it('should handle hour 0 as 12 AM', () => {
    expect(formatTimeDisplay(0, 0)).toBe('12:00 AM');
  });

  it('should handle 11:59 AM correctly', () => {
    expect(formatTimeDisplay(11, 59)).toBe('11:59 AM');
  });
});

// ============================================================================
// formatTimeWithTimezone
// ============================================================================
describe('formatTimeWithTimezone', () => {
  it('should include timezone abbreviation', () => {
    expect(formatTimeWithTimezone(14, 30, 'America/Denver')).toBe('2:30 PM MT');
  });

  it('should format midnight with timezone', () => {
    expect(formatTimeWithTimezone(0, 0, 'America/New_York')).toBe('12:00 AM ET');
  });

  it('should handle unknown timezone gracefully', () => {
    const result = formatTimeWithTimezone(8, 0, 'Europe/London');
    expect(result).toBe('8:00 AM London');
  });
});

// ============================================================================
// formatDualTimezoneDisplay
// ============================================================================
describe('formatDualTimezoneDisplay', () => {
  it('should show single time when timezones are the same', () => {
    const result = formatDualTimezoneDisplay(14, 30, 'America/New_York', 'America/New_York');
    expect(result).toBe('2:30 PM ET');
    expect(result).not.toContain('/');
  });

  it('should show dual times when timezones differ', () => {
    const result = formatDualTimezoneDisplay(14, 30, 'America/New_York', 'America/Chicago');
    expect(result).toContain('/');
    expect(result).toContain('ET');
    expect(result).toContain('CT');
  });
});

// ============================================================================
// convertTimeBetweenTimezones
// ============================================================================
describe('convertTimeBetweenTimezones', () => {
  it('should return same time for same timezone', () => {
    const result = convertTimeBetweenTimezones(14, 30, 'America/New_York', 'America/New_York');
    expect(result.hours).toBe(14);
    expect(result.minutes).toBe(30);
    expect(result.dayOffset).toBe(0);
  });

  it('should handle conversion that stays in same day', () => {
    // ET to CT should be -1 hour
    const result = convertTimeBetweenTimezones(14, 30, 'America/New_York', 'America/Chicago');
    expect(result.dayOffset).toBe(0);
  });

  it('should return valid hours (0-23)', () => {
    const result = convertTimeBetweenTimezones(23, 59, 'America/New_York', 'America/Los_Angeles');
    expect(result.hours).toBeGreaterThanOrEqual(0);
    expect(result.hours).toBeLessThan(24);
  });

  it('should return valid minutes (0-59)', () => {
    const result = convertTimeBetweenTimezones(14, 30, 'America/New_York', 'America/Denver');
    expect(result.minutes).toBeGreaterThanOrEqual(0);
    expect(result.minutes).toBeLessThan(60);
  });

  // Negative / edge cases
  it('should handle midnight conversion', () => {
    const result = convertTimeBetweenTimezones(0, 0, 'America/New_York', 'America/Los_Angeles');
    expect(result.hours).toBeGreaterThanOrEqual(0);
    expect(result.hours).toBeLessThan(24);
  });

  it('should gracefully handle invalid timezone string', () => {
    // Should not throw, returns original values on error
    const result = convertTimeBetweenTimezones(14, 30, 'Invalid/Timezone', 'Also/Invalid');
    expect(result.hours).toBe(14);
    expect(result.minutes).toBe(30);
    expect(result.dayOffset).toBe(0);
  });
});

// ============================================================================
// getTimezoneOffsetMinutes
// ============================================================================
describe('getTimezoneOffsetMinutes', () => {
  it('should return 0 for UTC', () => {
    expect(getTimezoneOffsetMinutes('UTC')).toBe(0);
  });

  it('should return a negative offset for US timezones', () => {
    // US timezones are behind UTC
    const offset = getTimezoneOffsetMinutes('America/New_York');
    expect(offset).toBeLessThan(0);
  });

  it('should return a positive offset for Asia/Tokyo', () => {
    const offset = getTimezoneOffsetMinutes('Asia/Tokyo');
    expect(offset).toBeGreaterThan(0);
  });

  it('should return 0 for invalid timezone (fallback)', () => {
    const offset = getTimezoneOffsetMinutes('Invalid/Timezone');
    expect(offset).toBe(0);
  });

  it('should return offset in reasonable range (-14h to +14h)', () => {
    const offset = getTimezoneOffsetMinutes('America/Los_Angeles');
    expect(offset).toBeGreaterThanOrEqual(-14 * 60);
    expect(offset).toBeLessThanOrEqual(14 * 60);
  });
});

// ============================================================================
// formatEventTimeForDisplay
// ============================================================================
describe('formatEventTimeForDisplay', () => {
  // Positive tests
  it('should format HH:MM time string correctly', () => {
    const result = formatEventTimeForDisplay('14:30', 'America/New_York');
    expect(result).toContain('2:30 PM');
    expect(result).toContain('ET');
  });

  it('should format HH:MM:SS time string correctly', () => {
    const result = formatEventTimeForDisplay('08:00:00', 'America/Chicago');
    expect(result).toContain('8:00 AM');
    expect(result).toContain('CT');
  });

  it('should show single timezone when viewer and recipient are in same timezone', () => {
    // Mock device timezone is America/New_York
    const result = formatEventTimeForDisplay('14:30', 'America/New_York', false);
    expect(result).not.toContain('/');
  });

  it('should show dual timezone when forced', () => {
    const result = formatEventTimeForDisplay('14:30', 'America/Chicago', true);
    expect(result).toContain('/');
  });

  // Negative tests
  it('should return original string for invalid time format', () => {
    expect(formatEventTimeForDisplay('invalid', 'America/New_York')).toBe('invalid');
  });

  it('should return original string for NaN hours', () => {
    expect(formatEventTimeForDisplay('ab:cd', 'America/New_York')).toBe('ab:cd');
  });

  it('should handle empty string gracefully', () => {
    const result = formatEventTimeForDisplay('', 'America/New_York');
    expect(typeof result).toBe('string');
  });

  it('should handle midnight time', () => {
    const result = formatEventTimeForDisplay('00:00', 'America/New_York');
    expect(result).toContain('12:00 AM');
  });

  it('should handle noon time', () => {
    const result = formatEventTimeForDisplay('12:00', 'America/New_York');
    expect(result).toContain('12:00 PM');
  });
});

// ============================================================================
// formatEventTimeCompact
// ============================================================================
describe('formatEventTimeCompact', () => {
  // Positive tests
  it('should format time with timezone abbreviation', () => {
    expect(formatEventTimeCompact('14:30', 'America/Denver')).toBe('2:30 PM MT');
  });

  it('should format morning time', () => {
    expect(formatEventTimeCompact('08:00', 'America/New_York')).toBe('8:00 AM ET');
  });

  it('should format midnight', () => {
    expect(formatEventTimeCompact('00:00', 'America/Chicago')).toBe('12:00 AM CT');
  });

  // Negative tests
  it('should return original for invalid time', () => {
    expect(formatEventTimeCompact('invalid', 'America/New_York')).toBe('invalid');
  });

  it('should return original for malformed time', () => {
    expect(formatEventTimeCompact('xx:yy', 'America/New_York')).toBe('xx:yy');
  });
});

// ============================================================================
// timezonesAreDifferent
// ============================================================================
describe('timezonesAreDifferent', () => {
  // Positive tests
  it('should return false for identical timezone strings', () => {
    expect(timezonesAreDifferent('America/New_York', 'America/New_York')).toBe(false);
  });

  it('should return true for different timezones with different offsets', () => {
    expect(timezonesAreDifferent('America/New_York', 'America/Los_Angeles')).toBe(true);
  });

  // Edge cases
  it('should return false for timezones with same offset but different names', () => {
    // America/New_York and America/Detroit should have the same offset
    expect(timezonesAreDifferent('America/New_York', 'America/Detroit')).toBe(false);
  });
});

// ============================================================================
// convertDateToRecipientTimezone
// ============================================================================
describe('convertDateToRecipientTimezone', () => {
  it('should convert a date to care recipient timezone', () => {
    const date = new Date('2024-06-15T14:30:00');
    const result = convertDateToRecipientTimezone(date, 'America/Chicago');
    expect(result).toHaveProperty('hours');
    expect(result).toHaveProperty('minutes');
    expect(result).toHaveProperty('dayOffset');
    expect(result.hours).toBeGreaterThanOrEqual(0);
    expect(result.hours).toBeLessThan(24);
  });

  it('should return same time when device and recipient timezone are the same', () => {
    // Device timezone is mocked as America/New_York
    const date = new Date('2024-06-15T14:30:00');
    const result = convertDateToRecipientTimezone(date, 'America/New_York');
    expect(result.dayOffset).toBe(0);
  });
});

// ============================================================================
// convertTimeBetweenTimezones - additional edge cases
// ============================================================================
describe('convertTimeBetweenTimezones additional', () => {
  it('should handle day wraparound when going west (negative totalMinutes)', () => {
    // Very early morning in Eastern, converting far west
    // 1:00 AM ET -> should potentially wrap to previous day in HT (Hawaii, -5h offset)
    const result = convertTimeBetweenTimezones(1, 0, 'America/New_York', 'Pacific/Honolulu');
    expect(result.hours).toBeGreaterThanOrEqual(0);
    expect(result.hours).toBeLessThan(24);
  });

  it('should handle day wraparound when going east (late night)', () => {
    // Late at night going east
    const result = convertTimeBetweenTimezones(23, 30, 'America/Los_Angeles', 'Asia/Tokyo');
    expect(result.hours).toBeGreaterThanOrEqual(0);
    expect(result.hours).toBeLessThan(24);
  });
});

// ============================================================================
// syncDeviceTimezone
// ============================================================================
describe('syncDeviceTimezone', () => {
  const mockGetCurrentUser = vi.mocked(getCurrentUser);
  const mockUpdateProfile = vi.mocked(updateProfile);

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('should set timezone when user has no timezone set', async () => {
    mockGetCurrentUser.mockResolvedValue({ timezone: null } as unknown as User);
    mockUpdateProfile.mockResolvedValue({} as unknown as User);

    await syncDeviceTimezone();

    expect(mockUpdateProfile).toHaveBeenCalledWith({ timezone: 'America/New_York' });
  });

  it('should skip update when user already has timezone set', async () => {
    mockGetCurrentUser.mockResolvedValue({ timezone: 'America/Chicago' } as unknown as User);

    await syncDeviceTimezone();

    expect(mockUpdateProfile).not.toHaveBeenCalled();
  });

  it('should handle errors gracefully', async () => {
    mockGetCurrentUser.mockRejectedValue(new Error('Network error'));

    // Should not throw
    await expect(syncDeviceTimezone()).resolves.toBeUndefined();
  });
});

// ============================================================================
// TDD TESTS: isEventPastDue
// ============================================================================
// This function should determine if a medication/event is past due by
// comparing times IN THE CARE RECIPIENT'S TIMEZONE, not device local time.
//
// BUG BEING FIXED: CalendarScreen.tsx and MedicationHistoryScreen.tsx both
// compare event.scheduled_time (in care recipient's TZ) with
// new Date().getHours() (device local time). When user and care recipient
// are in different timezones, this produces wrong results.
// ============================================================================
import { isEventPastDue, getCurrentHoursInTimezone, getRelativeDateLabel } from '../../utils/timezone';

describe('isEventPastDue', () => {
  // Scenario: User in ET (UTC-5), care recipient in MT (UTC-7)
  // Medication at 13:45 MT. Current time 15:44 ET = 13:44 MT.
  // BUG: device hours (15) > scheduled hours (13) → wrongly says past due
  // FIX: convert to MT → 13:44 < 13:45 → correctly says NOT past due
  it('should NOT mark as past due when recipient TZ time has not passed yet (cross-TZ)', () => {
    // Simulate: it's 15:44 ET (device) = 13:44 MT (recipient)
    // Medication is scheduled for 13:45 MT
    // Create a "now" that is 15:44 ET = 20:44 UTC (January, EST = UTC-5)
    const now = new Date('2026-01-15T20:44:00Z'); // 15:44 ET = 13:44 MT

    const result = isEventPastDue(
      '2026-01-15', // scheduled_date (in recipient TZ)
      '13:45:00', // scheduled_time (in recipient TZ = 1:45 PM MT)
      'America/Denver', // care recipient timezone
      now
    );

    expect(result).toBe(false);
  });

  // Scenario: User in PT (UTC-8), care recipient in ET (UTC-5)
  // Medication at 14:00 ET. Current time 11:30 PT = 14:30 ET.
  // BUG: device hours (11) < scheduled hours (14) → wrongly says NOT past due
  // FIX: convert to ET → 14:30 > 14:00 → correctly says past due
  it('should mark as past due when recipient TZ time HAS passed (cross-TZ)', () => {
    // Simulate: it's 11:30 PT (device) = 14:30 ET (recipient)
    // Medication is scheduled for 14:00 ET
    // 11:30 PT = 19:30 UTC (January, PST = UTC-8)
    const now = new Date('2026-01-15T19:30:00Z'); // 11:30 PT = 14:30 ET

    const result = isEventPastDue(
      '2026-01-15', // scheduled_date
      '14:00:00', // scheduled_time (2:00 PM ET)
      'America/New_York', // care recipient timezone
      now
    );

    expect(result).toBe(true);
  });

  // Same timezone - basic past due check
  it('should mark as past due when time has passed in same timezone', () => {
    // 3:00 PM ET, medication at 2:00 PM ET
    const now = new Date('2026-01-15T20:00:00Z'); // 15:00 ET

    const result = isEventPastDue('2026-01-15', '14:00:00', 'America/New_York', now);

    expect(result).toBe(true);
  });

  // Same timezone - not past due
  it('should NOT mark as past due when time has not passed in same timezone', () => {
    // 1:30 PM ET, medication at 2:00 PM ET
    const now = new Date('2026-01-15T18:30:00Z'); // 13:30 ET

    const result = isEventPastDue('2026-01-15', '14:00:00', 'America/New_York', now);

    expect(result).toBe(false);
  });

  // Past date is always past due
  it('should mark as past due when date is in the past', () => {
    const now = new Date('2026-01-15T20:00:00Z');

    const result = isEventPastDue(
      '2026-01-14', // yesterday
      '14:00:00',
      'America/New_York',
      now
    );

    expect(result).toBe(true);
  });

  // Future date is never past due
  it('should NOT mark as past due when date is in the future', () => {
    const now = new Date('2026-01-15T20:00:00Z');

    const result = isEventPastDue(
      '2026-01-16', // tomorrow
      '14:00:00',
      'America/New_York',
      now
    );

    expect(result).toBe(false);
  });

  // All-day event (no scheduled_time) on today is NOT past due
  it('should NOT mark all-day event on today as past due', () => {
    // 3 PM ET on Jan 15
    const now = new Date('2026-01-15T20:00:00Z');

    const result = isEventPastDue(
      '2026-01-15',
      null, // all-day event
      'America/New_York',
      now
    );

    expect(result).toBe(false);
  });

  // All-day event on past date IS past due
  it('should mark all-day event on past date as past due', () => {
    const now = new Date('2026-01-15T20:00:00Z');

    const result = isEventPastDue('2026-01-14', null, 'America/New_York', now);

    expect(result).toBe(true);
  });

  // Edge case: exactly at scheduled time (boundary)
  it('should NOT mark as past due when exactly at scheduled time', () => {
    // Exactly 14:00 ET
    const now = new Date('2026-01-15T19:00:00Z'); // 14:00 ET

    const result = isEventPastDue('2026-01-15', '14:00:00', 'America/New_York', now);

    // At the exact time, it's not "past" yet
    expect(result).toBe(false);
  });

  // Edge case: one minute after scheduled time
  it('should mark as past due one minute after scheduled time', () => {
    const now = new Date('2026-01-15T19:01:00Z'); // 14:01 ET

    const result = isEventPastDue('2026-01-15', '14:00:00', 'America/New_York', now);

    expect(result).toBe(true);
  });

  // DST transition: Spring forward (March, EDT = UTC-4)
  it('should handle DST correctly (spring forward)', () => {
    // March 15, 2026 - EDT (UTC-4)
    // 14:30 EDT = 18:30 UTC
    const now = new Date('2026-03-15T18:30:00Z');

    const result = isEventPastDue(
      '2026-03-15',
      '15:00:00', // 3:00 PM EDT
      'America/New_York',
      now
    );

    // 14:30 EDT < 15:00 EDT → not past due
    expect(result).toBe(false);
  });

  // DST: Summer time (June, MDT = UTC-6)
  it('should handle summer time correctly', () => {
    // June 15, 2026 - MDT (UTC-6)
    // 14:30 MDT = 20:30 UTC
    const now = new Date('2026-06-15T20:30:00Z');

    const result = isEventPastDue(
      '2026-06-15',
      '14:00:00', // 2:00 PM MDT
      'America/Denver',
      now
    );

    // 14:30 MDT > 14:00 MDT → past due
    expect(result).toBe(true);
  });

  // Cross-day scenario: it's past midnight in recipient's TZ but still yesterday locally
  it('should handle cross-day timezone differences correctly', () => {
    // 11:30 PM PT (Jan 15) = 2:30 AM ET (Jan 16)
    // now = 2026-01-16T07:30:00Z = 2:30 AM ET Jan 16
    const now = new Date('2026-01-16T07:30:00Z');

    // Event was scheduled for 23:00 ET on Jan 15
    const result = isEventPastDue('2026-01-15', '23:00:00', 'America/New_York', now);

    // It's now Jan 16 in ET, event was yesterday → past due
    expect(result).toBe(true);
  });
});

// ============================================================================
// TDD TESTS: getCurrentHoursInTimezone
// ============================================================================
// Returns fractional hours (e.g., 14.5 = 2:30 PM) for a given timezone.
// Used for the schedule view's current time indicator line.
//
// BUG BEING FIXED: CalendarScreen.tsx uses now.getHours() + now.getMinutes()/60
// which gives device local time, not care recipient's time.
// ============================================================================

describe('getCurrentHoursInTimezone', () => {
  // Basic conversion
  it('should return hours in the specified timezone, not device local', () => {
    // 20:30 UTC = 15:30 ET (January, EST = UTC-5)
    const now = new Date('2026-01-15T20:30:00Z');
    const hours = getCurrentHoursInTimezone('America/New_York', now);

    expect(hours).toBeCloseTo(15.5, 1); // 15 hours + 30 min = 15.5
  });

  it('should return correct hours for Mountain Time', () => {
    // 20:30 UTC = 13:30 MT (January, MST = UTC-7)
    const now = new Date('2026-01-15T20:30:00Z');
    const hours = getCurrentHoursInTimezone('America/Denver', now);

    expect(hours).toBeCloseTo(13.5, 1);
  });

  it('should return correct hours for Pacific Time', () => {
    // 20:30 UTC = 12:30 PT (January, PST = UTC-8)
    const now = new Date('2026-01-15T20:30:00Z');
    const hours = getCurrentHoursInTimezone('America/Los_Angeles', now);

    expect(hours).toBeCloseTo(12.5, 1);
  });

  it('should handle UTC directly', () => {
    const now = new Date('2026-01-15T14:45:00Z');
    const hours = getCurrentHoursInTimezone('UTC', now);

    expect(hours).toBeCloseTo(14.75, 1); // 14h 45min
  });

  it('should handle DST (summer EDT = UTC-4)', () => {
    // June 15, 18:00 UTC = 14:00 EDT (UTC-4)
    const now = new Date('2026-06-15T18:00:00Z');
    const hours = getCurrentHoursInTimezone('America/New_York', now);

    expect(hours).toBeCloseTo(14.0, 1);
  });

  it('should handle midnight correctly', () => {
    // 05:00 UTC = 00:00 ET (January, EST = UTC-5)
    const now = new Date('2026-01-15T05:00:00Z');
    const hours = getCurrentHoursInTimezone('America/New_York', now);

    expect(hours).toBeCloseTo(0.0, 1);
  });

  it('should handle late night correctly', () => {
    // 04:45 UTC = 23:45 ET (January, EST = UTC-5)
    const now = new Date('2026-01-15T04:45:00Z');
    const hours = getCurrentHoursInTimezone('America/New_York', now);

    expect(hours).toBeCloseTo(23.75, 1);
  });

  it('should return value between 0 and 24', () => {
    const now = new Date();
    const hours = getCurrentHoursInTimezone('America/Chicago', now);

    expect(hours).toBeGreaterThanOrEqual(0);
    expect(hours).toBeLessThan(24);
  });
});

// ============================================================================
// TDD TESTS: isEventPastDue - appointment completion scenario
// ============================================================================
// CalendarScreen line 409 uses `now.toTimeString().slice(0, 5)` to check if
// an appointment's scheduled time has passed. This uses device-local time
// instead of the care recipient's timezone.
//
// Scenario: Device in ET, care recipient in MT. Appointment at 14:00 MT.
// It's 15:30 ET (= 13:30 MT). Device time "15:30" > "14:00" → wrongly
// counts appointment as completed. Should compare in MT: 13:30 < 14:00 → NOT done.
// ============================================================================
describe('isEventPastDue - appointment completion', () => {
  it('should NOT count appointment as done when recipient TZ time has not passed (cross-TZ)', () => {
    // Device: 15:30 ET, Recipient: 13:30 MT, Appointment: 14:00 MT
    // 15:30 ET = 20:30 UTC (January, EST = UTC-5)
    const now = new Date('2026-01-15T20:30:00Z');

    const result = isEventPastDue(
      '2026-01-15',
      '14:00:00', // appointment at 2:00 PM MT
      'America/Denver', // care recipient timezone
      now
    );

    expect(result).toBe(false); // 13:30 MT < 14:00 MT
  });

  it('should count appointment as done when recipient TZ time HAS passed (cross-TZ)', () => {
    // Device: 12:30 PT, Recipient: 15:30 ET, Appointment: 14:00 ET
    // 12:30 PT = 20:30 UTC (January, PST = UTC-8)
    const now = new Date('2026-01-15T20:30:00Z');

    const result = isEventPastDue(
      '2026-01-15',
      '14:00:00', // appointment at 2:00 PM ET
      'America/New_York', // care recipient timezone
      now
    );

    expect(result).toBe(true); // 15:30 ET > 14:00 ET
  });
});

// ============================================================================
// TDD TESTS: getRelativeDateLabel
// ============================================================================
// MedicationHistoryScreen formatDate (line 696-720) determines "Today",
// "Yesterday", or a full date string for section headers. Currently uses
// device-local `new Date()` for today/yesterday, but the dates come from
// scheduled_date which is in the care recipient's timezone.
//
// BUG: When device is in a different timezone from the care recipient and
// it's near midnight, "Today"/"Yesterday" labels can be wrong.
//
// Example: Device at 12:30 AM ET (Jan 16), Recipient at 10:30 PM MT (Jan 15).
// Header for "2026-01-15" should show "Today" (still today in MT) but device
// sees it as yesterday.
// ============================================================================
describe('getRelativeDateLabel', () => {
  it('should return "today" when dateString matches today in recipient timezone', () => {
    // 20:00 UTC on Jan 15 = 15:00 ET (Jan 15) = 13:00 MT (Jan 15)
    const now = new Date('2026-01-15T20:00:00Z');

    const result = getRelativeDateLabel('2026-01-15', 'America/New_York', now);
    expect(result).toBe('today');
  });

  it('should return "yesterday" when dateString is yesterday in recipient timezone', () => {
    // 20:00 UTC on Jan 15 = 15:00 ET (Jan 15)
    const now = new Date('2026-01-15T20:00:00Z');

    const result = getRelativeDateLabel('2026-01-14', 'America/New_York', now);
    expect(result).toBe('yesterday');
  });

  it('should return null for older dates', () => {
    const now = new Date('2026-01-15T20:00:00Z');

    const result = getRelativeDateLabel('2026-01-13', 'America/New_York', now);
    expect(result).toBeNull();
  });

  it('should return null for future dates', () => {
    const now = new Date('2026-01-15T20:00:00Z');

    const result = getRelativeDateLabel('2026-01-16', 'America/New_York', now);
    expect(result).toBeNull();
  });

  // CROSS-TZ BUG SCENARIO:
  // 12:30 AM ET (Jan 16) = 05:30 UTC (Jan 16) = 10:30 PM MT (Jan 15)
  // "2026-01-15" should be "today" in MT, not "yesterday"
  it('should return "today" when it is still today in recipient TZ despite being tomorrow on device (cross-TZ)', () => {
    // 05:30 UTC on Jan 16 = 00:30 AM ET (Jan 16) = 10:30 PM MT (Jan 15)
    const now = new Date('2026-01-16T05:30:00Z');

    const result = getRelativeDateLabel('2026-01-15', 'America/Denver', now);
    expect(result).toBe('today');
  });

  // Opposite direction: device still on Jan 15, recipient already on Jan 16
  // 11:30 PM HT (Jan 15) = 04:30 AM ET (Jan 16) = 09:30 UTC (Jan 16)
  it('should return "today" when it is already tomorrow in recipient TZ (cross-TZ east)', () => {
    // 09:30 UTC on Jan 16 = 04:30 AM ET (Jan 16)
    const now = new Date('2026-01-16T09:30:00Z');

    const result = getRelativeDateLabel('2026-01-16', 'America/New_York', now);
    expect(result).toBe('today');
  });

  it('should handle DST correctly (summer EDT)', () => {
    // June 15, 20:00 UTC = 16:00 EDT
    const now = new Date('2026-06-15T20:00:00Z');

    const result = getRelativeDateLabel('2026-06-15', 'America/New_York', now);
    expect(result).toBe('today');
  });

  it('should return "yesterday" correctly across timezone boundary', () => {
    // 05:30 UTC Jan 16 = 00:30 AM ET (Jan 16) = 10:30 PM MT (Jan 15)
    // In MT, yesterday = Jan 14
    const now = new Date('2026-01-16T05:30:00Z');

    const result = getRelativeDateLabel('2026-01-14', 'America/Denver', now);
    expect(result).toBe('yesterday');
  });
});
