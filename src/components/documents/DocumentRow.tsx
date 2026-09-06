import { useMemo, useState, type ReactElement } from 'react';
import { useTranslation } from 'react-i18next';
import { getFreshSignedUrl, type CircleDocument } from '@/api/documents';
import {
  Badge,
  IconTile,
  MoreMenu,
  useToast,
  careCardBadgeRow,
  careCardMeta,
  careCardShell,
  careCardTitle,
  careCardTopRow,
  type MoreMenuEntry,
} from '@/components/ui';
import { buildDownloadFileName, triggerSignedUrlDownload } from './downloadFile';
import { CATEGORY_TONE, categoryBadgeVariant } from './documentIcon';
import { formatFileSize } from './formatFileSize';

export interface DocumentRowProps {
  doc: CircleDocument;
  circleId: string;
  /** Open the preview modal for this document (images + PDFs only). */
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

// Browsers can render JPEG/PNG and (natively or via fallback) PDFs.
// HEIC is not renderable in any mainstream browser → download only.
const PREVIEWABLE_TYPES = new Set(['image/jpeg', 'image/png', 'application/pdf']);

export function isPreviewable(fileType: string): boolean {
  return PREVIEWABLE_TYPES.has(fileType);
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
 * Single document entry (spec §6.6, care card shell §4.6). Preview (when
 * renderable), Download, Edit, and Delete all live behind the trailing
 * `MoreMenu` rather than inline row buttons. Download fetches a FRESH signed
 * URL at click time — never a cached one.
 */
export function DocumentRow({
  doc,
  circleId,
  onPreview,
  canManage = false,
  onEdit,
  onDelete,
}: DocumentRowProps): ReactElement {
  const { t, i18n } = useTranslation('documents');
  const { showToast } = useToast();
  const [isDownloading, setIsDownloading] = useState(false);

  // Upload timestamps are UTC ISO; viewer-local display is intended here.
  const uploadedDate = useMemo(
    () =>
      new Intl.DateTimeFormat(i18n.language, { dateStyle: 'medium' }).format(
        new Date(doc.created_at)
      ),
    [doc.created_at, i18n.language]
  );
  const uploaderName = useMemo(() => getUploaderName(doc), [doc]);

  const handleDownload = async (): Promise<void> => {
    if (isDownloading) return;
    setIsDownloading(true);
    try {
      const signedUrl = await getFreshSignedUrl(circleId, doc);
      triggerSignedUrlDownload(signedUrl, buildDownloadFileName(doc));
    } catch {
      // Never log document names or URLs.
      showToast(t('downloadFailed'), 'error');
    } finally {
      setIsDownloading(false);
    }
  };

  const items: MoreMenuEntry[] = [];
  if (isPreviewable(doc.file_type)) {
    items.push({
      id: 'preview',
      label: t('preview'),
      icon: 'eye-outline',
      onSelect: () => onPreview(doc),
    });
  }
  items.push({
    id: 'download',
    label: t('download'),
    icon: 'download-outline',
    onSelect: () => void handleDownload(),
  });
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
          <p className={`m-0 truncate ${careCardTitle}`}>{doc.label}</p>
          <p className={`m-0 ${careCardMeta}`}>
            <span>{formatFileSize(doc.file_size)}</span>
            <span>·</span>
            <span>{uploadedDate}</span>
            {uploaderName && (
              <>
                <span>·</span>
                <span>{uploaderName}</span>
              </>
            )}
          </p>
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
