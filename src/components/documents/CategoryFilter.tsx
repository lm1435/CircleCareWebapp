import type { ReactElement } from 'react';
import { useTranslation } from 'react-i18next';
import { DOCUMENT_CATEGORIES, type DocumentCategory } from '@/api/documents';

export type CategorySelection = DocumentCategory | 'all';

export interface CategoryFilterProps {
  selected: CategorySelection;
  onSelect: (category: CategorySelection) => void;
}

const OPTIONS: readonly CategorySelection[] = ['all', ...DOCUMENT_CATEGORIES];

/**
 * Chip row category filter (mirrors mobile DocumentsTab's chips).
 * Toggle buttons with aria-pressed — keyboard accessible by default.
 */
export function CategoryFilter({ selected, onSelect }: CategoryFilterProps): ReactElement {
  const { t } = useTranslation('documents');

  return (
    <div
      role="group"
      aria-label={t('filterLabel')}
      className="scrollbar-hide flex gap-2 overflow-x-auto"
    >
      {OPTIONS.map((option) => {
        const isActive = option === selected;
        return (
          <button
            key={option}
            type="button"
            aria-pressed={isActive}
            onClick={() => onSelect(option)}
            className={
              isActive
                ? 'whitespace-nowrap rounded-full border border-ink bg-ink px-4 py-2 text-sm font-medium text-cream'
                : 'whitespace-nowrap rounded-full border border-line bg-cream px-4 py-2 text-sm text-ink-2 hover:border-ink hover:text-ink'
            }
          >
            {t(`categories.${option}`)}
          </button>
        );
      })}
    </div>
  );
}
