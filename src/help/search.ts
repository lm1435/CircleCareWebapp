import type { HelpArticleOut } from './types';

/** Lowercase, strip diacritics, collapse whitespace: "Medicación" matches "medicacion". */
export function normalizeForSearch(value: string): string {
  return value
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .trim();
}

/** Steps plus body text, with markdown link targets dropped so "/help/..." never matches. */
function fullText(article: HelpArticleOut): string {
  const body = (article.body ?? '').replace(/\]\([^)]*\)/g, ']');
  return normalizeForSearch([...(article.steps ?? []), body].join(' '));
}

/**
 * Client-side search over every article, whatever its category: title, keywords,
 * summary, steps and body. Every query word must appear somewhere; a word scores
 * by the best field it hits: title > keywords > summary > steps/body. Stable for
 * ties (content order). Same weights as mobile.
 */
export function searchArticles(articles: HelpArticleOut[], query: string): HelpArticleOut[] {
  const words = normalizeForSearch(query).split(' ').filter(Boolean);
  if (words.length === 0) return [];
  const scored: { article: HelpArticleOut; score: number; index: number }[] = [];
  articles.forEach((article, index) => {
    const title = normalizeForSearch(article.title);
    const keywords = normalizeForSearch((article.keywords ?? []).join(' '));
    const summary = normalizeForSearch(article.summary);
    const text = fullText(article);
    let score = 0;
    for (const word of words) {
      if (title.includes(word)) score += 1000;
      else if (keywords.includes(word)) score += 100;
      else if (summary.includes(word)) score += 10;
      else if (text.includes(word)) score += 1;
      else return; // a word that matches nowhere rejects the article
    }
    scored.push({ article, score, index });
  });
  return scored.sort((a, b) => b.score - a.score || a.index - b.index).map((s) => s.article);
}

/** Bucket for `help_search_used` (the query itself is never sent). */
export type ResultCountBucket = '0' | '1-3' | '4+';

export function resultCountBucket(count: number): ResultCountBucket {
  if (count <= 0) return '0';
  if (count <= 3) return '1-3';
  return '4+';
}
