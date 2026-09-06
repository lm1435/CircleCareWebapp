// The ZONE SUFFIX rules, ported from mobile/src/utils/timezone.ts.
//
// Three behaviours are pinned here, because each one shipped wrong on web:
//
//   1. A zone label is SUPPRESSED when the viewer shares the recipient's zone.
//      Web appended it unconditionally, so a Denver caregiver watching a Denver
//      recipient read "8:00 PM MT" on every row — a label answers "whose clock
//      is this?", and in a single-zone circle nobody is asking.
//   2. A zone is named by its CITY, never by an invented abbreviation. The
//      101-row abbreviation table this replaces could not be sourced: Intl has
//      no language-neutral abbreviation, and IANA deleted its own in 2017a.
//   3. The comparison is judged AT AN INSTANT. Phoenix and Denver share a clock
//      in January and differ in July, so "are these different" has no answer
//      without saying when.

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

import {
  formatDualTimezoneDisplay,
  formatEventTimeCompact,
  formatEventTimeForDisplay,
  getEventTimeParts,
  getTimezoneLabel,
  getTimezoneSuffix,
  zoneReferenceInstant,
} from '../../utils/timezone';

/** The dev machine is America/Denver; nothing here may depend on that. */
function pinDeviceTimezone(timeZone: string) {
  vi.spyOn(Intl.DateTimeFormat.prototype, 'resolvedOptions').mockReturnValue({
    timeZone,
  } as Intl.ResolvedDateTimeFormatOptions);
}

const JANUARY = new Date('2026-01-15T12:00:00Z');
const JULY = new Date('2026-07-15T12:00:00Z');

afterEach(() => {
  vi.restoreAllMocks();
});

// ============================================================================
// getTimezoneLabel — the name of a zone is its city
// ============================================================================

describe('getTimezoneLabel', () => {
  it('names a zone by the city inside its IANA id', () => {
    expect(getTimezoneLabel('America/Denver', 'en')).toBe('Denver');
    expect(getTimezoneLabel('Europe/Berlin', 'en')).toBe('Berlin');
    expect(getTimezoneLabel('Asia/Tokyo', 'en')).toBe('Tokyo');
  });

  it('strips the underscore rather than shipping it to a reader', () => {
    // "8:00 p. m. Mexico_City" is what a raw `.split('/').pop()` renders.
    expect(getTimezoneLabel('America/Mexico_City', 'en')).toBe('Mexico City');
    expect(getTimezoneLabel('America/Los_Angeles', 'en')).toBe('Los Angeles');
  });

  it('reads the last segment of a three-part id', () => {
    expect(getTimezoneLabel('America/Argentina/Buenos_Aires', 'en')).toBe('Buenos Aires');
  });

  it('spells the city in Spanish for a Spanish reader', () => {
    // THE ONE PLACE THE TWO LANGUAGES ARE MEANT TO DIFFER. Apple localises its
    // city names too — Settings reads "Londres" in Spanish.
    expect(getTimezoneLabel('Europe/Berlin', 'es')).toBe('Berlín');
    expect(getTimezoneLabel('America/Mexico_City', 'es')).toBe('Ciudad de México');
    expect(getTimezoneLabel('Europe/London', 'es')).toBe('Londres');
    expect(getTimezoneLabel('Asia/Tokyo', 'es')).toBe('Tokio');
  });

  it('falls through to the IANA city when Spanish needs no respelling', () => {
    expect(getTimezoneLabel('America/Denver', 'es')).toBe('Denver');
    expect(getTimezoneLabel('America/Lima', 'es')).toBe('Lima');
  });

  it('says NOTHING for an id that carries no city', () => {
    // The product rule is that a user never sees GMT±X. A zone with nothing
    // readable in it gets no label at all — omitting is correct, printing an
    // offset is not. `Etc/GMT+5` is UTC-5, so its sign is a trap on top.
    expect(getTimezoneLabel('Etc/GMT+5', 'en')).toBe('');
    expect(getTimezoneLabel('Etc/GMT-3', 'en')).toBe('');
    expect(getTimezoneLabel('', 'en')).toBe('');
  });

  it('names UTC after itself, the one id with no city in it', () => {
    expect(getTimezoneLabel('UTC', 'en')).toBe('UTC');
    expect(getTimezoneLabel('Etc/UTC', 'es')).toBe('UTC');
  });
});

