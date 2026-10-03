import { useCallback, useEffect, useRef, useState, type ReactElement } from 'react';
import { useTranslation } from 'react-i18next';
import { getFreshSignedUrl, type CircleDocument } from '@/api/documents';
import { Button, Icon, Modal, Spinner, Text, useToast } from '@/components/ui';
import { buildDownloadFileName, triggerSignedUrlDownload } from './downloadFile';
import { fetchDocumentBlob, openPendingTab, showBlobInTab } from './openInNewTab';

export interface DocumentPreviewModalProps {
  doc: CircleDocument;
  circleId: string;
  onClose: () => void;
}

type PreviewState =
  | { status: 'loading' }
  | { status: 'error' }
  | { status: 'unsupported' }
  | { status: 'ready'; signedUrl: string };

// Browsers can render JPEG/PNG and (natively or via fallback) PDFs.
// HEIC is not renderable in any mainstream browser → the "can't preview" state.
const PREVIEWABLE_TYPES = new Set(['image/jpeg', 'image/png', 'application/pdf']);

export function isPreviewable(fileType: string): boolean {
  return PREVIEWABLE_TYPES.has(fileType);
}

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
 * The in-app document viewer — web's counterpart of mobile's
 * `DocumentViewerModal` (same header: the document's label, Close, and the
 * platform's save action — Share on the phone, Download here). Opened from the
 * row itself or its "Open" menu item, for EVERY type: a type the browser can't
 * render (HEIC) gets the "can't preview" state with its own Download, exactly
 * as mobile does.
 *
 * Built on the shared `Modal` shell, which owns role="dialog", the name (the
 * sr-only h2 = the label), focus in/trap/return, Escape, and the backdrop.
 *
 * Security:
 * - The header shows the document's LABEL, never a URL or host.
 * - Fetches a FRESH short-lived signed URL on open; it lives only in local
 *   component state (never the React Query cache, URL bar, or history).
 * - "Open in new tab" never navigates to the signed URL. It fetches the bytes
 *   into a Blob and opens `blob:<app origin>/<uuid>` (see openInNewTab.ts), so
 *   the new tab's address bar and history carry no storage host and no token.
 * - Download re-signs at click time and hands the URL to a transient,
 *   never-rendered anchor (downloadFile.ts) — not a visible link.
 * - PDFs render in an UNSANDBOXED iframe. This is deliberate and was verified
 *   in Chrome: the browser refuses to instantiate its built-in PDF viewer in a
 *   frame carrying a `sandbox` attribute AT ALL, and paints "This page has been
 *   blocked by Chrome" instead. The attribute's presence is the trigger, not its
 *   tokens. What keeps that acceptable is upstream: the backend derives the
 *   stored Content-Type server-side from a validated extension allowlist
 *   (jpg/jpeg/png/heic/pdf — see ALLOWED_EXTENSIONS in backend/src/routes/
 *   documents.ts), so the framed object is always image/* or application/pdf
 *   and can never be served as HTML that would run script. Keep it that way.
 */
export function DocumentPreviewModal({
  doc,
  circleId,
  onClose,
}: DocumentPreviewModalProps): ReactElement {
  const { t } = useTranslation(['documents', 'common']);
  const { showToast } = useToast();
  const previewable = isPreviewable(doc.file_type);
  const [preview, setPreview] = useState<PreviewState>(
    previewable ? { status: 'loading' } : { status: 'unsupported' }
  );
  const [attempt, setAttempt] = useState(0);
  const [downloading, setDownloading] = useState(false);
  const [openingTab, setOpeningTab] = useState(false);
  const mountedRef = useRef(true);
  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
    };
  }, []);

  const isPdf = doc.file_type === 'application/pdf';

  // Fetch a fresh signed URL on open (and on retry) — renderable types only.
  useEffect(() => {
    if (!previewable) return;
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
  }, [circleId, doc.id, attempt, previewable]);

  /**
   * Re-signs at click time (the modal may have sat open past the URL's TTL),
   * then downloads through the shared helper under buildDownloadFileName.
   * Both outcomes are announced through the toast live region.
   */
  const download = useCallback(
    async (successMessage: string, successType: 'info' | 'error' = 'info'): Promise<void> => {
      try {
        const signedUrl = await getFreshSignedUrl(circleId, doc);
        triggerSignedUrlDownload(signedUrl, buildDownloadFileName(doc));
        showToast(successMessage, successType);
      } catch {
        // Never log document names or URLs.
        showToast(t('documents:downloadFailed'), 'error');
      }
    },
    [circleId, doc, showToast, t]
  );

  const handleDownload = useCallback(async () => {
    if (downloading) return;
    setDownloading(true);
    await download(t('documents:viewer.downloadStarted'));
    if (mountedRef.current) setDownloading(false);
  }, [downloading, download, t]);

  const handleOpenInNewTab = useCallback(async () => {
    if (openingTab || preview.status !== 'ready') return;
    // Opened NOW, synchronously inside the click, so the popup blocker sees a
    // user gesture; it is pointed at the blob once the bytes arrive.
    const tab = openPendingTab();
    if (!tab) {
      // Blocked anyway: the user still gets the file.
      await download(t('documents:viewer.newTabBlocked'));
      return;
    }
    setOpeningTab(true);
    try {
      const blob = await fetchDocumentBlob(circleId, doc, preview.signedUrl);
      showBlobInTab(tab, blob);
    } catch {
      tab.close();
      showToast(t('documents:viewer.newTabFailed'), 'error');
    } finally {
      if (mountedRef.current) setOpeningTab(false);
    }
  }, [openingTab, preview, download, circleId, doc, showToast, t]);

  const downloadLabel = t('documents:downloadDocument', { name: doc.label });

  return (
    <Modal
      title={doc.label}
      hideTitle
      header={
        <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-2">
          {/* NOT a heading: the Modal's sr-only h2 (same text) already names
              the dialog; a second heading would read twice (AIChatModal). */}
          <Text variant="h2" as="p" className="min-w-0 flex-1 basis-40 break-words">
            {doc.label}
          </Text>
          <Button
            variant="secondary"
            size="sm"
            aria-label={downloadLabel}
            loading={downloading}
            onClick={() => void handleDownload()}
            leftIcon={<Icon name="download-outline" size="inline" />}
          >
            {t('documents:download')}
          </Button>
        </div>
      }
      onClose={onClose}
      closeLabel={t('documents:closePreview')}
      size="lg"
      footer={
        preview.status === 'ready' && isPdf ? (
          <Button variant="secondary" loading={openingTab} onClick={() => void handleOpenInNewTab()}>
            {t('documents:openInNewTab')}
          </Button>
        ) : undefined
      }
    >
      <div className="flex min-h-48 flex-1 items-center justify-center">
        {preview.status === 'loading' && <Spinner size={32} />}

        {preview.status === 'error' && (
          <div className="text-center">
            <div role="alert">
              <p className="m-0 font-semibold text-ink">{t('documents:viewer.failedTitle')}</p>
              <p className="m-0 mt-1 text-ink-2">{t('documents:viewer.failedMessage')}</p>
            </div>
            <Button variant="ghost" className="mt-4" onClick={() => setAttempt((count) => count + 1)}>
              {t('common:retry')}
            </Button>
          </div>
        )}

        {preview.status === 'unsupported' && (
          <div className="flex flex-col items-center text-center">
            <p className="m-0 font-semibold text-ink">{t('documents:viewer.unsupportedTitle')}</p>
            <p className="m-0 mt-1 text-ink-2">{t('documents:viewer.unsupportedMessage')}</p>
            <Button
              variant="primary"
              className="mt-4"
              aria-label={downloadLabel}
              loading={downloading}
              onClick={() => void handleDownload()}
            >
              {t('documents:download')}
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
