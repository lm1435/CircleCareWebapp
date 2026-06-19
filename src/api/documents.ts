import { apiClient } from '@/lib/api';

// PORT of mobile/src/api/documents.ts (read-only subset for the web companion).
// Endpoint truth (backend/src/routes/documents.ts):
//   GET /circles/:circleId/documents?category=<cat>
//   → { success, data: { documents: [...row, file_url], storage: { used, limit } } }
// `file_url` is a SHORT-LIVED signed Supabase Storage URL (1h TTL for the
// `circle-documents` PHI bucket — see backend/src/utils/signedUrl.ts). There is
// no separate signed-URL endpoint; fresh URLs come from re-calling this list.
//
// SECURITY: signed URLs must never sit in the React Query cache (or any
// persistent store). `getDocuments` strips `file_url` before returning;
// `getFreshSignedUrl` fetches one on demand at click time and the caller keeps
// it in transient component state only. NEVER log labels or URLs.

export type DocumentCategory =
  | 'medical_records'
  | 'insurance'
  | 'legal'
  | 'prescriptions'
  | 'other';

export const DOCUMENT_CATEGORIES: readonly DocumentCategory[] = [
  'medical_records',
  'insurance',
  'legal',
  'prescriptions',
  'other',
];

/** Cache-safe document metadata — deliberately EXCLUDES the signed `file_url`. */
export interface CircleDocument {
  id: string;
  circle_id: string;
  uploaded_by: string;
  label: string;
  category: DocumentCategory;
  note: string | null;
  file_path: string;
  file_type: string; // MIME: image/jpeg | image/png | image/heic | application/pdf
  file_size: number; // bytes
  created_at: string; // UTC ISO timestamp
  updated_at: string;
  uploaded_by_user?: {
    id: string;
    first_name: string | null;
    last_name: string | null;
    email: string;
  };
}

export interface StorageUsage {
  used: number;
  limit: number;
}

export interface DocumentsResponse {
  documents: CircleDocument[];
  storage: StorageUsage;
}

type RawCircleDocument = CircleDocument & { file_url: string | null };

interface DocumentsEnvelope {
  success: boolean;
  data: {
    documents: RawCircleDocument[];
    storage: StorageUsage;
  };
}

async function fetchDocumentsEnvelope(
  circleId: string,
  category?: DocumentCategory
): Promise<DocumentsEnvelope> {
  return (await apiClient.get(`/circles/${circleId}/documents`, {
    params: category ? { category } : undefined,
  })) as unknown as DocumentsEnvelope;
}

/**
 * List a circle's documents. Strips the short-lived signed `file_url` from
 * every row so the result is safe to hold in the React Query cache.
 */
export async function getDocuments(
  circleId: string,
  category?: DocumentCategory
): Promise<DocumentsResponse> {
  const response = await fetchDocumentsEnvelope(circleId, category);
  const documents = response.data.documents.map(({ file_url: _fileUrl, ...meta }) => meta);
  return { documents, storage: response.data.storage };
}

/**
 * Fetch a FRESH short-lived signed URL for one document, on demand (at
 * download/preview click time). Narrows the response with the document's
 * category filter. The returned URL must only live in transient local state.
 */
export async function getFreshSignedUrl(
  circleId: string,
  doc: Pick<CircleDocument, 'id' | 'category'>
): Promise<string> {
  const response = await fetchDocumentsEnvelope(circleId, doc.category);
  const match = response.data.documents.find((d) => d.id === doc.id);
  if (!match?.file_url) {
    throw new Error('SIGNED_URL_UNAVAILABLE');
  }
  return match.file_url;
}
