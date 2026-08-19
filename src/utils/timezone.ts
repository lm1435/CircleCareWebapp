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
 * Timezone abbreviation map for common US timezones
 */
const TIMEZONE_ABBREVIATIONS: Record<string, string> = {
  'America/New_York': 'ET',
  'America/Chicago': 'CT',
  'America/Denver': 'MT',
  'America/Los_Angeles': 'PT',
  'America/Phoenix': 'AZ',
  'America/Anchorage': 'AKT',
  'Pacific/Honolulu': 'HT',
  'America/Detroit': 'ET',
  'America/Indiana/Indianapolis': 'ET',
  'America/Boise': 'MT',
};

/**
 * ENGLISH fallback for the curated timezone labels.
 *
 * The rendered label comes from `common:timezoneLabels.<IANA>` — see
 * {@link getTimezoneLabel}. This table is the `defaultValue` handed to i18next,
 * so a key that is missing (or an i18next that has not initialized) degrades to
 * exactly today's English string rather than to a raw key.
 *
 * NOT reusing `profile:timezones.*`: those deliberately bake the abbreviation
 * into the string ("Eastern Time (ET)") for the profile picker, while every
 * caller here appends `getTimezoneAbbreviation` itself — reusing them would
 * render "Eastern Time (ET) (ET)".
 */
