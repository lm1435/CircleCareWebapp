import { type ReactNode } from 'react';
import { Button } from './Button';
import { Modal } from './Modal';

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
  /** When true, the confirm button uses the terracotta (destructive) variant. */
  destructive?: boolean;
  /** Disables the confirm button (e.g. while the mutation is pending). */
  confirmDisabled?: boolean;
}

/**
 * Confirmation dialog built on top of the shared Modal. Title + message +
 * confirm/cancel buttons, with a destructive variant. Backdrop click maps to
 * cancel; Escape closes (cancel). All copy comes from props — no English
 * literals are embedded (`closeLabel` falls back to `cancelLabel`).
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
  confirmDisabled = false,
}: ConfirmDialogProps): ReactNode {
  return (
    <Modal
      title={title}
      onClose={onCancel}
      closeLabel={closeLabel ?? cancelLabel}
      size="sm"
      footer={
        <div className="flex justify-end gap-3">
          <Button variant="ghost" onClick={onCancel}>
            {cancelLabel}
          </Button>
          <Button
            variant={destructive ? 'terracotta' : 'primary'}
            onClick={onConfirm}
            disabled={confirmDisabled}
          >
            {confirmLabel}
          </Button>
        </div>
      }
    >
      <div className="m-0 text-base text-ink-2">{message}</div>
    </Modal>
  );
}
