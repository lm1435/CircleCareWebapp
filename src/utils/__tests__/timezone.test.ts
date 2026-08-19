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
  formatTimeOfDay,
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
  normalizeTimeOfDay,
} from '../../utils/timezone';

// Pin the "device" timezone to America/New_York for deterministic tests
// (the dev machine is America/Denver — tests must never depend on it).
// Only getDeviceTimezone() calls resolvedOptions(); formatToParts/format are unaffected.
vi.spyOn(Intl.DateTimeFormat.prototype, 'resolvedOptions').mockReturnValue({
  timeZone: 'America/New_York',
} as Intl.ResolvedDateTimeFormatOptions);

// ============================================================================
// normalizeTimeOfDay
// ============================================================================

describe('normalizeTimeOfDay', () => {
  it('strips seconds from Postgres TIME values', () => {
    expect(normalizeTimeOfDay('22:00:00')).toBe('22:00');
    expect(normalizeTimeOfDay('07:00:00')).toBe('07:00');
    expect(normalizeTimeOfDay('23:59:59')).toBe('23:59');
    expect(normalizeTimeOfDay('00:00:00')).toBe('00:00');
  });

  it('leaves already-canonical HH:MM untouched', () => {
    expect(normalizeTimeOfDay('22:00')).toBe('22:00');
    expect(normalizeTimeOfDay('07:30')).toBe('07:30');
    expect(normalizeTimeOfDay('00:00')).toBe('00:00');
  });

  it('strips fractional seconds', () => {
    expect(normalizeTimeOfDay('22:00:00.000')).toBe('22:00');
    expect(normalizeTimeOfDay('08:15:30.123456')).toBe('08:15');
  });

  it('zero-pads a single-digit hour', () => {
    expect(normalizeTimeOfDay('7:05:00')).toBe('07:05');
    expect(normalizeTimeOfDay('9:30')).toBe('09:30');
  });

  it('tolerates surrounding whitespace', () => {
    expect(normalizeTimeOfDay(' 22:00:00 ')).toBe('22:00');
  });

  it('passes nullish and empty values through untouched', () => {
    expect(normalizeTimeOfDay(null)).toBeNull();
    expect(normalizeTimeOfDay(undefined)).toBeUndefined();
    expect(normalizeTimeOfDay('')).toBe('');
  });

  it('returns unrecognizable input as-is instead of throwing', () => {
    expect(() => normalizeTimeOfDay('not a time')).not.toThrow();
    expect(normalizeTimeOfDay('not a time')).toBe('not a time');
    expect(normalizeTimeOfDay('22')).toBe('22');
    expect(normalizeTimeOfDay('22:0')).toBe('22:0');
    expect(normalizeTimeOfDay('10:00 PM')).toBe('10:00 PM');
    expect(normalizeTimeOfDay('2026-08-09T22:00:00Z')).toBe('2026-08-09T22:00:00Z');
  });
});

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

  // Unmapped zones: Intl's short name, NOT the city.
  // This used to be `timezone.split('/').pop()`, which appended a CITY to every
  // rendered time — a Mexico City circle read "8:00 PM Mexico_City". An
  // abbreviation may never contain a '/' or a '_'.
  it('should return a real abbreviation, not the city, for an unmapped zone', () => {
    const abbr = getTimezoneAbbreviation('America/Mexico_City');
    expect(abbr).not.toBe('Mexico_City');
    expect(abbr).not.toContain('_');
    expect(abbr).not.toContain('/');
    // Mexico abolished DST in 2022, so this one is stable year-round.
    expect(abbr).toBe('CST');
  });

  it('should return a real abbreviation for an unmapped Asia zone', () => {
    // Japan has no DST either, so 'GMT+9' does not drift with the season.
    const abbr = getTimezoneAbbreviation('Asia/Tokyo');
    expect(abbr).not.toBe('Tokyo');
    expect(abbr).toBe('GMT+9');
  });

  it('should not leak a city for a DST-observing unmapped zone', () => {
    // Europe/London alternates GMT / GMT+1 across the year, so assert the
    // SHAPE rather than a value that would break every spring.
    const abbr = getTimezoneAbbreviation('Europe/London');
    expect(abbr).not.toBe('London');
    expect(abbr).toMatch(/^(?:GMT(?:[+-]\d{1,2}(?::\d{2})?)?|[A-Z]{2,5})$/);
  });

  it('should return the full string if no slash present', () => {
    expect(getTimezoneAbbreviation('UTC')).toBe('UTC');
  });

  it('should handle empty string gracefully', () => {
    expect(getTimezoneAbbreviation('')).toBe('');
  });

  it('should fall back to the last segment when Intl rejects the zone', () => {
    // A malformed id makes Intl throw; the old split('/') behaviour is kept as
    // the last resort so this never returns empty.
    expect(getTimezoneAbbreviation('Not/AZone')).toBe('AZone');
  });
});

