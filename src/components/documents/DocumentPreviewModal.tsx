import { useCallback, useEffect, useState, type ReactElement } from 'react';
import { useTranslation } from 'react-i18next';
import { getFreshSignedUrl, type CircleDocument } from '@/api/documents';
import { Button, Modal, Spinner, Text } from '@/components/ui';
import { buildDownloadFileName, triggerSignedUrlDownload } from './downloadFile';

export interface DocumentPreviewModalProps {
  doc: CircleDocument;
  circleId: string;
  onClose: () => void;
}

type PreviewState =
  | { status: 'loading' }
  | { status: 'error' }
  | { status: 'ready'; signedUrl: string };

/**
 * Chrome PDF viewer open parameters, appended to the framed URL only.
 *
 * `navpanes=0` collapses the left-hand thumbnail rail, which otherwise eats
 * roughly half the modal's width and pushes the document itself into a narrow
 * column. The toolbar is deliberately KEPT (no `toolbar=0`) — it carries zoom,
 * which people need on scanned documents.
 *
 * A fragment is never sent to the server, so this cannot affect the URL's
 * signature. Any existing fragment is stripped first so the parameters can't be
 * silently appended to one already there.
 */
function withViewerParams(signedUrl: string): string {
  return `${signedUrl.split('#')[0]}#navpanes=0`;
}

/**
 * Preview modal for images and PDFs (spec §6.6: rebuilt on the shared `Modal`
 * shell — no local dialog/focus-trap/backdrop code here anymore; `Modal` owns
 * role="dialog", focus management, Tab trapping, Escape, and the backdrop).
 *
 * Security:
 * - Fetches a FRESH short-lived signed URL on open; it lives only in local
 *   component state (never the React Query cache, URL bar, or history).
 * - PDFs render in an UNSANDBOXED iframe with "open in new tab" + download
 *   fallbacks. This is deliberate and was verified in Chrome: the browser
 *   refuses to instantiate its built-in PDF viewer in a frame carrying a
 *   `sandbox` attribute AT ALL, and paints "This page has been blocked by
 *   Chrome" instead. The attribute's presence is the trigger, not its tokens —
 *   even a sandbox listing every allow-* token is still blocked, so there is no
 *   "minimal safe sandbox" available here; the only choice is sandbox-or-render.
 *   What keeps that acceptable is upstream: the backend derives the stored
 *   Content-Type server-side from a validated extension allowlist
 *   (jpg/jpeg/png/heic/pdf — see ALLOWED_EXTENSIONS in backend/src/routes/
 *   documents.ts), so the framed object is always image/* or application/pdf
 *   and can never be served as HTML that would run script. Keep it that way: if
 *   the upload allowlist ever widens to a scriptable type, this frame becomes a
 *   script-execution vector on the Storage origin and needs rethinking.
 */
export function DocumentPreviewModal({
  doc,
  circleId,
  onClose,
}: DocumentPreviewModalProps): ReactElement {
  const { t } = useTranslation(['documents', 'common']);
  const [preview, setPreview] = useState<PreviewState>({ status: 'loading' });
  const [attempt, setAttempt] = useState(0);

  const isPdf = doc.file_type === 'application/pdf';

  // Fetch a fresh signed URL on open (and on retry).
  useEffect(() => {
    let cancelled = false;
    setPreview({ status: 'loading' });
    getFreshSignedUrl(circleId, doc)
      .then((signedUrl) => {
        if (!cancelled) setPreview({ status: 'ready', signedUrl });
      })
      .catch(() => {
        // Never log document names or URLs.
        if (!cancelled) setPreview({ status: 'error' });
      });
    return () => {
      cancelled = true;
    };
    // doc.id is the stable identity for the fetched document.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [circleId, doc.id, attempt]);

  const handleDownload = useCallback(() => {
    if (preview.status !== 'ready') return;
    triggerSignedUrlDownload(preview.signedUrl, buildDownloadFileName(doc));
  }, [preview, doc]);

  return (
    <Modal
      title={doc.label}
      onClose={onClose}
      closeLabel={t('documents:closePreview')}
      size="lg"
      footer={
        preview.status === 'ready' ? (
          <>
            {isPdf && (
              <Button as="a" href={preview.signedUrl} target="_blank" rel="noopener noreferrer" variant="secondary">
                {t('documents:openInNewTab')}
              </Button>
            )}
            <Button
              variant="primary"
              aria-label={t('documents:downloadDocument', { name: doc.label })}
              onClick={handleDownload}
            >
              {t('documents:download')}
            </Button>
          </>
        ) : undefined
      }
    >
      <div className="flex min-h-48 flex-1 items-center justify-center">
        {preview.status === 'loading' && <Spinner size={32} />}

        {preview.status === 'error' && (
          <div className="text-center">
            <p className="m-0 text-ink-2">{t('documents:previewFailed')}</p>
            <Button variant="ghost" className="mt-4" onClick={() => setAttempt((count) => count + 1)}>
              {t('common:retry')}
            </Button>
          </div>
        )}

        {preview.status === 'ready' &&
          (isPdf ? (
            <div className="flex w-full flex-col items-center gap-2">
              <iframe
                src={withViewerParams(preview.signedUrl)}
                title={doc.label}
                className="h-[70vh] w-full rounded-lg border border-line"
              />
              <Text variant="caption">{t('documents:pdfFallbackHint')}</Text>
            </div>
          ) : (
            <img
              src={preview.signedUrl}
              alt={doc.label}
              className="max-h-[70vh] max-w-full rounded-lg object-contain"
            />
          ))}
      </div>
    </Modal>
  );
}
