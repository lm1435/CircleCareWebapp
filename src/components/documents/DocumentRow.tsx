import { useMemo, useState, type ReactElement } from 'react';
import { useTranslation } from 'react-i18next';
import { getFreshSignedUrl, type CircleDocument } from '@/api/documents';
import { Badge, Button, useToast } from '@/components/ui';
import { buildDownloadFileName, triggerSignedUrlDownload } from './downloadFile';
import { categoryTileClass, DocumentIcon } from './documentIcon';
import { formatFileSize } from './formatFileSize';

export interface DocumentRowProps {
  doc: CircleDocument;
  circleId: string;
  /** Open the preview modal for this document (images + PDFs only). */
  onPreview: (doc: CircleDocument) => void;
  /**
   * Whether the current user may edit/delete THIS document (uploader or circle
   * owner, AND the circle is editable). When false, the edit/delete buttons are
   * hidden. The backend re-checks regardless.
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
 * Single document entry (plan Task 33): label, category badge, upload date,
 * human file size, preview (when renderable) + download actions.
 * Download fetches a FRESH signed URL at click time — never a cached one.
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

  return (
    <li className="flex flex-wrap items-center gap-x-4 gap-y-2 border-b border-line-2 py-4 last:border-b-0">
      {/* Category/MIME icon tile — never an image thumbnail (signed URLs are
          fetched on demand at click time and never held at rest). */}
      <span
        aria-hidden="true"
        className={`inline-flex h-11 w-11 shrink-0 items-center justify-center rounded-xl ${categoryTileClass[doc.category]}`}
      >
        <DocumentIcon category={doc.category} fileType={doc.file_type} />
      </span>
      <div className="min-w-0 flex-1">
        <p className="m-0 truncate text-base font-medium text-ink">{doc.label}</p>
        <p className="m-0 mt-1 flex flex-wrap items-center gap-2 text-sm text-ink-3">
          <Badge variant="moss">{t(`categories.${doc.category}`)}</Badge>
          <span>{t('uploadedOn', { date: uploadedDate })}</span>
          <span aria-hidden="true">&middot;</span>
          <span>{formatFileSize(doc.file_size)}</span>
        </p>
      </div>
      <div className="flex shrink-0 items-center gap-2">
        {isPreviewable(doc.file_type) && (
          <Button
            variant="ghost"
            aria-label={t('previewDocument', { name: doc.label })}
            onClick={() => onPreview(doc)}
          >
            {t('preview')}
          </Button>
        )}
        <Button
          variant="ghost"
          aria-label={t('downloadDocument', { name: doc.label })}
          aria-busy={isDownloading}
          disabled={isDownloading}
          onClick={() => void handleDownload()}
        >
          {isDownloading ? t('downloading') : t('download')}
        </Button>
        {canManage && onEdit && (
          <Button
            variant="ghost"
            aria-label={t('editDocument', { name: doc.label })}
            onClick={() => onEdit(doc)}
          >
            {t('editAction')}
          </Button>
        )}
        {canManage && onDelete && (
          <Button
            variant="ghost"
            aria-label={t('deleteDocument', { name: doc.label })}
            onClick={() => onDelete(doc)}
          >
            {t('deleteAction')}
          </Button>
        )}
      </div>
    </li>
  );
}
