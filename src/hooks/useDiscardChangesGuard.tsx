import { useCallback, useContext, useEffect, useRef, useState, type ReactElement } from 'react';
import { useTranslation } from 'react-i18next';
import { UNSAFE_DataRouterContext, useBlocker } from 'react-router-dom';
import { ConfirmDialog } from '@/components/ui/ConfirmDialog';

export interface DiscardChangesGuard {
  /**
   * The modal's close gesture (×, Escape, backdrop, footer Cancel). Closes at
   * once when nothing was edited; otherwise asks "Discard changes?" first.
   */
  requestClose: () => void;
  /**
   * The SAVE path. A successful save closes while the form still differs from
   * what it opened with (that difference is exactly what was just saved), so it
   * must not go through `requestClose`: it disarms the guard, then closes.
   */
  closeAfterSave: () => void;
  /** Render beside the Modal (a sibling, not a child — see below). */
  prompt: ReactElement;
}

/**
 * "Discard changes?" for the Emergency/Health edit modals (owner-approved
 * 2026-10-14; mobile asks the same question with the same words).
 *
 * `dirty` is the CALLER's verdict: the form's current values against the
 * snapshot it opened with — the same baseline its session draft compares to, so
 * an untouched form (phone normalization included: it happens in the state
 * initializer, before the baseline is taken) is never dirty, while a restored
 * draft that differs from the record is.
 *
 * While dirty, three exits are guarded:
 * 1. the modal's own close gestures (`requestClose`);
 * 2. in-app navigation — sidebar links, browser back/forward — via `useBlocker`;
 * 3. tab close / reload via `beforeunload` (the browser shows its own text).
 *
 * The prompt is rendered as a SIBLING of the Modal rather than inside it: the
 * Modal's keydown handler sits on its own backdrop, so a dialog nested in its
 * children would bubble Escape and Tab through it. As a sibling the confirm owns
 * its keys outright — Escape on it means "Keep editing" and never reaches the
 * form's Modal — and it is later in document order, so it is the topmost modal.
 */
export function useDiscardChangesGuard(dirty: boolean, onClose: () => void): DiscardChangesGuard {
  const [confirming, setConfirming] = useState(false);
  // Set by a successful save. State (not just a ref) so the beforeunload
  // listener is actually removed when a caller keeps the form mounted; the ref
  // is what the router's blocker function and the listener read at event time.
  const [saved, setSaved] = useState(false);
  const armed = dirty && !saved;
  const armedRef = useRef(armed);
  armedRef.current = armed;

  useEffect(() => {
    if (!armed) return undefined;
    const handleBeforeUnload = (event: BeforeUnloadEvent): void => {
      if (!armedRef.current) return;
      event.preventDefault();
      // Legacy browsers only show the prompt when returnValue is set.
      event.returnValue = '';
    };
    window.addEventListener('beforeunload', handleBeforeUnload);
    return () => window.removeEventListener('beforeunload', handleBeforeUnload);
  }, [armed]);

  const requestClose = useCallback((): void => {
    if (armedRef.current) setConfirming(true);
    else onClose();
  }, [onClose]);

  const closeAfterSave = useCallback((): void => {
    armedRef.current = false;
    setSaved(true);
    onClose();
  }, [onClose]);

  // useBlocker throws outside a DATA router, and these modals are also rendered
  // under a plain MemoryRouter (and no router at all) in component tests. The
  // app's router is always `createBrowserRouter`, so in the app this is always
  // present; the context cannot appear or vanish over a component's lifetime.
  const dataRouter = useContext(UNSAFE_DataRouterContext);
  const shouldBlock = useCallback(() => armedRef.current, []);

  const prompt = (
    <>
      {confirming && (
        <DiscardChangesDialog
          onDiscard={() => {
            setConfirming(false);
            onClose();
          }}
          onKeep={() => setConfirming(false)}
        />
      )}
      {dataRouter && <NavigationGuard shouldBlock={shouldBlock} />}
    </>
  );

  return { requestClose, closeAfterSave, prompt };
}

/** The blocker lives in its own component so it is only mounted under a data router. */
function NavigationGuard({ shouldBlock }: { shouldBlock: () => boolean }): ReactElement | null {
  const blocker = useBlocker(
    ({ currentLocation, nextLocation }) =>
      shouldBlock() &&
      (currentLocation.pathname !== nextLocation.pathname ||
        currentLocation.search !== nextLocation.search)
  );
  if (blocker.state !== 'blocked') return null;
  return <DiscardChangesDialog onDiscard={() => blocker.proceed()} onKeep={() => blocker.reset()} />;
}

function DiscardChangesDialog({
  onDiscard,
  onKeep,
}: {
  onDiscard: () => void;
  onKeep: () => void;
}): ReactElement {
  const { t } = useTranslation('emergency');
  return (
    <ConfirmDialog
      title={t('edit.discard.title')}
      message={t('edit.discard.message')}
      confirmLabel={t('edit.discard.confirm')}
      cancelLabel={t('edit.discard.keep')}
      // "Close", not the cancelLabel fallback: the × and "Keep editing" do the
      // same thing, but each control keeps a distinct name (WCAG 2.4.6).
      closeLabel={t('edit.close')}
      destructive
      onConfirm={onDiscard}
      onCancel={onKeep}
    />
  );
}
