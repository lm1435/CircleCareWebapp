import { useState, type ReactElement } from 'react';
import { useParams } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import type { CircleDocument } from '@/api/documents';
import { CategoryFilter, type CategorySelection } from '@/components/documents/CategoryFilter';
import { DocumentRow } from '@/components/documents/DocumentRow';
import { DocumentPreviewModal } from '@/components/documents/DocumentPreviewModal';
import { DocumentUploadModal } from '@/components/documents/DocumentUploadModal';
import { DocumentEditModal } from '@/components/documents/DocumentEditModal';
import { formatFileSize } from '@/components/documents/formatFileSize';
import { Button, Card, ConfirmDialog, EmptyState, Skeleton, useToast } from '@/components/ui';
import { FolderIcon } from '@/components/ui/emptyStateIcons';
import { useDocuments, useDeleteDocument } from '@/hooks/useDocuments';
import { useCircle } from '@/hooks/useCircle';
import { useAuthStore } from '@/store/authStore';

const SKELETON_ROWS = [0, 1, 2, 3, 4];

/**
 * Documents page (plan Tasks 32 + 3.4/3.5): category-filtered, newest-first
 * document list with per-row preview/download, plus upload / edit / delete when
 * the requester can edit the circle. Edit/delete on a row are additionally
 * limited to the uploader or the circle owner (mirrors the backend rule); the
 * backend re-checks regardless.
 */
