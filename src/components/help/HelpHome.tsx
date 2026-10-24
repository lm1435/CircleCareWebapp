import { useEffect, useMemo, useRef, useState, type ReactElement } from 'react';
import { useLocation } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { Text, TextField } from '@/components/ui';
import { Analytics } from '@/lib/analytics';
import { getPopular, groupByCategory } from '@/help/content';
import { resultCountBucket, searchArticles } from '@/help/search';
import { useHelp } from '@/help/useHelp';
import type { HelpOpenSource } from '@/help/types';
import { HelpArticleList } from './HelpArticleList';
import { HelpCategoryList } from './HelpCategoryList';
import { HelpContactCard } from './HelpContactCard';

const OPEN_SOURCES: readonly HelpOpenSource[] = [
  'profile',
  'login',
  'signup',
  'home_card',
  'contextual',
];
const SEARCH_ANALYTICS_DELAY_MS = 800;
const POPULAR_COUNT = 3;

/** Help home: search, Popular, categories (plan "What the user gets"). */
export function HelpHome(): ReactElement | null {
  const { t } = useTranslation('help');
  const location = useLocation();
  const { content, locale, articles } = useHelp();
  const [query, setQuery] = useState('');

  // help_center_opened fires once per visit of the hub. The entry point rides in
  // router state; a direct visit to /help counts as the Profile entry.
  const stateSource = (location.state as { helpSource?: string } | null)?.helpSource;
  const source: HelpOpenSource = OPEN_SOURCES.includes(stateSource as HelpOpenSource)
    ? (stateSource as HelpOpenSource)
    : 'profile';
  useEffect(() => {
    Analytics.helpCenterOpened(source);
    // Once per mount: the entry point cannot change while the hub stays open.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const results = useMemo(() => searchArticles(articles, query), [articles, query]);
  const searching = query.trim().length > 0;

  // help_search_used: debounced, once per distinct settled query, bucket only.
  const lastReported = useRef('');
  useEffect(() => {
    const normalized = query.trim();
    if (!normalized || normalized === lastReported.current) return;
    const timer = window.setTimeout(() => {
      lastReported.current = normalized;
      Analytics.helpSearchUsed(resultCountBucket(results.length));
    }, SEARCH_ANALYTICS_DELAY_MS);
    return () => window.clearTimeout(timer);
  }, [query, results.length]);

  if (articles.length === 0) return null;

  const popular = getPopular(content, locale).slice(0, POPULAR_COUNT);
  const groups = groupByCategory(content, locale);

  return (
    <div className="mt-6 flex flex-col gap-6" data-testid="help-home">
      <TextField
        id="help-search"
        type="search"
        label={t('center.searchLabel')}
        placeholder={t('center.searchLabel')}
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        autoComplete="off"
        enterKeyHint="search"
        rightIcon={searching ? 'close-outline' : undefined}
        rightIconLabel={t('center.clearSearch')}
        onRightIconPress={searching ? () => setQuery('') : undefined}
      />

      {searching ? (
        <section aria-labelledby="help-results-heading">
          <Text variant="label" as="h2" id="help-results-heading" className="uppercase tracking-wide">
            {t('center.results')}
          </Text>
          <p role="status" className="m-0 mt-1 text-sm text-ink-2">
            {results.length === 0
              ? t('center.noResults', { query: query.trim() })
              : t('center.resultsCount', { count: results.length })}
          </p>
          {results.length > 0 && (
            <div className="mt-3">
              <HelpArticleList
                articles={results}
                source="search"
                label={t('center.results')}
                truncateSummary
              />
            </div>
          )}
        </section>
      ) : (
        <>
          {popular.length > 0 && (
            <section aria-labelledby="help-popular-heading">
              <Text variant="label" as="h2" id="help-popular-heading" className="uppercase tracking-wide">
                {t('center.popular')}
              </Text>
              <div className="mt-2">
                <HelpArticleList
                  articles={popular}
                  source="hub"
                  label={t('center.popular')}
                  showSummary={false}
                />
              </div>
            </section>
          )}
          <section aria-labelledby="help-browse-heading">
            <Text variant="label" as="h2" id="help-browse-heading" className="uppercase tracking-wide">
              {t('center.browse')}
            </Text>
            <div className="mt-2">
              <HelpCategoryList groups={groups} label={t('center.browse')} />
            </div>
          </section>
        </>
      )}

      <HelpContactCard />
    </div>
  );
}
