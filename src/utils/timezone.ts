// The i18next PACKAGE singleton, not `src/i18n` (this app's barrel).
//
// CIRCULAR IMPORT: `src/i18n/index.ts` calls `i18n.init()` in its module body
// and pulls in every locale JSON plus the browser language detector — importing
// it here would put a leaf util on the i18n bootstrap path and run that init
// inside any unit test that touches a date. `i18next` itself is a leaf
// node_module and exports the very same singleton instance that
// `src/i18n/index.ts` configures, so reading `.language` / calling `.t()` off it
// is exactly as correct with none of that coupling. No cycle exists on this
// edge.
import i18n from 'i18next';
import { getCurrentUser, updateProfile } from '../api/users';
import { devLog, devError } from '../constants/config';
import type { HourCycle } from './hourCycle';

// VERBATIM PORT of mobile/src/utils/timezone.ts (Intl-based — 20 timezone bugs
// were fixed on mobile; web must not re-earn those scars).
// Only adaptation: getDeviceTimezone uses Intl.resolvedOptions() instead of
// expo-localization.
//
// NEVER use `new Date().getHours()` to compare with scheduled times,
// `.split('T')[0]` on UTC ISO strings, or `toLocaleDateString()` without a
// `timeZone` param — always convert to the care recipient's timezone first.

/**
 * ONE `Intl.DateTimeFormat` PER SHAPE, NOT ONE PER CALL.
 *
 * Constructing an `Intl.DateTimeFormat` is the expensive half of the API — it
 * resolves locale and timezone data — while formatting with an existing one is
 * cheap. This module built a fresh formatter at all nine call sites below, and
 * the hot path multiplies that: `formatEventTimeCompact` calls
 * `getTimezoneSuffix` -> `timezonesAreDifferent` -> `getTimezoneOffsetMinutes`
 * ONCE PER ZONE, so rendering a single row constructed three. A month grid or a
 * list of medication rows paid that on every render.
 *
 * The instances are stateless with respect to formatting — the Date is an
 * argument to `.format()`, never to the constructor — so sharing one across
 * calls is safe and cannot leak a date between callers.
 *
 * The key must include the locale AND every option, because two call sites in
 * this file build their options dynamically by spreading. The cache is bounded
 * in practice by (distinct zones seen) x (option shapes in this file), which is
 * small; the cap below is only there so a pathological caller cannot grow it
 * without limit.
 *
 * MIRRORS mobile/src/utils/timezone.ts. `timezoneFormattersAreCached.test.ts`
 * guards it.
 */
const FORMATTER_CACHE = new Map<string, Intl.DateTimeFormat>();
const FORMATTER_CACHE_MAX = 200;

function dateTimeFormat(locale: string, options: Intl.DateTimeFormatOptions): Intl.DateTimeFormat {
  const key = `${locale}|${JSON.stringify(options)}`;
  const hit = FORMATTER_CACHE.get(key);
  if (hit) return hit;

  const made = new Intl.DateTimeFormat(locale, options);
  if (FORMATTER_CACHE.size >= FORMATTER_CACHE_MAX) FORMATTER_CACHE.clear();
  FORMATTER_CACHE.set(key, made);
  return made;
}

/**
 * The cache above, for callers OUTSIDE this module.
 *
 * A component that formats per row — the medication history list formats a
 * wall clock for every confirmation and a title for every day group — was
 * building a fresh `Intl.DateTimeFormat` each time, which is exactly the cost
 * this cache exists to remove; it was simply unreachable from outside.
 *
 * The LOCALE is a parameter, not just the zone: a day-group title carries a
 * month name, so the same zone under `en` and `es` are two different
 * formatters and must be two different cache entries. Put the zone in
 * `options.timeZone`, as every call site inside this module does.
 *
 * Same contract as the private helper: the instance is stateless with respect
 * to formatting (the Date is an argument to `.format()`, never to the
 * constructor), so sharing one across callers cannot leak a date between them.
 */
export function getCachedDateTimeFormat(
  locale: string,
  options: Intl.DateTimeFormatOptions
): Intl.DateTimeFormat {
  return dateTimeFormat(locale, options);
}

/**
 * The zones that have no place name in them.
 *
 * WHAT THIS REPLACED. A hand-written abbreviation table (ET, CT, MT, PT, AZ,
 * AKT, HT) plus an Intl `timeZoneName: 'short'` fallthrough for everything
 * else. It is gone because those strings cannot be SOURCED, only invented:
 *
 *   - Intl cannot supply them. The best any single locale manages is a handful
 *     of US zones, and the locales disagree with each other -- Europe/Berlin is
 *     "MESZ" under `de`, "CEST" under `es` and "Germany Time" under `en`. There
 *     is no language-neutral abbreviation in CLDR to read.
 *   - The IANA tzdb DELETED its invented abbreviations in 2017a. It now reports
 *     "-05" for America/Lima and "-03" for America/Sao_Paulo, so no package can
 *     hand back what the database no longer carries.
 *   - The short-name fallthrough was an OFFSET for most of the world:
 *     Europe/Berlin "GMT+2", Asia/Tokyo "GMT+9", Asia/Kolkata "GMT+5:30".
 *
 * So a zone is named the way Apple's Clock, timezone picker and Settings name
 * it: by its CITY. "Berlin", "Tokyo", "Denver", derived from the IANA id by
 * {@link ianaPlaceName}. Never an abbreviation, never `GMT+-X`.
 *
 * UTC is the one id with no city inside it, and "hora de UTC" is not a
 * sentence, so it names itself. `Etc/UTC` needs its own row because
 * {@link ianaPlaceName} rejects the entire `Etc/*` family (those ids are
 * offsets, and inverted ones at that: `Etc/GMT+5` is UTC-5).
 *
 * MIRRORS mobile/src/utils/timezone.ts. Change both in the same commit.
 */
const NON_PLACE_LABELS: Record<string, string> = {
  UTC: 'UTC',
  'Etc/UTC': 'UTC',
};

/**
 * Spanish spellings for the place names an IANA id yields.
 *
 * An IANA id is ASCII by construction — `America/Mexico_City`, never
 * `America/Ciudad_de_México` — so the name derived from it is always the
 * English one. A Spanish reader deserves "Berlín", not "Berlin".
 *
 * THE ONE PLACE THE TWO LANGUAGES ARE MEANT TO DIFFER. Apple localises its
 * city names too — Settings reads "Londres" in Spanish and "London" in English
 * — so `getTimezoneLabel(z, 'en') !== getTimezoneLabel(z, 'es')` for any zone
 * with a row here is the DESIGN, not a bug.
 *
 * BOUNDED AND BEST-EFFORT, keyed by the derived English name. It covers this
 * app's own markets (US, Latin America, Spain) plus the largest cities
 * elsewhere; anything unlisted falls through to the IANA name, which is already
 * readable. A missing row costs an accent, never a broken label, so this list
 * may be extended freely and never has to be complete. Only names whose Spanish
 * DIFFERS are listed — "Madrid", "Lima" and "Denver" need no row.
 */
