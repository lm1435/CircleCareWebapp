import { DEFAULT_LOCALE, normalizeLocale } from '@/i18n/locales';

/**
 * Locale-aware links to the hosted legal pages.
 *
 * Full Spanish versions exist at /es/terms and /es/privacy, but every surface
 * used to hard-code the English URL regardless of the active locale — so a
 * Spanish-speaking user tapping "Política de Privacidad" landed on the English
 * policy.
 */
/**
 * Locales the MARKETING SITE (CircleCareWeb) mirrors under /<locale>/terms and
 * /<locale>/privacy: Spanish, plus French, Canadian French, German, Italian,
 * Brazilian and European Portuguese since 2026-10-10. Deploy CircleCareWeb BEFORE
 * this webapp, or these links 404. Unlisted locales link the ENGLISH page (mobile
 * twin: `mobile/src/utils/legalLinks.ts`, same list).
 */
export const LEGAL_MIRROR_LOCALES: readonly string[] = ['es', 'fr', 'fr-CA', 'de', 'it', 'pt', 'pt-PT'];

export function legalUrl(page: 'terms' | 'privacy', language: string | undefined): string {
  const base = 'https://circlecare.app';
  const locale = normalizeLocale(language);
  // English is the unprefixed default; a registry locale gets its /<locale>/ path only
  // when the marketing mirror exists, otherwise the English page.
  return locale !== DEFAULT_LOCALE && LEGAL_MIRROR_LOCALES.includes(locale)
    ? `${base}/${locale}/${page}`
    : `${base}/${page}`;
}
