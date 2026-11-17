import { formatRecurrenceLabel, formatWeekdayList } from '../recurrenceLabel';
import { browserRegion, firstDayForRegion, firstDayOfWeek, nextDateOnWeekdays, orderedWeekdays } from '../dateMath';
import { readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';

/** The browser's preferred languages for one test (jsdom says en-US). */
function stubBrowserLanguages(languages: string[]) {
  vi.spyOn(window.navigator, 'languages', 'get').mockReturnValue(languages);
  vi.spyOn(window.navigator, 'language', 'get').mockReturnValue(languages[0] ?? '');
}

afterEach(() => {
  vi.restoreAllMocks();
});

/** Passes the key through with its interpolations, so the exact output is visible. */
const t = (key: string, opts?: Record<string, unknown>): string =>
  opts && Object.keys(opts).length ? `${key}(${JSON.stringify(opts)})` : key;

describe('weekday order follows the locale week start', () => {
  it('en starts on Sunday, es on Monday — 0=Sun throughout, never 7', () => {
    expect(orderedWeekdays('en')).toEqual([0, 1, 2, 3, 4, 5, 6]);
    expect(orderedWeekdays('es')).toEqual([1, 2, 3, 4, 5, 6, 0]);
  });

  it('orders by the BASE language, so a regional PDF locale reads like the app', () => {
    // CLDR starts es-MX on Sunday; the app UI (bare `es`) and mobile start on
    // Monday. The day list must read the same everywhere it appears.
    expect(orderedWeekdays('es-MX')).toEqual(orderedWeekdays('es'));
    expect(orderedWeekdays('en-GB')).toEqual(orderedWeekdays('en'));
  });
});

describe('formatWeekdayList', () => {
  it('renders short names in week order, whatever order the set was stored in', () => {
    expect(formatWeekdayList([5, 1, 3], 'en')).toBe('Mon, Wed, Fri');
    expect(formatWeekdayList([5, 1, 3], 'es')).toBe('lun, mié, vie');
  });

  it('puts Sunday LAST in Spanish and FIRST in English (browser with no region)', () => {
    stubBrowserLanguages(['es']);
    expect(formatWeekdayList([0, 3], 'en')).toBe('Sun, Wed');
    expect(formatWeekdayList([0, 3], 'es')).toBe('mié, dom');
  });

  it('drops values outside 0..6 and duplicates; empty for nothing valid', () => {
    expect(formatWeekdayList([7, -1, 2, 2, 1.5], 'en')).toBe('Tue');
    expect(formatWeekdayList([], 'en')).toBe('');
    expect(formatWeekdayList(null, 'en')).toBe('');
  });
});

describe('week start follows the browser REGION (1.4.2 i18n audit D)', () => {
  // POSITIVE
  it('en-GB browser: Monday first, Sunday last; es-MX: Sunday first', () => {
    stubBrowserLanguages(['en-GB', 'en']);
    expect(browserRegion()).toBe('GB');
    expect(formatWeekdayList([0, 3], 'en')).toBe('Wed, Sun');
    stubBrowserLanguages(['es-MX']);
    expect(formatWeekdayList([0, 3], 'es')).toBe('dom, mié');
    stubBrowserLanguages(['es-ES']);
    expect(formatWeekdayList([0, 3], 'es')).toBe('mié, dom');
  });

  it.each([
    ['GB', 1], ['IE', 1], ['AU', 1], ['NZ', 1], ['DE', 1], ['FR', 1], ['ES', 1], ['AR', 1],
    ['US', 0], ['CA', 0], ['MX', 0], ['BR', 0], ['PT', 0], ['CO', 0], ['EG', 6], ['MV', 5],
  ])('%s starts on %i whatever the language', (region, day) => {
    expect(firstDayOfWeek('en', region)).toBe(day);
    expect(firstDayOfWeek('es', region)).toBe(day);
  });

  it('agrees with the runtime CLDR for every region', () => {
    const DEPRECATED = new Set(['BU', 'JT', 'MI', 'NT', 'PU', 'PZ', 'RH', 'WK', 'YD']);
    type WeekLocale = Intl.Locale & { getWeekInfo?: () => { firstDay: number }; weekInfo?: { firstDay: number } };
    if (!(new Intl.Locale('und-GB') as WeekLocale).getWeekInfo && !(new Intl.Locale('und-GB') as WeekLocale).weekInfo) return;
    const A = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ';
    for (const a of A) {
      for (const b of A) {
        const region = a + b;
        if (DEPRECATED.has(region)) continue;
        const loc = new Intl.Locale(`und-${region}`) as WeekLocale;
        const info = loc.getWeekInfo ? loc.getWeekInfo() : loc.weekInfo!;
        expect([region, firstDayForRegion(region)]).toEqual([region, info.firstDay % 7]);
      }
    }
  });

  it('is the same table as mobile (utils/weekStart.ts)', () => {
    const mobile = join(__dirname, '../../../../../mobile/src/utils/weekStart.ts');
    if (!existsSync(mobile)) return;
    const web = readFileSync(join(__dirname, '../dateMath.ts'), 'utf8');
    const src = readFileSync(mobile, 'utf8');
    const lists = (s: string) =>
      ['SUNDAY_FIRST_REGIONS', 'SATURDAY_FIRST_REGIONS', 'FRIDAY_FIRST_REGIONS'].map((name) => {
        const block = s.slice(s.indexOf(`const ${name}`), s.indexOf(');', s.indexOf(`const ${name}`)));
        return (block.match(/\b[A-Z]{2}\b/g) ?? []).sort().join(' ');
      });
    expect(lists(web)).toEqual(lists(src));
  });

  // NEGATIVE
  it('a browser with no usable region keeps the language order exactly as before', () => {
    for (const langs of [['es'], ['es-419'], [], ['zz-ZZZ']]) {
      stubBrowserLanguages(langs);
      expect(browserRegion()).toBeNull();
      expect(formatWeekdayList([0, 3], 'es')).toBe('mié, dom');
      expect(formatWeekdayList([0, 3], 'en')).toBe('Sun, Wed');
    }
    for (const r of [null, undefined, '', '419', 'GBR']) {
      expect(firstDayForRegion(r)).toBeNull();
      expect(firstDayOfWeek('es', r)).toBe(firstDayOfWeek('es'));
    }
  });

  it('never emits 7 and keeps every stored day number', () => {
    for (const region of ['US', 'GB', 'EG', 'MV']) {
      expect([...orderedWeekdays('en', region)].sort()).toEqual([0, 1, 2, 3, 4, 5, 6]);
    }
  });
});

describe('week start uses THE shared region resolver (units, phone seed and week start agree)', () => {
  function stubTimeZone(timeZone: string) {
    const real = Intl.DateTimeFormat.prototype.resolvedOptions;
    vi.spyOn(Intl.DateTimeFormat.prototype, 'resolvedOptions').mockImplementation(function (
      this: Intl.DateTimeFormat
    ) {
      return { ...real.call(this), timeZone };
    });
  }

  // POSITIVE
  it('a bare "en" browser in Europe/London is GB (time zone step) and starts on Monday', () => {
    stubBrowserLanguages(['en']);
    stubTimeZone('Europe/London');
    expect(browserRegion()).toBe('GB');
    expect(formatWeekdayList([0, 3], 'en')).toBe('Wed, Sun');
  });

  it('answers exactly what the vitals units read (lib/regionResolver.browserRegion)', async () => {
    const { browserRegion: unitsRegion } = await import('@/lib/regionResolver');
    for (const [langs, tz] of [
      [['en'], 'Europe/London'],
      [['de'], 'America/Denver'],
      [['en-US'], 'Europe/Berlin'],
      [['es-419'], 'America/Denver'],
    ] as const) {
      stubBrowserLanguages([...langs]);
      stubTimeZone(tz);
      expect(browserRegion()).toBe(unitsRegion());
    }
  });

  // NEGATIVE
  it('an en-US browser in a US zone stays US and Sunday-first', () => {
    stubBrowserLanguages(['en-US']);
    stubTimeZone('America/New_York');
    expect(browserRegion()).toBe('US');
    expect(formatWeekdayList([0, 3], 'en')).toBe('Sun, Wed');
  });

  it('a bare "en" browser in a US zone has no region: the language decides (Sunday)', () => {
    stubBrowserLanguages(['en']);
    stubTimeZone('America/Denver');
    expect(browserRegion()).toBeNull();
    expect(formatWeekdayList([0, 3], 'en')).toBe('Sun, Wed');
  });
});

describe('formatRecurrenceLabel — weekly with days', () => {
  it('labels a days series in the locale order', () => {
    const event = { recurrence_rule: 'weekly', recurrence_days: [5, 3, 1] };
    expect(formatRecurrenceLabel(event, t, 'en')).toBe(
      'calendar:recurrence.weeklyOn({"days":"Mon, Wed, Fri"})'
    );
    expect(formatRecurrenceLabel(event, t, 'es')).toBe(
      'calendar:recurrence.weeklyOn({"days":"lun, mié, vie"})'
    );
  });

  it('a weekly series without days, or with only invalid ones, is plain Weekly', () => {
    expect(formatRecurrenceLabel({ recurrence_rule: 'weekly', recurrence_days: null }, t, 'en')).toBe(
      'calendar:recurrence.weekly'
    );
    expect(formatRecurrenceLabel({ recurrence_rule: 'weekly', recurrence_days: [9] }, t, 'en')).toBe(
      'calendar:recurrence.weekly'
    );
  });
});

describe('formatRecurrenceLabel — monthly, yearly, days on / off (never the raw rule)', () => {
  it('monthly and yearly have their own labels', () => {
    expect(formatRecurrenceLabel({ recurrence_rule: 'monthly', recurrence_days: null }, t, 'en')).toBe(
      'calendar:recurrence.monthly'
    );
    expect(formatRecurrenceLabel({ recurrence_rule: 'yearly', recurrence_days: null }, t, 'en')).toBe(
      'calendar:recurrence.yearly'
    );
  });

  it('cycle:N:M reads as days on / days off', () => {
    expect(formatRecurrenceLabel({ recurrence_rule: 'cycle:14:7', recurrence_days: null }, t, 'en')).toBe(
      'calendar:recurrence.cycle({"on":14,"off":7})'
    );
  });

  it('renders the real English words through the app i18n', async () => {
    const { default: i18n } = await import('@/i18n');
    const real = i18n.getFixedT('en');
    expect(formatRecurrenceLabel({ recurrence_rule: 'cycle:14:7', recurrence_days: null }, real, 'en')).toBe(
      '14 days on, 7 days off'
    );
    expect(formatRecurrenceLabel({ recurrence_rule: 'monthly', recurrence_days: null }, real, 'en')).toBe('Monthly');
    expect(formatRecurrenceLabel({ recurrence_rule: 'yearly', recurrence_days: null }, real, 'en')).toBe('Yearly');
  });
});

describe('nextDateOnWeekdays (string date math, 0=Sun)', () => {
  it('returns the date itself when it is on the set', () => {
    expect(nextDateOnWeekdays('2026-06-15', [1])).toBe('2026-06-15'); // Monday
  });

  it('moves forward to the next selected weekday, at most six days', () => {
    expect(nextDateOnWeekdays('2026-06-16', [1, 3, 5])).toBe('2026-06-17'); // Tue → Wed
    expect(nextDateOnWeekdays('2026-06-16', [1])).toBe('2026-06-22'); // Tue → next Mon
    expect(nextDateOnWeekdays('2026-06-15', [0])).toBe('2026-06-21'); // Mon → Sun (0)
  });

  it('crosses a month and a year boundary', () => {
    expect(nextDateOnWeekdays('2026-12-30', [5])).toBe('2027-01-01'); // Wed → Fri
  });

  it('is null for a set with no valid weekday', () => {
    expect(nextDateOnWeekdays('2026-06-15', [])).toBeNull();
    expect(nextDateOnWeekdays('2026-06-15', [7])).toBeNull();
  });
});