// ============================================================================
// getTimezoneLabel
// ============================================================================
describe('getTimezoneLabel', () => {
  // i18next is NOT initialized in this file, so `t` is unavailable and every
  // curated label degrades to its English default — which is exactly the
  // pre-existing behaviour these assertions lock in. The LOCALIZED path lives
  // in ./timezone.i18n.test.ts, which boots a real i18next.

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

  // Unmapped zones. The old code returned the RAW IANA id, which landed inside
  // a translated sentence: "Times are saved in America/Mexico_City." Intl's
  // long name replaces it, so ANY zone reads as prose.
  it('should return a readable name, not the IANA id, for an unmapped zone', () => {
    const label = getTimezoneLabel('America/Mexico_City', 'en');
    expect(label).not.toBe('America/Mexico_City');
    expect(label).not.toContain('/');
    expect(label).not.toContain('_');
    expect(label).toBe('Central Standard Time');
  });

  it('should return a readable name for an unmapped European zone', () => {
    // London flips between GMT and BST, so assert the shape, not the season.
    const label = getTimezoneLabel('Europe/London', 'en');
    expect(label).not.toBe('Europe/London');
    expect(label).not.toContain('/');
    expect(label.length).toBeGreaterThan(3);
  });

  it('should fall back to the IANA id only when Intl rejects the zone', () => {
    expect(getTimezoneLabel('Not/AZone', 'en')).toBe('Not/AZone');
  });

  it('should return empty string for empty input', () => {
    expect(getTimezoneLabel('')).toBe('');
  });
});

