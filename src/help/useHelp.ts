import { useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { getBundledHelpContent, getArticles, pickHelpLocale } from './content';
import type { HelpArticleOut, HelpContent, HelpLocale } from './types';

export interface UseHelp {
  content: HelpContent;
  locale: HelpLocale;
  articles: HelpArticleOut[];
}

export function useHelp(): UseHelp {
  const { i18n } = useTranslation();
  const locale = pickHelpLocale(i18n.resolvedLanguage ?? i18n.language);
  const content = getBundledHelpContent();
  const articles = useMemo(() => getArticles(content, locale), [content, locale]);
  return { content, locale, articles };
}
