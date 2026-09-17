/**
 * WEB ADAPTER for the shared PDF templates (`src/pdf/shared/`).
 *
 * Builds the {@link PdfEnv} every template call receives, from the web app's
 * own helpers. This is the ONE place the shared, platform-pure templates meet
 * i18next, the signed-in user's clock preference and the web timezone module
 * — mobile has its own twin (`mobile/src/utils/pdfEnv.ts`).
 *
 * Built PER CALL, never captured at module load: the active language, the
 * browser locale and the cached `/users/me` row can all change between two
 * exports in one session, and each document must reflect the moment it was
 * generated.
 */
import i18n from '@/i18n';
import type { PdfEnv } from './shared/env';
import { LOGO_IMG } from './logo';
import {
  formatTimeOfDay,
  getCachedDateTimeFormat,
  getDateInTimezone,
  getTimezoneLabel,
  type TimeLanguage,
} from '@/utils/timezone';
import { resolveHourCycle, type HourCycle } from '@/utils/hourCycle';
import { formatRecurrenceLabel } from '@/components/calendar/recurrenceLabel';
import { queryClient } from '@/lib/queryClient';
import { queryKeys } from '@/lib/queryKeys';
import type { User } from '@/api/users';

/**
 * Mobile-namespace key → web-namespace key.
 *
 * The templates speak MOBILE's flat key space (plan decision 4); the web app
 * files the same strings under per-feature namespaces. Only the prefixes the
 * templates actually use are mapped; anything else (a `calendar:` key the
 * recurrence formatter already namespaced, say) passes through untouched.
 */
const KEY_PREFIX_MAP: ReadonlyArray<readonly [mobilePrefix: string, webPrefix: string]> = [
  ['careSummary.', 'emergency:careSummary.'],
  ['medicationHistory.export.', 'meds:export.'],
  // `shared/vitalsSummary.ts` labels vital rows with `vitals.types.*`.
  ['vitals.', 'vitals:'],
];

/** Exported for the unit test; not part of the adapter contract. */
export function mapPdfKey(key: string): string {
  for (const [mobilePrefix, webPrefix] of KEY_PREFIX_MAP) {
    if (key.startsWith(mobilePrefix)) return webPrefix + key.slice(mobilePrefix.length);
  }
  return key;
}

function pdfT(key: string, opts?: Record<string, unknown>): string {
  return i18n.t(mapPdfKey(key), opts);
}

/** The active UI language, collapsed to the two the app ships. */
function uiLanguage(): TimeLanguage {
  const lng = i18n.resolvedLanguage || i18n.language || 'en';
  return lng.toLowerCase().startsWith('es') ? 'es' : 'en';
}

/**
 * Locale to format dates in — the same rule as `lib/inviteExpiry.ts`
 * (`getFormattingLocale`), itself a port of mobile's `getFormattingLocale`.
 *
 * Prefer the browser's own locale when it agrees with the language the UI is
 * rendered in, so a Spanish-reading user in Mexico gets `es-MX` month names
 * rather than bare `es`. When the two disagree (UI switched to Spanish on an
 * en-US browser) the UI language wins — the date must match the words around it.
 */
function formattingLocale(language: TimeLanguage): string {
  const browserLocale = typeof navigator !== 'undefined' ? navigator.language : '';
  if (browserLocale && browserLocale.toLowerCase().startsWith(language)) return browserLocale;
  return language;
}

/**
 * The viewer's 12h/24h clock, resolved EXACTLY as `hooks/useHourCycle.ts`
 * does — from the shared `queryKeys.currentUser` row (`GET /users/me`), whose
 * `uses_24h_clock` is synced by the user's phone — but read from the cache
 * rather than a hook, because the adapter runs inside an event handler, not a
 * render. No request is made: when the row is not cached yet (or the viewer is
 * signed out) `resolveHourCycle` falls back to the browser locale and then the
 * timezone heuristic, so this always returns a usable value.
 *
 * `useAuthStore`'s `user` is deliberately NOT the source: `AuthUser` carries
 * only id/email/name, never the clock preference.
 */
function viewerHourCycle(): HourCycle {
  const user = queryClient.getQueryData<User>(queryKeys.currentUser);
  return resolveHourCycle({
    uses_24h_clock: user?.uses_24h_clock,
    timezone: user?.timezone,
  });
}

/**
 * A real instant's wall-clock time in `timezone`, on the viewer's hour cycle.
 * Web twin of mobile's `formatInstantTimeOfDay`: read the zone's hour/minute
 * digits with a fixed `en-US`/`hour12:false` formatter (locale-independent
 * digits), then hand them to the SAME `formatTimeOfDay` every other time in
 * the document flows through, so "Stopped 8:05 PM" and "8:05 PM" in the
 * medications table are shaped identically.
 */
function formatInstantTimeOfDay(
  instant: Date,
  timezone: string,
  cycle: HourCycle,
  language: TimeLanguage
): string {
  const read = (zone: string | undefined): { hours: number; minutes: number } => {
    const parts = getCachedDateTimeFormat('en-US', {
      hour: 'numeric',
      minute: '2-digit',
      hour12: false,
      timeZone: zone,
    }).formatToParts(instant);
    const rawHour = parseInt(parts.find((p) => p.type === 'hour')?.value || '0', 10);
    return {
      // Some ICU implementations report hour 24, not 0, for midnight.
      hours: rawHour === 24 ? 0 : rawHour,
      minutes: parseInt(parts.find((p) => p.type === 'minute')?.value || '0', 10),
    };
  };

  try {
    const { hours, minutes } = read(timezone);
    return formatTimeOfDay(hours, minutes, cycle, language);
  } catch {
    // An unknown or malformed zone throws a RangeError. A formatting helper
    // must not be the thing that fails an export: fall back to the device's
    // own zone rather than throwing.
    const { hours, minutes } = read(undefined);
    return formatTimeOfDay(hours, minutes, cycle, language);
  }
}

export function buildPdfEnv(): PdfEnv {
  const language = uiLanguage();
  const locale = formattingLocale(language);
  // Resolved ONCE per document, for the viewer — the same clock every time in
  // the export is rendered on, regardless of which zone the digits belong to.
  const cycle = viewerHourCycle();
  const t = (key: string, opts?: Record<string, unknown>) => pdfT(key, opts);

  return {
    t,
    locale,
    logoImg: LOGO_IMG,
    getDateInTimezone: (tz, date) => getDateInTimezone(tz, date),
    formatTimeOfDay: (hours, minutes) => formatTimeOfDay(hours, minutes, cycle, language),
    formatInstantTimeOfDay: (instant, tz) => formatInstantTimeOfDay(instant, tz, cycle, language),
    getTimezoneLabel: (tz, lang) => getTimezoneLabel(tz, lang),
    formatRecurrence: (event) => formatRecurrenceLabel(event, t, locale) ?? '',
  };
}