// ============================================================================
// getTimezoneSuffix — silent when the viewer shares the zone
// ============================================================================

describe('getTimezoneSuffix', () => {
  it('says nothing when the viewer is in the care recipient’s zone', () => {
    pinDeviceTimezone('America/Denver');
    expect(getTimezoneSuffix('America/Denver', JANUARY)).toBe('');
  });

  it('names the zone, parenthesised, when the viewer is somewhere else', () => {
    pinDeviceTimezone('America/Denver');
    expect(getTimezoneSuffix('Europe/Berlin', JANUARY, { language: 'en' })).toBe(' (Berlin)');
    expect(getTimezoneSuffix('America/Chicago', JANUARY, { language: 'en' })).toBe(' (Chicago)');
  });

  it('localises the city it appends', () => {
    pinDeviceTimezone('America/Denver');
    expect(getTimezoneSuffix('Europe/Berlin', JANUARY, { language: 'es' })).toBe(' (Berlín)');
  });

  it('stays silent for a zone that only ALIASES the viewer’s', () => {
    // ICU resolves Asia/Kolkata to the legacy Asia/Calcutta, so a name compare
    // would call these different and label a single-zone circle.
    pinDeviceTimezone('Asia/Calcutta');
    expect(getTimezoneSuffix('Asia/Kolkata', JANUARY)).toBe('');
  });

  it('judges the comparison AT THE INSTANT it is given', () => {
    // Phoenix does not observe DST; Denver does. Same clock in January, an hour
    // apart in July — so the same pair must label in one and stay silent in the
    // other. Judging both at "now" is how a caregiver gets a label on exactly
    // the row that does not need one, and none on the row that does.
    pinDeviceTimezone('America/Phoenix');
    expect(getTimezoneSuffix('America/Denver', JANUARY, { language: 'en' })).toBe('');
    expect(getTimezoneSuffix('America/Denver', JULY, { language: 'en' })).toBe(' (Denver)');
  });

  it('accepts an explicit viewer zone instead of reading the browser', () => {
    pinDeviceTimezone('America/Denver');
    expect(
      getTimezoneSuffix('America/Denver', JANUARY, {
        deviceTimezone: 'Europe/Berlin',
        language: 'en',
      })
    ).toBe(' (Denver)');
  });

  it('says nothing for an empty or unnameable zone even when the offsets differ', () => {
    pinDeviceTimezone('America/Denver');
    expect(getTimezoneSuffix('', JANUARY)).toBe('');
    expect(getTimezoneSuffix('Etc/GMT+5', JANUARY)).toBe('');
  });
});

// ============================================================================
// zoneReferenceInstant — the instant a dated row is judged at
// ============================================================================

describe('zoneReferenceInstant', () => {
  it('lands on UTC NOON of the given day, not midnight', () => {
    // NOON because the two offsets either side of a DST transition are exactly
    // what these comparisons turn on, and midnight sits close enough to one to
    // be pushed across it by the zone's own shift.
    //
    // UTC noon rather than the PROCESS's noon, which is the part that bites.
    // `new Date('2026-03-08T12:00:00')` is parsed in the machine's own zone, so
    // the instant it yields — and therefore the answer to "do these two zones
    // differ on this date" — moved with the VIEWER'S MACHINE. Under
    // TZ=Asia/Tokyo it landed at 03:00Z on the 8th, before America/Denver had
    // sprung forward at 09:00Z, so a Phoenix caregiver's label appeared or
    // vanished depending on which timezone their laptop was in. That is the
    // exact class of bug this whole module exists to remove.
    expect(zoneReferenceInstant('2026-07-15').toISOString()).toBe('2026-07-15T12:00:00.000Z');
    expect(zoneReferenceInstant('2026-03-08').toISOString()).toBe('2026-03-08T12:00:00.000Z');
  });

  it('falls back to now for a row that carries no date', () => {
    const before = Date.now();
    const at = zoneReferenceInstant(null);
    expect(at.getTime()).toBeGreaterThanOrEqual(before);
    expect(zoneReferenceInstant(undefined).getTime()).toBeGreaterThanOrEqual(before);
  });

  it('falls back to now for a date it cannot parse', () => {
    expect(Number.isNaN(zoneReferenceInstant('not-a-date').getTime())).toBe(false);
  });
});

