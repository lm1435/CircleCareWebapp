import {
  getTimezoneLabel,
  getTimezoneOffsetMinutes,
  type TimeLanguage,
} from '@/utils/timezone';

// The circle time-zone picker's option model (circle-timezone spec, web T11).
//
// The zone list is the browser's own IANA catalogue — `Intl.supportedValuesOf`
// — so it is always exactly the set the backend validates against (it uses
// the same call). Each option is named by its CITY (Apple's convention, the
// same `getTimezoneLabel` every other surface uses) plus its current GMT
// offset, because a picker of ~400 cities needs the offset to disambiguate
// ("Phoenix (GMT-7)" next to "Denver (GMT-6)").

/** Region order, roughly by how many CircleCare circles live there. */
export const TIMEZONE_REGIONS = [
  'America',
  'Europe',
  'Asia',
  'Africa',
  'Australia',
  'Pacific',
  'Atlantic',
  'Indian',
  'Antarctica',
  'Arctic',
] as const;

export type TimezoneRegion = (typeof TIMEZONE_REGIONS)[number];

export interface TimezoneOption {
  /** IANA id — what is stored and sent. */
  zone: string;
  region: TimezoneRegion;
  /** Localized city name. */
  city: string;
  /** "Mexico City (GMT-6)". */
  label: string;
  /** Folded haystack for search: city + IANA id + region. */
  search: string;
}

/** A tiny fallback for an engine without `Intl.supportedValuesOf` (pre-2022 browsers). */
const FALLBACK_ZONES = [
  'America/New_York',
  'America/Chicago',
  'America/Denver',
  'America/Phoenix',
  'America/Los_Angeles',
  'America/Anchorage',
  'Pacific/Honolulu',
  'America/Mexico_City',
  'America/Monterrey',
  'America/Bogota',
  'America/Lima',
  'America/Sao_Paulo',
  'America/Argentina/Buenos_Aires',
  'Europe/London',
  'Europe/Madrid',
  'Europe/Paris',
  'Europe/Berlin',
  'Europe/Rome',
  'Europe/Lisbon',
  'Asia/Kolkata',
  'Asia/Tokyo',
  'Australia/Sydney',
];

/** Every IANA zone this browser knows. */
export function listTimezones(): string[] {
  try {
    const intl = Intl as unknown as { supportedValuesOf?: (key: string) => string[] };
    const zones = intl.supportedValuesOf?.('timeZone');
    if (zones && zones.length > 0) return zones;
  } catch {
    // fall through
  }
  return FALLBACK_ZONES;
}

/** Case- and accent-insensitive search form. */
export function foldSearch(text: string): string {
  return text
    .trim()
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[_/]/g, ' ');
}

/** "GMT-6", "GMT+5:30", "GMT" — the zone's offset at `at`. Same shape as Intl's `shortOffset`. */
export function formatGmtOffset(zone: string, at: Date = new Date()): string {
  const minutes = getTimezoneOffsetMinutes(zone, at);
  if (minutes === 0) return 'GMT';
  const sign = minutes < 0 ? '-' : '+';
  const abs = Math.abs(minutes);
  const hours = Math.floor(abs / 60);
  const rest = abs % 60;
  return `GMT${sign}${hours}${rest ? `:${String(rest).padStart(2, '0')}` : ''}`;
}

/** The city a zone is named by, falling back to the raw id for a zone with no city. */
export function zoneCity(zone: string, language?: TimeLanguage): string {
  return getTimezoneLabel(zone, language) || zone;
}

/** "Mexico City (GMT-6)". */
export function zoneOptionLabel(zone: string, language?: TimeLanguage, at?: Date): string {
  return `${zoneCity(zone, language)} (${formatGmtOffset(zone, at)})`;
}

function regionOf(zone: string): TimezoneRegion | null {
  const head = zone.split('/')[0];
  return (TIMEZONE_REGIONS as readonly string[]).includes(head) && zone.includes('/')
    ? (head as TimezoneRegion)
    : null;
}

/**
 * The picker's options, grouped by region (in {@link TIMEZONE_REGIONS} order)
 * and sorted by city inside each region. Zones without a region and a city
 * (`Etc/*`, `UTC`) are left out — nobody lives there.
 */
export function buildTimezoneOptions(
  language: TimeLanguage | undefined,
  regionLabel: (region: TimezoneRegion) => string,
  at: Date = new Date()
): TimezoneOption[] {
  const options: TimezoneOption[] = [];
  for (const zone of listTimezones()) {
    const region = regionOf(zone);
    if (!region) continue;
    const city = getTimezoneLabel(zone, language);
    if (!city) continue;
    options.push({
      zone,
      region,
      city,
      label: `${city} (${formatGmtOffset(zone, at)})`,
      search: foldSearch(`${city} ${zone} ${regionLabel(region)}`),
    });
  }
  const order = (r: TimezoneRegion): number => TIMEZONE_REGIONS.indexOf(r);
  return options.sort(
    (a, b) => order(a.region) - order(b.region) || a.city.localeCompare(b.city) || a.zone.localeCompare(b.zone)
  );
}

/** Options whose city, id or region contains every word of `query`. */
export function filterTimezoneOptions(options: TimezoneOption[], query: string): TimezoneOption[] {
  const words = foldSearch(query).split(/\s+/).filter(Boolean);
  if (words.length === 0) return options;
  return options.filter((option) => words.every((word) => option.search.includes(word)));
}
