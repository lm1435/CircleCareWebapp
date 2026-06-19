import type { CircleDocument } from '@/api/documents';

const MIME_TO_EXTENSION: Record<string, string> = {
  'image/jpeg': 'jpg',
  'image/png': 'png',
  'image/heic': 'heic',
  'application/pdf': 'pdf',
};

/** Build a safe download filename from the document label + MIME type. */
export function buildDownloadFileName(doc: Pick<CircleDocument, 'label' | 'file_type' | 'file_path'>): string {
  // Strip path separators / reserved filename characters from the label.
  const base = doc.label.replace(/[\\/:*?"<>|]/g, '-').trim() || 'document';
  const fromPath = doc.file_path.split('.').pop()?.toLowerCase() ?? '';
  const extension =
    MIME_TO_EXTENSION[doc.file_type] ?? (/^[a-z0-9]{1,5}$/.test(fromPath) ? fromPath : 'bin');
  return `${base}.${extension}`;
}

/**
 * Trigger a browser download of a freshly issued signed URL via a temporary
 * anchor element (NEVER window.open). Appends Supabase Storage's `download`
 * query param so the response carries `Content-Disposition: attachment`
 * (the `download` attribute alone is ignored for cross-origin URLs).
 * The signed URL never enters our app's history or any persistent store.
 */
export function triggerSignedUrlDownload(signedUrl: string, filename: string): void {
  let href = signedUrl;
  try {
    const url = new URL(signedUrl);
    url.searchParams.set('download', filename);
    href = url.toString();
  } catch {
    // Malformed URL — fall back to the raw value; the anchor will no-op safely.
  }

  const anchor = document.createElement('a');
  anchor.href = href;
  anchor.download = filename;
  anchor.rel = 'noopener';
  anchor.style.display = 'none';
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
}
