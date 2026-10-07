/**
 * Per-locale FORMAT primitives (not copy): data a locale must supply so that times and
 * zone labels render correctly. One file per locale code (`format/<code>.ts`,
 * exporting `format`), wired into `format/index.ts` with one import + one entry.
 *
 * A regional variant (fr-CA, pt-PT) is a SPARSE override of its base: it exports only the
 * fields that differ (`meridiem` for the fr-CA "13 h 05" style, a handful of
 * `placeNames`); lookups walk variant -> base -> en (see `format/index.ts`).
 */
export interface LocaleFormat {
  /** 12-hour period marker. Required on a base locale; optional on a variant. */
  meridiem: { am: string; pm: string };
  /** Respellings keyed by the English IANA-derived place name. Sparse; may be empty. */
  placeNames: Record<string, string>;
}

/** Variant files may omit any field; the base's value then applies. */
export type LocaleFormatOverride = Partial<LocaleFormat>;
