import { useMemo } from 'react';
import {
  useMutation,
  useQuery,
  useQueryClient,
  type UseMutationResult,
  type UseQueryResult,
} from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import {
  deleteDocument,
  getDocuments,
  updateDocument,
  uploadDocument,
  type CircleDocument,
  type DocumentCategory,
  type DocumentsResponse,
  type StorageUsage,
  type UpdateDocumentRequest,
  type UploadDocumentRequest,
} from '@/api/documents';
import { queryKeys } from '@/lib/queryKeys';
import {
  isPermissionDeniedError,
  isStorageFullError,
  isSubscriptionRequiredError,
} from '@/lib/apiErrors';
import { useToast } from '@/components/ui';
import { usePremiumGate } from '@/hooks/usePremiumGate';
import { Analytics } from '@/lib/analytics';

// Mirrors mobile/src/hooks/useDocuments.ts: fetch the full (unfiltered) list
// under the per-circle key and filter by category client-side, so switching
// category chips is instant and the cache shape matches mobile 1:1.
// The cached payload contains NO signed URLs (stripped in api/documents.ts).

const EMPTY_DOCS: CircleDocument[] = [];
const DEFAULT_STORAGE: StorageUsage = { used: 0, limit: 209715200 }; // 200MB free tier floor

export interface UseDocumentsResult {
  /** Filtered by `category` (when given) and sorted newest first. */
  documents: CircleDocument[];
  storage: StorageUsage;
}

export function useDocuments(
  circleId: string,
  category?: DocumentCategory
): UseQueryResult<DocumentsResponse> & UseDocumentsResult {
  const query = useQuery({
    queryKey: queryKeys.documents(circleId),
    queryFn: () => getDocuments(circleId),
    enabled: !!circleId,
  });

  const allDocs = query.data?.documents ?? EMPTY_DOCS;

  const documents = useMemo(() => {
    const filtered = category ? allDocs.filter((doc) => doc.category === category) : allDocs;
    // Backend orders newest-first already; sort defensively (ISO strings sort lexically).
    return [...filtered].sort((a, b) => b.created_at.localeCompare(a.created_at));
  }, [allDocs, category]);

  return {
    ...query,
    documents,
    storage: query.data?.storage ?? DEFAULT_STORAGE,
  };
}

// ============================================================================
// WRITE HOOKS (Plan Task 3.3). Mirror the shipped mutation pattern in
// useMedConfirmation.ts: mutationFn → onSuccess invalidates queryKeys.documents
// → onError classifies the rejection via lib/apiErrors so the future UI can
// show distinct messages.
// ============================================================================

/**
 * Shared onError for document mutations. The freemium caps are surfaced
 * DISTINCTLY so the UI can show different copy:
 *   - 402 SUBSCRIPTION_REQUIRED → free circle hit the 200MB floor → "open the
 *     app to upgrade" (web cannot transact).
 *   - 413 STORAGE_LIMIT_EXCEEDED → premium circle hit the 1GB hard cap →
 *     "storage full" (nothing to upgrade to).
 *   - other 403 (membership / uploader-owner) → "no permission" + refetch flags.
 *   - everything else → generic save-failed.
 * Returns the i18n key it surfaced so callers/tests can branch on it too.
 */
function useDocumentMutationOnError(circleId: string): (error: unknown) => void {
  const queryClient = useQueryClient();
  const { showToast } = useToast();
  const { promptUpgrade } = usePremiumGate();
  const { t } = useTranslation('documents');

  return (error: unknown) => {
    if (isStorageFullError(error)) {
      // Premium 1GB cap — no upgrade path. Distinct from the 402 free-tier path.
      showToast(t('errors.storageFull'), 'error');
    } else if (isSubscriptionRequiredError(error)) {
      // Free-tier 200MB cap — web cannot transact, point at the app to upgrade.
      promptUpgrade();
      void queryClient.invalidateQueries({ queryKey: queryKeys.circles });
    } else if (isPermissionDeniedError(error)) {
      showToast(t('errors.permissionDenied'), 'error');
      void queryClient.invalidateQueries({ queryKey: queryKeys.circles });
    } else {
      showToast(t('errors.saveFailed'), 'error');
      void queryClient.invalidateQueries({ queryKey: queryKeys.documents(circleId) });
    }
  };
}

/**
 * POST /circles/:circleId/documents/upload (multipart). Invalidates the
 * per-circle documents list so the new row + updated storage usage appear.
 */
export function useUploadDocument(
  circleId: string
): UseMutationResult<CircleDocument, unknown, UploadDocumentRequest> {
  const queryClient = useQueryClient();
  const onError = useDocumentMutationOnError(circleId);

  return useMutation({
    mutationFn: (data: UploadDocumentRequest) => uploadDocument(circleId, data),
    onSuccess: (_document, variables) => {
      // PHI-safe: only circle_id, the category enum, and the file extension —
      // never the document label or note text.
      Analytics.documentUploaded(circleId, variables.category, variables.fileExtension);
      void queryClient.invalidateQueries({ queryKey: queryKeys.documents(circleId) });
    },
    onError,
  });
}

export interface UpdateDocumentVariables {
  documentId: string;
  data: UpdateDocumentRequest;
}

/** PATCH /circles/:circleId/documents/:documentId — edit metadata only. */
export function useUpdateDocument(
  circleId: string
): UseMutationResult<CircleDocument, unknown, UpdateDocumentVariables> {
  const queryClient = useQueryClient();
  const onError = useDocumentMutationOnError(circleId);

  return useMutation({
    mutationFn: ({ documentId, data }: UpdateDocumentVariables) =>
      updateDocument(circleId, documentId, data),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: queryKeys.documents(circleId) });
    },
    onError,
  });
}

/** DELETE /circles/:circleId/documents/:documentId. */
export function useDeleteDocument(circleId: string): UseMutationResult<void, unknown, string> {
  const queryClient = useQueryClient();
  const onError = useDocumentMutationOnError(circleId);

  return useMutation({
    mutationFn: (documentId: string) => deleteDocument(circleId, documentId),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: queryKeys.documents(circleId) });
    },
    onError,
  });
}
