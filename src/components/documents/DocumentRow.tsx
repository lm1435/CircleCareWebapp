import { useId, useMemo, type ReactElement } from 'react';
import { useTranslation } from 'react-i18next';
import type { CircleDocument } from '@/api/documents';
import {
  Badge,
  IconTile,
  MoreMenu,
  careCardBadgeRow,
  careCardMeta,
  careCardShell,
  careCardTitle,
  careCardTopRow,
  type MoreMenuEntry,
} from '@/components/ui';
import { CATEGORY_TONE, categoryBadgeVariant } from './documentIcon';
import { formatFileSize } from './formatFileSize';

export interface DocumentRowProps {
  doc: CircleDocument;
  /** Kept for callers; the viewer (not the row) now fetches signed URLs. */
  circleId: string;
  /**
   * Open the in-app viewer (DocumentPreviewModal) for this document — every
   * type; one the browser can't render shows the viewer's "can't preview"
   * state with Download, as on mobile.
   */
  onPreview: (doc: CircleDocument) => void;
  /**
   * Whether the current user may edit/delete THIS document (uploader or circle
   * owner, AND the circle is editable). When false, the Edit/Delete menu items
   * are omitted entirely. The backend re-checks regardless.
   */
  canManage?: boolean;
  /** Open the metadata edit modal for this document. */
  onEdit?: (doc: CircleDocument) => void;
  /** Open the delete-confirm dialog for this document. */
  onDelete?: (doc: CircleDocument) => void;
}

/**
 * First name only (mobile `DocumentRow.getUploaderName`) — attribution inside
 * a family circle reads fine on a first name, and it is the difference
 * between a meta line that fits and one that truncates.
 */
function getUploaderName(doc: CircleDocument): string {
  const user = doc.uploaded_by_user;
  if (!user) return '';
  if (user.first_name || user.last_name) return user.first_name || user.last_name || '';
  return user.email;
}

/**
 * Single document entry (spec §6.6, care card shell §4.6). Same actions, order
 * and wording as mobile's row (DocumentActionsModal): Open, Edit, Delete — in
 * the trailing `MoreMenu`. The row's name + meta is itself a button that
 * opens the document, as tapping the row does on mobile. Download lives in
 * the viewer's header (mobile's Share), never on the row.
 */
export function DocumentRow({
  doc,
  onPreview,
  canManage = false,
  onEdit,
  onDelete,
}: DocumentRowProps): ReactElement {
  const { t, i18n } = useTranslation('documents');

  // Upload timestamps are UTC ISO; viewer-local display is intended here.
  const uploadedDate = useMemo(
    () =>
      new Intl.DateTimeFormat(i18n.language, { dateStyle: 'medium' }).format(
        new Date(doc.created_at)
      ),
    [doc.created_at, i18n.language]
  );
  const uploaderName = useMemo(() => getUploaderName(doc), [doc]);
  const titleId = useId();
  const metaId = useId();

  const items: MoreMenuEntry[] = [
    {
      id: 'open',
      label: t('open'),
      icon: 'eye-outline',
      onSelect: () => onPreview(doc),
    },
  ];
  if (canManage && onEdit) {
    items.push({
      id: 'edit',
      label: t('editAction'),
      icon: 'create-outline',
      onSelect: () => onEdit(doc),
    });
  }
  if (canManage && onDelete) {
    items.push({ divider: true, id: 'manage-divider' });
    items.push({
      id: 'delete',
      label: t('deleteAction'),
      icon: 'trash-outline',
      danger: true,
      onSelect: () => onDelete(doc),
    });
  }

  return (
    <li className={careCardShell}>
      <div className={careCardTopRow}>
        <IconTile size={36} tone={CATEGORY_TONE[doc.category]} name="document-text-outline" />
        <div className="min-w-0 flex-1">
          {/* Named by the label alone (aria-labelledby), described by the meta
              line — the whole block is the target, the name stays short. */}
          <button
            type="button"
            onClick={() => onPreview(doc)}
            aria-labelledby={titleId}
            aria-describedby={metaId}
            className="block w-full min-w-0 cursor-pointer rounded-md border-0 bg-transparent p-0 text-left"
          >
            <span id={titleId} className={`block truncate ${careCardTitle}`}>
              {doc.label}
            </span>
            <span id={metaId} className={`${careCardMeta}`}>
              <span>{formatFileSize(doc.file_size)}</span>
              <span>·</span>
              <span>{uploadedDate}</span>
              {uploaderName && (
                <>
                  <span>·</span>
                  <span>{uploaderName}</span>
                </>
              )}
            </span>
          </button>
          <div className={careCardBadgeRow}>
            <Badge variant={categoryBadgeVariant(doc.category)} size="sm">
              {t(`categories.${doc.category}`)}
            </Badge>
          </div>
        </div>
        <MoreMenu items={items} label={t('actionsFor', { name: doc.label })} />
      </div>
    </li>
  );
}
