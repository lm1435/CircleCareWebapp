import { useEffect, type ReactElement } from 'react';
import { Helmet } from 'react-helmet-async';
import { Link, useLocation, useParams } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { Button, Card, EmptyState, Icon, Text } from '@/components/ui';
import { HelpArticleList } from '@/components/help/HelpArticleList';
import { HelpMarkdown } from '@/components/help/HelpMarkdown';
import { HelpVideo } from '@/components/help/HelpVideo';
import { Analytics } from '@/lib/analytics';
import { findArticle, getRelated } from '@/help/content';
import { useHelp } from '@/help/useHelp';
import type { HelpArticleSource } from '@/help/types';

const ARTICLE_SOURCES: readonly HelpArticleSource[] = ['hub', 'search', 'related', 'contextual'];

/** /help/:slug — title, short answer, video, steps, body, related, contact. */
export default function HelpArticlePage(): ReactElement {
  const { t } = useTranslation('help');
  const { slug } = useParams<{ slug: string }>();
  const location = useLocation();
  const { content, locale } = useHelp();
  const article = findArticle(content, locale, slug);

  const stateSource = (location.state as { helpSource?: string } | null)?.helpSource;
  const source: HelpArticleSource = ARTICLE_SOURCES.includes(stateSource as HelpArticleSource)
    ? (stateSource as HelpArticleSource)
    : 'hub';

  const viewedSlug = article?.slug;
  useEffect(() => {
    if (!viewedSlug) return;
    // A contextual entry skips the hub, so it is also the help center's open.
    if (source === 'contextual') Analytics.helpCenterOpened('contextual');
    Analytics.helpArticleViewed({ slug: viewedSlug, source, locale });
    // Per article opened: the entry point is fixed by the navigation that got us here.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [viewedSlug, locale]);

  const backLink = (
    <Link
      to="/help"
      className="mb-4 inline-flex min-h-[44px] items-center gap-1 text-sm font-medium text-coral-deep underline-offset-4 hover:underline"
    >
      <Icon name="chevron-back" size="row" />
      {t('center.allArticles')}
    </Link>
  );

  if (!article) {
    return (
      <section className="mx-auto w-full max-w-2xl p-6 md:p-8">
        <Helmet>
          <title>{`${t('center.notFoundTitle')} · CircleCare`}</title>
        </Helmet>
        {backLink}
        <EmptyState
          icon="help-circle-outline"
          titleAs="h1"
          title={t('center.notFoundTitle')}
          description={t('center.notFoundBody')}
        />
      </section>
    );
  }

  const related = getRelated(content, locale, article);

  return (
    <article className="mx-auto w-full max-w-2xl p-6 md:p-8">
      <Helmet>
        <title>{`${article.title} · CircleCare`}</title>
      </Helmet>
      {backLink}
      <Text variant="editorialTitleCompact" as="h1">
        {article.title}
      </Text>
      <p className="m-0 mt-3 text-md font-medium text-ink">{article.summary}</p>

      {article.video && (
        <div className="mt-5">
          <HelpVideo
            key={article.video.file}
            slug={article.slug}
            title={article.title}
            file={article.video.file}
            poster={article.poster}
          />
        </div>
      )}

      {article.steps && article.steps.length > 0 && (
        <section className="mt-6" aria-labelledby="help-steps-heading">
          <Text variant="h2" as="h2" id="help-steps-heading">
            {t('center.steps')}
          </Text>
          <ol className="m-0 mt-3 flex list-none flex-col gap-3 p-0">
            {article.steps.map((step, i) => (
              <li key={i} className="flex items-start gap-3">
                <span
                  aria-hidden="true"
                  className="flex h-8 w-8 flex-none items-center justify-center rounded-full bg-moss-soft text-sm font-semibold text-moss-deep"
                >
                  {i + 1}
                </span>
                <span className="pt-1 text-base leading-snug text-ink-2">{step}</span>
              </li>
            ))}
          </ol>
        </section>
      )}

      {article.body.trim() && (
        <div className="mt-6">
          <HelpMarkdown source={article.body} />
        </div>
      )}

      {related.length > 0 && (
        <section className="mt-8" aria-labelledby="help-related-heading">
          <Text variant="h2" as="h2" id="help-related-heading">
            {t('center.related')}
          </Text>
          <div className="mt-3">
            <HelpArticleList articles={related} source="related" label={t('center.related')} />
          </div>
        </section>
      )}

      <Card variant="filled" padding="lg" className="mt-8">
        <Text variant="h3" as="h2">
          {t('center.stillNeedHelp')}
        </Text>
        <Button as="a" href={`mailto:${t('contact.email')}`} variant="primary" className="mt-4">
          {t('contact.cta')}
        </Button>
      </Card>
    </article>
  );
}
