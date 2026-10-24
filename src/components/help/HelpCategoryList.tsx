import type { ReactElement } from 'react';
import { Link } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { Icon, Sheet } from '@/components/ui';
import type { HelpCategoryGroup } from '@/help/content';

/** BROWSE rows: label, muted article count, chevron. Each row links to /help/c/<id>. */
export function HelpCategoryList({
  groups,
  label,
}: {
  groups: HelpCategoryGroup[];
  label: string;
}): ReactElement {
  const { t } = useTranslation('help');
  return (
    <Sheet as="ul" aria-label={label} className="m-0 list-none overflow-hidden p-0">
      {groups.map((group) => {
        const count = t('center.articleCount', { count: group.articles.length });
        return (
          <li key={group.id} className="border-t border-line-2 first:border-t-0">
            <Link
              to={`/help/c/${group.id}`}
              aria-label={`${group.label}, ${count}`}
              className="flex min-h-[44px] items-center gap-3 px-4 py-3 text-ink no-underline transition-colors duration-fast hover:bg-bg-2"
            >
              <span className="min-w-0 flex-1 text-base font-semibold leading-tight text-ink">
                {group.label}
              </span>
              <span className="shrink-0 text-sm text-ink-2">{count}</span>
              <Icon name="chevron-forward" size="row" className="shrink-0 text-ink-3" />
            </Link>
          </li>
        );
      })}
    </Sheet>
  );
}