const PLACE_NAMES_ES: Record<string, string> = {
  // Americas
  'Mexico City': 'Ciudad de México',
  Cancun: 'Cancún',
  Merida: 'Mérida',
  Bogota: 'Bogotá',
  Panama: 'Panamá',
  Asuncion: 'Asunción',
  'Sao Paulo': 'São Paulo',
  Havana: 'La Habana',
  'New York': 'Nueva York',
  'Los Angeles': 'Los Ángeles',
  // Europe
  London: 'Londres',
  Berlin: 'Berlín',
  Paris: 'París',
  Rome: 'Roma',
  Lisbon: 'Lisboa',
  Brussels: 'Bruselas',
  Vienna: 'Viena',
  Zurich: 'Zúrich',
  Athens: 'Atenas',
  Warsaw: 'Varsovia',
  Prague: 'Praga',
  Copenhagen: 'Copenhague',
  Stockholm: 'Estocolmo',
  Dublin: 'Dublín',
  Moscow: 'Moscú',
  Istanbul: 'Estambul',
  // Africa & Middle East
  Cairo: 'El Cairo',
  Johannesburg: 'Johannesburgo',
  Dubai: 'Dubái',
  // Asia & Pacific
  Tokyo: 'Tokio',
  Seoul: 'Seúl',
  Shanghai: 'Shanghái',
  Singapore: 'Singapur',
  Jakarta: 'Yakarta',
  Kolkata: 'Calcuta',
  Calcutta: 'Calcuta',
  'New Delhi': 'Nueva Delhi',
  Sydney: 'Sídney',
};

/**
 * The language a time or zone is being RENDERED in.
 *
 * Local to this file on purpose: `src/i18n/index.ts` exports an identical
 * `SupportedLanguage`, but importing it would drag the i18n barrel (and its
 * `i18n.init()` side effect) onto this leaf util. See the `i18next` import at
 * the top of the file.
 */
export type TimeLanguage = 'en' | 'es';

/**
 * The 12-hour period marker, per language.
 *
 * VERBATIM COPY of `backend/src/i18n/translations.ts` (the CANONICAL source);
 * `mobile/src/utils/timezone.ts` carries the third copy. Change all three in
 * the same commit — otherwise the app, the web app and the server render the
 * same appointment three different ways.
 *
 * Spanish uses the RAE form `a. m.` / `p. m.`: lowercase, a period after EACH
 * letter, and a space between the two groups. Not `AM`, not `am`, not `a.m.`.
 *
 * Deliberately a constant rather than an i18n key. This is a locale FORMAT
 * primitive, not copy: a key that has not loaded yet would render its own name
 * ("time.meridiem.pm") into every calendar row, and a well-meaning edit to `PM`
 * in a locale file would silently undo RAE compliance.
 */
const MERIDIEM: Record<TimeLanguage, { am: string; pm: string }> = {
  en: { am: 'AM', pm: 'PM' },
  es: { am: 'a. m.', pm: 'p. m.' },
};

/**
 * The language i18next is currently rendering in, narrowed to what this file
 * can format. Never throws and never returns undefined: a formatting helper
 * must not be the thing that crashes a page, and an unresolved language is
 * 'en' — the app's own `fallbackLng`.
 *
 * Regional tags matter: the browser detector routinely yields `es-MX` or
 * `es-419` (see `nonExplicitSupportedLngs` in `src/i18n/index.ts`), both of
 * which must format as Spanish.
 */
function activeLanguage(): TimeLanguage {
  try {
    const lng = i18n?.resolvedLanguage || i18n?.language;
    return typeof lng === 'string' && lng.toLowerCase().startsWith('es') ? 'es' : 'en';
  } catch {
    return 'en';
  }
}

/**
 * The human place inside an IANA id — `Europe/Berlin` -> "Berlin",
 * `America/Mexico_City` -> "Mexico City", `America/Argentina/Buenos_Aires` ->
 * "Buenos Aires" — or null when the id carries no place to read.
 *
 * NULL RATHER THAN AN OFFSET, ALWAYS. `Etc/GMT+5`, `GMT`, `UTC+3` and the
 * `+05:30`-shaped ids are offsets wearing an id's clothes. The product rule is
 * that a user never sees `GMT±X`, so a zone with nothing readable in it gets NO
 * label at all — omitting the label is the correct outcome, printing an offset
 * is not.
 *
 * The underscore is the whole reason this is a function and not a `.pop()`:
 * "8:00 p. m. Mexico_City" is exactly what shipped the last time a city was
 * appended raw.
 */
