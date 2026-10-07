import type { LocaleFormatOverride } from './types';

/**
 * European Portuguese format override (sparse; everything else resolves through pt).
 * `meridiem`: CLDR default for `pt-PT` ("2:30 p.m."), lockstep with backend
 * tables/pt-PT/format.ts and mobile src/i18n/format/pt-PT.ts.
 *
 * NOTE: `placeNames` REPLACES the base table when present (no deep merge), so the
 * full pt table is spread in and only the European spellings are changed.
 */
import { format as pt } from './pt';

export const format: LocaleFormatOverride = {
  meridiem: { am: 'a.m.', pm: 'p.m.' },
  placeNames: {
    ...pt.placeNames,
  // Only the names whose European spelling differs from the Brazilian one.
  'New York': 'Nova Iorque',
  Moscow: 'Moscovo',
  Copenhagen: 'Copenhaga',
  },
};
