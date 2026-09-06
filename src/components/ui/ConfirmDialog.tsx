import { type ReactElement, type ReactNode } from 'react';
import { Button } from './Button';
import { IconTile, type IconTileTone } from './IconTile';
import { Modal } from './Modal';
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
  onConfirm: () => void;
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
            onClick={onConfirm}
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
