import { useCallback, useState, type ReactElement } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { FREE_STORAGE_BYTES, type CircleDocument, type DocumentCategory } from '@/api/documents';
import { CategoryFilter, type CategorySelection } from '@/components/documents/CategoryFilter';
import { DocumentRow } from '@/components/documents/DocumentRow';
import { DocumentStarterKit } from '@/components/documents/DocumentStarterKit';
import { DocumentPreviewModal } from '@/components/documents/DocumentPreviewModal';
import { DocumentUploadModal } from '@/components/documents/DocumentUploadModal';
import { DocumentEditModal } from '@/components/documents/DocumentEditModal';
import { StorageBar } from '@/components/documents/StorageBar';
import {
  Button,
  Card,
  ConfirmDialog,
  EmptyState,
  Skeleton,
  Text,
  careCardListGap,
  useToast,
} from '@/components/ui';
import { PageMasthead } from '@/components/layout/PageMasthead';
import { HealthTabs } from '@/components/layout/HealthTabs';
import { useDocuments, useDeleteDocument } from '@/hooks/useDocuments';
import { useCircle } from '@/hooks/useCircle';
import { useAuthStore } from '@/store/authStore';

const SKELETON_ROWS = [0, 1, 2, 3, 4];

/**
 * Documents page (spec §6.6): category-filtered, newest-first document list
 * with per-row preview/download, plus upload / edit / delete when the
 * requester can edit the circle. Edit/delete on a row are additionally
 * limited to the uploader or the circle owner (mirrors the backend rule); the
 * backend re-checks regardless.
 */