function ianaPlaceName(timezone: string): string | null {
  if (!timezone) return null;
  // The `Etc/*` family is offsets by definition, and its signs are INVERTED
  // (`Etc/GMT+5` is UTC-5) — the last thing to show anybody.
  if (/^etc\//i.test(timezone)) return null;
  const name = (timezone.split('/').pop() ?? '').replace(/_/g, ' ').trim();
  if (!name) return null;
  if (/gmt/i.test(name) || /^utc[+-]/i.test(name) || /^[+-]?\d/.test(name)) return null;
  return name;
}

/**
 * The name a zone resolves to, in the reader's language: a city, or one of the
 * {@link NON_PLACE_LABELS} rows for the ids that contain no city.
 */
function localizedPlaceName(timezone: string, language: TimeLanguage): string | null {
  const fixed = NON_PLACE_LABELS[timezone];
  if (fixed) return fixed;
  const place = ianaPlaceName(timezone);
  if (!place) return null;
  return language === 'es' ? PLACE_NAMES_ES[place] ?? place : place;
}

/**
 * Get the device's (browser's) current IANA timezone
 */
export function getDeviceTimezone(): string {
  try {
    return new Intl.DateTimeFormat().resolvedOptions().timeZone || 'America/New_York';
  } catch {
    return 'America/New_York';
  }
}

/**
 * THE NAME OF A ZONE: its city. "Berlin", "Mexico City", "Denver",
 * "Buenos Aires" — "Berlín", "Ciudad de México" for a Spanish reader. `''`
 * when the id holds no city (the `Etc/*` family, a bare offset).
 *
 * APPLE'S CONVENTION, deliberately. The Clock app, the timezone picker and
 * Settings all name a zone by its city; so does this app. No abbreviation
 * (there is no sourceable set — see {@link NON_PLACE_LABELS}) and no `GMT+-X`,
 * ever.
 *
 * WHAT THIS REPLACED, and why the i18n keys went with it. The label used to be
 * a curated English string ("Mountain Time") looked up through
 * `common:timezoneLabels.<IANA>`, falling through to Intl's LONG name for
 * anything outside the seven US rows. Both halves were wrong for the same
 * reason the abbreviation table was: Intl's long name is locale-dependent prose
 * ("Germany Time", "hora de Europa central"), not a name a product can commit
 * to. The city comes from the IANA id, so it needs no table to keep growing and
 * no key to keep translated — only the accents in {@link PLACE_NAMES_ES}.
 *
 * `language` is OPTIONAL and defaults to the active i18next language so the
 * existing call sites need no edit; pass it explicitly in tests, or when
 * rendering for somebody other than the current viewer.
 *
 * Use this where the zone is named ON ITS OWN — a page subtitle, a sentence
 * with a `{{timezone}}` slot, the conversion line in a form. Where it FOLLOWS a
 * rendered time, use {@link getTimezoneSuffix}, which adds the parentheses and
 * the same-zone suppression.
 */
export function getTimezoneLabel(timezone: string, language?: TimeLanguage): string {
  return localizedPlaceName(timezone, language ?? activeLanguage()) ?? '';
}

/**
 * The zone label as it is APPENDED to a rendered time, leading space included:
 * `' (Berlin)'`, `' (Denver)'`, `' (Berlín)'`.
 *
 * ONE SHAPE, ALWAYS PARENTHESISED. There used to be two — a curated
 * abbreviation rode bare ("8:00 PM MT") while the long label was parenthesised
 * — but with the abbreviation table gone every label is a city, so every label
 * is bracketed. The parentheses are PUNCTUATION applied here rather than copy
 * in a locale file: they are the same character in English and Spanish, and the
 * city itself is already localised by {@link localizedPlaceName}.
 *
 * Says nothing (`''`) when there is no readable name. It does NOT decide
 * whether the label is wanted — {@link getTimezoneSuffix} does that.
 */
function zoneSuffixText(timezone: string, language: TimeLanguage): string {
  const label = getTimezoneLabel(timezone, language);
  return label ? ` (${label})` : '';
}

/**
 * THE zone suffix for a rendered time: `''` or `' (Berlín)'`.
 *
 * SILENT WHEN THE VIEWER SHARES THE ZONE, which is the point. A zone label
 * answers "whose clock is this?"; in a single-zone circle — the overwhelming
 * majority — there is only one clock and the label is pure noise. Web appended
 * it UNCONDITIONALLY on every surface (the activity feed, `formatEventTimeCompact`,
 * `formatTimestampInTimezone`), so a Denver caregiver watching a Denver
 * recipient read "8:00 PM MT" on every row. This is the gate those surfaces
 * were missing, hoisted so no surface can forget it again.
 *
 * @param at - the instant to judge the comparison at. Two zones where only one
 *   observes DST (Phoenix / Denver) share a clock for part of the year, so
 *   "are these different" has no answer without saying WHEN. Pass the row's own
 *   date via {@link zoneReferenceInstant}, not today.
 */
export function getTimezoneSuffix(
  timezone: string,
  at: Date,
  options: { language?: TimeLanguage; deviceTimezone?: string } = {}
): string {
  if (!timezone) return '';
  const device = options.deviceTimezone ?? getDeviceTimezone();
  if (!timezonesAreDifferent(device, timezone, at)) return '';
  return zoneSuffixText(timezone, options.language ?? activeLanguage());
}

/**
 * The instant a row whose only date is a naive `YYYY-MM-DD` should have its
 * zone comparison judged at.
 *
 * NOON, not midnight: the two offsets either side of a DST transition are
 * exactly what these comparisons turn on, and midnight sits close enough to one
 * to be pushed across it by a zone's own shift.
 *
 * UTC noon, not the PROCESS's noon, and that distinction is the whole reason
 * this has a `Z`. Mobile's twin parses `${date}T12:00:00` — a naive string,
 * which every JS engine resolves in the MACHINE's own zone. The instant that
 * yields swings across a ~26-hour band depending on where the reader is
 * sitting, and with it the answer to "do these two zones differ on this date".
 * Measured: for 2026-03-08, a machine in Asia/Tokyo produced 03:00Z — BEFORE
 * America/Denver springs forward at 09:00Z — so a Phoenix caregiver watching a
 * Denver recipient saw the zone label appear or vanish according to which
 * timezone their own laptop was in. That is precisely the class of bug the rest
 * of this module exists to remove, so the anchor is pinned to a real instant.
 *
 * It is still an approximation — the exactly-correct anchor is noon in the
 * RECIPIENT's zone, which would need the zone passed in — but it is a
 * DETERMINISTIC one, identical for every viewer, and it sits at least 9 hours
 * clear of the 02:00-local transitions it has to stay away from in every zone
 * from UTC-11 to UTC+14.
 *
 * Falls back to NOW for a row with no date — an untimed note, a task with no
 * due date — which is the only instant such a row has. Stated here once so no
 * call site has to invent it, because inventing it is how `new Date()` creeps
 * back in.
 */
export function zoneReferenceInstant(scheduledDate?: string | null): Date {
  if (!scheduledDate) return new Date();
  const parsed = new Date(`${scheduledDate}T12:00:00Z`);
  return Number.isNaN(parsed.getTime()) ? new Date() : parsed;
}

/**
 * Get the UTC offset in minutes for a timezone at a specific date.
 * Positive = ahead of UTC, Negative = behind UTC.
 *
 * Compares the zone's FULL WALL-CLOCK READING (year, month, day, hour, minute)
 * against the instant, rather than the hour of day alone.
 *
 * The hour-of-day version this replaces could not tell UTC+14 from UTC-10 —
 * they read the SAME CLOCK, one day apart — so it folded everything past +12
 * back by a day and returned the wrong SIGN for every zone east of +12:
 * Pacific/Kiritimati (+14) reported -10:00, Pacific/Apia and Auckland-in-DST
 * (+13) reported -11:00. Downstream that made
 * timezonesAreDifferent('Pacific/Kiritimati', 'Pacific/Honolulu') FALSE, so no
 * dual-timezone line was shown between two zones a full day apart. Its comment
 * even claimed a "-12 to +14" range while the code capped at +12.
 *
 * Including the DAY in the comparison removes the ambiguity: the day is part of
 * the answer, so +14 and -10 are no longer the same number. Handles whole-hour,
 * half-hour (Asia/Kolkata +5:30) and quarter-hour (Asia/Kathmandu +5:45,
 * Pacific/Chatham +12:45) offsets identically, because nothing here assumes
 * hours.
 */
export function getTimezoneOffsetMinutes(timezone: string, date: Date = new Date()): number {
  try {
    const parts = dateTimeFormat('en-US', {
      timeZone: timezone,
      hour12: false,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
    }).formatToParts(date);

    const get = (type: string): number =>
      parseInt(parts.find((p) => p.type === type)?.value || '0', 10);

    // `% 24` because `hour12: false` renders midnight as 24 on some ICU builds.
    const wallClockAsUtc = Date.UTC(
      get('year'),
      get('month') - 1,
      get('day'),
      get('hour') % 24,
      get('minute')
    );

    if (Number.isNaN(wallClockAsUtc)) return 0;

    // Seconds and milliseconds floored on both sides so the difference is a
    // clean minute count rather than a fraction.
    const instantMinute = Math.floor(date.getTime() / 60000) * 60000;
    return Math.round((wallClockAsUtc - instantMinute) / 60000);
  } catch {
    return 0;
  }
}

/**
 * Convert a time from one timezone to another
 * @param hours - Hours (0-23)
 * @param minutes - Minutes (0-59)
 * @param fromTimezone - Source IANA timezone
 * @param toTimezone - Target IANA timezone
 * @param date - Reference date (for DST calculation)
 * @returns Object with converted hours, minutes, and day offset (-1, 0, or +1)
 */
export function convertTimeBetweenTimezones(
  hours: number,
  minutes: number,
  fromTimezone: string,
  toTimezone: string,
  date: Date = new Date()
): { hours: number; minutes: number; dayOffset: number } {
  try {
    // Get offsets for both timezones
    const fromOffset = getTimezoneOffsetMinutes(fromTimezone, date);
    const toOffset = getTimezoneOffsetMinutes(toTimezone, date);

    // Calculate the difference (positive means toTimezone is ahead)
    const offsetDiff = toOffset - fromOffset;

    // Convert to total minutes and add offset
    const totalMinutes = hours * 60 + minutes + offsetDiff;

    // Day wraparound, as a FLOOR DIVISION rather than a single +/-1440 step.
    //
    // A single step silently under-corrects at the extremes. Offsets run from
    // -11:00 (Pacific/Niue, Pacific/Midway) to +14:00 (Pacific/Kiritimati), so
    // `offsetDiff` spans +/-25 HOURS and `totalMinutes` spans -1500..2939. One
    // correction leaves -1500 at -60 and 2939 at 1499 — both still outside a
    // day. `Math.floor(-60 / 60)` is -1, which is how the dual-timezone line
    // rendered "-1:00 AM" for a Kiritimati time viewed from Niue.
    //
    // Floor division lands inside 0..1439 for any offset pair, and yields the
    // real dayOffset, which reaches +/-2 for a true 25-hour gap.
    const DAY = 24 * 60;
    const dayOffset = Math.floor(totalMinutes / DAY);
    const minuteOfDay = totalMinutes - dayOffset * DAY;

    return {
      hours: Math.floor(minuteOfDay / 60),
      minutes: minuteOfDay % 60,
      dayOffset,
    };
  } catch {
    return { hours, minutes, dayOffset: 0 };
  }
}

/**
 * Normalize a naive time-of-day to canonical `HH:MM`.
 *
 * Postgres `TIME` columns (e.g. `users.quiet_hours_start/end`) come back over
 * the API WITH seconds — `"22:00:00"` — while everything the app writes is
 * `HH:MM`. Round-tripping the server value unchanged is what broke saving quiet
 * hours: editing only the END time sent the untouched START back as
 * `"22:00:00"`, which stricter `HH:MM` validation rejected. It also feeds an
 * `<input type="time">` (whose `step` implies minutes) a seconds-bearing value,
 * which browsers handle inconsistently.
 *
 * Call this at the boundary where a server TIME enters local state, so only the
 * canonical form ever exists in the app.
 *
 * Nullish/empty values pass through untouched — callers layer their own
 * `|| '22:00'` defaults on top. Anything unrecognizable is returned as-is
 * rather than thrown on: a normalizer must never be the thing that crashes a
 * screen.
 */
export function normalizeTimeOfDay<T extends string | null | undefined>(value: T): T {
  if (typeof value !== 'string' || value === '') return value;
  const match = /^(\d{1,2}):(\d{2})(?::\d{2})?(?:\.\d+)?$/.exec(value.trim());
  if (!match) return value;
  return `${match[1].padStart(2, '0')}:${match[2]}` as T;
}

/**
 * THE one time-of-day renderer for this repo.
 *
 * Every user-facing time goes through here — no site may re-inline `% 12` or
 * `substring(0, 5)`. `cycle` comes from `resolveHourCycle()` (see
 * `utils/hourCycle.ts`), in a component via the `useHourCycle()` hook.
 *
 * `cycle` is REQUIRED on every display helper below — deliberately. It was
 * briefly defaulted to '12h' "so an un-wired call site keeps today's
 * behaviour", and the result was that every calendar and medication surface
 * silently kept rendering 12-hour for 24-hour users while the feature looked
 * shipped. A missing cycle must be a compile error, not a silent wrong answer.
 * If you are adding a call site and have no cycle, call `useHourCycle()` in the
 * nearest component and thread it down as a parameter.
 *
 * NOT for machine formats. Times SENT to the API go through `formatTimeForAPI`,
 * which is timezone arithmetic, not display.
 *
 * CYCLE AND LANGUAGE ARE INDEPENDENT. The cycle is a property of the viewer's
 * DEVICE (a Spanish speaker in Miami reads a 12-hour clock); the language only
 * picks the period marker. Under '24h' there is no marker, so that branch is
 * byte-identical in every language and must stay that way.
 *
 * Unlike `cycle`, `language` is OPTIONAL — and the asymmetry is deliberate.
 * A missing cycle is a WRONG ANSWER (12-hour digits shown to a 24-hour user)
 * that nothing else can recover, which is why it must be a compile error. A
 * missing language has one obviously correct value — whatever i18next is
 * currently rendering in — so defaulting it fixes dozens of existing call sites
 * without touching them. Pass it explicitly only when formatting for somebody
 * OTHER than the current viewer, or in a test that must not depend on the
 * ambient language.
 *
 * @param hours - Hours (0-23)
 * @param minutes - Minutes (0-59)
 * @param cycle - '12h' → "2:05 PM", '24h' → "14:05" (zero-padded)
 * @param language - 'en' → "2:05 PM"; 'es' → "2:05 p. m." (RAE form, see
 *   {@link MERIDIEM}). Defaults to the active i18next language.
 */
export function formatTimeOfDay(
  hours: number,
  minutes: number,
  cycle: HourCycle,
  language: TimeLanguage = activeLanguage()
): string {
  // HOUR 24 IS MIDNIGHT, AND IT REACHES HERE. Mirrors the mobile fix (mobile is
  // the source of truth for this module — see the note further down).
  //
  // Three other readers in this file normalise it (line ~415's `% 24`, and the
  // `rawHour === 24 ? 0` guards below) — this one, the single renderer every
  // displayed time flows through, did not. Untreated, `hours = 24` takes
  // `24 >= 12` (PM) and `24 % 12 || 12` (12), so a midnight dose renders
  // "12:00 PM": twelve hours wrong, and indistinguishable from an ordinary time.
  //
  // Not hypothetical — `recipientEventDate.ts` documents an older `|| '00'`
  // fallback that let `hour12: false` ICU builds serialise midnight as the
  // scheduled_time "24:00", so such rows are already in the database. Measured
  // here before the fix:
  //   formatTimeOfDay(24, 0, '12h')   -> "12:00 PM"   (noon)
  //   formatEventTimeCompact('24:00') -> "12:00 PM"   (noon)
  //   formatEventTimeCompact('00:00') -> "12:00 AM"
  // Both inputs mean midnight.
  const normalisedHours = ((hours % 24) + 24) % 24;

  const mm = minutes.toString().padStart(2, '0');
  if (cycle === '24h') {
    return `${normalisedHours.toString().padStart(2, '0')}:${mm}`;
  }
  const meridiem = MERIDIEM[language] ?? MERIDIEM.en;
  const period = normalisedHours >= 12 ? meridiem.pm : meridiem.am;
  const hour12 = normalisedHours % 12 || 12;
  return `${hour12}:${mm} ${period}`;
}

/**
 * Format a time for display (AM/PM, or HH:MM under a 24-hour cycle)
 */
export function formatTimeDisplay(hours: number, minutes: number, cycle: HourCycle): string {
  return formatTimeOfDay(hours, minutes, cycle);
}

/**
 * Format a time and NAME ITS ZONE unconditionally: "8:40 PM (Denver)".
 *
 * The one renderer here that does not suppress the label, because its name is a
 * promise: a caller asking for the time "with timezone" has already decided the
 * zone needs saying. Everything that has to DECIDE goes through
 * {@link getTimezoneSuffix} instead.
 */
export function formatTimeWithTimezone(
  hours: number,
  minutes: number,
  timezone: string,
  cycle: HourCycle,
  language: TimeLanguage = activeLanguage()
): string {
  return `${formatTimeOfDay(hours, minutes, cycle, language)}${zoneSuffixText(timezone, language)}`;
}

/**
 * Format dual timezone display (e.g., "8:40 PM (Denver) / 9:40 PM (Chicago)")
 * Shows user's local time first, then care recipient's time.
 *
 * @param at - the instant the zone comparison is judged at. Phoenix and Denver
 *   share a clock in January and differ in July, so a pair is only "the same
 *   zone" on a given date.
 */
export function formatDualTimezoneDisplay(
  hours: number,
  minutes: number,
  userTimezone: string,
  careRecipientTimezone: string,
  cycle: HourCycle,
  at: Date = new Date()
): string {
  // Gate on the OFFSET, not on the zone NAMES. Single-zone circles are the
  // overwhelming majority and must show one time with no zone-label clutter,
  // and a name compare gets that wrong for aliases: ICU resolves
  // TZ=Asia/Kolkata to the legacy Asia/Calcutta, so a name compare would print
  // the same time twice for a circle that is not dual-zone at all.
  if (!timezonesAreDifferent(userTimezone, careRecipientTimezone, at)) {
    // BARE. One clock, one time — a label here answers a question nobody asked.
    return formatTimeOfDay(hours, minutes, cycle);
  }

  // Convert user's time to care recipient's time
  const converted = convertTimeBetweenTimezones(
    hours,
    minutes,
    userTimezone,
    careRecipientTimezone
  );

  const userTime = formatTimeWithTimezone(hours, minutes, userTimezone, cycle);
  const recipientTime = formatTimeWithTimezone(
    converted.hours,
    converted.minutes,
    careRecipientTimezone,
    cycle
  );

  return `${userTime} / ${recipientTime}`;
}

/**
 * Convert a Date object's time from device timezone to care recipient's timezone
 * Returns hours and minutes in the care recipient's timezone
 */
export function convertDateToRecipientTimezone(
  date: Date,
  careRecipientTimezone: string
): { hours: number; minutes: number; dayOffset: number } {
  const deviceTimezone = getDeviceTimezone();
  return convertTimeBetweenTimezones(
    date.getHours(),
    date.getMinutes(),
    deviceTimezone,
    careRecipientTimezone,
    date
  );
}

/**
 * Check if two timezones are different
 */
export function timezonesAreDifferent(
  tz1: string,
  tz2: string,
  at: Date = new Date()
): boolean {
  if (tz1 === tz2) return false;

  // Compared at `at`, not unconditionally at "now".
  //
  // Two zones can agree TODAY and differ on the date being scheduled or read:
  // America/Phoenix and America/Denver are both -07:00 in January and -07:00 /
  // -06:00 in July (Australia/Brisbane and Australia/Sydney do the same in
  // December). Evaluating this at `new Date()` while the CONVERSION beside it
  // runs at the event's instant is how a caregiver gets no dual-timezone line
  // on precisely the event whose time is being shifted.
  //
  // Offsets, not names: some zones are aliases (ICU resolves Asia/Kolkata to
  // Asia/Calcutta), and a name compare would call those different.
  const offset1 = getTimezoneOffsetMinutes(tz1, at);
  const offset2 = getTimezoneOffsetMinutes(tz2, at);

  return offset1 !== offset2;
}

/**
 * Format an event time for display throughout the app.
 * Times are stored in care recipient's timezone (already converted on save).
 * Shows: "2:00 PM CT" or "2:00 PM CT / 1:00 PM MT" if viewer is in different TZ
 *
 * @param timeString - Time from database (HH:MM or HH:MM:SS format) - already in care recipient's TZ
 * @param careRecipientTimezone - The care recipient's IANA timezone
 * @param showDualTimezone - Whether to show viewer's local time too (`undefined` auto-detects)
 * @param referenceDate - Date for DST calculations (`undefined` = today)
 * @param cycle - Viewer's hour cycle from resolveHourCycle() — REQUIRED
 * @returns Formatted time string with timezone(s)
 *
 * `showDualTimezone` and `referenceDate` take an explicit `undefined` rather
 * than being optional: `cycle` is required and sits last, and TypeScript does
 * not allow a required parameter to follow an optional one. Keeping the
 * positions stable was worth the two `undefined`s at the one call site.
 */
export function formatEventTimeForDisplay(
  timeString: string,
  careRecipientTimezone: string,
  showDualTimezone: boolean | undefined,
  referenceDate: Date | undefined,
  cycle: HourCycle
): string {
  try {
    // Parse time string (HH:MM or HH:MM:SS) - this is already in care recipient's timezone
    const [hoursStr, minutesStr] = timeString.split(':');
    const hours = parseInt(hoursStr, 10);
    const minutes = parseInt(minutesStr, 10);

    if (isNaN(hours) || isNaN(minutes)) {
      return timeString; // Return original if parsing fails
    }

    const deviceTimezone = getDeviceTimezone();
    // Resolved BEFORE the gate: whether to show a second time and what that
    // second time is must be decided at the SAME instant, or the pairs that
    // only diverge seasonally (Phoenix/Denver in July) get converted without
    // being disclosed.
    const refDate = referenceDate || new Date();
    const zonesDiffer = timezonesAreDifferent(deviceTimezone, careRecipientTimezone, refDate);
    const shouldShowDual = showDualTimezone ?? zonesDiffer;
    // WHETHER TO NAME THE ZONES IS NOT THE SAME QUESTION AS WHETHER TO SHOW TWO
    // OF THEM. `showDualTimezone: false` means "render only the recipient's
    // half" — a dense day grid has no room for two times but still has to say
    // whose clock it is. Conversely a dual line whose halves were unlabelled
    // would be unreadable. So: label when the zones differ, or when a caller
    // has forced the dual display.
    const showZoneLabels = zonesDiffer || shouldShowDual;
    const language = activeLanguage();
    const zoneSuffix = (zone: string): string =>
      showZoneLabels ? zoneSuffixText(zone, language) : '';

    // Format care recipient's time directly (no conversion - it's already in their TZ)
    const recipientTime = `${formatTimeOfDay(hours, minutes, cycle, language)}${zoneSuffix(careRecipientTimezone)}`;

    if (!shouldShowDual) {
      return recipientTime;
    }

    // For viewer's time, we need to convert FROM care recipient's TZ TO viewer's TZ
    // Get the UTC time for this moment
    const recipientOffset = getTimezoneOffsetMinutes(careRecipientTimezone, refDate);
    const utcMinutes = hours * 60 + minutes - recipientOffset;

    // Convert to viewer's timezone
    const viewerOffset = getTimezoneOffsetMinutes(deviceTimezone, refDate);
    const viewerTotalMinutes = utcMinutes + viewerOffset;

    // Floor division, not a single +/-1440 step — see the note in
    // convertTimeBetweenTimezones. Recipient and viewer offsets can be 25 hours
    // apart (Kiritimati +14 against Niue -11), which one correction cannot
    // close: this is what rendered a negative hour like "-1:00 AM".
    const DAY = 24 * 60;
    const viewerMinuteOfDay = viewerTotalMinutes - Math.floor(viewerTotalMinutes / DAY) * DAY;

    const viewerHours = Math.floor(viewerMinuteOfDay / 60);
    const viewerMinutes = viewerMinuteOfDay % 60;
    const viewerTime = `${formatTimeOfDay(viewerHours, viewerMinutes, cycle, language)}${zoneSuffix(deviceTimezone)}`;

    return `${recipientTime} / ${viewerTime}`;
  } catch {
    // Fallback to simple format if Intl fails
    return timeString;
  }
}

/**
 * Get event time parts for stacked display (primary = care recipient's TZ, secondary = viewer's TZ)
 * Use this when you want to render times on separate lines instead of "10:00 AM CT / 9:00 AM MT"
 *
 * @param timeString - Time from database (HH:MM or HH:MM:SS format) - already in care recipient's TZ
 * @param careRecipientTimezone - The care recipient's IANA timezone
 * @param referenceDate - Date for DST calculations (`undefined` = today)
 * @param cycle - Viewer's hour cycle from resolveHourCycle() — REQUIRED
 * @returns Object with primaryTime (recipient's TZ) and secondaryTime (viewer's TZ, null if same TZ)
 */
export function getEventTimeParts(
  timeString: string,
  careRecipientTimezone: string,
  referenceDate: Date | undefined,
  cycle: HourCycle
): { primaryTime: string; secondaryTime: string | null } {
  try {
    const [hoursStr, minutesStr] = timeString.split(':');
    const hours = parseInt(hoursStr, 10);
    const minutes = parseInt(minutesStr, 10);

    if (isNaN(hours) || isNaN(minutes)) {
      return { primaryTime: timeString, secondaryTime: null };
    }

    const deviceTimezone = getDeviceTimezone();
    // ONE INSTANT FOR BOTH DECISIONS — resolved before the gate, so that whether
    // a second time is shown and what that second time says are judged at the
    // same moment. This used to compare the zones at "now" while converting at
    // `referenceDate`.
    const refDate = referenceDate || new Date();
    const language = activeLanguage();
    const zonesDiffer = timezonesAreDifferent(deviceTimezone, careRecipientTimezone, refDate);
    const zoneSuffix = (zone: string): string =>
      zonesDiffer ? zoneSuffixText(zone, language) : '';

    // Format care recipient's time
    const primaryTime = `${formatTimeOfDay(hours, minutes, cycle, language)}${zoneSuffix(careRecipientTimezone)}`;

    // Check if we need viewer's time
    if (!zonesDiffer) {
      return { primaryTime, secondaryTime: null };
    }

    const recipientOffset = getTimezoneOffsetMinutes(careRecipientTimezone, refDate);
    const utcMinutes = hours * 60 + minutes - recipientOffset;
    const viewerOffset = getTimezoneOffsetMinutes(deviceTimezone, refDate);
    const viewerTotalMinutes = utcMinutes + viewerOffset;

    // Floor division, not a single +/-1440 step — see the note in
    // convertTimeBetweenTimezones. Recipient and viewer offsets can be 25 hours
    // apart (Kiritimati +14 against Niue -11), which one correction cannot
    // close: this is what rendered a negative hour like "-1:00 AM".
    const DAY = 24 * 60;
    const viewerMinuteOfDay = viewerTotalMinutes - Math.floor(viewerTotalMinutes / DAY) * DAY;

    const viewerHours = Math.floor(viewerMinuteOfDay / 60);
    const viewerMinutes = viewerMinuteOfDay % 60;
    const secondaryTime = `${formatTimeOfDay(viewerHours, viewerMinutes, cycle, language)}${zoneSuffix(deviceTimezone)}`;

    return { primaryTime, secondaryTime };
  } catch {
    return { primaryTime: timeString, secondaryTime: null };
  }
}

/**
 * Format an event time for compact display (e.g., in calendar cards).
 *
 * Shows just the time — "2:00 PM" — for a viewer who shares the recipient's
 * zone, and names the zone when they do not: "2:00 PM (Chicago)",
 * "5:00 p. m. (Berlín)". The label used to be UNCONDITIONAL, which is how a
 * Denver caregiver watching a Denver recipient read "8:00 PM MT" on Tasks, the
 * month grid and Today's Meds: a zone label answers "whose clock is this?", and
 * in a single-zone circle nobody is asking.
 *
 * @param timeString - Time from database (HH:MM or HH:MM:SS format) - already in care recipient's TZ
 * @param careRecipientTimezone - The care recipient's IANA timezone
 * @param cycle - Viewer's hour cycle from resolveHourCycle() — REQUIRED
 * @param referenceDate - the day this time falls on, which is the instant the
 *   zone comparison is judged at (Phoenix and Denver share a clock in January
 *   and differ in July). Pass the row's own date via {@link zoneReferenceInstant};
 *   defaults to now for rows that carry none.
 * @returns Formatted time string, with the zone named only when it differs
 */
export function formatEventTimeCompact(
  timeString: string,
  careRecipientTimezone: string,
  cycle: HourCycle,
  referenceDate: Date = new Date()
): string {
  try {
    const [hoursStr, minutesStr] = timeString.split(':');
    const hours = parseInt(hoursStr, 10);
    const minutes = parseInt(minutesStr, 10);

    if (isNaN(hours) || isNaN(minutes)) {
      return timeString;
    }

    // Format directly - time is already in care recipient's timezone
    return `${formatTimeOfDay(hours, minutes, cycle)}${getTimezoneSuffix(careRecipientTimezone, referenceDate)}`;
  } catch {
    return timeString;
  }
}

/**
 * Syncs the device timezone to the user's profile.
 * Only sets timezone if user doesn't have one set (null).
 *
 * This is a fallback for users who registered before we added timezone to signup.
 * New users get their timezone set during registration.
 * Users can change their timezone from the profile page.
 */
export async function syncDeviceTimezone(): Promise<void> {
  try {
    const deviceTimezone = getDeviceTimezone();

    if (!deviceTimezone) {
      devLog('[Timezone] Could not detect device timezone');
      return;
    }

    // Check if user already has a timezone set
    const currentUser = await getCurrentUser();
    if (currentUser.timezone) {
      devLog(`[Timezone] User already has timezone set: ${currentUser.timezone}, skipping sync`);
      return;
    }

    // Only set if null - this handles legacy users who registered before timezone was captured
    devLog(`[Timezone] No timezone set, setting to device timezone: ${deviceTimezone}`);
    await updateProfile({ timezone: deviceTimezone });
    devLog('[Timezone] Successfully set timezone');
  } catch (error) {
    // Non-critical - don't fail auth if timezone sync fails
    devError('[Timezone] Failed to sync timezone:', error);
  }
}

/**
 * Determine if a date string represents "today", "yesterday", or neither
 * in the care recipient's timezone.
 *
 * Used for section headers in medication history. The date strings come from
 * scheduled_date which is in the care recipient's timezone. We must compare
 * with "today" and "yesterday" IN THAT TIMEZONE, not in the device's local time.
 *
 * @param dateString - YYYY-MM-DD date in care recipient's timezone
 * @param careRecipientTimezone - IANA timezone of the care recipient
 * @param now - Current time (defaults to new Date())
 * @returns 'today' | 'yesterday' | null
 */
export function getRelativeDateLabel(
  dateString: string,
  careRecipientTimezone: string,
  now: Date = new Date()
): 'today' | 'yesterday' | null {
  try {
    // Get today's date in the care recipient's timezone
    const formatter = dateTimeFormat('en-CA', {
      timeZone: careRecipientTimezone,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
    });
    const todayInRecipientTZ = formatter.format(now); // YYYY-MM-DD

    if (dateString === todayInRecipientTZ) return 'today';

    // Yesterday, stepped on the recipient's own DATE STRING rather than by
    // moving the instant back 24 real hours. A 23-hour day makes those two
    // different answers: for the hour after the recipient's spring-forward,
    // `now - 24h` formats as the day BEFORE yesterday, so the wrong date is
    // labelled "Yesterday" and the real one falls through to a bare date.
    // Reaches the caregiver on the task list and on the dose they are being
    // asked to confirm (TaskRow, ConfirmMedDialog).
    const yesterdayInRecipientTZ = addCalendarDays(todayInRecipientTZ, -1);

    if (dateString === yesterdayInRecipientTZ) return 'yesterday';

    return null;
  } catch {
    return null;
  }
}

/**
 * Get the YYYY-MM-DD date string for a given moment in a specific timezone.
 * Uses Intl.DateTimeFormat with 'en-CA' locale which produces YYYY-MM-DD format.
 *
 * @param timezone - IANA timezone string
 * @param date - Date to convert (defaults to now)
 * @returns Date string in YYYY-MM-DD format
 */
export function getDateInTimezone(timezone: string, date: Date = new Date()): string {
  try {
    return dateTimeFormat('en-CA', {
      timeZone: timezone,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
    }).format(date);
  } catch {
    // Fallback to device-local
    const y = date.getFullYear();
    const m = String(date.getMonth() + 1).padStart(2, '0');
    const d = String(date.getDate()).padStart(2, '0');
    return `${y}-${m}-${d}`;
  }
}

/**
 * Check if an event is past due, comparing times in the care recipient's timezone.
 *
 * Times in the database (scheduled_date, scheduled_time) are stored in the
 * care recipient's timezone. To determine "past due" we must compare the
 * current time IN THAT TIMEZONE — not in the device's local time.
 *
 * @param scheduledDate - YYYY-MM-DD in care recipient's timezone
 * @param scheduledTime - HH:MM or HH:MM:SS in care recipient's timezone, or null for all-day
 * @param careRecipientTimezone - IANA timezone of the care recipient
 * @param now - Current time (defaults to new Date())
 * @returns true if the event's scheduled time has passed in the care recipient's timezone
 */
export function isEventPastDue(
  scheduledDate: string,
  scheduledTime: string | null,
  careRecipientTimezone: string,
  now: Date = new Date()
): boolean {
  try {
    // Get today's date in the care recipient's timezone
    const formatter = dateTimeFormat('en-CA', {
      timeZone: careRecipientTimezone,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
    });
    const todayInRecipientTZ = formatter.format(now); // YYYY-MM-DD

    // If scheduled date is in the future, not past due
    if (scheduledDate > todayInRecipientTZ) return false;

    // If scheduled date is in the past, it's past due
    if (scheduledDate < todayInRecipientTZ) {
      return true;
    }

    // scheduledDate === today in recipient's timezone
    if (!scheduledTime) {
      // All-day event on today — not past due yet
      return false;
    }

    // Get current time in care recipient's timezone. Shares
    // getMinutesOfDayInTimezone with isDoseConfirmable so both read the clock
    // the same way — including its rawHour === 24 → 0 normalization (some
    // Intl implementations report hour 24, not 0, for midnight).
    const currentTotalMinutes = getMinutesOfDayInTimezone(careRecipientTimezone, now);

    // Parse scheduled time
    const scheduledTotalMinutes = parseScheduledMinutes(scheduledTime) ?? 0;

    // Past due if current time is strictly after scheduled time
    return currentTotalMinutes > scheduledTotalMinutes;
  } catch {
    return false;
  }
}

/**
 * Check whether an event's scheduled DAY is still in the future, comparing
 * against "today" in the care recipient's timezone.
 *
 * `scheduled_date` is a naive YYYY-MM-DD in the care recipient's timezone, so
 * the only correct comparison is against today's date rendered in that same
 * timezone — never against the device's local day.
 *
 * Used to suppress "did this happen?" affordances (Take / Skip / Complete) on
 * doses that have not come around yet: confirming one would write a falsified
 * adherence record into the report a doctor may read.
 *
 * @param scheduledDate - YYYY-MM-DD in care recipient's timezone
 * @param careRecipientTimezone - IANA timezone of the care recipient
 * @param now - Current time (defaults to new Date())
 */
export function isEventInFuture(
  scheduledDate: string,
  careRecipientTimezone: string,
  now: Date = new Date()
): boolean {
  if (!scheduledDate) return false;
  return scheduledDate > getDateInTimezone(careRecipientTimezone, now);
}

// ---------------------------------------------------------------------------
// DOSE CONFIRMATION WINDOW — VERBATIM PORT of mobile/src/utils/timezone.ts
// (`DOSE_EARLY_CONFIRM_WINDOW_MINUTES`, `getMinutesOfDayInTimezone`,
// `parseScheduledMinutes`, `isDoseConfirmable`). Mobile is the SOURCE OF TRUTH;
// the two copies must be changed TOGETHER or web and mobile start disagreeing
// about when a dose may be marked taken — and that record feeds the
// clinician-facing adherence report. Same convention as the hour-cycle port.
// No web adaptation exists: the logic below is byte-for-byte mobile's.
// ---------------------------------------------------------------------------

/**
 * How long BEFORE a dose's scheduled time the Take / Skip pair becomes live,
 * in minutes.
 *
 * Caregivers legitimately give the 9:00 PM dose at 8:30 — the affordance has to
 * open early or the app forces them to lie about when it happened. It must NOT
 * open a whole day early though: a card offering "Take" at 4 PM for a 9 PM dose
 * asks a question nobody can answer yet, and doubles the visual weight of every
 * day list.
 *
 * Two hours is the one knob. Tune it here — nothing else hard-codes it.
 * Must stay under 24h (1440): {@link isDoseConfirmable} only ever looks one
 * calendar day ahead.
 */
export const DOSE_EARLY_CONFIRM_WINDOW_MINUTES = 120;

/** Minutes in a day — used for the cross-midnight arm of the early window. */
const MINUTES_PER_DAY = 24 * 60;

/**
 * A `YYYY-MM-DD` string plus (or minus) whole CALENDAR days, in UTC so there is
 * no DST slack to round away.
 *
 * THE ONLY WAY TO STEP A RECIPIENT-FRAME DAY. The alternative — moving the
 * INSTANT by 24 real hours and reformatting it in the zone — is wrong on every
 * day that is not 24 hours long, and it is wrong in BOTH directions:
 *
 *   Recipient America/Denver, DST starts 2027-03-14 02:00 (a 23-hour day).
 *   At 23:00 on the 13th, `now + 1440 min` formats as 2027-03-15 — so the
 *   caller's "tomorrow" is two days out. The 14th (real tomorrow) stops
 *   matching, and the 15th starts matching a window it is 24 h too far from.
 *
 * `dateMath.addDays` is the same function, but `dateMath` imports from THIS
 * module, so importing it back would close a cycle. `TodaysMeds.getYesterdayInTimezone`
 * carries the same fix and the same reasoning for the same class of bug.
 *
 * Both callers pass a string this module has just produced with
 * `Intl.DateTimeFormat('en-CA')`, so the input is always a well-formed
 * `YYYY-MM-DD`.
 */
function addCalendarDays(isoDay: string, days: number): string {
  const stepped = new Date(`${isoDay}T00:00:00Z`);
  stepped.setUTCDate(stepped.getUTCDate() + days);
  const m = String(stepped.getUTCMonth() + 1).padStart(2, '0');
  const d = String(stepped.getUTCDate()).padStart(2, '0');
  return `${stepped.getUTCFullYear()}-${m}-${d}`;
}

/**
 * Extract "minutes since midnight" for `now` in a given timezone.
 * Shared by the past-due and confirmable predicates so both read the clock the
 * same way.
 */
function getMinutesOfDayInTimezone(timezone: string, now: Date): number {
  const timeFormatter = dateTimeFormat('en-US', {
    timeZone: timezone,
    hour: 'numeric',
    minute: 'numeric',
    hour12: false,
  });
  const parts = timeFormatter.formatToParts(now);
  const rawHour = parseInt(parts.find((p) => p.type === 'hour')?.value || '0', 10);
  // Some Intl implementations return 24 for midnight.
  const hour = rawHour === 24 ? 0 : rawHour;
  const minute = parseInt(parts.find((p) => p.type === 'minute')?.value || '0', 10);
  return hour * 60 + minute;
}

/** Parse a naive HH:MM[:SS] into minutes since midnight, or null if unparseable. */
function parseScheduledMinutes(scheduledTime: string | null): number | null {
  if (!scheduledTime) return null;
  const [hoursStr, minutesStr] = scheduledTime.split(':');
  const total = parseInt(hoursStr, 10) * 60 + parseInt(minutesStr, 10);
  if (Number.isNaN(total)) return null;
  // Same "24:00 is midnight" rows as `formatTimeOfDay`. Left raw this returns
  // 1440, a minute-of-day no clock can reach, so every comparison against "now"
  // is false and `isEventPastDue` can never fire for those doses.
  return ((total % 1440) + 1440) % 1440;
}

/**
 * Whether a dose is close enough to its scheduled moment that a caregiver may
 * mark it Taken / Skipped.
 *
 * THE gate for the Skip/Take pair on every surface (Calendar detail modal,
 * Today's Medications) — each surface computes it and both inherit the rule.
 *
 * A dose is confirmable when:
 *   • its scheduled DAY has already passed (an unanswered dose stays actionable
 *     — that is exactly what the "Needs Attention" lists exist to surface), or
 *   • it is scheduled for today at or after `scheduled_time - earlyWindow`
 *     (which includes every already-overdue dose today), or
 *   • it has no `scheduled_time` at all — a timeless dose has no due moment, so
 *     it is confirmable for the whole of its own day (unchanged behaviour). A
 *     timeless dose from a PAST day is confirmable too, but via the past-day
 *     rule above, which runs first and returns before this check is reached —
 *     it is not this bullet's doing, or
 *   • it is tomorrow's dose and the early window reaches across midnight (the
 *     12:30 AM dose given at 11:50 PM).
 *
 * It is NOT confirmable on any later day: confirming a dose that has not come
 * around yet writes a falsified record into the adherence PDF a doctor reads.
 *
 * Timezone discipline (same as {@link isEventPastDue}, which this mirrors):
 * `scheduled_date` and `scheduled_time` are NAIVE local values in the CARE
 * RECIPIENT's timezone, so "now" must be rendered in that timezone before any
 * comparison — never `Date.getHours()`, never device-local dates.
 *
 * @param scheduledDate - YYYY-MM-DD in care recipient's timezone
 * @param scheduledTime - HH:MM or HH:MM:SS in care recipient's timezone, or null
 * @param careRecipientTimezone - IANA timezone of the care recipient
 * @param now - Current time (defaults to new Date())
 * @param earlyWindowMinutes - How early the pair opens (defaults to
 *   {@link DOSE_EARLY_CONFIRM_WINDOW_MINUTES})
 */
export function isDoseConfirmable(
  scheduledDate: string,
  scheduledTime: string | null,
  careRecipientTimezone: string,
  now: Date = new Date(),
  earlyWindowMinutes: number = DOSE_EARLY_CONFIRM_WINDOW_MINUTES
): boolean {
  if (!scheduledDate) return false;

  try {
    const formatter = dateTimeFormat('en-CA', {
      timeZone: careRecipientTimezone,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
    });
    const todayInRecipientTZ = formatter.format(now); // YYYY-MM-DD

    // A dose from a past day is still waiting on an answer.
    if (scheduledDate < todayInRecipientTZ) return true;

    const scheduledMinutes = parseScheduledMinutes(scheduledTime);

    // Timeless dose (or an unparseable time): no due moment to open a window
    // around, so it stays confirmable for its own day only.
    if (scheduledMinutes === null) return scheduledDate === todayInRecipientTZ;

    const currentMinutes = getMinutesOfDayInTimezone(careRecipientTimezone, now);

    if (scheduledDate === todayInRecipientTZ) {
      return currentMinutes >= scheduledMinutes - earlyWindowMinutes;
    }

    // Later day. Only TOMORROW can fall inside a sub-24h window, and only late
    // at night — the 12:30 AM dose becomes confirmable at 10:30 PM.
    //
    // STEPPED ON THE DATE STRING, never on the instant. This used to be
    // `getDateInTimezone(tz, now + 1440 min)`, which is only "tomorrow" on a
    // day that is 1440 minutes long. On the eve of the recipient's
    // spring-forward the day is 23 h, so the sum landed on day+2 — and because
    // the minute test below is a fixed sub-24h window, a dose TWENTY-FOUR AND A
    // HALF HOURS AWAY came back confirmable. That is the falsified adherence
    // record the doc block above says must never be reachable, and it is
    // reachable straight from the calendar (EventDetailActions gates Take/Skip
    // on this, ConfirmMedDialog re-checks it, and the write lands). The
    // mirror-image failure hit the same night: real tomorrow stopped matching,
    // so the legitimate cross-midnight early window silently closed.
    const tomorrowInRecipientTZ = addCalendarDays(todayInRecipientTZ, 1);
    if (scheduledDate !== tomorrowInRecipientTZ) return false;

    return MINUTES_PER_DAY - currentMinutes + scheduledMinutes <= earlyWindowMinutes;
  } catch {
    // Intl blew up (unknown timezone). Degrade to the old day-granularity rule
    // rather than stranding a caregiver who cannot confirm anything.
    return !isEventInFuture(scheduledDate, careRecipientTimezone, now);
  }
}

/**
 * Get the current time as fractional hours in a specific timezone.
 * E.g., 14:30 → 14.5. Used for positioning the current-time indicator
 * on the schedule view.
 *
 * @param timezone - IANA timezone string
 * @param now - Current time (defaults to new Date())
 * @returns Fractional hours (0–23.999...)
 */
export function getCurrentHoursInTimezone(timezone: string, now: Date = new Date()): number {
  try {
    const formatter = dateTimeFormat('en-US', {
      timeZone: timezone,
      hour: 'numeric',
      minute: 'numeric',
      hour12: false,
    });
    const parts = formatter.formatToParts(now);
    const hour = parseInt(parts.find((p) => p.type === 'hour')?.value || '0', 10);
    const minute = parseInt(parts.find((p) => p.type === 'minute')?.value || '0', 10);

    // Handle hour 24 (midnight) returned by some Intl implementations
    const normalizedHour = hour === 24 ? 0 : hour;

    return normalizedHour + minute / 60;
  } catch {
    // Fallback to device local time
    return now.getHours() + now.getMinutes() / 60;
  }
}

// ─── WRITE-SIDE FORMATTERS ─────────────────────────────────────────────────
// Times/dates a form SENDS must be the care recipient's local naive value, never
// device-local. These mirror mobile's AddEventScreen handleSubmit (~lines
// 925-948) — read the instant `date` AS SEEN IN `timeZone` via
// Intl.DateTimeFormat formatToParts. NEVER use `new Date(`${d}T${t}`)`,
// `.getHours()`, `.split('T')[0]`, or `toLocaleDateString()` without `timeZone`.

/**
 * Format the time-of-day of an instant AS SEEN IN a timezone, for the API.
 *
 * Returns a 24-hour `"HH:MM"` string. The backend stores scheduled_time as a
 * naive local TIME in the care recipient's timezone, so we render the instant
 * `date` in that timezone rather than the device's local time.
 *
 * @param date - The instant to format
 * @param timeZone - IANA timezone to render the instant in
 * @returns Time string in "HH:MM" (24h) format
 */
export function formatTimeForAPI(date: Date, timeZone: string): string {
  const parts = dateTimeFormat('en-US', {
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
    timeZone,
  }).formatToParts(date);

  let hour = parts.find((p) => p.type === 'hour')?.value || '00';
  const minute = parts.find((p) => p.type === 'minute')?.value || '00';

  // Some engines emit "24" for midnight under hour12:false — normalize to "00".
  if (hour === '24') {
    hour = '00';
  }

  return `${hour}:${minute}`;
}

/**
 * Format BOTH the date (YYYY-MM-DD) and time (HH:MM) of an instant AS SEEN IN a
 * timezone, for the API.
 *
 * Both halves are recomputed from the SAME instant `date` in `timeZone`, so a
 * timezone shift that crosses midnight is handled correctly: e.g. 9:00 PM on
 * date D in America/Denver is the next calendar day in America/New_York, and the
 * returned `scheduled_date` reflects D+1 (not D).
 *
 * @param date - The combined date+time instant to format
 * @param timeZone - The care recipient's IANA timezone
 * @returns `{ scheduled_date, scheduled_time }` both in the recipient's timezone
 */
export function formatDateTimeForAPI(
  date: Date,
  timeZone: string
): { scheduled_date: string; scheduled_time: string } {
  return {
    scheduled_date: getDateInTimezone(timeZone, date),
    scheduled_time: formatTimeForAPI(date, timeZone),
  };
}
