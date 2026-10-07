import type { LocaleFormat } from './types';

/**
 * Italian format primitives. meridiem is lockstep with backend tables/it/format.ts
 * (CLDR `it` default; Italian UI is 24h). Place names: only names whose Italian
 * differs from the English IANA-derived name.
 */
const placeNames: Record<string, string> = {
  // Americas
  'Mexico City': 'Città del Messico',
  Cancun: 'Cancún',
  Merida: 'Mérida',
  Bogota: 'Bogotá',
  Asuncion: 'Asunción',
  'Sao Paulo': 'San Paolo',
  Havana: "L'Avana",
  // Europe
  London: 'Londra',
  Berlin: 'Berlino',
  Paris: 'Parigi',
  Rome: 'Roma',
  Lisbon: 'Lisbona',
  Brussels: 'Bruxelles',
  Zurich: 'Zurigo',
  Athens: 'Atene',
  Warsaw: 'Varsavia',
  Prague: 'Praga',
  Copenhagen: 'Copenaghen',
  Stockholm: 'Stoccolma',
  Dublin: 'Dublino',
  Moscow: 'Mosca',
  Belgrade: 'Belgrado',
  Bucharest: 'Bucarest',
  // Africa & Middle East
  Cairo: 'Il Cairo',
  Algiers: 'Algeri',
  Tunis: 'Tunisi',
  // Asia & Pacific
  Seoul: 'Seul',
  Jakarta: 'Giacarta',
  'New Delhi': 'Nuova Delhi',
  Kolkata: 'Calcutta',
};

export const format: LocaleFormat = {
  meridiem: { am: 'AM', pm: 'PM' },
  placeNames,
};
