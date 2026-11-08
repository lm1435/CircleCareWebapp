import type { ReactElement } from 'react';
import { Link } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { findArticle } from '@/help/content';
import { useHelp } from '@/help/useHelp';
import { Icon } from '@/components/ui';

export interface HowDoesThisWorkProps {
  /** Article slug from the plan's contextual list. */
  slug: string;
  className?: string;
}

/**
 * Small contextual "How does this work?" link that opens the article directly.
 * Renders nothing when the article is not in the bundled content (so a surface
 * never links to a dead page).
 */
export function HowDoesThisWork({ slug, className }: HowDoesThisWorkProps): ReactElement | null {
  const { t } = useTranslation('help');
  const { content, locale } = useHelp();
  if (!findArticle(content, locale, slug)) return null;
  return (
    // Moss, like mobile's HowDoesThisWorkLink (help-circle glyph + moss label): the one accent,
    // not a second (coral) one. Show it only while its surface is empty — each caller gates it.
    <Link
      to={`/help/${slug}`}
      state={{ helpSource: 'contextual' }}
      data-testid={`how-does-this-work-${slug}`}
      className={`inline-flex min-h-[44px] items-center gap-1.5 text-sm font-medium text-moss underline underline-offset-4${
        className ? ` ${className}` : ''
      }`}
    >
      <Icon name="help-circle-outline" size="inline" />
      {t('center.howDoesThisWork')}
    </Link>
  );
}
