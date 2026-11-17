import { normalizeLocale } from '@/i18n/locales';
import i18n from '@/i18n';
import { formatTimeOfDay, getTimezoneSuffix } from '@/utils/timezone';
import type { HourCycle } from '@/utils/hourCycle';

// Date-only arithmetic on YYYY-MM-DD strings using UTC methods exclusively.
// Mirrors backend/src/utils/recurrence.ts helpers. NEVER use device-local
// getDay()/getDate()/setDate() for date iteration — local methods shift dates
// across timezones (20 timezone bugs were fixed on mobile/backend this way).
// Display formatting parses date-only strings with T12:00:00Z + timeZone:'UTC'
// so the rendered date can never roll over to an adjacent day.

/** Parse a YYYY-MM-DD string as UTC midnight (for arithmetic only). */
function parseUTC(dateStr: string): Date {
  return new Date(`${dateStr}T00:00:00Z`);
}

/** Format a Date's UTC components back to YYYY-MM-DD. */
function toDateStr(date: Date): string {
  const y = date.getUTCFullYear();
  const m = String(date.getUTCMonth() + 1).padStart(2, '0');
  const d = String(date.getUTCDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

/** Add (or subtract) whole days to a YYYY-MM-DD string. */
export function addDays(dateStr: string, days: number): string {
  const d = parseUTC(dateStr);
  d.setUTCDate(d.getUTCDate() + days);
  return toDateStr(d);
}

/** Whole days from `a` to `b` (positive when b is later). */
export function daysBetween(a: string, b: string): number {
  return Math.round((parseUTC(b).getTime() - parseUTC(a).getTime()) / 86400000);
}

/** Day of week for a date string: 0=Sun..6=Sat (matches recurrence_days). */
export function getDayOfWeek(dateStr: string): number {
  return parseUTC(dateStr).getUTCDay();
}

/**
 * FIRST DAY OF THE WEEK BY REGION (1.4.2 i18n audit D), CLDR 48 `weekData`
 * `firstDay` (checked against ICU 78 / CLDR 48 `Intl.Locale#getWeekInfo`). Every
 * region not listed starts on Monday (CLDR `001`). A TABLE, not the runtime
 * `Intl`, so every browser and mobile's Hermes agree.
 * VERBATIM PORT of mobile/src/utils/weekStart.ts (parity-tested).
 */
const SUNDAY_FIRST_REGIONS: ReadonlySet<string> = new Set(
  ('AG AS BD BR BS BT BW BZ CA CO DM DO ET GT GU HK HN ID IL IN IS JM JP KE KH KR LA MH MM MO ' +
    'MT MX MZ NI NP PA PE PH PK PR PT PY SA SG SV TH TT TW UM US VE VI WS YE ZA ZW').split(' ')
);
const SATURDAY_FIRST_REGIONS: ReadonlySet<string> = new Set(
  'AF BH DJ DZ EG IQ IR JO KW LY OM QA SD SY'.split(' ')
);
const FRIDAY_FIRST_REGIONS: ReadonlySet<string> = new Set(['MV']);

/**
 * The first day of the week in `region` (ISO 3166-1 alpha-2), 0 = Sunday; null
 * when there is no usable region (none, "419", malformed), so the caller falls
 * back to the language.
 */
export function firstDayForRegion(region: string | null | undefined): number | null {
  if (!region || !/^[A-Za-z]{2}$/.test(region)) return null;
  const r = region.toUpperCase();
  if (SUNDAY_FIRST_REGIONS.has(r)) return 0;
  if (SATURDAY_FIRST_REGIONS.has(r)) return 6;
  if (FRIDAY_FIRST_REGIONS.has(r)) return 5;
  return 1;
}

/**
 * WHICH DAY THE WEEK STARTS ON, per locale — 0 = Sunday.
 *
 * Read from CLDR through `Intl.Locale`, not hardcoded and not keyed off a
 * translation file: Spanish weeks start Monday and English (US) weeks start
 * Sunday, and that is a property of the locale in exactly the way month and
 * weekday NAMES are (see the `meridiemLabel` note in `TimePickerPanel` for the
 * same judgment call — format primitives come from `Intl`, only chrome comes
 * from `common.json`).
 *
 * `getWeekInfo().firstDay` is 1 = Monday … 7 = Sunday, so `% 7` maps it onto the
 * 0 = Sunday that `getUTCDay` speaks. The fallback covers a runtime without the
 * API at all rather than a wrong answer from it: this app ships `en` and `es`,
 * and Sunday-first is the minority position worldwide, so anything that is not
 * English starts on Monday.
 *
 * Lives HERE (re-exported by `DatePickerPanel`, its first consumer) so that
 * non-UI modules — `recurrenceLabel`, and through it the care-summary PDF — can
 * order weekdays without importing a React component file.
 */
export function firstDayOfWeek(language: string, region?: string | null): number {
  // REGION FIRST (1.4.2 i18n audit D): en-GB / en-AU / en-IE / en-NZ start Monday,
  // es-MX / es-US / pt-BR Sunday, whatever the app language. Display order only:
  // stored `recurrence_days` and the calendar week view's own math never read it.
  const byRegion = firstDayForRegion(region);
  if (byRegion !== null) return byRegion;
  try {
    // The REGISTERED locale (normalizeLocale: exact registry code, else its base,
    // else en), matching mobile `utils/weekStart.ts`: every es tag starts Monday and
    // every en tag Sunday, whatever CLDR says for the region (es-MX, en-GB), so the
    // two platforms agree. A registered VARIANT keeps its own convention: fr-CA
    // starts Sunday (CLDR CA), fr Monday.
    const locale = new Intl.Locale(normalizeLocale(language)) as Intl.Locale & {
      getWeekInfo?: () => { firstDay: number };
      weekInfo?: { firstDay: number };
    };
    const info = typeof locale.getWeekInfo === 'function' ? locale.getWeekInfo() : locale.weekInfo;
    if (typeof info?.firstDay === 'number') return info.firstDay % 7;
  } catch {
    // An unparseable language tag is not worth a blank calendar.
  }
  return normalizeLocale(language) === 'en' ? 0 : 1;
}

/**
 * The seven weekday indexes (0=Sun..6=Sat, the `recurrence_days` convention —
 * NEVER Sunday as 7) in the locale's week order: `es` → [1..6, 0], `en` → [0..6].
 *
 * Ordered by the REGISTERED locale, not the raw tag (see `firstDayOfWeek`): the
 * care-summary PDF formats with the browser's regional locale (`es-MX`, which CLDR
 * starts on Sunday) while the app UI speaks bare `es`, and a day list must read the
 * same in both and the same as mobile; a registered variant (fr-CA) keeps its own.
 */
export function orderedWeekdays(language: string, region?: string | null): number[] {
  const first = firstDayOfWeek(language, region);
  return Array.from({ length: 7 }, (_, i) => (first + i) % 7);
}

/**
 * The first date ON OR AFTER `dateStr` whose weekday is in `days`, or null when
 * `days` holds no valid weekday. String date math only — never a local Date.
 * Mirrors the backend create-path normalizer, which snaps a weekly+days start
 * forward the same way (at most six days).
 */
export function nextDateOnWeekdays(dateStr: string, days: readonly number[]): string | null {
  const valid = days.filter((d) => Number.isInteger(d) && d >= 0 && d <= 6);
  if (valid.length === 0) return null;
  for (let offset = 0; offset < 7; offset += 1) {
    const candidate = addDays(dateStr, offset);
    if (valid.includes(getDayOfWeek(candidate))) return candidate;
  }
  return null;
}

/** Sunday that starts the week containing `dateStr`. */
export function startOfWeek(dateStr: string): string {
  return addDays(dateStr, -getDayOfWeek(dateStr));
}

/** The 7 date strings of the week starting at `weekStart`. */
export function getWeekDays(weekStart: string): string[] {
  return Array.from({ length: 7 }, (_, i) => addDays(weekStart, i));
}

/** First day (YYYY-MM-01) of the month containing `dateStr`. */
export function startOfMonth(dateStr: string): string {
  return `${dateStr.slice(0, 8)}01`;
}

/** First day of the month `months` away from the month containing `dateStr`. */
export function addMonths(dateStr: string, months: number): string {
  const d = parseUTC(startOfMonth(dateStr));
  d.setUTCMonth(d.getUTCMonth() + months);
  return toDateStr(d);
}

/**
 * Classic 6-week (42-cell) month grid starting on the Sunday on/before the
 * 1st of the month. Fixed height keeps the layout stable across months.
 */
export function getMonthGridDays(dateStr: string): string[] {
  const gridStart = startOfWeek(startOfMonth(dateStr));
  return Array.from({ length: 42 }, (_, i) => addDays(gridStart, i));
}

/** True when both date strings fall in the same calendar month. */
export function isSameMonth(a: string, b: string): boolean {
  return a.slice(0, 7) === b.slice(0, 7);
}

/**
 * Locale-aware display formatting for a NAIVE date-only string.
 * Parses with T12:00:00Z and formats with timeZone:'UTC' (noon UTC can never
 * cross a day boundary in any rendering timezone).
 */
export function formatDateForDisplay(
  dateStr: string,
  options: Intl.DateTimeFormatOptions,
  locale: string = i18n.language
): string {
  return new Intl.DateTimeFormat(locale, { timeZone: 'UTC', ...options }).format(
    new Date(`${dateStr}T12:00:00Z`)
  );
}

/**
 * Localized weekday name for a 0=Sun..6=Sat index (recurrence_days convention
 * — NEVER convert Sunday 0→7). Uses Intl, not hand-written arrays.
 * 2024-01-07 is a known Sunday.
 */
export function getWeekdayName(
  dayIndex: number,
  width: 'narrow' | 'short' | 'long' = 'short',
  locale: string = i18n.language
): string {
  const ref = new Date(Date.UTC(2024, 0, 7 + dayIndex, 12));
  return new Intl.DateTimeFormat(locale, { timeZone: 'UTC', weekday: width }).format(ref);
}

/**
 * Format an ISO UTC timestamp (e.g. confirmation.confirmed_at) as a time in a
 * specific timezone, LABELLED with that timezone.
 *
 * The label is not decoration. "Taken at 8:05 PM" is rendered to caregivers who
 * are frequently NOT in the care recipient's zone, and this string is the
 * evidence a dose was actually taken — read in the wrong frame it is evidence
 * of something that did not happen.
 *
 * SHOWN ONLY WHEN THE VIEWER IS ELSEWHERE, though. The label used to be
 * unconditional, so a caregiver in the recipient's own zone read "8:05 PM CT"
 * on every confirmation — a label answers "whose clock is this?", and in a
 * single-zone circle nobody is asking. {@link getTimezoneSuffix} owns that rule
 * for every time surface in the app.
 */
export function formatTimestampInTimezone(
  isoString: string,
  timezone: string,
  locale: string,
  cycle?: HourCycle
): string {
  try {
    const at = new Date(isoString);
    // Extract the wall clock NUMERICALLY, then render it through the app's one
    // time renderer.
    //
    // Formatting straight off the locale ignored the viewer's resolved 12h/24h
    // preference and made the output locale-dependent in a way nothing else in
    // the app is: `es-MX` produced "8:05 p.m." while a bare `es` produced
    // "20:05" for the same instant and the same user. `formatTimeOfDay` is what
    // every other time surface uses, including the RAE meridiem rules.
    const parts = new Intl.DateTimeFormat('en-US', {
      timeZone: timezone,
      hour: '2-digit',
      minute: '2-digit',
      hour12: false,
    }).formatToParts(at);
    const hours = parseInt(parts.find((p) => p.type === 'hour')?.value || '0', 10) % 24;
    const minutes = parseInt(parts.find((p) => p.type === 'minute')?.value || '0', 10);

    const time = cycle
      ? formatTimeOfDay(hours, minutes, cycle)
      : new Intl.DateTimeFormat(locale, {
          timeZone: timezone,
          hour: 'numeric',
          minute: 'numeric',
        }).format(at);

    // Judged AT the instant. The city itself does not move with the season, but
    // whether it is worth naming does: Phoenix and Denver are the same clock in
    // January and an hour apart in July.
    return `${time}${getTimezoneSuffix(timezone, at)}`;
  } catch {
    return '';
  }
}

