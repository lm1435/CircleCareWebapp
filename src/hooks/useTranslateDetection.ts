import { useEffect, useState } from 'react';
import i18n from '@/i18n';
import { baseLanguage, baseLocale, normalizeLocale, type SupportedLanguage } from '@/i18n/locales';

/**
 * Browser auto-translate detection (Chrome/Edge). When the page is being
 * translated, Chrome adds `translated-ltr` / `translated-rtl` to <html> and
 * sets `lang` to the translate TARGET. That target is a strong signal the
 * user wants a language we may already ship.
 *
 * The app's own `lang` writes (App.tsx `applyLang`) never carry the
 * `translated-*` class, so they never count as translation.
 */

/** Target tag -> shipped locale, or null when it only "matches" via the en fallback. */
export function mapTranslateTarget(tag: string | null | undefined): SupportedLanguage | null {
  if (typeof tag !== 'string') return null;
  const primary = tag.trim().replace(/_/g, '-').toLowerCase().split('-')[0];
  if (!primary) return null;
  const mapped = normalizeLocale(tag);
  // normalizeLocale falls back to 'en' for unshipped tags ('zh'): the mapped
  // base must genuinely equal the tag's primary subtag.
  return baseLocale(mapped).toLowerCase() === primary ? mapped : null;
}

function compute(): SupportedLanguage | null {
  if (typeof document === 'undefined') return null;
  const root = document.documentElement;
  const active =
    root.classList.contains('translated-ltr') || root.classList.contains('translated-rtl');
  if (!active) return null;
  const mapped = mapTranslateTarget(root.lang);
  if (!mapped) return null;
  return baseLanguage(mapped) === baseLanguage(i18n.language) ? null : mapped;
}

export function useTranslateDetection(): { suggested: SupportedLanguage | null } {
  const [suggested, setSuggested] = useState<SupportedLanguage | null>(compute);

  useEffect(() => {
    const update = (): void => setSuggested(compute());
    update();
    let observer: MutationObserver | null = null;
    if (typeof MutationObserver !== 'undefined') {
      observer = new MutationObserver(update);
      observer.observe(document.documentElement, {
        attributes: true,
        attributeFilter: ['class', 'lang'],
      });
    }
    i18n.on('languageChanged', update);
    return () => {
      observer?.disconnect();
      i18n.off('languageChanged', update);
    };
  }, []);

  return { suggested };
}
