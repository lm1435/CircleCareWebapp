import type { LocaleFormat } from './types';

/**
 * Portuguese spellings for the place names an IANA id yields (Brazilian
 * conventions; pt-PT overrides the few European spellings that differ).
 *
 * An IANA id is ASCII by construction (`America/Sao_Paulo`), so the derived name
 * loses its accents: a Brazilian reader deserves "São Paulo", "Belém", "Cuiabá".
 * Same contract as es.ts: bounded, best-effort, keyed by the derived English name,
 * and only names whose Portuguese DIFFERS are listed ("Paris", "Recife", "Manaus"
 * need no row).
 */
const placeNames: Record<string, string> = {
  // Americas (Brazilian zones first: their IANA ids drop the accents)
  'Sao Paulo': 'São Paulo',
  Belem: 'Belém',
  Cuiaba: 'Cuiabá',
  Maceio: 'Maceió',
  Araguaina: 'Araguaína',
  Santarem: 'Santarém',
  Eirunepe: 'Eirunepé',
  'Mexico City': 'Cidade do México',
  Bogota: 'Bogotá',
  Panama: 'Panamá',
  Asuncion: 'Assunção',
  'New York': 'Nova York',
  // Europe
  London: 'Londres',
  Berlin: 'Berlim',
  Rome: 'Roma',
  Lisbon: 'Lisboa',
  Azores: 'Açores',
  Brussels: 'Bruxelas',
  Vienna: 'Viena',
  Zurich: 'Zurique',
  Athens: 'Atenas',
  Warsaw: 'Varsóvia',
  Prague: 'Praga',
  Copenhagen: 'Copenhague',
  Stockholm: 'Estocolmo',
  Moscow: 'Moscou',
  Istanbul: 'Istambul',
  // Africa & Middle East
  Johannesburg: 'Joanesburgo',
  // Asia & Pacific
  Tokyo: 'Tóquio',
  Seoul: 'Seul',
  Shanghai: 'Xangai',
  Singapore: 'Singapura',
  Jakarta: 'Jacarta',
  Kolkata: 'Calcutá',
  Calcutta: 'Calcutá',
  'New Delhi': 'Nova Délhi',
};

/**
 * The 12-hour period marker: CLDR default for `pt` (Brazil tells time on the 24h
 * clock; this only serves users who pick 12h). Lockstep with backend
 * tables/pt/format.ts and mobile src/i18n/format/pt.ts.
 */
export const format: LocaleFormat = {
  meridiem: { am: 'AM', pm: 'PM' },
  placeNames,
};
