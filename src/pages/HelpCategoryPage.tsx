import type { ReactElement } from 'react';
import { Helmet } from 'react-helmet-async';
import { Link, useParams } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { EmptyState, Icon, Text } from '@/components/ui';
import { HelpArticleList } from '@/components/help/HelpArticleList';
import { HelpContactCard } from '@/components/help/HelpContactCard';
import { groupByCategory } from '@/help/content';
import { useHelp } from '@/help/useHelp';

/** /help/c/:category — the category's article titles only, then the contact card. */
export default function HelpCategoryPage(): ReactElement {
  const { t } = useTranslation('help');
  const { category } = useParams<{ category: string }>();
  const { content, locale } = useHelp();
  const group = groupByCategory(content, locale).find((g) => g.id === category);

  const backLink = (
    <Link
      to="/help"
      className="mb-4 inline-flex min-h-[44px] items-center gap-1 text-sm font-medium text-coral-deep underline-offset-4 hover:underline"
    >
      <Icon name="chevron-back" size="row" />
      {t('center.allArticles')}
    </Link>
  );

  if (!group) {
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

  return (
    <section className="mx-auto w-full max-w-2xl p-6 md:p-8" data-testid="help-category">
      <Helmet>
        <title>{`${group.label} · CircleCare`}</title>
      </Helmet>
      {backLink}
      <Text variant="editorialTitle" as="h1">
        {group.label}
      </Text>
      <div className="mt-6">
        <HelpArticleList
          articles={group.articles}
          source="hub"
          label={group.label}
          showSummary={false}
        />
      </div>
      <HelpContactCard className="mt-8" />
    </section>
  );
}
