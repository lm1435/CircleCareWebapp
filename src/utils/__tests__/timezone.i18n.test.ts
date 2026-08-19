/**
 * The LANGUAGE-AWARE half of `utils/timezone.ts`.
 *
 * Kept separate from `./timezone.test.ts` on purpose: that file is a verbatim
 * port of the mobile suite and deliberately runs with i18next UNINITIALIZED, so
 * every assertion there proves the English/degraded path. This file boots a real
 * i18next singleton — the same instance `src/utils/timezone.ts` imports — and
 * proves the localized path.
 *
 * It does NOT import `src/i18n/index.ts`. That barrel calls `init()` in its
 * module body with the browser language detector attached, which would make the
 * language under test depend on the runner's environment. Registering the exact
 * bundle we care about is both deterministic and a precise statement of the
 * contract: given these keys, this output.
 */

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

import i18n from 'i18next';
import {
  formatTimeOfDay,
  getTimezoneLabel,
  getTimezoneAbbreviation,
  getTimezoneOffsetMinutes,
  getDateInTimezone,
  convertTimeBetweenTimezones,
  formatTimeForAPI,
  formatDateTimeForAPI,
  isEventPastDue,
} from '../timezone';

/**
 * The `common:timezoneLabels.*` bundle this change adds to the locale files.
 * Mirrors the key patch exactly — if the two drift, this suite is lying.
 */
const EN_TIMEZONE_LABELS = {
  'America/New_York': 'Eastern Time',
  'America/Chicago': 'Central Time',
  'America/Denver': 'Mountain Time',
  'America/Los_Angeles': 'Pacific Time',
  'America/Phoenix': 'Arizona Time',
  'America/Anchorage': 'Alaska Time',
  'Pacific/Honolulu': 'Hawaii Time',
};

const ES_TIMEZONE_LABELS = {
  'America/New_York': 'Hora del Este',
  'America/Chicago': 'Hora Central',
  'America/Denver': 'Hora de la Montaña',
  'America/Los_Angeles': 'Hora del Pacífico',
  'America/Phoenix': 'Hora de Arizona',
  'America/Anchorage': 'Hora de Alaska',
  'Pacific/Honolulu': 'Hora de Hawái',
};

beforeAll(async () => {
  await i18n.init({
    lng: 'en',
    fallbackLng: 'en',
    ns: ['common'],
    defaultNS: 'common',
    supportedLngs: ['en', 'es'],
    nonExplicitSupportedLngs: true, // es-MX / es-419 → es, as the app does
    interpolation: { escapeValue: false },
    resources: {
      en: { common: { timezoneLabels: EN_TIMEZONE_LABELS } },
      es: { common: { timezoneLabels: ES_TIMEZONE_LABELS } },
    },
  });
});

afterEach(async () => {
  await i18n.changeLanguage('en');
});

// ============================================================================
// formatTimeOfDay — the language default
// ============================================================================
// The whole point of the optional parameter: dozens of existing call sites pass
// no language and must start rendering Spanish for a Spanish reader without
// being edited.
describe('formatTimeOfDay default language', () => {
  it('renders the RAE meridiem once i18next is on Spanish', async () => {
    await i18n.changeLanguage('es');
    expect(formatTimeOfDay(20, 45, '12h')).toBe('8:45 p. m.');
    expect(formatTimeOfDay(9, 5, '12h')).toBe('9:05 a. m.');
  });

  it('renders Spanish for a regional tag (es-MX)', async () => {
    // The browser detector routinely reports es-MX or es-419, never bare es.
    await i18n.changeLanguage('es-MX');
    expect(formatTimeOfDay(20, 45, '12h')).toBe('8:45 p. m.');
  });

  it('renders Spanish for es-419', async () => {
    await i18n.changeLanguage('es-419');
    expect(formatTimeOfDay(20, 45, '12h')).toBe('8:45 p. m.');
  });

  it('renders English when i18next is on English', () => {
    expect(formatTimeOfDay(20, 45, '12h')).toBe('8:45 PM');
    expect(formatTimeOfDay(9, 5, '12h')).toBe('9:05 AM');
  });

  it('lets an explicit argument override the active language', async () => {
    // Needed whenever we format for somebody OTHER than the current viewer.
    await i18n.changeLanguage('es');
    expect(formatTimeOfDay(20, 45, '12h', 'en')).toBe('8:45 PM');
    await i18n.changeLanguage('en');
    expect(formatTimeOfDay(20, 45, '12h', 'es')).toBe('8:45 p. m.');
  });

  it('leaves the 24h cycle byte-identical whatever the active language', async () => {
    const english: string[] = [];
    for (let h = 0; h < 24; h++) english.push(formatTimeOfDay(h, 30, '24h'));

    await i18n.changeLanguage('es');
    for (let h = 0; h < 24; h++) {
      expect(formatTimeOfDay(h, 30, '24h')).toBe(english[h]);
      expect(formatTimeOfDay(h, 30, '24h')).toMatch(/^\d{2}:30$/);
    }
  });
});