// ============================================================================
// formatTimeOfDay — THE renderer every display site delegates to.
// The cycle is always passed EXPLICITLY here: these assertions must depend on
// the argument, never on the test runner's locale or the dev machine's clock.
// ============================================================================
describe('formatTimeOfDay', () => {
  it('renders the 12-hour cycle with AM/PM', () => {
    expect(formatTimeOfDay(0, 0, '12h')).toBe('12:00 AM');
    expect(formatTimeOfDay(9, 5, '12h')).toBe('9:05 AM');
    expect(formatTimeOfDay(11, 59, '12h')).toBe('11:59 AM');
    expect(formatTimeOfDay(12, 0, '12h')).toBe('12:00 PM');
    expect(formatTimeOfDay(13, 0, '12h')).toBe('1:00 PM');
    expect(formatTimeOfDay(23, 59, '12h')).toBe('11:59 PM');
  });

  it('renders the 24-hour cycle zero-padded, with no AM/PM', () => {
    expect(formatTimeOfDay(0, 0, '24h')).toBe('00:00');
    expect(formatTimeOfDay(9, 5, '24h')).toBe('09:05');
    expect(formatTimeOfDay(12, 0, '24h')).toBe('12:00');
    expect(formatTimeOfDay(13, 0, '24h')).toBe('13:00');
    expect(formatTimeOfDay(23, 59, '24h')).toBe('23:59');
    expect(formatTimeOfDay(14, 30, '24h')).not.toMatch(/[AP]M/);
  });

  // --------------------------------------------------------------------------
  // Language axis. Orthogonal to the cycle axis above: `cycle` picks the
  // DIGITS, `language` picks only the period marker.
  //
  // Spanish uses the RAE form `a. m.` / `p. m.` — lowercase, a period after
  // EACH letter, a space between the groups. The assertions are exact strings
  // so `a.m.`, `am` and `A. M.` all fail.
  // --------------------------------------------------------------------------
  describe('language', () => {
    it('renders the RAE meridiem in Spanish', () => {
      expect(formatTimeOfDay(0, 0, '12h', 'es')).toBe('12:00 a. m.');
      expect(formatTimeOfDay(9, 5, '12h', 'es')).toBe('9:05 a. m.');
      expect(formatTimeOfDay(11, 59, '12h', 'es')).toBe('11:59 a. m.');
      expect(formatTimeOfDay(12, 0, '12h', 'es')).toBe('12:00 p. m.');
      expect(formatTimeOfDay(13, 0, '12h', 'es')).toBe('1:00 p. m.');
      expect(formatTimeOfDay(20, 45, '12h', 'es')).toBe('8:45 p. m.');
      expect(formatTimeOfDay(23, 59, '12h', 'es')).toBe('11:59 p. m.');
    });

    it('renders ENGLISH byte-identically to before this change', () => {
      // Regression lock: an English user's screens must not have moved.
      // Explicit 'en' and the omitted-argument default must agree.
      const cases = [
        [0, 0, '12:00 AM'],
        [9, 5, '9:05 AM'],
        [11, 59, '11:59 AM'],
        [12, 0, '12:00 PM'],
        [13, 0, '1:00 PM'],
        [23, 59, '11:59 PM'],
      ] as const;
      for (const [h, m, expected] of cases) {
        expect(formatTimeOfDay(h, m, '12h', 'en')).toBe(expected);
        expect(formatTimeOfDay(h, m, '12h')).toBe(expected);
      }
    });

    it('leaves the 24h cycle byte-identical in both languages', () => {
      // There is no period marker under 24h, so that branch must not merely be
      // "similar" across languages — it must be the same bytes.
      for (let h = 0; h < 24; h++) {
        const en = formatTimeOfDay(h, 30, '24h', 'en');
        expect(formatTimeOfDay(h, 30, '24h', 'es')).toBe(en);
        expect(formatTimeOfDay(h, 30, '24h')).toBe(en);
        expect(formatTimeOfDay(h, 30, '24h', 'es')).toMatch(/^\d{2}:30$/);
      }
    });

    it('rejects the near-miss Spanish forms the RAE does not use', () => {
      const pm = formatTimeOfDay(14, 30, '12h', 'es');
      expect(pm).not.toBe('2:30 PM');
      expect(pm).not.toBe('2:30 pm');
      expect(pm).not.toBe('2:30 p.m.');
      expect(pm).not.toBe('2:30 P. M.');
      expect(pm).toBe('2:30 p. m.');
    });
  });
});

// ============================================================================
// formatTimeDisplay
// ============================================================================
describe('formatTimeDisplay', () => {
  // Positive tests
  it('should format midnight correctly', () => {
    expect(formatTimeDisplay(0, 0, '12h')).toBe('12:00 AM');
  });

  it('should format noon correctly', () => {
    expect(formatTimeDisplay(12, 0, '12h')).toBe('12:00 PM');
  });

  it('should format morning time correctly', () => {
    expect(formatTimeDisplay(8, 30, '12h')).toBe('8:30 AM');
  });

  it('should format evening time correctly', () => {
    expect(formatTimeDisplay(20, 45, '12h')).toBe('8:45 PM');
  });

  it('should format 1 PM correctly', () => {
    expect(formatTimeDisplay(13, 0, '12h')).toBe('1:00 PM');
  });

  it('should format 11 PM correctly', () => {
    expect(formatTimeDisplay(23, 59, '12h')).toBe('11:59 PM');
  });

  it('should pad single-digit minutes', () => {
    expect(formatTimeDisplay(9, 5, '12h')).toBe('9:05 AM');
  });

  // Edge cases
  it('should handle hour 0 as 12 AM', () => {
    expect(formatTimeDisplay(0, 0, '12h')).toBe('12:00 AM');
  });

  it('should handle 11:59 AM correctly', () => {
    expect(formatTimeDisplay(11, 59, '12h')).toBe('11:59 AM');
  });

  it('renders HH:MM under a 24-hour cycle', () => {
    expect(formatTimeDisplay(20, 45, '24h')).toBe('20:45');
    expect(formatTimeDisplay(0, 0, '24h')).toBe('00:00');
  });

  // `cycle` is REQUIRED — there is deliberately no "defaults to 12h" test.
  // The default was removed because it let every un-wired surface keep
  // rendering 12-hour for 24-hour users while the feature looked shipped;
  // `tsc` now rejects a call site that omits it (see utils/timezone.ts).
});

