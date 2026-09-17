import { useCallback, type ReactElement, type ReactNode } from 'react';
import { Button } from './Button';
import { IconTile, type IconTileTone } from './IconTile';
import { Modal } from './Modal';
import { useGuardedSubmit } from '@/hooks/useGuardedSubmit';
import { captureException } from '@/lib/posthog';
import type { IconName } from './iconNames';

export type ConfirmDialogVariant = 'confirm' | 'destructive' | 'success' | 'error';

export interface ConfirmDialogProps {
  /** Dialog title — supply an i18n string. */
  title: ReactNode;
  /** Body message — supply an i18n string. */
  message: ReactNode;
  /** Confirm button text. */
  confirmLabel: string;
  /** Cancel button text. */
  cancelLabel: string;
  /** Accessible label for the close (×) button. Falls back to cancelLabel. */
  closeLabel?: string;
  /**
   * The action. May return a PROMISE — when it does, the shell's double-submit
   * guard is held for as long as that promise is pending, which is strictly
   * better than the same-tick-only protection a synchronous handler gets. Every
   * caller whose confirm fires a request should return it.
   */
  onConfirm: () => void | Promise<unknown>;
  onCancel: () => void;
  /**
   * When true, the confirm button uses the `danger` variant and a terracotta
   * mark is shown. Alias for `variant="destructive"` — kept so no existing
   * call site needs to change.
   */
  destructive?: boolean;
  /**
   * Dialog intent: `'confirm'` (default) is a plain question with a neutral
   * question mark; `'destructive'` and `'error'` show a terracotta mark;
   * `'success'` shows a moss check. `destructive={true}` is equivalent to
   * `variant="destructive"`.
   */
  variant?: ConfirmDialogVariant;
  /** Disables the confirm button (e.g. while the mutation is pending). */
  confirmDisabled?: boolean;
  /** Disables both buttons and swaps the confirm label to `loadingLabel` (if given). */
  loading?: boolean;
  /** Confirm button label to show while `loading` is true. Falls back to `confirmLabel`. */
  loadingLabel?: string;
  /**
   * The mark, when the variant's default is not the right glyph for the
   * question: `log-out-outline` for signing out, `person-outline` for removing
   * a member, `time-outline` for a past-time notice. A plain `confirm` shows
   * no mark unless one is given here.
   */
  icon?: IconName;
  /** Tint for `icon`. Defaults to the variant's tone (`dusk` for a plain confirm). */
  iconTone?: IconTileTone;
}

/**
 * Spec §4.5: the mark is an `IconTile` at the 44 chrome size — for the
 * variants that MEAN something (a bin, a warning, a check). A plain question
 * has no mark: the grey "?" tile said nothing the title did not, and read as a
 * placeholder. Mobile's plain confirm is a bare alert for the same reason.
 */
const MARK: Record<ConfirmDialogVariant, { tone: IconTileTone; name: IconName } | null> = {
  destructive: { tone: 'terracotta', name: 'trash-outline' },
  error: { tone: 'terracotta', name: 'alert-circle-outline' },
  success: { tone: 'moss', name: 'checkmark-circle' },
  confirm: null,
};

/**
 * Confirmation dialog built on top of the shared Modal. Title + message +
 * confirm/cancel buttons, with confirm/destructive/success/error variants.
 * Backdrop click maps to cancel (disabled for destructive); Escape closes
 * (cancel). All copy comes from props — no English literals are embedded
 * (`closeLabel` falls back to `cancelLabel`).
 *
 * The footer is the shell's own row (spec §4.5): right-aligned, secondary
 * `Cancel` first, then the confirm button — stacked full width, confirm on
 * top, below 480px. The message is no longer capped at 280px.
 */
