/**
 * Hour-cycle resolution (12-hour vs 24-hour clock).
 *
 * VERBATIM PORT of `backend/src/utils/hourCycle.ts` (the CANONICAL SOURCE) —
 * the type, the exception sets and `inferHourCycleFromTimezone` below are
 * identical there and in `mobile/src/utils/hourCycle.ts`. Keep the three copies
 * identical — if you change a rule in the backend file, change it here in the
 * same commit. Only `resolveHourCycle` differs per repo, because only the
 * priority of the *inputs* differs (see below).
 *
 * ---------------------------------------------------------------------------
 * `inferHourCycleFromTimezone` IS A DELIBERATE HEURISTIC.
 *
 * There is no data source that maps an IANA timezone to a country's clock
 * convention, and a timezone is not a locale. This function exists for exactly
 * one situation: rendering a time for a user whose device has NOT yet synced
 * `users.uses_24h_clock` — i.e. server-generated push/email/AI text for a user
 * on an old app build, a web-only user, or a brand new account.
 *
 * Once a device has synced, `resolveHourCycle` uses the exact device value and
 * this heuristic is never consulted. Mixed-convention countries (Canada, South
 * Africa) may be wrong for a single app-open; that is accepted (see the plan's
 * Open Questions). Do NOT use this function when a real device value is
 * available, and do NOT extend it into a general locale system.
 * ---------------------------------------------------------------------------
 */

export type HourCycle = '12h' | '24h';

/** Region prefixes that predominantly use a 12-hour clock. */
const TWELVE_HOUR_PREFIXES = ['America/', 'Australia/', 'Pacific/'];

/** Region prefixes that predominantly use a 24-hour clock. */
const TWENTY_FOUR_HOUR_PREFIXES = [
  'Europe/',
  'Africa/',
  'Asia/',
  'Atlantic/',
  'Indian/',
  'Antarctica/',
];

/**
 * 12-hour zones that sit inside an otherwise 24-hour region.
 * India, Sri Lanka, Bangladesh, Pakistan, the Philippines, South Korea,
 * Malaysia and Egypt read the clock in 12-hour form.
 */
const TWELVE_HOUR_ZONE_EXCEPTIONS: ReadonlySet<string> = new Set([
  'Asia/Kolkata',
  'Asia/Calcutta',
  'Asia/Colombo',
  'Asia/Dhaka',
  'Asia/Karachi',
  'Asia/Manila',
  'Asia/Seoul',
  'Asia/Kuala_Lumpur',
  'Africa/Cairo',
]);

/**
 * 24-hour zones that sit inside an otherwise 12-hour region.
 * South America runs on a 24-hour clock while North America does not.
 */
const TWENTY_FOUR_HOUR_ZONE_EXCEPTIONS: ReadonlySet<string> = new Set([
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
]);

/**
 * Zone prefixes that are 24-hour exceptions inside a 12-hour region.
 * Argentina's zones are all `America/Argentina/<City>`.
 */
const TWENTY_FOUR_HOUR_ZONE_PREFIX_EXCEPTIONS = ['America/Argentina/'];

/**
 * Best-effort guess at a region's clock convention from an IANA timezone.
 *
 * Heuristic — see the file header. Only valid before a device has synced.
 * Unknown, empty and null timezones resolve to '12h', matching the
 * America/New_York fallback used throughout the project.
 */
export function inferHourCycleFromTimezone(tz: string | null | undefined): HourCycle {
  if (!tz) return '12h';

  // Exceptions are checked first: they intentionally override the prefix rule.
  if (TWELVE_HOUR_ZONE_EXCEPTIONS.has(tz)) return '12h';
  if (TWENTY_FOUR_HOUR_ZONE_EXCEPTIONS.has(tz)) return '24h';
  if (TWENTY_FOUR_HOUR_ZONE_PREFIX_EXCEPTIONS.some((prefix) => tz.startsWith(prefix))) {
    return '24h';
  }

  if (TWENTY_FOUR_HOUR_PREFIXES.some((prefix) => tz.startsWith(prefix))) return '24h';
  if (TWELVE_HOUR_PREFIXES.some((prefix) => tz.startsWith(prefix))) return '12h';

  // Unrecognised zone (UTC, Etc/GMT+5, a typo, a legacy alias).
  return '12h';
}

/**
 * Read the browser LOCALE's clock convention.
 *
 * This is NOT the OS 12/24-hour toggle — see `resolveHourCycle`. It is what
 * `navigator.language` implies (en-US → 12h, es-ES → 24h), which is a better
 * guess than a timezone but still only a guess: a user in en-US who flipped
 * their phone to 24-hour time is invisible here.
 *
 * Returns `null` (rather than throwing) in any environment without `navigator`
 * or without a full-ICU `Intl` — SSR, a jsdom test with a trimmed global, an
 * engine whose `resolvedOptions()` omits `hour12`. A formatting helper must
 * never be the thing that crashes a page.
 */
function inferHourCycleFromBrowserLocale(): HourCycle | null {
  try {
    if (typeof navigator === 'undefined') return null;
    const locale = navigator.language;
    if (!locale) return null;

    const { hour12 } = new Intl.DateTimeFormat(locale, { hour: 'numeric' }).resolvedOptions();
    if (typeof hour12 !== 'boolean') return null;

    return hour12 ? '12h' : '24h';
  } catch {
    return null;
  }
}

/**
 * The WEB resolution chain, in priority order:
 *
 *   1. `uses_24h_clock` — the exact device value, synced to the server by the
 *      user's PHONE (mobile reads it from `expo-localization`).
 *   2. browser locale  → `navigator.language`'s clock convention.
 *   3. `timezone`      → the shared heuristic above.
 *   4. '12h'.
 *
 * WHY STEP 1 BEATS EVERYTHING THE BROWSER CAN TELL US: **no browser API exposes
 * the operating system's 12/24-hour toggle.** `Intl` only reports what the
 * chosen *locale* prefers, and `navigator.language` is the browser's language
 * setting, not the OS clock setting. A user in `en-US` who set their phone and
 * laptop to 24-hour time still gets `hour12: true` from step 2. So whenever the
 * phone has told the server the real answer (step 1) we use that value and stop
 * — steps 2–4 exist only for a user who has never opened the mobile app, or who
 * is on a build old enough not to sync the column.
 *
 * Pass the row you already loaded from `GET /users/me`; no extra request needed.
 */
export function resolveHourCycle(user: {
  uses_24h_clock?: boolean | null;
  timezone?: string | null;
}): HourCycle {
  // 1. Exact value, synced from the user's phone.
  if (user.uses_24h_clock === true) return '24h';
  if (user.uses_24h_clock === false) return '12h';

  // 2. What the browser's locale implies (guarded — may be unavailable).
  const fromLocale = inferHourCycleFromBrowserLocale();
  if (fromLocale) return fromLocale;

  // 3. The shared timezone heuristic. 4. '12h' when the timezone is null or
  //    unrecognised (inferHourCycleFromTimezone already returns '12h' there).
  return inferHourCycleFromTimezone(user.timezone);
}
