/**
 * Locale registry (webapp copy) — the ONE place that says which languages the
 * app ships and how a raw BCP-47 tag maps onto them.
 *
 * LOCKSTEP: `backend/src/i18n/locales.ts` is the canonical list; mobile and
 * webapp keep same-shaped copies (they cannot import the backend). The parity
 * test `src/i18n/__tests__/localeRegistry.test.ts` fails when the code lists
 * drift. To add a locale, see the add-a-locale runbook (docs/plans/add-french-portuguese.md).
 *
 * PURE ON PURPOSE: no i18next import and no side effects, so leaf utilities
 * (utils/timezone.ts, pdf/pdfEnv.ts, api schemas) can depend on it without
 * pulling in the i18n barrel and its `i18n.init()`.
 *
 * Variant tags (e.g. `fr-CA`) carry `base: 'fr'`: they select a sparse override
 * layer on top of the base language. Variant selection follows the LANGUAGE TAG
 * only, never the device region.
 */

export interface LocaleEntry {
  readonly code: string;
  /** Base language this variant overlays (absent for a base language). */
  readonly base?: string;
  /** CLDR plural categories actually reachable by integer counts (not 'many'). */
  readonly pluralCategories: readonly string[];
}

export const LOCALE_REGISTRY = [
  { code: 'en', pluralCategories: ['one', 'other'] },
  { code: 'es', pluralCategories: ['one', 'other'] }, // Latin American Spanish
] as const satisfies readonly LocaleEntry[];

export type SupportedLanguage = (typeof LOCALE_REGISTRY)[number]['code'];

export const DEFAULT_LOCALE = 'en' as const;

/** Codes in registry order — usable in `z.enum`. */
export const SUPPORTED_LOCALES = LOCALE_REGISTRY.map((l) => l.code) as unknown as readonly [
  SupportedLanguage,
  ...SupportedLanguage[],
];

/** Native display names (language picker). */
export const LOCALE_LABELS: Record<SupportedLanguage, string> = {
  en: 'English',
  es: 'Español', // Latin American Spanish
};

export interface LocaleHelpers {
  isSupportedLocale(tag: unknown): boolean;
  /** exact (case-insensitive, `_`==`-`) -> primary-subtag base match -> 'en'. */
  normalizeLocale(tag: string | null | undefined): string;
  /** The registry base of a code (or the code itself). */
  baseLocale(code: string): string;
  /** Tag -> the supported BASE language (what `startsWith('es') ? 'es' : 'en'` approximated). */
  baseLanguage(tag: string | null | undefined): string;
  /** e.g. 'fr-CA' -> ['fr-CA', 'fr', 'en']. */
  localeChain(tag: string | null | undefined): string[];
  /** Registry codes other than 'en'. */
  nonEnglishLocales(): string[];
}

/** Build the helpers over any registry (the real one below; fakes in tests). */
export function createLocaleHelpers(registry: readonly LocaleEntry[]): LocaleHelpers {
  const canon = (tag: string): string => tag.trim().replace(/_/g, '-').toLowerCase();
  const byLower = new Map(registry.map((e) => [e.code.toLowerCase(), e]));

  const normalizeLocale = (tag: string | null | undefined): string => {
    if (typeof tag !== 'string') return DEFAULT_LOCALE;
    const c = canon(tag);
    if (!c) return DEFAULT_LOCALE;
    const exact = byLower.get(c);
    if (exact) return exact.code;
    const primary = byLower.get(c.split('-')[0] as string);
    if (primary) return primary.code;
    return DEFAULT_LOCALE;
  };
  const baseLocale = (code: string): string => byLower.get(canon(code))?.base ?? code;
  const baseLanguage = (tag: string | null | undefined): string =>
    baseLocale(normalizeLocale(tag));
  const localeChain = (tag: string | null | undefined): string[] => {
    const chain: string[] = [];
    let cur: string | undefined = normalizeLocale(tag);
    // Bounded walk (mirrors the backend): a misconfigured base cycle must not hang.
    for (let i = 0; cur && i < 8 && !chain.includes(cur); i++) {
      chain.push(cur);
      cur = byLower.get(canon(cur))?.base;
    }
    if (!chain.includes(DEFAULT_LOCALE)) chain.push(DEFAULT_LOCALE);
    return chain;
  };
  return {
    // Exact code only (like the backend): 'ES' / 'es-MX' are normalizable, not supported codes.
    isSupportedLocale: (tag) => typeof tag === 'string' && byLower.get(canon(tag))?.code === tag,
    normalizeLocale,
    baseLocale,
    baseLanguage,
    localeChain,
    nonEnglishLocales: () => registry.map((e) => e.code).filter((c) => c !== DEFAULT_LOCALE),
  };
}

const helpers = createLocaleHelpers(LOCALE_REGISTRY);

export const isSupportedLocale = helpers.isSupportedLocale as (
  tag: unknown
) => tag is SupportedLanguage;
export const normalizeLocale = helpers.normalizeLocale as (
  tag: string | null | undefined
) => SupportedLanguage;
export const baseLocale = helpers.baseLocale as (code: string) => SupportedLanguage;
export const baseLanguage = helpers.baseLanguage as (
  tag: string | null | undefined
) => SupportedLanguage;
export const localeChain = helpers.localeChain as (
  tag: string | null | undefined
) => SupportedLanguage[];
/** Non-English registry locales (each ships as its own lazy chunk / HTML doc). */
export const NON_EN_LOCALES = helpers.nonEnglishLocales() as Exclude<SupportedLanguage, 'en'>[];