export default function DocumentsPage(): ReactElement {
  const { circleId = '' } = useParams<{ circleId: string }>();
  const { t } = useTranslation(['documents', 'common']);
  const { showToast } = useToast();
  const [category, setCategory] = useState<CategorySelection>('all');
  const [previewDoc, setPreviewDoc] = useState<CircleDocument | null>(null);
  const [uploadOpen, setUploadOpen] = useState(false);
  const [editDoc, setEditDoc] = useState<CircleDocument | null>(null);
  const [deleteDoc, setDeleteDoc] = useState<CircleDocument | null>(null);

  const { documents, storage, isLoading, isError, refetch } = useDocuments(
    circleId,
    category === 'all' ? undefined : category
  );

  const { circle, canEdit } = useCircle(circleId);
  const currentUserId = useAuthStore((state) => state.user?.id);
  const ownerId = circle?.owner_id;
  const deleteMutation = useDeleteDocument(circleId);

  // Edit/delete allowed for the uploader or the circle owner, AND only when the
  // circle is editable (view-only / read-only circles hide write affordances).
  const canManage = (doc: CircleDocument): boolean =>
    canEdit && !!currentUserId && (doc.uploaded_by === currentUserId || ownerId === currentUserId);

  const storageFull = storage.limit - storage.used <= 0;

  const handleConfirmDelete = (): void => {
    if (!deleteDoc || deleteMutation.isPending) return;
    deleteMutation.mutate(deleteDoc.id, {
      onSuccess: () => {
        showToast(t('documents:delete.success'), 'success');
        setDeleteDoc(null);
      },
      // Hook onError surfaces the toast; keep dialog open for retry.
    });
  };

  return (
    <section className="mx-auto max-w-5xl p-6 md:p-8">
      <header className="flex flex-wrap items-baseline justify-between gap-2">
        <h1 className="serif m-0 text-xl text-ink">{t('documents:title')}</h1>
        {!isLoading && !isError && (
          <p className="m-0 text-sm text-ink-3">
            {t('documents:count', { count: documents.length })}
            <span aria-hidden="true"> &middot; </span>
            {t('documents:storageUsed', {
              used: formatFileSize(storage.used),
              limit: formatFileSize(storage.limit),
            })}
          </p>
        )}
      </header>

      <div className="mt-6">
        <CategoryFilter selected={category} onSelect={setCategory} />
      </div>

      {/* Upload (when the requester can edit) or the app-only CTA otherwise. */}
      {canEdit ? (
        <div className="mt-6 flex flex-wrap items-center justify-between gap-3">
          <p className="m-0 text-sm text-ink-3">
            {t('documents:upload.storageRemaining', {
              remaining: formatFileSize(Math.max(0, storage.limit - storage.used)),
            })}
          </p>
          <Button onClick={() => setUploadOpen(true)} disabled={storageFull}>
            {t('documents:upload.openButton')}
          </Button>
        </div>
      ) : (
        <Card className="mt-6 flex flex-wrap items-baseline gap-x-2 gap-y-1 bg-bg-2 p-4">
          <p className="m-0 text-sm font-medium text-ink">{t('documents:uploadCtaTitle')}</p>
          <p className="m-0 text-sm text-ink-3">{t('documents:uploadCta')}</p>
        </Card>
      )}

      <div className="mt-6">
        {isLoading && (
          <div role="status" aria-live="polite">
            <span className="sr-only">{t('common:loading')}</span>
            <ul className="m-0 list-none p-0">
              {SKELETON_ROWS.map((row) => (
                <li key={row} className="border-b border-line-2 py-4 last:border-b-0">
                  <Skeleton className="h-5 w-1/2 max-w-64" />
                  <Skeleton className="mt-2 h-4 w-2/3 max-w-80" />
                </li>
              ))}
            </ul>
          </div>
        )}

        {isError && (
          <Card className="text-center">
            <p className="m-0 font-medium text-ink">{t('documents:errorTitle')}</p>
            <p className="m-0 mt-1 text-sm text-ink-3">{t('documents:errorHint')}</p>
            <Button variant="ghost" className="mt-4" onClick={() => void refetch()}>
              {t('common:retry')}
            </Button>
          </Card>
        )}

        {!isLoading && !isError && documents.length === 0 && (
          <Card className="p-8">
            {category === 'all' ? (
              <EmptyState
                tone="clay"
                icon={<FolderIcon />}
                title={t('documents:noDocuments')}
                description={
                  canEdit
                    ? t('documents:noDocumentsHint')
                    : t('documents:noDocumentsHintReadOnly')
                }
              >
                {canEdit && (
                  <Button onClick={() => setUploadOpen(true)} disabled={storageFull}>
                    {t('documents:upload.openButton')}
                  </Button>
                )}
              </EmptyState>
            ) : (
              <EmptyState
                tone="clay"
                icon={<FolderIcon />}
                title={t('documents:noCategoryDocuments')}
              />
            )}
          </Card>
        )}

        {!isLoading && !isError && documents.length > 0 && (
          <ul className="m-0 list-none p-0">
            {documents.map((doc) => (
              <DocumentRow
                key={doc.id}
                doc={doc}
                circleId={circleId}
                onPreview={setPreviewDoc}
                canManage={canManage(doc)}
                onEdit={setEditDoc}
                onDelete={setDeleteDoc}
              />
            ))}
          </ul>
        )}
      </div>

      {previewDoc && (
        <DocumentPreviewModal
          doc={previewDoc}
          circleId={circleId}
          onClose={() => setPreviewDoc(null)}
        />
      )}

      {uploadOpen && (
        <DocumentUploadModal
          circleId={circleId}
          storage={storage}
          canEdit={canEdit}
          onClose={() => setUploadOpen(false)}
        />
      )}

      {editDoc && (
        <DocumentEditModal circleId={circleId} doc={editDoc} onClose={() => setEditDoc(null)} />
      )}

      {deleteDoc && (
        <ConfirmDialog
          title={t('documents:delete.title')}
          message={t('documents:delete.message', { name: deleteDoc.label })}
          confirmLabel={
            deleteMutation.isPending ? t('documents:delete.deleting') : t('documents:delete.confirm')
          }
          cancelLabel={t('common:cancel')}
          destructive
          confirmDisabled={deleteMutation.isPending}
          onConfirm={handleConfirmDelete}
          onCancel={() => setDeleteDoc(null)}
        />
      )}
    </section>
  );
}
