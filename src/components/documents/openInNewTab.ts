import { getFreshSignedUrl, type CircleDocument } from '@/api/documents';

/**
 * "Open in new tab" WITHOUT putting the storage URL in the address bar.
 *
 * The old escape hatch was a new-tab anchor whose href WAS the signed URL, which
 * printed the Supabase Storage host plus the signing token in the new tab's
 * address bar and left both in browser history (memory
 * feedback_no_system_browser_for_files: never expose the storage host/token).
 * Now the bytes are fetched into a Blob and the tab is pointed at an object URL
 * — `blob:<our origin>/<uuid>` — which names nothing, grants nothing once
 * revoked, and is useless in history.
 */

/** How long a tab's object URL stays alive — long enough for the viewer to load it. */
export const OBJECT_URL_TTL_MS = 60_000;

/** Upper bound on the file fetch — a hung Storage request must not hang the button. */
const FETCH_TIMEOUT_MS = 30_000;

function timeoutSignal(): AbortSignal | undefined {
  return typeof AbortSignal !== 'undefined' && typeof AbortSignal.timeout === 'function'
    ? AbortSignal.timeout(FETCH_TIMEOUT_MS)
    : undefined;
}

/**
 * Fetch the document's bytes as a Blob typed with the document's OWN MIME type
 * (Storage may answer `application/octet-stream`; a PDF only renders in the
 * browser's viewer when the blob says `application/pdf`).
 *
 * `signedUrl` is the one already in hand; when it no longer works (a 1h TTL
 * that lapsed while the modal sat open), a fresh one is fetched and tried once.
 */
export async function fetchDocumentBlob(
  circleId: string,
  doc: Pick<CircleDocument, 'id' | 'category' | 'file_type'>,
  signedUrl: string | null
): Promise<Blob> {
  const attempt = async (url: string): Promise<Response | null> => {
    try {
      const response = await fetch(url, { signal: timeoutSignal(), credentials: 'omit' });
      return response.ok ? response : null;
    } catch {
      return null;
    }
  };

  let response = signedUrl ? await attempt(signedUrl) : null;
  if (!response) {
    response = await attempt(await getFreshSignedUrl(circleId, doc));
  }
  if (!response) throw new Error('DOCUMENT_FETCH_FAILED');

  const bytes = await response.blob();
  return new Blob([bytes], { type: doc.file_type });
}

/**
 * Open an EMPTY tab synchronously, inside the click's user activation, so a
 * popup blocker has nothing to object to; the caller points it at the blob
 * once the fetch resolves. Returns null when the browser blocked it anyway.
 */
export function openPendingTab(): Window | null {
  return window.open('about:blank', '_blank');
}

/**
 * Point the pending tab at the blob and schedule the object URL's revocation.
 * `location.replace` keeps `about:blank` out of the tab's history too.
 */
export function showBlobInTab(tab: Window, blob: Blob): string {
  const objectUrl = URL.createObjectURL(blob);
  tab.location.replace(objectUrl);
  // Revoked on a timer rather than on modal close: closing the dialog right
  // after clicking must not pull the bytes out from under a tab still loading.
  // Once the viewer has the document, the URL itself is no longer needed.
  window.setTimeout(() => URL.revokeObjectURL(objectUrl), OBJECT_URL_TTL_MS);
  return objectUrl;
}