// ============================================================================
// getTimezoneLabel — localized
// ============================================================================
describe('getTimezoneLabel localization', () => {
  it('returns the English label in English', () => {
    expect(getTimezoneLabel('America/Denver')).toBe('Mountain Time');
    expect(getTimezoneLabel('America/New_York')).toBe('Eastern Time');
  });

  it('returns the Spanish label in Spanish', async () => {
    // The bug: "Las horas se guardan en Mountain Time (MT)." — an English
    // fragment welded into a Spanish sentence.
    await i18n.changeLanguage('es');
    expect(getTimezoneLabel('America/Denver')).toBe('Hora de la Montaña');
    expect(getTimezoneLabel('America/New_York')).toBe('Hora del Este');
    expect(getTimezoneLabel('Pacific/Honolulu')).toBe('Hora de Hawái');
  });

  it('honours an explicit language over the active one', async () => {
    await i18n.changeLanguage('en');
    expect(getTimezoneLabel('America/Denver', 'es')).toBe('Hora de la Montaña');
    await i18n.changeLanguage('es');
    expect(getTimezoneLabel('America/Denver', 'en')).toBe('Mountain Time');
  });

  it('degrades to the English label when the key is missing, never to a raw key', async () => {
    // The locale JSON is merged centrally and could lag this code. A key name
    // must never reach a sentence a customer reads.
    const removed = i18n.getResourceBundle('es', 'common');
    i18n.removeResourceBundle('es', 'common');
    try {
      await i18n.changeLanguage('es');
      const label = getTimezoneLabel('America/Denver');
      expect(label).toBe('Mountain Time');
      expect(label).not.toContain('timezoneLabels');
    } finally {
      i18n.addResourceBundle('es', 'common', removed, true, true);
    }
  });
});

// ============================================================================
// The Mexico City customer — the live bug
// ============================================================================
// "Las horas se guardan en America/Mexico_City (Mexico_City)." Unmapped zones
// fell through to the raw IANA id, which is unreadable in EVERY language.
describe('unmapped timezones read as prose in every language', () => {
  const UNMAPPED = 'America/Mexico_City';

  it('never returns the raw IANA identifier in English', () => {
    const label = getTimezoneLabel(UNMAPPED);
    expect(label).not.toBe(UNMAPPED);
    expect(label).not.toContain('/');
    expect(label).not.toContain('_');
    expect(label).toBe('Central Standard Time');
  });

  it('never returns the raw IANA identifier in Spanish', async () => {
    await i18n.changeLanguage('es');
    const label = getTimezoneLabel(UNMAPPED);
    expect(label).not.toBe(UNMAPPED);
    expect(label).not.toContain('/');
    expect(label).not.toContain('_');
    // Intl's own Spanish name. Asserted case-insensitively on the distinctive
    // word rather than in full: ICU wording varies across Node/browser builds,
    // and the contract here is "readable Spanish", not one exact string.
    expect(label.toLowerCase()).toContain('hora');
  });

  it('actually differs between the two languages', async () => {
    const en = getTimezoneLabel(UNMAPPED, 'en');
    const es = getTimezoneLabel(UNMAPPED, 'es');
    expect(es).not.toBe(en);
  });

  it('renders the full sentence fragment the modals build', async () => {
    // Exactly what AddEventModal / VitalFormModal / CalendarPage interpolate.
    await i18n.changeLanguage('es');
    const fragment = `${getTimezoneLabel(UNMAPPED)} (${getTimezoneAbbreviation(UNMAPPED)})`;
    expect(fragment).not.toContain('America/Mexico_City');
    expect(fragment).not.toContain('Mexico_City');
    expect(fragment).toContain('(CST)');
  });
});