// ============================================================================
// formatTimeWithTimezone
// ============================================================================
describe('formatTimeWithTimezone', () => {
  it('should include timezone abbreviation', () => {
    expect(formatTimeWithTimezone(14, 30, 'America/Denver', '12h')).toBe('2:30 PM MT');
  });

  it('should format midnight with timezone', () => {
    expect(formatTimeWithTimezone(0, 0, 'America/New_York', '12h')).toBe('12:00 AM ET');
  });

  it('should handle unknown timezone gracefully', () => {
    // Was '8:00 AM London' — the old split('/').pop() appended the CITY.
    // Mexico City has no DST, so 'CST' is stable year-round.
    const result = formatTimeWithTimezone(8, 0, 'America/Mexico_City', '12h');
    expect(result).toBe('8:00 AM CST');
    expect(result).not.toContain('Mexico_City');
  });

  it('keeps the abbreviation under a 24-hour cycle', () => {
    expect(formatTimeWithTimezone(14, 30, 'America/Denver', '24h')).toBe('14:30 MT');
  });

});

// ============================================================================
// formatDualTimezoneDisplay
// ============================================================================
describe('formatDualTimezoneDisplay', () => {
  it('should show single time when timezones are the same', () => {
    const result = formatDualTimezoneDisplay(
      14,
      30,
      'America/New_York',
      'America/New_York',
      '12h'
    );
    expect(result).toBe('2:30 PM ET');
    expect(result).not.toContain('/');
  });

  it('renders both halves in the 24-hour cycle', () => {
    const result = formatDualTimezoneDisplay(
      14,
      30,
      'America/New_York',
      'America/New_York',
      '24h'
    );
    expect(result).toBe('14:30 ET');
  });

  it('should show dual times when timezones differ', () => {
    const result = formatDualTimezoneDisplay(
      14,
      30,
      'America/New_York',
      'America/Chicago',
      '12h'
    );
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
    const result = formatEventTimeForDisplay('14:30', 'America/New_York', undefined, undefined, '12h');
    expect(result).toContain('2:30 PM');
    expect(result).toContain('ET');
  });

  it('should format HH:MM:SS time string correctly', () => {
    const result = formatEventTimeForDisplay(
      '08:00:00',
      'America/Chicago',
      undefined,
      undefined,
      '12h'
    );
    expect(result).toContain('8:00 AM');
    expect(result).toContain('CT');
  });

  it('formats both halves in the 24-hour cycle', () => {
    const single = formatEventTimeForDisplay('14:30', 'America/New_York', false, undefined, '24h');
    expect(single).toBe('14:30 ET');

    const dual = formatEventTimeForDisplay('14:30', 'America/Chicago', true, undefined, '24h');
    expect(dual).toContain('14:30 CT');
    expect(dual).toContain('/');
    expect(dual).not.toMatch(/[AP]M/);
  });

  it('should show single timezone when viewer and recipient are in same timezone', () => {
    // Mock device timezone is America/New_York
    const result = formatEventTimeForDisplay(
      '14:30',
      'America/New_York',
      false,
      undefined,
      '12h'
    );
    expect(result).not.toContain('/');
  });

  it('should show dual timezone when forced', () => {
    const result = formatEventTimeForDisplay('14:30', 'America/Chicago', true, undefined, '12h');
    expect(result).toContain('/');
  });

  // Negative tests
  it('should return original string for invalid time format', () => {
    expect(
      formatEventTimeForDisplay('invalid', 'America/New_York', undefined, undefined, '12h')
    ).toBe('invalid');
  });

  it('should return original string for NaN hours', () => {
    expect(
      formatEventTimeForDisplay('ab:cd', 'America/New_York', undefined, undefined, '12h')
    ).toBe('ab:cd');
  });

  it('should handle empty string gracefully', () => {
    const result = formatEventTimeForDisplay('', 'America/New_York', undefined, undefined, '12h');
    expect(typeof result).toBe('string');
  });

  it('should handle midnight time', () => {
    const result = formatEventTimeForDisplay(
      '00:00',
      'America/New_York',
      undefined,
      undefined,
      '12h'
    );
    expect(result).toContain('12:00 AM');
  });

  it('should handle noon time', () => {
    const result = formatEventTimeForDisplay(
      '12:00',
      'America/New_York',
      undefined,
      undefined,
      '12h'
    );
    expect(result).toContain('12:00 PM');
  });
});

