/**
 * Where is this browser? One resolver for the vitals units and the phone picker seed.
 * NO imports: pure. Mobile twin (identical body): mobile/src/utils/regionResolver.ts.
 */

/**
 * The language a bare tag names when its speakers are overwhelmingly in ONE country: bare "de" /
 * "fr" / "it" / "nl" are DE / FR / IT / NL, bare "pt" is Brazil (the app's `pt` bundle is pt-BR).
 * Bare "es" / "en" name no country (CircleCare's US Spanish-speaking audience): they fall through
 * to the US. Shared by the phone picker's seed and the vitals units.
 */
export const LANGUAGE_DEFAULT_COUNTRY: Readonly<Record<string, string>> = {
  de: 'DE',
  fr: 'FR',
  it: 'IT',
  nl: 'NL',
  pt: 'BR',
};

/**
 * The ISO 3166-1 alpha-2 region a locale tag carries: the first two-letter subtag ("de-DE" -> DE,
 * "zh-Hant-HK" -> HK, "en_GB" -> GB). Numeric regions ("es-419") and a bare language ("de") have
 * none: null.
 */
export function regionFromLocale(languageTag: string | null | undefined, regionCode?: string | null): string | null {
  if (regionCode && /^[A-Za-z]{2}$/.test(regionCode)) return regionCode.toUpperCase();
  const parts = (languageTag || '').replace(/_/g, '-').split('-');
  const region = parts.slice(1).find((p) => /^[A-Za-z]{2}$/.test(p));
  return region ? region.toUpperCase() : null;
}

/**
 * Time zone -> country, for the zones of the markets CircleCare sells in (plus the US's own, so a
 * US zone is recognised as such). Australia/* is matched by prefix, as is America/Argentina/*.
 * A zone not listed (UTC, Asia/*, ...) is unknown: never a guess.
 */
const ZONE_COUNTRY: Readonly<Record<string, string>> = {
  // United States and territories
  'America/New_York': 'US', 'America/Detroit': 'US', 'America/Chicago': 'US', 'America/Menominee': 'US',
  'America/Denver': 'US', 'America/Boise': 'US', 'America/Phoenix': 'US', 'America/Los_Angeles': 'US',
  'America/Anchorage': 'US', 'America/Juneau': 'US', 'America/Sitka': 'US', 'America/Metlakatla': 'US',
  'America/Yakutat': 'US', 'America/Nome': 'US', 'America/Adak': 'US', 'Pacific/Honolulu': 'US',
  'America/Indiana/Indianapolis': 'US', 'America/Indianapolis': 'US', 'America/Kentucky/Louisville': 'US',
  'America/North_Dakota/Center': 'US', 'US/Eastern': 'US', 'US/Central': 'US', 'US/Mountain': 'US',
  'US/Pacific': 'US', 'US/Alaska': 'US', 'US/Hawaii': 'US', 'US/Arizona': 'US',
  'America/Puerto_Rico': 'PR', 'America/St_Thomas': 'VI', 'Pacific/Guam': 'GU', 'Pacific/Saipan': 'MP',
  'Pacific/Pago_Pago': 'AS',
  // Europe
  'Europe/Berlin': 'DE', 'Europe/Busingen': 'DE', 'Europe/London': 'GB', 'Europe/Belfast': 'GB',
  'Europe/Dublin': 'IE', 'Europe/Madrid': 'ES', 'Atlantic/Canary': 'ES', 'Africa/Ceuta': 'ES',
  'Europe/Paris': 'FR', 'Europe/Rome': 'IT', 'Europe/Lisbon': 'PT', 'Atlantic/Madeira': 'PT',
  'Atlantic/Azores': 'PT', 'Europe/Vienna': 'AT', 'Europe/Zurich': 'CH', 'Europe/Brussels': 'BE',
  'Europe/Amsterdam': 'NL', 'Europe/Luxembourg': 'LU', 'Europe/Monaco': 'MC',
  // Oceania
  'Pacific/Auckland': 'NZ', 'Pacific/Chatham': 'NZ',
  // Canada
  'America/Toronto': 'CA', 'America/Montreal': 'CA', 'America/Vancouver': 'CA', 'America/Edmonton': 'CA',
  'America/Winnipeg': 'CA', 'America/Halifax': 'CA', 'America/St_Johns': 'CA', 'America/Regina': 'CA',
  'America/Moncton': 'CA', 'America/Whitehorse': 'CA', 'America/Yellowknife': 'CA', 'America/Iqaluit': 'CA',
  // Mexico
  'America/Mexico_City': 'MX', 'America/Cancun': 'MX', 'America/Merida': 'MX', 'America/Monterrey': 'MX',
  'America/Matamoros': 'MX', 'America/Chihuahua': 'MX', 'America/Ciudad_Juarez': 'MX', 'America/Mazatlan': 'MX',
  'America/Bahia_Banderas': 'MX', 'America/Hermosillo': 'MX', 'America/Tijuana': 'MX',
  // Brazil
  'America/Sao_Paulo': 'BR', 'America/Bahia': 'BR', 'America/Fortaleza': 'BR', 'America/Recife': 'BR',
  'America/Belem': 'BR', 'America/Manaus': 'BR', 'America/Cuiaba': 'BR', 'America/Campo_Grande': 'BR',
  'America/Porto_Velho': 'BR', 'America/Boa_Vista': 'BR', 'America/Rio_Branco': 'BR', 'America/Maceio': 'BR',
  'America/Araguaina': 'BR', 'America/Santarem': 'BR', 'America/Noronha': 'BR',
  // Rest of Latin America
  'America/Buenos_Aires': 'AR', 'America/Santiago': 'CL', 'America/Punta_Arenas': 'CL', 'America/Bogota': 'CO',
  'America/Lima': 'PE', 'America/Caracas': 'VE', 'America/Guayaquil': 'EC', 'America/La_Paz': 'BO',
  'America/Asuncion': 'PY', 'America/Montevideo': 'UY', 'America/Guatemala': 'GT', 'America/El_Salvador': 'SV',
  'America/Tegucigalpa': 'HN', 'America/Managua': 'NI', 'America/Costa_Rica': 'CR', 'America/Panama': 'PA',
  'America/Havana': 'CU', 'America/Santo_Domingo': 'DO',
};