// ============================================================================
// THE MATH IS NOT LOCALE-AWARE, AND MUST NEVER BECOME SO
// ============================================================================
// `utils/timezone.ts` is full of Intl/toLocale* calls pinned to 'en-US' /
// 'en-CA'. Those are OFFSET EXTRACTION and YYYY-MM-DD key construction, not
// display — twenty timezone bugs were fixed by pinning them, and unpinning any
// of them re-earns that whole class of bug.
//
// The trap this locks shut: a future change makes timezone.ts language-aware
// (as this one just did, for display) and "helpfully" threads the locale into
// the arithmetic too. Every expectation below is derived by hand, then asserted
// while i18next is on SPANISH — so the numbers must come out identical.
describe('timezone math is invariant under the active language', () => {
  beforeEach(async () => {
    await i18n.changeLanguage('es');
  });

  it('getTimezoneOffsetMinutes: standard time', () => {
    // 15 Jan 2026 — New York is on EST, UTC-5.
    expect(getTimezoneOffsetMinutes('America/New_York', new Date('2026-01-15T12:00:00Z'))).toBe(
      -300
    );
  });

  it('getTimezoneOffsetMinutes: daylight time', () => {
    // 15 Jul 2026 — Denver is on MDT, UTC-6.
    expect(getTimezoneOffsetMinutes('America/Denver', new Date('2026-07-15T12:00:00Z'))).toBe(-360);
  });

  it('getTimezoneOffsetMinutes: ahead of UTC', () => {
    // Tokyo is UTC+9 year-round (no DST).
    expect(getTimezoneOffsetMinutes('Asia/Tokyo', new Date('2026-08-16T12:00:00Z'))).toBe(540);
  });

  it('getDateInTimezone: the day is the RECIPIENT\'s, not UTC\'s', () => {
    // 02:30 UTC on 10 Mar is still 22:30 on 9 Mar in New York (EDT, UTC-4 —
    // 2026 DST began 8 Mar).
    expect(getDateInTimezone('America/New_York', new Date('2026-03-10T02:30:00Z'))).toBe(
      '2026-03-09'
    );
    // 20:00 UTC on 16 Aug is already 05:00 on 17 Aug in Tokyo (UTC+9).
    expect(getDateInTimezone('Asia/Tokyo', new Date('2026-08-16T20:00:00Z'))).toBe('2026-08-17');
  });

  it('getDateInTimezone still produces YYYY-MM-DD, never a localized date', () => {
    // es-ES would render 16/8/2026 — that string is a DATABASE KEY compared
    // with `<` and `>`, so any localization silently breaks every date compare.
    const key = getDateInTimezone('America/Denver', new Date('2026-08-16T18:00:00Z'));
    expect(key).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    expect(key).toBe('2026-08-16');
  });

  it('convertTimeBetweenTimezones: crossing midnight forward', () => {
    // 22:00 in Denver (UTC-6 in July) is 00:00 the NEXT day in New York (UTC-4).
    expect(
      convertTimeBetweenTimezones(
        22,
        0,
        'America/Denver',
        'America/New_York',
        new Date('2026-07-15T12:00:00Z')
      )
    ).toEqual({ hours: 0, minutes: 0, dayOffset: 1 });
  });

  it('convertTimeBetweenTimezones: crossing midnight backward', () => {
    // 01:00 in New York is 23:00 the PREVIOUS day in Denver.
    expect(
      convertTimeBetweenTimezones(
        1,
        0,
        'America/New_York',
        'America/Denver',
        new Date('2026-07-15T12:00:00Z')
      )
    ).toEqual({ hours: 23, minutes: 0, dayOffset: -1 });
  });

  it('formatTimeForAPI: 24-hour HH:MM, never a meridiem', () => {
    // The write side. A localized "8:00 p. m." here would be rejected by the
    // backend's HH:MM validation — or worse, stored.
    const instant = new Date('2026-08-17T02:00:00Z'); // 20:00 on 16 Aug in Denver
    expect(formatTimeForAPI(instant, 'America/Denver')).toBe('20:00');
    expect(formatTimeForAPI(instant, 'America/Denver')).not.toMatch(/[apAP]\.?\s?[mM]/);
  });

  it('formatDateTimeForAPI: both halves read the SAME instant in the SAME zone', () => {
    const instant = new Date('2026-08-17T02:00:00Z');
    expect(formatDateTimeForAPI(instant, 'America/Denver')).toEqual({
      scheduled_date: '2026-08-16',
      scheduled_time: '20:00',
    });
    // Same instant, a zone one day ahead.
    expect(formatDateTimeForAPI(instant, 'America/New_York')).toEqual({
      scheduled_date: '2026-08-16',
      scheduled_time: '22:00',
    });
  });

  it('isEventPastDue: compares in the recipient timezone', () => {
    const now = new Date('2026-08-16T18:00:00Z'); // 12:00 in Denver (MDT)
    expect(isEventPastDue('2026-08-16', '11:00', 'America/Denver', now)).toBe(true);
    expect(isEventPastDue('2026-08-16', '13:00', 'America/Denver', now)).toBe(false);
    expect(isEventPastDue('2026-08-15', '23:00', 'America/Denver', now)).toBe(true);
    expect(isEventPastDue('2026-08-17', '00:01', 'America/Denver', now)).toBe(false);
  });
});
