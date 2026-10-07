import type { LocaleFormat } from './types';

/**
 * French spellings for the place names an IANA id yields (keyed by the derived
 * English name; only names whose French DIFFERS are listed). Bounded and
 * best-effort, like es: a missing row costs an accent, never a broken label.
 */
const placeNames: Record<string, string> = {
  // Americas
  'Mexico City': 'Mexico',
  'Sao Paulo': 'São Paulo',
  Havana: 'La Havane',
  Montreal: 'Montréal',
  Quebec: 'Québec',
  // Europe
  London: 'Londres',
  Lisbon: 'Lisbonne',
  Brussels: 'Bruxelles',
  Vienna: 'Vienne',
  Athens: 'Athènes',
  Warsaw: 'Varsovie',
  Copenhagen: 'Copenhague',
  Moscow: 'Moscou',
  Bucharest: 'Bucarest',
  // Africa & Middle East
  Cairo: 'Le Caire',
  Algiers: 'Alger',
  Dubai: 'Dubaï',
  // Asia & Pacific
  Seoul: 'Séoul',
  Singapore: 'Singapour',
  Kolkata: 'Calcutta',
};

/** CLDR fr 12-hour marker (lockstep with backend/mobile; French clocks default to 24h). */
export const format: LocaleFormat = {
  meridiem: { am: 'AM', pm: 'PM' },
  placeNames,
};
