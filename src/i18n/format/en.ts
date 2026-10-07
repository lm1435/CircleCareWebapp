import type { LocaleFormat } from './types';

/**
 * English needs no place-name table: the IANA-derived name IS the English one.
 * The 12-hour marker is `AM` / `PM` (lockstep with backend/mobile MERIDIEM).
 */
export const format: LocaleFormat = {
  meridiem: { am: 'AM', pm: 'PM' },
  placeNames: {},
};