// ============================================================================
// formatEventTimeCompact
// ============================================================================
describe('formatEventTimeCompact', () => {
  // Positive tests
  it('should format time with timezone abbreviation', () => {
    expect(formatEventTimeCompact('14:30', 'America/Denver', '12h')).toBe('2:30 PM MT');
  });

  it('should format morning time', () => {
    expect(formatEventTimeCompact('08:00', 'America/New_York', '12h')).toBe('8:00 AM ET');
  });

  it('should format midnight', () => {
    expect(formatEventTimeCompact('00:00', 'America/Chicago', '12h')).toBe('12:00 AM CT');
  });

  it('formats in the 24-hour cycle', () => {
    expect(formatEventTimeCompact('14:30', 'America/Denver', '24h')).toBe('14:30 MT');
    expect(formatEventTimeCompact('08:00', 'America/New_York', '24h')).toBe('08:00 ET');
    expect(formatEventTimeCompact('00:00', 'America/Chicago', '24h')).toBe('00:00 CT');
  });

  // Negative tests
  it('should return original for invalid time', () => {
    expect(formatEventTimeCompact('invalid', 'America/New_York', '12h')).toBe('invalid');
  });

  it('should return original for malformed time', () => {
    expect(formatEventTimeCompact('xx:yy', 'America/New_York', '12h')).toBe('xx:yy');
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
import {
  isEventPastDue,
  getCurrentHoursInTimezone,
  getRelativeDateLabel,
  formatTimeForAPI,
  formatDateTimeForAPI,
} from '../../utils/timezone';

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

// ============================================================================
// WRITE-SIDE FORMATTERS: formatTimeForAPI
// ============================================================================
// Returns the time-of-day of an instant AS SEEN IN a timezone, "HH:MM" (24h).
// Inputs are built explicitly from UTC so tests never depend on machine TZ
// (dev machine is America/Denver).
// ============================================================================
describe('formatTimeForAPI', () => {
  it('should format an afternoon instant in the given timezone', () => {
    // 19:00 UTC on Jan 15 = 14:00 ET (EST = UTC-5)
    const date = new Date(Date.UTC(2026, 0, 15, 19, 0, 0));
    expect(formatTimeForAPI(date, 'America/New_York')).toBe('14:00');
  });

  it('should render the same instant differently across timezones', () => {
    // 19:00 UTC = 14:00 ET = 12:00 MT (EST=UTC-5, MST=UTC-7)
    const date = new Date(Date.UTC(2026, 0, 15, 19, 0, 0));
    expect(formatTimeForAPI(date, 'America/New_York')).toBe('14:00');
    expect(formatTimeForAPI(date, 'America/Denver')).toBe('12:00');
  });

  it('should format midnight as 00:00 (not 24:00)', () => {
    // 05:00 UTC on Jan 15 = 00:00 ET (EST = UTC-5)
    const date = new Date(Date.UTC(2026, 0, 15, 5, 0, 0));
    expect(formatTimeForAPI(date, 'America/New_York')).toBe('00:00');
  });

  it('should format noon as 12:00', () => {
    // 17:00 UTC on Jan 15 = 12:00 ET (EST = UTC-5)
    const date = new Date(Date.UTC(2026, 0, 15, 17, 0, 0));
    expect(formatTimeForAPI(date, 'America/New_York')).toBe('12:00');
  });

  it('should zero-pad single-digit hours and minutes', () => {
    // 14:05 UTC on Jan 15 = 09:05 ET (EST = UTC-5)
    const date = new Date(Date.UTC(2026, 0, 15, 14, 5, 0));
    expect(formatTimeForAPI(date, 'America/New_York')).toBe('09:05');
  });

  it('should handle UTC directly', () => {
    const date = new Date(Date.UTC(2026, 0, 15, 8, 30, 0));
    expect(formatTimeForAPI(date, 'UTC')).toBe('08:30');
  });
});

// ============================================================================
// WRITE-SIDE FORMATTERS: formatDateTimeForAPI
// ============================================================================
// Returns { scheduled_date (YYYY-MM-DD), scheduled_time (HH:MM) } for an instant
// AS SEEN IN a timezone. A TZ shift that crosses midnight must roll the DATE.
// ============================================================================
describe('formatDateTimeForAPI', () => {
  it('should roll the date forward when the TZ shift crosses midnight (Denver -> NY)', () => {
    // A late-evening Denver instant is already the next calendar day in NY.
    // 23:00 MST (Jan 15, MST = UTC-7) = 06:00 UTC (Jan 16) = 01:00 ET (Jan 16).
    // Recipient in NY: date must be D+1 (Jan 16), time 01:00 — NOT the Denver date.
    const instant = new Date(Date.UTC(2026, 0, 16, 6, 0, 0));
    const result = formatDateTimeForAPI(instant, 'America/New_York');
    expect(result.scheduled_date).toBe('2026-01-16');
    expect(result.scheduled_time).toBe('01:00');
  });

  it('should keep a 9:00 PM Denver instant on the same NY date when it does not cross', () => {
    // 21:00 MST (Jan 15) = 04:00 UTC (Jan 16) = 23:00 ET (Jan 15) -> still Jan 15 in NY.
    const instant = new Date(Date.UTC(2026, 0, 16, 4, 0, 0));
    const result = formatDateTimeForAPI(instant, 'America/New_York');
    expect(result.scheduled_date).toBe('2026-01-15');
    expect(result.scheduled_time).toBe('23:00');
  });

  it('should return the same date and time when the TZ matches (no shift)', () => {
    // 14:30 ET on Jan 15 = 19:30 UTC (EST = UTC-5)
    const instant = new Date(Date.UTC(2026, 0, 15, 19, 30, 0));
    const result = formatDateTimeForAPI(instant, 'America/New_York');
    expect(result.scheduled_date).toBe('2026-01-15');
    expect(result.scheduled_time).toBe('14:30');
  });

  it('should roll the date BACKWARD when the TZ is west and the instant is just past UTC midnight', () => {
    // 02:00 UTC Jan 16 = 21:00 ET (Jan 15, EST = UTC-5) -> NY date is the prior day.
    const instant = new Date(Date.UTC(2026, 0, 16, 2, 0, 0));
    const result = formatDateTimeForAPI(instant, 'America/New_York');
    expect(result.scheduled_date).toBe('2026-01-15');
    expect(result.scheduled_time).toBe('21:00');
  });

  it('should handle a DST-boundary instant correctly (summer EDT = UTC-4)', () => {
    // 2026-06-15 23:30 MDT (UTC-6) = 05:30 UTC Jun 16 = 01:30 EDT (UTC-4) Jun 16.
    // Recipient in NY: date rolls to Jun 16, time 01:30.
    const instant = new Date(Date.UTC(2026, 5, 16, 5, 30, 0));
    const result = formatDateTimeForAPI(instant, 'America/New_York');
    expect(result.scheduled_date).toBe('2026-06-16');
    expect(result.scheduled_time).toBe('01:30');
  });

  it('should format correctly for the recipient TZ even when device TZ differs', () => {
    // Same instant, recipient in Denver: 05:30 UTC Jun 16 = 23:30 MDT (UTC-6) Jun 15.
    const instant = new Date(Date.UTC(2026, 5, 16, 5, 30, 0));
    const result = formatDateTimeForAPI(instant, 'America/Denver');
    expect(result.scheduled_date).toBe('2026-06-15');
    expect(result.scheduled_time).toBe('23:30');
  });
});

// ============================================================================
// isEventInFuture / isDoseConfirmable
// ============================================================================
// VERBATIM PORT of the matching blocks in
// mobile/src/__tests__/utils/timezone.test.ts. Both predicates and both suites
// must be changed together with mobile's — web and mobile disagreeing about
// WHEN a dose may be confirmed means one of them writes a falsified row into
// the clinician-facing adherence report.
import {
  isEventInFuture,
  isDoseConfirmable,
  DOSE_EARLY_CONFIRM_WINDOW_MINUTES,
} from '../../utils/timezone';

describe('isEventInFuture', () => {
  // 2026-08-05 05:30 UTC — 23:30 on 08-04 in Denver, 01:30 on 08-05 in NY.
  const acrossMidnight = new Date('2026-08-05T05:30:00Z');

  it('reads "today" in the CARE RECIPIENT timezone, not the device', () => {
    // Same instant: 08-05 is still tomorrow in Denver, already today in NY.
    expect(isEventInFuture('2026-08-05', 'America/Denver', acrossMidnight)).toBe(true);
    expect(isEventInFuture('2026-08-05', 'America/New_York', acrossMidnight)).toBe(false);
  });

  it('is false for today and for past days', () => {
    expect(isEventInFuture('2026-08-04', 'America/Denver', acrossMidnight)).toBe(false);
    expect(isEventInFuture('2026-01-01', 'America/Denver', acrossMidnight)).toBe(false);
  });

  it('is false for a missing date rather than throwing', () => {
    expect(isEventInFuture('', 'America/Denver', acrossMidnight)).toBe(false);
  });
});

// THE gate for the Skip/Take pair on every surface. Day-granularity used to be
// enough, but at 4 PM it put a live "Take" on a 9 PM dose — a question nobody
// can answer yet — while the same card said "Upcoming". The rule is now a fixed
// EARLY WINDOW around the scheduled moment, still resolved entirely in the care
// recipient's timezone (scheduled_date/_time are naive local values in it).
describe('isDoseConfirmable', () => {
  // 2026-08-05 22:07 UTC = 16:07 (4:07 PM) in Denver, same calendar day.
  const fourOhSevenPmDenver = new Date('2026-08-05T22:07:00Z');
  const TZ = 'America/Denver';

  it('exports a single tunable early window of 120 minutes', () => {
    expect(DOSE_EARLY_CONFIRM_WINDOW_MINUTES).toBe(120);
  });

  it('does NOT offer a dose five hours out (4:07 PM, dose at 21:00)', () => {
    expect(isDoseConfirmable('2026-08-05', '21:00:00', TZ, fourOhSevenPmDenver)).toBe(false);
  });

  it('DOES offer the same dose 30 minutes out (4:07 PM, dose at 16:30)', () => {
    expect(isDoseConfirmable('2026-08-05', '16:30:00', TZ, fourOhSevenPmDenver)).toBe(true);
  });

  it('opens exactly at scheduled_time − window and not a minute earlier', () => {
    // Window boundary for 4:07 PM is an 18:07 dose.
    expect(isDoseConfirmable('2026-08-05', '18:07:00', TZ, fourOhSevenPmDenver)).toBe(true);
    expect(isDoseConfirmable('2026-08-05', '18:08:00', TZ, fourOhSevenPmDenver)).toBe(false);
  });

  it('stays open for an overdue dose earlier today', () => {
    expect(isDoseConfirmable('2026-08-05', '08:00:00', TZ, fourOhSevenPmDenver)).toBe(true);
  });

  it('stays open for an unanswered dose from a previous day', () => {
    expect(isDoseConfirmable('2026-08-04', '08:00:00', TZ, fourOhSevenPmDenver)).toBe(true);
  });

  it('is closed for a dose on a later day', () => {
    expect(isDoseConfirmable('2026-08-06', '08:00:00', TZ, fourOhSevenPmDenver)).toBe(false);
  });

  it('honours a caller-supplied window', () => {
    // 5h out, with a 6h window → confirmable.
    expect(isDoseConfirmable('2026-08-05', '21:00:00', TZ, fourOhSevenPmDenver, 360)).toBe(true);
  });

  // A timeless dose has no due moment to open a window around — it behaves
  // exactly as it did before the window existed: confirmable on its own day.
  describe('timeless doses', () => {
    it('is confirmable all day on its scheduled date', () => {
      expect(isDoseConfirmable('2026-08-05', null, TZ, fourOhSevenPmDenver)).toBe(true);
    });

    it('is confirmable on a past date', () => {
      expect(isDoseConfirmable('2026-08-01', null, TZ, fourOhSevenPmDenver)).toBe(true);
    });

    it('is NOT confirmable on a later date', () => {
      expect(isDoseConfirmable('2026-08-06', null, TZ, fourOhSevenPmDenver)).toBe(false);
    });

    it('treats an unparseable time as timeless rather than throwing', () => {
      expect(isDoseConfirmable('2026-08-05', 'not-a-time', TZ, fourOhSevenPmDenver)).toBe(true);
    });
  });

  // The window is measured in the CARE RECIPIENT's timezone — never the
  // device's. Same instant, two recipients, two answers.
  describe('timezone discipline', () => {
    // 2026-08-05 05:30 UTC — 23:30 on 08-04 in Denver, 01:30 on 08-05 in NY.
    const acrossMidnight = new Date('2026-08-05T05:30:00Z');

    it('reads "today" per the care recipient timezone', () => {
      // 08-05 01:00 dose: already overdue in New York, still tomorrow in Denver.
      expect(isDoseConfirmable('2026-08-05', '01:00:00', 'America/New_York', acrossMidnight)).toBe(
        true
      );
      // In Denver it is 23:30 on 08-04 — a 01:00 dose tomorrow is 1.5h away, so
      // the early window reaches it.
      expect(isDoseConfirmable('2026-08-05', '01:00:00', TZ, acrossMidnight)).toBe(true);
    });

    it('reaches across midnight only as far as the window allows', () => {
      // 23:30 Denver on 08-04 → a 03:00 dose tomorrow is 3.5h away: too early.
      expect(isDoseConfirmable('2026-08-05', '03:00:00', TZ, acrossMidnight)).toBe(false);
    });

    it('never reaches two days ahead', () => {
      expect(isDoseConfirmable('2026-08-06', '00:05:00', TZ, acrossMidnight)).toBe(false);
    });

    // The dev machine is America/Denver: the SAME dose, the SAME instant, must
    // answer differently for a New York recipient than for a Denver one, and
    // neither answer may come from the runner's local clock.
    it('gives two different answers for two recipients at one instant', () => {
      // 2026-08-05 01:30 UTC = 19:30 on 08-04 in Denver, 21:30 on 08-04 in NY.
      const instant = new Date('2026-08-05T01:30:00Z');
      // A 22:00 dose on 08-04 is 30 minutes away in NY (open) and 2.5h away in
      // Denver (closed) — the recipient timezone decides, not the device.
      expect(isDoseConfirmable('2026-08-04', '22:00:00', 'America/New_York', instant)).toBe(true);
      expect(isDoseConfirmable('2026-08-04', '22:00:00', 'America/Denver', instant)).toBe(false);
    });
  });

  it('is false for a missing date rather than throwing', () => {
    expect(isDoseConfirmable('', '08:00:00', TZ, fourOhSevenPmDenver)).toBe(false);
  });

  it('degrades to day-granularity when the timezone is unusable', () => {
    // Intl throws on a bogus zone — a caregiver must still be able to confirm
    // today's and past doses, and must still be blocked on later days.
    expect(isDoseConfirmable('2026-08-04', '21:00:00', 'Not/AZone', fourOhSevenPmDenver)).toBe(true);
    expect(isDoseConfirmable('2030-01-01', '21:00:00', 'Not/AZone', fourOhSevenPmDenver)).toBe(
      false
    );
  });
});
