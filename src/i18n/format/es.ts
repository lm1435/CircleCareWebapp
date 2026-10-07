import type { LocaleFormat } from './types';

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
const placeNames: Record<string, string> = {
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
 * The 12-hour period marker. Spanish uses the RAE form `a. m.` / `p. m.`: lowercase, a
 * period after EACH letter, a space between the two groups. See `MERIDIEM` in
 * `src/utils/timezone.ts` for why this is a constant and not an i18n key (and the
 * lockstep copies in backend/mobile).
 */
export const format: LocaleFormat = {
  meridiem: { am: 'a. m.', pm: 'p. m.' },
  placeNames,
};
