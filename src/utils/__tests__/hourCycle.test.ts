import { afterEach, describe, expect, it, vi } from 'vitest';
import { inferHourCycleFromTimezone, resolveHourCycle } from '../hourCycle';

// `hourCycle.ts` is a VERBATIM PORT of backend/src/utils/hourCycle.ts. The
// inference cases below mirror the backend suite ONE FOR ONE so the three copies
// (backend / mobile / webapp) cannot silently drift — if you add a zone to one
// exception set, add the same case here and in the other two suites.
//
// Only `resolveHourCycle` differs per repo: on the WEB the chain is
//   1. user.uses_24h_clock (synced from the phone) → 2. browser locale →
//   3. timezone heuristic → 4. '12h'.
// No browser API exposes the OS 12/24-hour toggle, hence step 1's priority.

// ---------------------------------------------------------------------------
// Browser-locale helpers. jsdom reports navigator.language = 'en-US' and the
// real Intl decides hour12, so both are stubbed for determinism (the dev
// machine's locale must never decide a test outcome).
// ---------------------------------------------------------------------------

function stubNavigatorLanguage(language: string | undefined): void {
  vi.stubGlobal('navigator', { ...globalThis.navigator, language });
}

/** Force `resolvedOptions().hour12` for every DateTimeFormat in the test. */
function stubResolvedHour12(hour12: boolean | undefined): void {
  vi.spyOn(Intl.DateTimeFormat.prototype, 'resolvedOptions').mockReturnValue({
    hour12,
  } as unknown as Intl.ResolvedDateTimeFormatOptions);
}

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

// ============================================================================
// inferHourCycleFromTimezone — ported rules
// ============================================================================

describe('inferHourCycleFromTimezone', () => {
  it('returns 12h for null, undefined and empty timezones', () => {
    expect(inferHourCycleFromTimezone(null)).toBe('12h');
    expect(inferHourCycleFromTimezone(undefined)).toBe('12h');
    expect(inferHourCycleFromTimezone('')).toBe('12h');
  });

  it('treats America/, Australia/ and Pacific/ as 12-hour regions', () => {
    expect(inferHourCycleFromTimezone('America/New_York')).toBe('12h');
    expect(inferHourCycleFromTimezone('America/Chicago')).toBe('12h');
    expect(inferHourCycleFromTimezone('America/Denver')).toBe('12h');
    expect(inferHourCycleFromTimezone('America/Los_Angeles')).toBe('12h');
    expect(inferHourCycleFromTimezone('America/Phoenix')).toBe('12h');
    expect(inferHourCycleFromTimezone('America/Anchorage')).toBe('12h');
    expect(inferHourCycleFromTimezone('America/Toronto')).toBe('12h');
    expect(inferHourCycleFromTimezone('America/Mexico_City')).toBe('12h');
    expect(inferHourCycleFromTimezone('Australia/Sydney')).toBe('12h');
    expect(inferHourCycleFromTimezone('Australia/Perth')).toBe('12h');
    expect(inferHourCycleFromTimezone('Pacific/Honolulu')).toBe('12h');
    expect(inferHourCycleFromTimezone('Pacific/Auckland')).toBe('12h');
  });

  it('treats Europe/, Africa/, Asia/, Atlantic/, Indian/ and Antarctica/ as 24-hour regions', () => {
    expect(inferHourCycleFromTimezone('Europe/Madrid')).toBe('24h');
    expect(inferHourCycleFromTimezone('Europe/London')).toBe('24h');
    expect(inferHourCycleFromTimezone('Europe/Paris')).toBe('24h');
    expect(inferHourCycleFromTimezone('Africa/Lagos')).toBe('24h');
    expect(inferHourCycleFromTimezone('Africa/Johannesburg')).toBe('24h');
    expect(inferHourCycleFromTimezone('Asia/Tokyo')).toBe('24h');
    expect(inferHourCycleFromTimezone('Asia/Shanghai')).toBe('24h');
    expect(inferHourCycleFromTimezone('Atlantic/Azores')).toBe('24h');
    expect(inferHourCycleFromTimezone('Atlantic/Reykjavik')).toBe('24h');
    expect(inferHourCycleFromTimezone('Indian/Maldives')).toBe('24h');
    expect(inferHourCycleFromTimezone('Antarctica/Casey')).toBe('24h');
    expect(inferHourCycleFromTimezone('Antarctica/McMurdo')).toBe('24h');
  });

  it('returns 12h for every 12-hour zone exception inside a 24-hour region', () => {
    const twelveHourExceptions = [
      'Asia/Kolkata',
      'Asia/Calcutta',
      'Asia/Colombo',
      'Asia/Dhaka',
      'Asia/Karachi',
      'Asia/Manila',
      'Asia/Seoul',
      'Asia/Kuala_Lumpur',
      'Africa/Cairo',
    ];
    for (const tz of twelveHourExceptions) {
      expect(inferHourCycleFromTimezone(tz)).toBe('12h');
    }
  });

  it('returns 24h for every 24-hour zone exception inside a 12-hour region', () => {
    const twentyFourHourExceptions = [
      'America/Sao_Paulo',
      'America/Fortaleza',
      'America/Recife',
      'America/Bahia',
      'America/Manaus',
      'America/Belem',
      'America/Noronha',
      'America/Santiago',
      'America/Montevideo',
      'America/Asuncion',
      'America/La_Paz',
      'America/Cayenne',
      'America/Paramaribo',
    ];
    for (const tz of twentyFourHourExceptions) {
      expect(inferHourCycleFromTimezone(tz)).toBe('24h');
    }
  });

  it('returns 24h for the America/Argentina/ prefix exception', () => {
    expect(inferHourCycleFromTimezone('America/Argentina/Buenos_Aires')).toBe('24h');
    expect(inferHourCycleFromTimezone('America/Argentina/Cordoba')).toBe('24h');
    expect(inferHourCycleFromTimezone('America/Argentina/Mendoza')).toBe('24h');
    expect(inferHourCycleFromTimezone('America/Argentina/Ushuaia')).toBe('24h');
  });

  it('lets exceptions override the prefix rule in both directions', () => {
    // Asia/* is 24h by prefix, but Seoul is an exception.
    expect(inferHourCycleFromTimezone('Asia/Seoul')).toBe('12h');
    // America/* is 12h by prefix, but Sao_Paulo is an exception.
    expect(inferHourCycleFromTimezone('America/Sao_Paulo')).toBe('24h');
  });

  it('returns 12h for unrecognised zones', () => {
    expect(inferHourCycleFromTimezone('UTC')).toBe('12h');
    expect(inferHourCycleFromTimezone('Etc/GMT+5')).toBe('12h');
    expect(inferHourCycleFromTimezone('Etc/UTC')).toBe('12h');
    expect(inferHourCycleFromTimezone('GMT')).toBe('12h');
    expect(inferHourCycleFromTimezone('Not/AZone')).toBe('12h');
    // Zone matching is case-sensitive — a lowercase real zone name is
    // "unrecognised" too, not silently normalized to America/New_York.
    expect(inferHourCycleFromTimezone('america/new_york')).toBe('12h');
  });
});

