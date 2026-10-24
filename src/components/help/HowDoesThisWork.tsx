import type { ReactElement } from 'react';
import { Link } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { findArticle } from '@/help/content';
import { useHelp } from '@/help/useHelp';

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
    <Link
      to={`/help/${slug}`}
      state={{ helpSource: 'contextual' }}
      className={`inline-flex min-h-[44px] items-center text-sm font-medium text-coral-deep underline underline-offset-4${
        className ? ` ${className}` : ''
      }`}
    >
      {t('center.howDoesThisWork')}
    </Link>
  );
}
