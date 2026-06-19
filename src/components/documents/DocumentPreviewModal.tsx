import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type KeyboardEvent,
  type MouseEvent,
  type ReactElement,
} from 'react';
import { useTranslation } from 'react-i18next';
import { getFreshSignedUrl, type CircleDocument } from '@/api/documents';
import { Button, Spinner } from '@/components/ui';
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

const FOCUSABLE_SELECTOR =
  'a[href], button:not([disabled]), iframe, [tabindex]:not([tabindex="-1"])';

/**
 * Preview modal for images and PDFs (plan Task 33).
 *
 * Security:
 * - Fetches a FRESH short-lived signed URL on open; it lives only in local
 *   component state (never the React Query cache, URL bar, or history).
 * - PDFs render inside a fully sandboxed iframe (`sandbox=""` — no scripts,
 *   no same-origin) with "open in new tab" + download fallbacks.
 *
 * Accessibility: role="dialog" + aria-modal, focus moves to the close button
 * on open, Tab is trapped inside, Escape closes, and focus is restored to the
 * previously focused element on close.
 */
export function DocumentPreviewModal({
  doc,
  circleId,
  onClose,
}: DocumentPreviewModalProps): ReactElement {
  const { t } = useTranslation(['documents', 'common']);
  const dialogRef = useRef<HTMLDivElement>(null);
  const closeButtonRef = useRef<HTMLButtonElement>(null);
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

  // Focus management: focus the close button on open, restore on close.
  useEffect(() => {
    const previouslyFocused =
      document.activeElement instanceof HTMLElement ? document.activeElement : null;
    closeButtonRef.current?.focus();
    return () => {
      previouslyFocused?.focus();
    };
  }, []);

  const handleKeyDown = useCallback(
    (event: KeyboardEvent<HTMLDivElement>) => {
      if (event.key === 'Escape') {
        event.stopPropagation();
        onClose();
        return;
      }
      if (event.key !== 'Tab') return;

      const focusables = dialogRef.current?.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR);
      if (!focusables || focusables.length === 0) return;
      const first = focusables[0];
      const last = focusables[focusables.length - 1];

      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    },
    [onClose]
  );

  const handleBackdropClick = useCallback(
    (event: MouseEvent<HTMLDivElement>) => {
      if (event.target === event.currentTarget) onClose();
    },
    [onClose]
  );

  const handleDownload = useCallback(() => {
    if (preview.status !== 'ready') return;
    triggerSignedUrlDownload(preview.signedUrl, buildDownloadFileName(doc));
  }, [preview, doc]);

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-ink/50 p-4"
      onClick={handleBackdropClick}
      onKeyDown={handleKeyDown}
    >
      <div
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby="document-preview-title"
        className="flex max-h-[90vh] w-full max-w-3xl flex-col rounded-2xl border border-line bg-cream shadow-lg"
      >
        <div className="flex items-center justify-between gap-4 border-b border-line-2 p-4">
          <h2 id="document-preview-title" className="m-0 truncate text-lg text-ink">
            {doc.label}
          </h2>
          <button
            ref={closeButtonRef}
            type="button"
            aria-label={t('documents:closePreview')}
            onClick={onClose}
            className="shrink-0 rounded-full px-2 text-xl leading-none text-ink-3 hover:text-ink"
          >
            <span aria-hidden="true">&times;</span>
          </button>
        </div>

        <div className="flex min-h-48 flex-1 items-center justify-center overflow-auto p-4">
          {preview.status === 'loading' && <Spinner size={32} />}

          {preview.status === 'error' && (
            <div className="text-center">
              <p className="m-0 text-ink-2">{t('documents:previewFailed')}</p>
              <Button
                variant="ghost"
                className="mt-4"
                onClick={() => setAttempt((count) => count + 1)}
              >
                {t('common:retry')}
              </Button>
            </div>
          )}

          {preview.status === 'ready' &&
            (isPdf ? (
              <iframe
                sandbox=""
                src={preview.signedUrl}
                title={doc.label}
                className="h-[70vh] w-full rounded-lg border border-line"
              />
            ) : (
              <img
                src={preview.signedUrl}
                alt={doc.label}
                className="max-h-[70vh] max-w-full rounded-lg object-contain"
              />
            ))}
        </div>

        {preview.status === 'ready' && (
          <div className="flex flex-wrap items-center justify-between gap-3 border-t border-line-2 p-4">
            {isPdf ? (
              <p className="m-0 text-sm text-ink-3">{t('documents:pdfFallbackHint')}</p>
            ) : (
              <span />
            )}
            <div className="flex items-center gap-2">
              {isPdf && (
                <a
                  href={preview.signedUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="btn btn-ghost"
                >
                  {t('documents:openInNewTab')}
                </a>
              )}
              <Button
                variant="ghost"
                aria-label={t('documents:downloadDocument', { name: doc.label })}
                onClick={handleDownload}
              >
                {t('documents:download')}
              </Button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