const TIMEZONE_LABELS_EN: Record<string, string> = {
  'America/New_York': 'Eastern Time',
  'America/Chicago': 'Central Time',
  'America/Denver': 'Mountain Time',
  'America/Los_Angeles': 'Pacific Time',
  'America/Phoenix': 'Arizona Time',
  'America/Anchorage': 'Alaska Time',
  'Pacific/Honolulu': 'Hawaii Time',
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
 * Look a key up in i18next, guaranteeing a usable string.
 *
 * `defaultValue` covers three real states: i18next not yet initialized (`t` is
 * not a function until `init()` resolves), the key not present, and i18next
 * echoing the key back. A raw key must never reach a sentence a customer reads.
 */
function translate(key: string, lng: TimeLanguage, defaultValue: string): string {
  try {
    if (typeof i18n?.t !== 'function') return defaultValue;
    const value = i18n.t(key, { lng, defaultValue });
    if (typeof value !== 'string' || !value || value === key) return defaultValue;
    return value;
  } catch {
    return defaultValue;
  }
}

/**
 * A timezone's own name, as Intl reports it, in a given locale.
 *
 * DISPLAY ONLY. Every other `Intl`/`toLocale*` call in this file is pinned to
 * 'en-US'/'en-CA' because it is doing OFFSET EXTRACTION or `YYYY-MM-DD` key
 * construction — that pinning is load-bearing and must never be made
 * locale-aware. This helper reads no numbers; it only asks for a name.
 *
 * Returns null (rather than throwing) for an unknown or malformed zone.
 */
function intlTimeZoneName(
  timezone: string,
  locale: string,
  style: 'long' | 'short'
): string | null {
  if (!timezone) return null;
  try {
    const part = new Intl.DateTimeFormat(locale, { timeZone: timezone, timeZoneName: style })
      .formatToParts(new Date())
      .find((p) => p.type === 'timeZoneName');
    const value = part?.value?.trim();
    return value ? value : null;
  } catch {
    return null;
  }
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
 * Get short timezone abbreviation (e.g., "MT", "CT")
 *
 * Unmapped zones used to fall through to `timezone.split('/').pop()`, which
 * appended a CITY to every rendered time — a Mexico City circle read
 * "8:00 p. m. Mexico_City", underscore and all. Intl's short name ("CST",
 * "GMT-6") is an actual abbreviation, which is what every call site assumes.
 *
 * Pinned to 'en' on purpose: this abbreviation is appended to BOTH halves of a
 * dual-timezone string and sits alongside the mapped values above (ET/CT/MT/PT,
 * which are English-derived), so it must stay stable no matter who is reading.
 * The viewer's language shows up in {@link getTimezoneLabel}, not here.
 */
export function getTimezoneAbbreviation(timezone: string): string {
  const mapped = TIMEZONE_ABBREVIATIONS[timezone];
  if (mapped) return mapped;
  if (!timezone) return timezone;
  return intlTimeZoneName(timezone, 'en', 'short') || timezone.split('/').pop() || timezone;
}

/**
 * Get a full, LOCALIZED timezone label (e.g., "Mountain Time" /
 * "Hora de la Montaña").
 *
 * This value is interpolated into TRANSLATED sentences — "Times are saved in
 * {{timezone}}." / "Las horas se guardan en {{timezone}}." (AddEventModal,
 * VitalFormModal, CalendarPage) — so an English-only label leaked English into
 * every Spanish sentence. Worse, anything outside the seven-entry US table fell
 * through to the RAW IANA id, giving real paying customers "Las horas se
 * guardan en America/Mexico_City (Mexico_City)." — broken in English too.
 *
 * Resolution order:
 *   1. `common:timezoneLabels.<IANA>` for the curated US zones, falling back to
 *      {@link TIMEZONE_LABELS_EN} if the key is not there.
 *   2. Intl's own long name for the zone in the viewer's language — this is
 *      what makes ANY zone in ANY language readable, and is why there is no
 *      table to keep growing.
 *   3. The IANA id, only if Intl rejects the zone entirely.
 *
 * `language` is OPTIONAL and defaults to the active i18next language so the
 * existing call sites need no edit; pass it explicitly in tests, or when
 * rendering for somebody other than the current viewer.
 */
export function getTimezoneLabel(timezone: string, language?: TimeLanguage): string {
  if (!timezone) return timezone;
  const lng = language ?? activeLanguage();

  const curatedEn = TIMEZONE_LABELS_EN[timezone];
  if (curatedEn) {
    return translate(`common:timezoneLabels.${timezone}`, lng, curatedEn);
  }

  return intlTimeZoneName(timezone, lng, 'long') || timezone;
}

/**
 * Get the UTC offset in minutes for a timezone at a specific date
 * Positive = ahead of UTC, Negative = behind UTC
 * Uses Intl.DateTimeFormat for reliable cross-platform support
 */
export function getTimezoneOffsetMinutes(timezone: string, date: Date = new Date()): number {
  try {
    // Get the hour and minute in the target timezone
    const formatter = new Intl.DateTimeFormat('en-US', {
      timeZone: timezone,
      hour: 'numeric',
      minute: 'numeric',
      hour12: false,
    });
    const parts = formatter.formatToParts(date);
    const hour = parseInt(parts.find((p) => p.type === 'hour')?.value || '0', 10);
    const minute = parseInt(parts.find((p) => p.type === 'minute')?.value || '0', 10);

    // Get the hour and minute in UTC
    const utcFormatter = new Intl.DateTimeFormat('en-US', {
      timeZone: 'UTC',
      hour: 'numeric',
      minute: 'numeric',
      hour12: false,
    });
    const utcParts = utcFormatter.formatToParts(date);
    const utcHour = parseInt(utcParts.find((p) => p.type === 'hour')?.value || '0', 10);
    const utcMinute = parseInt(utcParts.find((p) => p.type === 'minute')?.value || '0', 10);

    // Calculate offset in minutes
    let offsetMinutes = hour * 60 + minute - (utcHour * 60 + utcMinute);

    // Handle day boundary (offset should be between -12 and +14 hours)
    if (offsetMinutes > 12 * 60) {
      offsetMinutes -= 24 * 60;
    } else if (offsetMinutes < -12 * 60) {
      offsetMinutes += 24 * 60;
    }

    return offsetMinutes;
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
    let totalMinutes = hours * 60 + minutes + offsetDiff;

    // Handle day wraparound
    let dayOffset = 0;
    if (totalMinutes < 0) {
      dayOffset = -1;
      totalMinutes += 24 * 60;
    } else if (totalMinutes >= 24 * 60) {
      dayOffset = 1;
      totalMinutes -= 24 * 60;
    }

    return {
      hours: Math.floor(totalMinutes / 60),
      minutes: totalMinutes % 60,
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
  const mm = minutes.toString().padStart(2, '0');
  if (cycle === '24h') {
    return `${hours.toString().padStart(2, '0')}:${mm}`;
  }
  const meridiem = MERIDIEM[language] ?? MERIDIEM.en;
  const period = hours >= 12 ? meridiem.pm : meridiem.am;
  const hour12 = hours % 12 || 12;
  return `${hour12}:${mm} ${period}`;
}

/**
 * Format a time for display (AM/PM, or HH:MM under a 24-hour cycle)
 */
export function formatTimeDisplay(hours: number, minutes: number, cycle: HourCycle): string {
  return formatTimeOfDay(hours, minutes, cycle);
}

/**
 * Format time with timezone abbreviation (e.g., "8:40 PM MT")
 */
export function formatTimeWithTimezone(
  hours: number,
  minutes: number,
  timezone: string,
  cycle: HourCycle
): string {
  return `${formatTimeOfDay(hours, minutes, cycle)} ${getTimezoneAbbreviation(timezone)}`;
}

/**
 * Format dual timezone display (e.g., "8:40 PM MT / 9:40 PM CT")
 * Shows user's local time first, then care recipient's time
 */
export function formatDualTimezoneDisplay(
  hours: number,
  minutes: number,
  userTimezone: string,
  careRecipientTimezone: string,
  cycle: HourCycle
): string {
  // If same timezone, just show one time
  if (userTimezone === careRecipientTimezone) {
    return formatTimeWithTimezone(hours, minutes, userTimezone, cycle);
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
export function timezonesAreDifferent(tz1: string, tz2: string): boolean {
  if (tz1 === tz2) return false;

  // Also check if they have the same offset (some timezones are aliases)
  const offset1 = getTimezoneOffsetMinutes(tz1);
  const offset2 = getTimezoneOffsetMinutes(tz2);

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
    const shouldShowDual =
      showDualTimezone ?? timezonesAreDifferent(deviceTimezone, careRecipientTimezone);

    // Format care recipient's time directly (no conversion - it's already in their TZ)
    const recipientTime = `${formatTimeOfDay(hours, minutes, cycle)} ${getTimezoneAbbreviation(careRecipientTimezone)}`;

    if (!shouldShowDual) {
      return recipientTime;
    }

    // For viewer's time, we need to convert FROM care recipient's TZ TO viewer's TZ
    const refDate = referenceDate || new Date();

    // Get the UTC time for this moment
    const recipientOffset = getTimezoneOffsetMinutes(careRecipientTimezone, refDate);
    const utcMinutes = hours * 60 + minutes - recipientOffset;

    // Convert to viewer's timezone
    const viewerOffset = getTimezoneOffsetMinutes(deviceTimezone, refDate);
    let viewerTotalMinutes = utcMinutes + viewerOffset;

    // Handle day wraparound
    if (viewerTotalMinutes < 0) {
      viewerTotalMinutes += 24 * 60;
    } else if (viewerTotalMinutes >= 24 * 60) {
      viewerTotalMinutes -= 24 * 60;
    }

    const viewerHours = Math.floor(viewerTotalMinutes / 60);
    const viewerMinutes = viewerTotalMinutes % 60;
    const viewerTime = `${formatTimeOfDay(viewerHours, viewerMinutes, cycle)} ${getTimezoneAbbreviation(deviceTimezone)}`;

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
    const tzAbbr = getTimezoneAbbreviation(careRecipientTimezone);

    // Format care recipient's time
    const primaryTime = `${formatTimeOfDay(hours, minutes, cycle)} ${tzAbbr}`;

    // Check if we need viewer's time
    if (!timezonesAreDifferent(deviceTimezone, careRecipientTimezone)) {
      return { primaryTime, secondaryTime: null };
    }

    // Convert to viewer's timezone
    const refDate = referenceDate || new Date();
    const recipientOffset = getTimezoneOffsetMinutes(careRecipientTimezone, refDate);
    const utcMinutes = hours * 60 + minutes - recipientOffset;
    const viewerOffset = getTimezoneOffsetMinutes(deviceTimezone, refDate);
    let viewerTotalMinutes = utcMinutes + viewerOffset;

    // Handle day wraparound
    if (viewerTotalMinutes < 0) {
      viewerTotalMinutes += 24 * 60;
    } else if (viewerTotalMinutes >= 24 * 60) {
      viewerTotalMinutes -= 24 * 60;
    }

    const viewerHours = Math.floor(viewerTotalMinutes / 60);
    const viewerMinutes = viewerTotalMinutes % 60;
    const viewerTzAbbr = getTimezoneAbbreviation(deviceTimezone);
    const secondaryTime = `${formatTimeOfDay(viewerHours, viewerMinutes, cycle)} ${viewerTzAbbr}`;

    return { primaryTime, secondaryTime };
  } catch {
    return { primaryTime: timeString, secondaryTime: null };
  }
}

/**
 * Format an event time for compact display (e.g., in calendar cards)
 * Shows just the time with timezone abbreviation: "2:00 PM CT"
 *
 * @param timeString - Time from database (HH:MM or HH:MM:SS format) - already in care recipient's TZ
 * @param careRecipientTimezone - The care recipient's IANA timezone
 * @param cycle - Viewer's hour cycle from resolveHourCycle() — REQUIRED
 * @returns Formatted time string with timezone abbreviation
 */
export function formatEventTimeCompact(
  timeString: string,
  careRecipientTimezone: string,
  cycle: HourCycle
): string {
  try {
    const [hoursStr, minutesStr] = timeString.split(':');
    const hours = parseInt(hoursStr, 10);
    const minutes = parseInt(minutesStr, 10);

    if (isNaN(hours) || isNaN(minutes)) {
      return timeString;
    }

    // Format directly - time is already in care recipient's timezone
    return `${formatTimeOfDay(hours, minutes, cycle)} ${getTimezoneAbbreviation(careRecipientTimezone)}`;
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
    const formatter = new Intl.DateTimeFormat('en-CA', {
      timeZone: careRecipientTimezone,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
    });
    const todayInRecipientTZ = formatter.format(now); // YYYY-MM-DD

    if (dateString === todayInRecipientTZ) return 'today';

    // Get yesterday in the care recipient's timezone
    const yesterday = new Date(now.getTime() - 24 * 60 * 60 * 1000);
    const yesterdayInRecipientTZ = formatter.format(yesterday);

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
    return new Intl.DateTimeFormat('en-CA', {
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
    const formatter = new Intl.DateTimeFormat('en-CA', {
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
 * Extract "minutes since midnight" for `now` in a given timezone.
 * Shared by the past-due and confirmable predicates so both read the clock the
 * same way.
 */
function getMinutesOfDayInTimezone(timezone: string, now: Date): number {
  const timeFormatter = new Intl.DateTimeFormat('en-US', {
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
  return Number.isNaN(total) ? null : total;
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
    const formatter = new Intl.DateTimeFormat('en-CA', {
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
    const tomorrowInRecipientTZ = getDateInTimezone(
      careRecipientTimezone,
      new Date(now.getTime() + MINUTES_PER_DAY * 60 * 1000)
    );
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
    const formatter = new Intl.DateTimeFormat('en-US', {
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
  const parts = new Intl.DateTimeFormat('en-US', {
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
