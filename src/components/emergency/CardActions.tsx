import type { ReactElement } from 'react';
import { useTranslation } from 'react-i18next';
import { MoreMenu } from '@/components/ui';

export interface CardActionsProps {
  onEdit: () => void;
  onDelete: () => void;
  /** Item display name — builds the trigger's accessible label ("Actions for Dr. Chen"). */
  name: string;
  /** Accessible label for the Edit item (item-specific, e.g. "Edit doctor Dr. Chen"). */
  editLabel: string;
  /** Accessible label for the Delete item (item-specific, e.g. "Delete doctor Dr. Chen"). */
  deleteLabel: string;
}

/**
 * Per-item overflow menu (spec §6.6): the two always-visible Edit/Delete
 * pills collapse into a single 44px `ellipsis-horizontal` `MoreMenu` trigger,
 * right-aligned in the card's header row. Hidden in print (`no-print` +
 * `data-print-hide`).
 */
export function CardActions({
  onEdit,
  onDelete,
  name,
  editLabel,
  deleteLabel,
}: CardActionsProps): ReactElement {
  const { t } = useTranslation('emergency');
  return (
    <div className="no-print" data-print-hide>
      <MoreMenu
        label={t('edit.itemActionsAria', { name })}
        items={[
          { id: 'edit', label: editLabel, icon: 'create-outline', onSelect: onEdit },
          { id: 'delete', label: deleteLabel, icon: 'trash-outline', danger: true, onSelect: onDelete },
        ]}
      />
    </div>
  );
}