export function ConfirmDialog({
  title,
  message,
  confirmLabel,
  cancelLabel,
  closeLabel,
  onConfirm,
  onCancel,
  destructive = false,
  variant,
  confirmDisabled = false,
  loading = false,
  loadingLabel,
  icon,
  iconTone,
}: ConfirmDialogProps): ReactElement {
  const resolvedVariant: ConfirmDialogVariant =
    variant ?? (destructive ? 'destructive' : 'confirm');
  // Only `destructive` is an irreversible/dangerous action — `error` shows the
  // same terracotta mark (something went wrong) but its confirm is just an
  // acknowledgment, so it stays primary.
  const isDestructive = resolvedVariant === 'destructive';
  // THE SYNCHRONOUS DOUBLE-CONFIRM GUARD. `loading` puts `disabled` on the
  // confirm button below, but that is React state committed a render AFTER the
  // click that started the action — so two clicks dispatched in the SAME tick
  // both reach `onConfirm` with the button still enabled. Every destructive
  // action in the app comes through this shell, and for some of them the second
  // call is not harmless: DeleteEventDialog's delete-one-occurrence hits one of
  // the three backend routes that write against the partial unique index with
  // no 23505 recovery, so the losing racer is answered with a 500 over a delete
  // that already succeeded.
  //
  // Guarding HERE rather than at each call site is deliberate: the shell owns
  // the button, so no caller can forget. A caller that returns its promise (see
  // `onConfirm`) additionally gets the guard held for the whole request rather
  // than just the tick. `loading` stays exactly where it is — it is the VISUAL
  // guard; this is the correctness one.
  const guardedConfirm = useGuardedSubmit(onConfirm);
  // …AND THE ONE PLACE THE PROMISE IS DROPPED ON THE FLOOR HAS TO CATCH IT.
  //
  // `onConfirm` may return a promise (that is the point — the guard is then
  // held for the whole request), this shell calls it from an `onClick` and
  // discards what comes back, and `useGuardedSubmit` deliberately does not
  // catch: it is a re-entrancy guard, and swallowing there would make a failed
  // submit indistinguishable from a successful one for every caller that
  // awaits. So a caller written the obvious way — `onConfirm={() =>
  // thing.mutateAsync(id)}` — produced a browser-level unhandled rejection,
  // which `capture_exceptions: true` turns into a context-free `$exception` in
  // the admin digest, duplicating a failure the mutation's own onError has
  // already toasted.
  //
  // Reported, not swallowed: a genuine bug stays visible and carries a
  // boundary that says where it came from.
  const handleConfirm = useCallback((): void => {
    void guardedConfirm().catch((err: unknown) => {
      captureException(
        err instanceof Error ? err : new Error(String(err)),
        'ConfirmDialog.onConfirm'
      );
    });
  }, [guardedConfirm]);
  const disabled = confirmDisabled || loading;
  const confirmText = loading ? (loadingLabel ?? confirmLabel) : confirmLabel;
  const defaultMark = MARK[resolvedVariant];
  const mark = icon
    ? { name: icon, tone: iconTone ?? defaultMark?.tone ?? 'dusk' }
    : defaultMark;
  // A string message is short confirm-dialog copy — center it under the mark.
  // A ReactNode message (a form field, a rich body) renders left-aligned so it
  // isn't mis-centered. Neither is width-capped any more (spec §4.5).
  const messageClassName =
    typeof message === 'string' && mark
      ? 'break-words text-center text-base text-ink-2'
      : 'break-words text-base text-ink-2';

  return (
    <Modal
      title={title}
      onClose={onCancel}
      closeLabel={closeLabel ?? cancelLabel}
      size="sm"
      closeOnBackdropClick={!isDestructive}
      dismissible={!loading}
      footer={
        <>
          <Button variant="secondary" onClick={onCancel} disabled={loading}>
            {cancelLabel}
          </Button>
          <Button
            variant={isDestructive ? 'danger' : 'primary'}
            onClick={handleConfirm}
            disabled={disabled}
            loading={loading}
          >
            {confirmText}
          </Button>
        </>
      }
    >
      {mark && <IconTile tone={mark.tone} name={mark.name} size={44} className="mx-auto" />}
      <div className={messageClassName}>{message}</div>
    </Modal>
  );
}