export default function DocumentsPage(): ReactElement {
  const { circleId = '' } = useParams<{ circleId: string }>();
  const { t } = useTranslation(['documents', 'common']);
  const navigate = useNavigate();
  const { showToast } = useToast();
  const [category, setCategory] = useState<CategorySelection>('all');
  const [previewDoc, setPreviewDoc] = useState<CircleDocument | null>(null);
  const [uploadOpen, setUploadOpen] = useState(false);
  /** Starter-kit row that opened the upload form, so it arrives preset. */
  const [uploadPreset, setUploadPreset] = useState<{
    category: DocumentCategory;
    label: string;
  } | null>(null);
  const [editDoc, setEditDoc] = useState<CircleDocument | null>(null);
  const [deleteDoc, setDeleteDoc] = useState<CircleDocument | null>(null);

  const { documents, allDocuments, storage, isLoading, isError, refetch } = useDocuments(
    circleId,
    category === 'all' ? undefined : category
  );

  const { circle, canEdit } = useCircle(circleId);
  const currentUserId = useAuthStore((state) => state.user?.id);
  const ownerId = circle?.owner_id;
  const isOwner = !!currentUserId && ownerId === currentUserId;
  const deleteMutation = useDeleteDocument(circleId);

  // Edit/delete allowed for the uploader or the circle owner, AND only when the
  // circle is editable (view-only / read-only circles hide write affordances).
  const canManage = (doc: CircleDocument): boolean =>
    canEdit && !!currentUserId && (doc.uploaded_by === currentUserId || ownerId === currentUserId);

  const openUpload = useCallback(() => {
    setUploadPreset(null);
    setUploadOpen(true);
  }, []);
  const handleStarterPick = useCallback((pickedCategory: DocumentCategory, label: string) => {
    setUploadPreset({ category: pickedCategory, label });
    setUploadOpen(true);
  }, []);

  // First run (mobile DocumentsTab, 1.1.11): a circle with NO documents gets
  // the starter kit, not a filter row over nothing and a 0% storage meter.
  // Chips appear once there is something to filter — a second category — and
  // the `category` clause is a stranding guard so an active filter can always
  // be cleared whatever the counts say.
  const isFirstRun = !isLoading && !isError && allDocuments.length === 0 && category === 'all';
  const distinctCategories = new Set(allDocuments.map((doc) => doc.category)).size;
  const showChips = !isFirstRun && (distinctCategories > 1 || category !== 'all');

  // Same paywall context mobile's storage-full CTA sends ('feature': a
  // premium-only capability was reached), so both platforms land the event in
  // the same PostHog cohort.
  const handleUpgrade = useCallback(() => {
    navigate('/upgrade', { state: { paywallContext: 'feature' } });
  }, [navigate]);

  // Storage-full gates BOTH upload entry points (mastheard action + empty-state
  // button) — mirrors mobile's DocumentUploadScreen, which disables its upload
  // CTA the same way. The message differs by tier, same as DocumentUploadModal.
  const storageFull = storage.limit - storage.used <= 0;
  const isFreeTier = storage.limit <= FREE_STORAGE_BYTES;
  const storageFullMessage = t(
    isFreeTier ? 'documents:upload.storageFull' : 'documents:upload.storageFullPremium'
  );

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
    <div className="mx-auto w-full max-w-5xl">
      <PageMasthead
        section={t('common:nav.documents')}
        tone="moss"
        title={t('documents:title')}
        subtitle={t('documents:subtitle')}
        rightAction={
          canEdit
            ? {
                name: 'add-outline',
                label: t('documents:upload.openButton'),
                onClick: openUpload,
                disabled: storageFull,
                title: storageFull ? storageFullMessage : undefined,
              }
            : undefined
        }
      >
        <HealthTabs />
      </PageMasthead>

      {!isFirstRun && (
        <div className="px-5">
          <StorageBar
            usedBytes={storage.used}
            limitBytes={storage.limit}
            onUpgrade={handleUpgrade}
            isOwner={isOwner}
          />
        </div>
      )}

      {showChips && (
        <div className="px-5 pt-4">
          <CategoryFilter selected={category} onSelect={setCategory} />
        </div>
      )}

      {!canEdit && (
        <div className="px-5 pt-4">
          <Card className="flex flex-wrap items-baseline gap-x-2 gap-y-1 bg-bg-2 p-4">
            <p className="m-0 text-sm font-medium text-ink">{t('documents:uploadCtaTitle')}</p>
            <p className="m-0 text-sm text-ink-3">{t('documents:uploadCta')}</p>
          </Card>
        </div>
      )}

      <div className="px-5 pb-8 pt-4">
        {/* "0 documents" over the starter kit would restate its premise. */}
        {!isLoading && !isError && !isFirstRun && (
          <Text variant="caption" className="mb-3">
            {t('documents:count', { count: documents.length })}
          </Text>
        )}

        {isLoading && (
          <div role="status" aria-live="polite">
            <span className="sr-only">{t('common:loading')}</span>
            <ul className={`m-0 list-none p-0 ${careCardListGap}`}>
              {SKELETON_ROWS.map((row) => (
                <li key={row}>
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
          <>
            {category === 'all' && canEdit && !storageFull ? (
              <DocumentStarterKit onPick={handleStarterPick} onOther={openUpload} />
            ) : category === 'all' ? (
              <EmptyState
                icon="document-text-outline"
                tone="moss"
                title={t('documents:noDocuments')}
                description={
                  canEdit ? t('documents:noDocumentsHint') : t('documents:noDocumentsHintReadOnly')
                }
                actions={
                  canEdit ? (
                    <div className="flex flex-col items-center gap-2">
                      <Button
                        onClick={openUpload}
                        disabled={storageFull}
                        title={storageFull ? storageFullMessage : undefined}
                      >
                        {t('documents:upload.emptyButton')}
                      </Button>
                      {storageFull && (
                        <Text variant="caption" className="text-terracotta">
                          {storageFullMessage}
                        </Text>
                      )}
                    </div>
                  ) : undefined
                }
              />
            ) : (
              // A category that matched nothing is a filter result, not an
              // empty page — say which, and offer the way out.
              <EmptyState
                icon="document-text-outline"
                tone="moss"
                title={t('documents:emptyCategory.title', {
                  category: t(`documents:categories.${category}`),
                })}
                actions={
                  <Button variant="ghost" onClick={() => setCategory('all')}>
                    {t('documents:emptyCategory.action')}
                  </Button>
                }
              />
            )}
          </>
        )}

        {!isLoading && !isError && documents.length > 0 && (
          <ul className={`m-0 list-none p-0 ${careCardListGap}`}>
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
          initialCategory={uploadPreset?.category}
          initialLabel={uploadPreset?.label}
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
    </div>
  );
}
