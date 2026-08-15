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
  return language?.startsWith('es') ? `${base}/es/${page}` : `${base}/${page}`;
}
