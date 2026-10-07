import { DEFAULT_LOCALE, normalizeLocale } from '@/i18n/locales';

/**
 * Locale-aware links to the hosted legal pages.
 *
 * Full Spanish versions exist at /es/terms and /es/privacy, but every surface
 * used to hard-code the English URL regardless of the active locale — so a
 * Spanish-speaking user tapping "Política de Privacidad" landed on the English
 * policy.
 */
export function legalUrl(page: 'terms' | 'privacy', language: string | undefined): string {
  const base = 'https://circlecare.app';
  const locale = normalizeLocale(language);
  // English is the unprefixed default; every other registry locale lives under
  // /<locale>/ (the marketing site must carry that mirror before a locale ships).
  return locale === DEFAULT_LOCALE ? `${base}/${page}` : `${base}/${locale}/${page}`;
}
