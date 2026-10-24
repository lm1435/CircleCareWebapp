import type { ReactElement } from 'react';
import { Link } from 'react-router-dom';
import { Icon, Sheet } from '@/components/ui';
import type { HelpArticleOut, HelpArticleSource } from '@/help/types';

export interface HelpArticleListProps {
  articles: HelpArticleOut[];
  source: HelpArticleSource;
  /** Accessible name of the list. */
  label: string;
  /** Summary line under each title (one line, ellipsised). Default true. */
  showSummary?: boolean;
  /** One-line truncated summaries (search results) instead of wrapping. */
  truncateSummary?: boolean;
}

/** A Sheet of article rows (title + summary), each a real link to the article. */
export function HelpArticleList({
  articles,
  source,
  label,
  showSummary = true,
  truncateSummary = false,
}: HelpArticleListProps): ReactElement {
  return (
    <Sheet as="ul" aria-label={label} className="m-0 list-none overflow-hidden p-0">
      {articles.map((article) => (
        <li key={article.slug} className="border-t border-line-2 first:border-t-0">
          <Link
            to={`/help/${article.slug}`}
            state={{ helpSource: source }}
            className="flex min-h-[44px] items-center gap-3 px-4 py-3 text-ink no-underline transition-colors duration-fast hover:bg-bg-2"
          >
            <span className="flex min-w-0 flex-1 flex-col gap-0.5">
              <span className="text-base font-semibold leading-tight text-ink">{article.title}</span>
              {showSummary && (
                <span
                  className={`text-sm leading-normal text-ink-2${truncateSummary ? ' truncate' : ''}`}
                >
                  {article.summary}
                </span>
              )}
            </span>
            <Icon name="chevron-forward" size="row" className="shrink-0 text-ink-3" />
          </Link>
        </li>
      ))}
    </Sheet>
  );
}
