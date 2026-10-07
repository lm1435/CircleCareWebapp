import type { LocaleFormat } from './types';

/**
 * German spellings for the place names an IANA id yields (one locale for DE / AT / CH).
 *
 * Same contract as es.ts: bounded, best-effort, keyed by the derived English name, and
 * only names whose German spelling DIFFERS are listed ("Berlin", "London", "Paris" need
 * no row). A missing row costs a spelling, never a broken label.
 */
const placeNames: Record<string, string> = {
  // Americas
  'Mexico City': 'Mexiko-Stadt',
  Havana: 'Havanna',
  Bogota: 'Bogotá',
  Asuncion: 'Asunción',
  'Sao Paulo': 'São Paulo',
  // Europe
  Rome: 'Rom',
  Lisbon: 'Lissabon',
  Brussels: 'Brüssel',
  Vienna: 'Wien',
  Zurich: 'Zürich',
  Athens: 'Athen',
  Warsaw: 'Warschau',
  Prague: 'Prag',
  Copenhagen: 'Kopenhagen',
  Moscow: 'Moskau',
  Belgrade: 'Belgrad',
  Bucharest: 'Bukarest',
  Kiev: 'Kiew',
  Kyiv: 'Kiew',
  Luxembourg: 'Luxemburg',
  Busingen: 'Büsingen',
  // Africa & Middle East
  Cairo: 'Kairo',
  // Asia & Pacific
  Tokyo: 'Tokio',
  Singapore: 'Singapur',
  Kolkata: 'Kalkutta',
  Calcutta: 'Kalkutta',
  'New Delhi': 'Neu-Delhi',
};

/**
 * The 12-hour period marker. German is a 24-hour locale; a user who picks 12h gets the
 * CLDR `de` default. Flagged for the native-speaker review. Lockstep with backend
 * tables/de/format.ts and mobile src/i18n/format/de.ts.
 */
export const format: LocaleFormat = {
  meridiem: { am: 'AM', pm: 'PM' },
  placeNames,
};
