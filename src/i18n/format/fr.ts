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
  // Time zone picker cities (utils/timezoneOptions.ts)
  'St Johns': 'Saint-Jean de Terre-Neuve',
  'Santo Domingo': 'Saint-Domingue',
  'Puerto Rico': 'Porto Rico',
  Jamaica: 'Jamaïque',
  Bogota: 'Bogotá',
  Asuncion: 'Asunción',
  Cancun: 'Cancún',
  Canary: 'Îles Canaries',
  Kyiv: 'Kiev',
  Jerusalem: 'Jérusalem',
  Tehran: 'Téhéran',
  Kathmandu: 'Katmandou',
  Manila: 'Manille',
  Adelaide: 'Adélaïde',
};

/** CLDR fr 12-hour marker (lockstep with backend/mobile; French clocks default to 24h). */
export const format: LocaleFormat = {
  meridiem: { am: 'AM', pm: 'PM' },
  placeNames,
};
