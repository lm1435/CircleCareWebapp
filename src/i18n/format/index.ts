/**
 * CENTRAL INDEX of per-locale format modules (meridiem, place names).
 *
 * Adding a locale = create `./<code>.ts` (exports `format`) and add EXACTLY two lines
 * here: one import directly BELOW `// slot: <code> (import)` and one map entry directly
 * BELOW `// slot: <code> (entry)` (alphabetical, separate slots so lanes never edit
 * adjacent lines; keep the markers; hyphenated codes are quoted, alias drops the hyphen:
 * `'fr-CA': frCA,`). Variants (`fr-CA`, `pt-PT`)
 * export a sparse `LocaleFormatOverride`. Do NOT register the locale in
 * `../locales.ts` from a lane: the registry flip is a separate stage.
 *
 * The map is typed loosely on purpose so a module can land before the registry flip;
 * `__tests__/formatIndex.test.ts` checks every registered locale has a module and every
 * present module is well-formed.
 */
import { localeChain } from '../locales';
import type { LocaleFormat, LocaleFormatOverride } from './types';
// slot: de (import)
import { format as en } from './en';
import { format as es } from './es';
// slot: fr (import)
// slot: fr-CA (import)
// slot: it (import)
// slot: pt (import)
// slot: pt-PT (import)

export const LOCALE_FORMATS: Record<string, LocaleFormat | LocaleFormatOverride> = {
  // slot: de (entry)
  en,
  es,
  // slot: fr (entry)
  // slot: fr-CA (entry)
  // slot: it (entry)
  // slot: pt (entry)
  // slot: pt-PT (entry)
};

/** Meridiem for a locale: variant -> base -> en (a variant may omit it). */
export function resolveMeridiem(code: string): { am: string; pm: string } {
  for (const c of localeChain(code)) {
    const m = LOCALE_FORMATS[c]?.meridiem;
    if (m) return m;
  }
  return (LOCALE_FORMATS.en as LocaleFormat).meridiem;
}