// ============================================================================
// resolveHourCycle — the WEB 4-step chain
// ============================================================================

describe('resolveHourCycle (web chain)', () => {
  describe('step 1 — the value synced from the phone wins', () => {
    it('returns 24h when uses_24h_clock is true, whatever the browser/timezone says', () => {
      stubNavigatorLanguage('en-US');
      stubResolvedHour12(true);
      expect(
        resolveHourCycle({ uses_24h_clock: true, timezone: 'America/Denver' })
      ).toBe('24h');
    });

    it('returns 12h when uses_24h_clock is false, even in a 24-hour timezone/locale', () => {
      stubNavigatorLanguage('es-ES');
      stubResolvedHour12(false);
      expect(
        resolveHourCycle({ uses_24h_clock: false, timezone: 'Europe/Madrid' })
      ).toBe('12h');
    });

    it('does not consult the browser at all when the synced value is present', () => {
      const spy = vi.spyOn(Intl.DateTimeFormat.prototype, 'resolvedOptions');
      expect(resolveHourCycle({ uses_24h_clock: true, timezone: 'Europe/Madrid' })).toBe('24h');
      expect(spy).not.toHaveBeenCalled();
    });
  });

  describe('step 2 — browser locale, when the phone has not synced', () => {
    it('returns 12h when the locale resolves hour12: true', () => {
      stubNavigatorLanguage('en-US');
      stubResolvedHour12(true);
      // Europe/Madrid would infer 24h — the locale is consulted FIRST.
      expect(resolveHourCycle({ timezone: 'Europe/Madrid' })).toBe('12h');
    });

    it('returns 24h when the locale resolves hour12: false', () => {
      stubNavigatorLanguage('es-ES');
      stubResolvedHour12(false);
      // America/Denver would infer 12h — the locale is consulted FIRST.
      expect(resolveHourCycle({ timezone: 'America/Denver' })).toBe('24h');
    });

    it('treats uses_24h_clock: null/undefined as "not yet synced"', () => {
      stubNavigatorLanguage('es-ES');
      stubResolvedHour12(false);
      expect(resolveHourCycle({ uses_24h_clock: null, timezone: 'America/Denver' })).toBe('24h');
      expect(resolveHourCycle({ uses_24h_clock: undefined, timezone: 'America/Denver' })).toBe(
        '24h'
      );
    });
  });

  describe('step 3 — timezone heuristic when the browser cannot answer', () => {
    it('falls through when there is no navigator (SSR / trimmed global)', () => {
      vi.stubGlobal('navigator', undefined);
      expect(resolveHourCycle({ timezone: 'Europe/Madrid' })).toBe('24h');
      expect(resolveHourCycle({ timezone: 'America/Denver' })).toBe('12h');
    });

    it('falls through when navigator.language is empty', () => {
      stubNavigatorLanguage('');
      expect(resolveHourCycle({ timezone: 'Europe/Madrid' })).toBe('24h');
    });

    it('falls through when resolvedOptions() omits hour12', () => {
      stubNavigatorLanguage('en-US');
      stubResolvedHour12(undefined);
      expect(resolveHourCycle({ timezone: 'Europe/Madrid' })).toBe('24h');
    });

    it('falls through when Intl.DateTimeFormat throws (bad locale tag)', () => {
      stubNavigatorLanguage('not a locale');
      vi.spyOn(Intl.DateTimeFormat.prototype, 'resolvedOptions').mockImplementation(() => {
        throw new RangeError('Incorrect locale information provided');
      });
      expect(resolveHourCycle({ timezone: 'Europe/Madrid' })).toBe('24h');
    });

    it('never throws when navigator is missing', () => {
      vi.stubGlobal('navigator', undefined);
      expect(() => resolveHourCycle({})).not.toThrow();
    });
  });

  describe('step 4 — final fallback', () => {
    it('returns 12h with no synced value, no browser and no timezone', () => {
      vi.stubGlobal('navigator', undefined);
      expect(resolveHourCycle({})).toBe('12h');
      expect(resolveHourCycle({ uses_24h_clock: null, timezone: null })).toBe('12h');
    });

    it('returns 12h for an unrecognised timezone with no browser answer', () => {
      vi.stubGlobal('navigator', undefined);
      expect(resolveHourCycle({ timezone: 'Etc/GMT+5' })).toBe('12h');
    });
  });
});
