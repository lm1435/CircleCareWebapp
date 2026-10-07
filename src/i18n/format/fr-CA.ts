import type { LocaleFormatOverride } from './types';

/**
 * French (Canada): SPARSE override of fr (place names resolve through fr).
 * CLDR fr-CA 12-hour marker; spec Q2 ("13 h 05" h-notation) flagged for native review.
 */
export const format: LocaleFormatOverride = {
  meridiem: { am: 'a.m.', pm: 'p.m.' },
};
