import { baseLanguage } from '@/i18n/locales';
import type { HelpArticleOut, HelpContent, HelpLocale } from './types';

/**
 * Bundled help content. `content.json` is generated (see ./types.ts) and may be
 * absent in a checkout where the export has not run yet: `import.meta.glob`
 * resolves to nothing instead of failing the build, and help degrades to an
 * empty hub rather than crashing the app.
 */
const modules = import.meta.glob<{ default: HelpContent }>('./content.json', { eager: true });

export const EMPTY_HELP_CONTENT: HelpContent = {
  generated: '',
  categories: [],
  popular: [],
  articles: { en: [], es: [] },
};

export function getBundledHelpContent(): HelpContent {
  const mod = Object.values(modules)[0];
  return mod?.default ?? EMPTY_HELP_CONTENT;
}

/** es -> es; every other app language shows the English articles (plan). */
const HELP_LOCALE_BY_BASE: Record<string, HelpLocale> = { es: 'es' };

export function pickHelpLocale(language: string | undefined | null): HelpLocale {
  return HELP_LOCALE_BY_BASE[baseLanguage(language ?? '')] ?? 'en';
}

export function getArticles(content: HelpContent, locale: HelpLocale): HelpArticleOut[] {
  return content.articles[locale] ?? content.articles.en ?? [];
}

export function findArticle(
  content: HelpContent,
  locale: HelpLocale,
  slug: string | undefined
): HelpArticleOut | undefined {
  if (!slug) return undefined;
  return getArticles(content, locale).find((a) => a.slug === slug);
}

/** Popular slugs resolved to articles, dropping any slug with no article. */
export function getPopular(content: HelpContent, locale: HelpLocale): HelpArticleOut[] {
  const all = getArticles(content, locale);
  return content.popular
    .map((slug) => all.find((a) => a.slug === slug))
    .filter((a): a is HelpArticleOut => a !== undefined);
}

export interface HelpCategoryGroup {
  id: string;
  label: string;
  articles: HelpArticleOut[];
}

/** Categories in content order, each with its articles; empty categories are dropped. */
export function groupByCategory(content: HelpContent, locale: HelpLocale): HelpCategoryGroup[] {
  const all = getArticles(content, locale);
  return content.categories
    .map((c) => ({
      id: c.id,
      label: c.label[locale] ?? c.label.en,
      articles: all.filter((a) => a.category === c.id),
    }))
    .filter((g) => g.articles.length > 0);
}

export function getRelated(
  content: HelpContent,
  locale: HelpLocale,
  article: HelpArticleOut
): HelpArticleOut[] {
  const all = getArticles(content, locale);
  return article.related
    .map((slug) => all.find((a) => a.slug === slug))
    .filter((a): a is HelpArticleOut => a !== undefined);
}