// ============================================================================
// The renderers that carry the suffix
// ============================================================================

describe('formatEventTimeCompact', () => {
  it('renders a BARE time for a viewer in the recipient’s zone', () => {
    // This is the row that read "8:00 PM MT" to a Denver caregiver watching a
    // Denver recipient — on Tasks, the calendar month grid and Today's Meds.
    pinDeviceTimezone('America/Denver');
    expect(formatEventTimeCompact('20:00', 'America/Denver', '12h', JANUARY)).toBe('8:00 PM');
  });

  it('names the zone when the viewer is somewhere else', () => {
    pinDeviceTimezone('America/Denver');
    expect(formatEventTimeCompact('14:00', 'America/Chicago', '12h', JANUARY)).toBe(
      '2:00 PM (Chicago)'
    );
  });

  it('judges the zone comparison at the row’s own date', () => {
    pinDeviceTimezone('America/Phoenix');
    expect(formatEventTimeCompact('14:00', 'America/Denver', '12h', JANUARY)).toBe('2:00 PM');
    expect(formatEventTimeCompact('14:00', 'America/Denver', '12h', JULY)).toBe('2:00 PM (Denver)');
  });
});

describe('formatEventTimeForDisplay', () => {
  it('renders a BARE time when viewer and recipient share a zone', () => {
    pinDeviceTimezone('America/Denver');
    expect(
      formatEventTimeForDisplay('14:00', 'America/Denver', undefined, JANUARY, '12h')
    ).toBe('2:00 PM');
  });

  it('names BOTH zones on a dual line', () => {
    pinDeviceTimezone('America/Denver');
    expect(
      formatEventTimeForDisplay('14:00', 'America/Chicago', undefined, JANUARY, '12h')
    ).toBe('2:00 PM (Chicago) / 1:00 PM (Denver)');
  });

  it('still names the recipient’s zone when a caller suppresses the second half', () => {
    // WHETHER TO NAME THE ZONES IS NOT THE SAME QUESTION AS WHETHER TO SHOW TWO
    // OF THEM. A dense day grid has no room for two times but still has to say
    // whose clock the one time is on.
    pinDeviceTimezone('America/Denver');
    expect(formatEventTimeForDisplay('14:00', 'America/Chicago', false, JANUARY, '12h')).toBe(
      '2:00 PM (Chicago)'
    );
  });

  it('labels a forced dual line even when the zones agree', () => {
    // A dual line whose halves were unlabelled would be unreadable.
    pinDeviceTimezone('America/Denver');
    expect(formatEventTimeForDisplay('14:00', 'America/Denver', true, JANUARY, '12h')).toBe(
      '2:00 PM (Denver) / 2:00 PM (Denver)'
    );
  });
});

describe('getEventTimeParts', () => {
  it('leaves the primary time bare in a single-zone circle', () => {
    pinDeviceTimezone('America/Denver');
    expect(getEventTimeParts('14:00', 'America/Denver', JANUARY, '12h')).toEqual({
      primaryTime: '2:00 PM',
      secondaryTime: null,
    });
  });

  it('names both zones when they differ', () => {
    pinDeviceTimezone('America/Denver');
    expect(getEventTimeParts('14:00', 'America/Chicago', JANUARY, '12h')).toEqual({
      primaryTime: '2:00 PM (Chicago)',
      secondaryTime: '1:00 PM (Denver)',
    });
  });
});

describe('formatDualTimezoneDisplay', () => {
  it('renders one BARE time when the two zones are the same clock', () => {
    expect(
      formatDualTimezoneDisplay(20, 0, 'America/Denver', 'America/Denver', '12h', JANUARY)
    ).toBe('8:00 PM');
  });

  it('names both zones when they are not', () => {
    expect(
      formatDualTimezoneDisplay(20, 0, 'America/Denver', 'America/Chicago', '12h', JANUARY)
    ).toBe('8:00 PM (Denver) / 9:00 PM (Chicago)');
  });
});
