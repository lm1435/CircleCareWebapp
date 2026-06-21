import type { ReactElement } from 'react';
import { useTranslation } from 'react-i18next';
import { Button } from '@/components/ui';

export interface CardActionsProps {
  onEdit: () => void;
  onDelete: () => void;
  /** Accessible label for the edit button (item-specific). */
  editLabel: string;
  /** Accessible label for the delete button (item-specific). */
  deleteLabel: string;
}

/**
 * Visible per-item Edit / Delete action row for the emergency cards. No
 * long-press — discoverable buttons only (project rule). Hidden in print via
 * `no-print`.
 */
export function CardActions({
  onEdit,
  onDelete,
  editLabel,
  deleteLabel,
}: CardActionsProps): ReactElement {
  const { t } = useTranslation('emergency');
  return (
    <div className="no-print mt-4 flex gap-2">
      <Button variant="ghost" size="md" aria-label={editLabel} onClick={onEdit}>
        {t('edit.edit')}
      </Button>
      <Button variant="ghost" size="md" aria-label={deleteLabel} onClick={onDelete}>
        {t('edit.delete')}
      </Button>
    </div>
  );
}
