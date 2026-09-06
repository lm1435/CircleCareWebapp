// ONE `Intl.DateTimeFormat` PER SHAPE, NOT ONE PER CALL.
//
// Constructing an `Intl.DateTimeFormat` is the expensive half of the API — it
// resolves locale and timezone data — while formatting with an existing one is
// cheap. This module built a fresh formatter at every call site, and the hot
// path multiplies that: `formatEventTimeCompact` calls `getTimezoneSuffix` ->
// `timezonesAreDifferent` -> `getTimezoneOffsetMinutes` ONCE PER ZONE, so
// rendering a single row constructed two or more. A list of medication rows or
// a month grid of events paid that on every render.
//
// The instances are stateless with respect to formatting — the Date is an
// argument to `.format()`, never to the constructor — so sharing one across
// calls is safe and cannot leak a date between callers. This file is the guard
// on that claim.

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

const AT = new Date('2026-01-15T12:00:00Z');

beforeEach(() => {
  // A fresh module means a fresh cache — otherwise the first assertion in this
  // file would be measuring formatters a previous test already warmed.
  vi.resetModules();
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe('Intl.DateTimeFormat construction', () => {
  it('is paid ONCE for a repeated (locale, options, zone) shape', async () => {
    const construct = vi.spyOn(Intl, 'DateTimeFormat');
    const { getTimezoneOffsetMinutes } = await import('../../utils/timezone');

    getTimezoneOffsetMinutes('America/Denver', AT);
    const afterFirst = construct.mock.calls.length;
    expect(afterFirst).toBeGreaterThan(0);

    getTimezoneOffsetMinutes('America/Denver', AT);
    getTimezoneOffsetMinutes('America/Denver', new Date('2026-07-15T12:00:00Z'));

    // The DATE is an argument to .format(), not to the constructor — a second
    // date on the same zone must reuse the formatter, not build another.
    expect(construct.mock.calls.length).toBe(afterFirst);
  });

  it('is paid again for a zone the cache has not seen', async () => {
    const construct = vi.spyOn(Intl, 'DateTimeFormat');
    const { getTimezoneOffsetMinutes } = await import('../../utils/timezone');

    getTimezoneOffsetMinutes('America/Denver', AT);
    const afterFirst = construct.mock.calls.length;
    getTimezoneOffsetMinutes('Asia/Tokyo', AT);

    expect(construct.mock.calls.length).toBeGreaterThan(afterFirst);
  });

  it('does not build zone data again for every row rendered', async () => {
    // The regression this file exists for: a 30-row month grid constructed
    // formatters proportional to the row count.
    //
    // Counted over the ZONE-PARAMETERIZED constructions only, because those are
    // the expensive ones — a formatter given a `timeZone` has to load that
    // zone's rules. `getDeviceTimezone` deliberately stays outside the cache
    // and constructs a bare `Intl.DateTimeFormat()` per call: its whole job is
    // to re-read `resolvedOptions().timeZone`, and an instance resolves that
    // ONCE at construction, so a cached probe would keep reporting the zone the
    // browser had when the page loaded.
    const construct = vi.spyOn(Intl, 'DateTimeFormat');
    const withZone = () =>
      construct.mock.calls.filter(
        (args) => (args[1] as Intl.DateTimeFormatOptions | undefined)?.timeZone
      ).length;
    const { formatEventTimeCompact } = await import('../../utils/timezone');

    formatEventTimeCompact('14:00', 'America/Chicago', '12h', AT);
    const afterFirstRow = withZone();
    expect(afterFirstRow).toBeGreaterThan(0);

    for (let i = 0; i < 30; i++) {
      formatEventTimeCompact(`${String(i % 24).padStart(2, '0')}:00`, 'America/Chicago', '12h', AT);
    }

    expect(withZone()).toBe(afterFirstRow);
  });

  // The cache is reachable from OUTSIDE this module now: the medication history
  // list formats a wall clock per confirmation card and a title per day group,
  // and was paying a constructor for each. `getCachedDateTimeFormat` is the
  // public door onto the same map.
  describe('getCachedDateTimeFormat', () => {
    it('hands back the SAME instance for a repeated (locale, options) shape', async () => {
      const { getCachedDateTimeFormat } = await import('../../utils/timezone');
      const options = { timeZone: 'America/Denver', hour: '2-digit', minute: '2-digit' } as const;

      const first = getCachedDateTimeFormat('en-GB', options);
      expect(getCachedDateTimeFormat('en-GB', { ...options })).toBe(first);
    });

    it('keys on the LOCALE too, because a month name is language', async () => {
      const { getCachedDateTimeFormat } = await import('../../utils/timezone');
      const options = { timeZone: 'UTC', weekday: 'long', month: 'long', day: 'numeric' } as const;

      const en = getCachedDateTimeFormat('en', options);
      const es = getCachedDateTimeFormat('es', options);

      expect(es).not.toBe(en);
      const day = new Date('2026-09-01T12:00:00Z');
      expect(en.format(day)).toMatch(/September/);
      expect(es.format(day)).toMatch(/septiembre/);
    });

    it('is paid once across a list, not once per row', async () => {
      const construct = vi.spyOn(Intl, 'DateTimeFormat');
      const { getCachedDateTimeFormat } = await import('../../utils/timezone');
      const options = { timeZone: 'America/Denver', hour: '2-digit', minute: '2-digit' } as const;

      getCachedDateTimeFormat('en-GB', options);
      const afterFirstRow = construct.mock.calls.length;

      // No `.format()` here: `construct` is a spy standing in for the
      // constructor, so its return value is not a real formatter. Counting
      // constructions is the whole assertion — the sibling test below proves
      // the shared instance still formats each caller's own instant.
      for (let i = 0; i < 150; i++) {
        getCachedDateTimeFormat('en-GB', { ...options });
      }

      expect(construct.mock.calls.length).toBe(afterFirstRow);
    });

    // Sharing an instance must not leak a date between callers: the Date is an
    // argument to `.format()`, never to the constructor.
    it('formats each caller’s own instant', async () => {
      const { getCachedDateTimeFormat } = await import('../../utils/timezone');
      const options = {
        timeZone: 'America/Denver',
        hour: '2-digit',
        minute: '2-digit',
        hour12: false,
      } as const;

      const a = getCachedDateTimeFormat('en-GB', options);
      const b = getCachedDateTimeFormat('en-GB', { ...options });
      expect(a).toBe(b);
      expect(a.format(new Date('2026-01-15T20:00:00Z'))).toBe('13:00');
      expect(b.format(new Date('2026-01-15T21:30:00Z'))).toBe('14:30');
    });
  });

  it('still reports the right offsets through the cache', async () => {
    // Caching must not change a single answer. Kiritimati (+14) and Honolulu
    // (-10) read the same clock a day apart and are the pair a shared formatter
    // would be most likely to conflate.
    const { getTimezoneOffsetMinutes } = await import('../../utils/timezone');

    expect(getTimezoneOffsetMinutes('America/Denver', AT)).toBe(-420);
    expect(getTimezoneOffsetMinutes('America/Denver', new Date('2026-07-15T12:00:00Z'))).toBe(-360);
    expect(getTimezoneOffsetMinutes('Pacific/Kiritimati', AT)).toBe(840);
    expect(getTimezoneOffsetMinutes('Pacific/Honolulu', AT)).toBe(-600);
    expect(getTimezoneOffsetMinutes('Asia/Kathmandu', AT)).toBe(345);
  });
});
