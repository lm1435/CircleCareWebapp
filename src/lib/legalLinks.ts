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
 * Locales the MARKETING SITE (CircleCareWeb) actually mirrors under /<locale>/.
 * Only Spanish today: there is no /fr, /fr-CA, /de, /it, /pt or /pt-PT page, so those
 * app languages link the ENGLISH legal page rather than a 404. Add a code here only
 * once circlecare.app serves /<code>/terms and /<code>/privacy (mobile twin:
 * `mobile/src/utils/legalLinks.ts`, same list).
 */
export const LEGAL_MIRROR_LOCALES: readonly string[] = ['es'];

export function legalUrl(page: 'terms' | 'privacy', language: string | undefined): string {
  const base = 'https://circlecare.app';
  const locale = normalizeLocale(language);
  // English is the unprefixed default; a registry locale gets its /<locale>/ path only
  // when the marketing mirror exists, otherwise the English page.
  return locale !== DEFAULT_LOCALE && LEGAL_MIRROR_LOCALES.includes(locale)
    ? `${base}/${locale}/${page}`
    : `${base}/${page}`;
}
