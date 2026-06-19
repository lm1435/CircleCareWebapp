import { useState, type ReactElement } from 'react';
import { useParams } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import type { CircleDocument } from '@/api/documents';
import { CategoryFilter, type CategorySelection } from '@/components/documents/CategoryFilter';
import { DocumentRow } from '@/components/documents/DocumentRow';
import { DocumentPreviewModal } from '@/components/documents/DocumentPreviewModal';
import { formatFileSize } from '@/components/documents/formatFileSize';
import { Button, Card, EmptyState, Skeleton } from '@/components/ui';
import { FolderIcon } from '@/components/ui/emptyStateIcons';
import { useDocuments } from '@/hooks/useDocuments';

const SKELETON_ROWS = [0, 1, 2, 3, 4];

/**
 * Documents page (plan Task 32): category-filtered, newest-first document list
 * with per-row preview/download. Read-only — upload happens in the app.
 */
export default function DocumentsPage(): ReactElement {
  const { circleId = '' } = useParams<{ circleId: string }>();
  const { t } = useTranslation(['documents', 'common']);
  const [category, setCategory] = useState<CategorySelection>('all');
  const [previewDoc, setPreviewDoc] = useState<CircleDocument | null>(null);

  const { documents, storage, isLoading, isError, refetch } = useDocuments(
    circleId,
    category === 'all' ? undefined : category
  );

  return (
    <section className="mx-auto max-w-4xl p-6 md:p-8">
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

      {/* Read-only on web — upload lives in the mobile app */}
      <Card className="mt-6 flex flex-wrap items-baseline gap-x-2 gap-y-1 bg-bg-2 p-4">
        <p className="m-0 text-sm font-medium text-ink">{t('documents:uploadCtaTitle')}</p>
        <p className="m-0 text-sm text-ink-3">{t('documents:uploadCta')}</p>
      </Card>

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
                description={t('documents:noDocumentsHint')}
              />
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
              <DocumentRow key={doc.id} doc={doc} circleId={circleId} onPreview={setPreviewDoc} />
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
    </section>
  );
}
