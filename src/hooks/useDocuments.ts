import { useMemo } from 'react';
import { useQuery, type UseQueryResult } from '@tanstack/react-query';
import {
  getDocuments,
  type CircleDocument,
  type DocumentCategory,
  type DocumentsResponse,
  type StorageUsage,
} from '@/api/documents';
import { queryKeys } from '@/lib/queryKeys';

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