/** Zones of the US and its territories: never evidence of being elsewhere. */
const US_ZONE_COUNTRIES: ReadonlySet<string> = new Set(['US', 'PR', 'VI', 'GU', 'MP', 'AS']);

/** The country of an IANA zone, or null when it is not in the table. */
export function countryForTimeZone(timeZone: string | null | undefined): string | null {
  if (!timeZone) return null;
  if (Object.prototype.hasOwnProperty.call(ZONE_COUNTRY, timeZone)) return ZONE_COUNTRY[timeZone];
  if (timeZone.startsWith('Australia/')) return 'AU';
  if (timeZone.startsWith('America/Argentina/')) return 'AR';
  if (timeZone.startsWith('America/Indiana/') || timeZone.startsWith('America/Kentucky/') ||
      timeZone.startsWith('America/North_Dakota/')) return 'US';
  return null;
}

/**
 * THE region resolver (vitals units and the phone picker's seed, both platforms):
 *   0. an OS region setting (mobile `getLocales()[0].regionCode`) wins when present, US included;
 *   1. the language tag's region, unless it is US or missing;
 *   2. tag region missing or US, and the time zone is a known zone clearly OUTSIDE the US: the
 *      zone's country (an "en-US" browser in Europe/Berlin is in Germany);
 *   3. tag region US: US. Missing: the language's country (bare "de" -> DE);
 *   4. else null (the caller's default: the US).
 */
export function resolveRegion(input: {
  languageTag?: string | null;
  osRegionCode?: string | null;
  timeZone?: string | null;
}): string | null {
  const os = input.osRegionCode;
  if (os && /^[A-Za-z]{2}$/.test(os)) return os.toUpperCase();
  const tagRegion = regionFromLocale(input.languageTag);
  if (tagRegion && tagRegion !== 'US') return tagRegion;
  // Only a zone clearly OUTSIDE the US counts (a US or US-territory zone says nothing new).
  const zoneCountry = countryForTimeZone(input.timeZone);
  const foreignZone = zoneCountry && !US_ZONE_COUNTRIES.has(zoneCountry) ? zoneCountry : null;
  if (foreignZone) return foreignZone;
  if (tagRegion === 'US') return 'US';
  const language = ((input.languageTag || '').replace(/_/g, '-').split('-')[0] || '').toLowerCase();
  if (Object.prototype.hasOwnProperty.call(LANGUAGE_DEFAULT_COUNTRY, language)) {
    return LANGUAGE_DEFAULT_COUNTRY[language];
  }
  return null;
}

// ── Web only (below the shared body) ─────────────────────────────────────────

/**
 * The browser's region: `resolveRegion` on `navigator.languages[0]` and the browser time zone
 * (browsers expose no OS region setting). Null when nothing says (the caller's default: the US).
 */
export function browserRegion(): string | null {
  if (typeof navigator === 'undefined') return null;
  let timeZone: string | null = null;
  try {
    timeZone = Intl.DateTimeFormat().resolvedOptions().timeZone ?? null;
  } catch {
    timeZone = null;
  }
  return resolveRegion({ languageTag: navigator.languages?.[0] ?? navigator.language, timeZone });
}
