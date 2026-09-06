import type { ReactElement } from 'react';
import { useTranslation } from 'react-i18next';
import { ChipSelect } from '@/components/ui';
import { DOCUMENT_CATEGORIES, type DocumentCategory } from '@/api/documents';

export type CategorySelection = DocumentCategory | 'all';

export interface CategoryFilterProps {
  selected: CategorySelection;
  onSelect: (category: CategorySelection) => void;
}

const OPTIONS: readonly CategorySelection[] = ['all', ...DOCUMENT_CATEGORIES];

/**
 * Category chip row (spec §6.6; mirrors mobile DocumentsTab's chips). Built on
 * the shared `ChipSelect` primitive (44px pill chips, `role="radiogroup"` of
 * `role="radio"` chips with `aria-checked`) with `allowDeselect={false}`:
 * there is always exactly one selection here ("All" is itself an option, not
 * the absence of one), so clicking the already-selected chip is a no-op
 * rather than clearing it.
 */
export function CategoryFilter({ selected, onSelect }: CategoryFilterProps): ReactElement {
  const { t } = useTranslation('documents');

  return (
    <ChipSelect
      label={t('filterLabel')}
      options={OPTIONS.map((value) => ({ value, label: t(`categories.${value}`) }))}
      value={selected}
      allowDeselect={false}
      onChange={(next) => onSelect((next ?? 'all') as CategorySelection)}
    />
  );
}
