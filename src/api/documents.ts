import { z } from 'zod';
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

// ============================================================================
// WRITE TYPES (mirror mobile/src/api/documents.ts + backend Zod schemas in
// backend/src/routes/documents.ts). Plan Task 3.1.
// ============================================================================

export type DocumentFileExtension = 'jpg' | 'jpeg' | 'png' | 'heic' | 'pdf';

/** Accepted file extensions — mirrors backend `ALLOWED_EXTENSIONS`. */
export const DOCUMENT_FILE_EXTENSIONS: readonly DocumentFileExtension[] = [
  'jpg',
  'jpeg',
  'png',
  'heic',
  'pdf',
];

/** Hard per-file upload cap enforced by multer on the backend (10MB). */
export const MAX_DOCUMENT_FILE_BYTES = 10 * 1024 * 1024;

/**
 * Free-tier per-circle storage floor (200MB), mirroring the backend's
 * `FREE_STORAGE_BYTES`. Premium circles get 1GB. The documents list endpoint
 * returns the circle's effective `storage.limit`; when it equals this value the
 * circle is on the free tier (upgrading to Premium raises the cap), otherwise it
 * is already premium (the only remedy is freeing space).
 */
export const FREE_STORAGE_BYTES = 209715200;

/**
 * Multipart upload payload. Unlike mobile (which sends an RN `{ uri, type, name }`
 * descriptor) the web sends a real browser `File` from `<input type="file">`.
 */
export interface UploadDocumentRequest {
  file: File;
  label: string;
  category: DocumentCategory;
  fileExtension: DocumentFileExtension;
  note?: string;
}

export interface UpdateDocumentRequest {
  label?: string;
  category?: DocumentCategory;
  note?: string | null;
}

// ============================================================================
// ZOD — web-side mirror of the backend `createDocumentSchema` /
// `updateDocumentSchema` constraints (backend/src/routes/documents.ts). The
// backend schemas are inline-per-route and not importable, so the field rules
// are duplicated here verbatim. Plan Task 3.2.
// ============================================================================

/**
 * Metadata constraints for the upload/edit forms — mirrors backend exactly:
 *   label:    string, 1–200
 *   category: enum(medical_records|insurance|legal|prescriptions|other)
 *   fileExtension: enum(jpg|jpeg|png|heic|pdf)
 *   note:     string ≤500, optional
 * The `file`/`fileSize` checks are NOT part of this schema (a browser `File`
 * isn't Zod-validatable); use `validateDocumentFile` for those.
 */
export const documentFormSchema = z.object({
  label: z.string().min(1).max(200),
  category: z.enum(['medical_records', 'insurance', 'legal', 'prescriptions', 'other']),
  fileExtension: z.enum(['jpg', 'jpeg', 'png', 'heic', 'pdf']),
  note: z.string().max(500).optional(),
});

export type DocumentFormValues = z.infer<typeof documentFormSchema>;

/** Edit-metadata schema — every field optional (mirrors backend update schema). */
export const documentEditSchema = z.object({
  label: z.string().min(1).max(200).optional(),
  category: z.enum(['medical_records', 'insurance', 'legal', 'prescriptions', 'other']).optional(),
  note: z.string().max(500).nullable().optional(),
});

/** Result of the client-side file guards (size cap + remaining storage). */
export type DocumentFileValidation =
  | { ok: true }
  | { ok: false; reason: 'too_large'; maxBytes: number }
  | { ok: false; reason: 'storage_full'; remainingBytes: number };

/**
 * Client-side file guards usable by the future upload form. Mirrors what the
 * backend enforces (10MB multer cap + total-circle-storage cap), so the user
 * gets immediate feedback before the multipart round-trip. The backend remains
 * the source of truth (402/413), so these are best-effort UX guards only.
 *
 * `storage` is the `{ used, limit }` shape returned by the documents list
 * endpoint (see `StorageUsage`).
 */
export function validateDocumentFile(
  file: File,
  storage: StorageUsage
): DocumentFileValidation {
  if (file.size > MAX_DOCUMENT_FILE_BYTES) {
    return { ok: false, reason: 'too_large', maxBytes: MAX_DOCUMENT_FILE_BYTES };
  }
  const remainingBytes = storage.limit - storage.used;
  if (file.size > remainingBytes) {
    return { ok: false, reason: 'storage_full', remainingBytes };
  }
  return { ok: true };
}

// ============================================================================
// WRITE FUNCTIONS (Plan Task 3.1). Endpoints + multipart contract verified
// against backend/src/routes/documents.ts.
// ============================================================================

/**
 * Upload a document via multipart/form-data straight to the backend
 * (`POST /circles/:circleId/documents/upload`) — NOT the signed-URL flow.
 *
 * MULTIPART: we build a `FormData` with the browser `File` and the metadata
 * fields and let the BROWSER set `Content-Type: multipart/form-data; boundary=…`.
 * We pass `Content-Type: undefined` so axios DELETES the api client's default
 * `application/json` header (it would otherwise be sent with no boundary and the
 * backend's multer parser would reject the body). NEVER hand-set a boundary.
 *
 * Mirrors mobile `uploadDocument` (which appends `file, label, category,
 * fileExtension, note?`); the only difference is the `file` value is a real
 * `File`, not an RN `{ uri, type, name }` descriptor.
 */
export async function uploadDocument(
  circleId: string,
  data: UploadDocumentRequest
): Promise<CircleDocument> {
  const formData = new FormData();
  formData.append('file', data.file);
  formData.append('label', data.label);
  formData.append('category', data.category);
  formData.append('fileExtension', data.fileExtension);
  if (data.note) {
    formData.append('note', data.note);
  }

  const response = (await apiClient.post(`/circles/${circleId}/documents/upload`, formData, {
    headers: { 'Content-Type': undefined },
  })) as unknown as { data: { document: CircleDocument } };
  return response.data.document;
}

/** PATCH /circles/:circleId/documents/:documentId — edit metadata only. */
export async function updateDocument(
  circleId: string,
  documentId: string,
  data: UpdateDocumentRequest
): Promise<CircleDocument> {
  const response = (await apiClient.patch(
    `/circles/${circleId}/documents/${documentId}`,
    data
  )) as unknown as { data: { document: CircleDocument } };
  return response.data.document;
}

/** DELETE /circles/:circleId/documents/:documentId. */
export async function deleteDocument(circleId: string, documentId: string): Promise<void> {
  await apiClient.delete(`/circles/${circleId}/documents/${documentId}`);
}
