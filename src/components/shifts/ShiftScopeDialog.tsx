import { useState, type ReactElement, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { ConfirmDialog, RadioGroup } from '@/components/ui';
import type { ShiftScope } from '@/api/shifts';
import { ShiftInlineError } from './ShiftInlineError';

export interface ShiftScopeDialogProps {
  title: string;
  /** The intro sentence above the choice (or the whole body when not repeating). */
  message?: ReactNode;
  confirmLabel: string;
  /** Repeating shifts get the "This shift / This and future shifts" choice. */
  repeating: boolean;
  /** Extra controls rendered between the message and the choice (the assign picker). */
  children?: ReactNode;
  destructive?: boolean;
  loading?: boolean;
  confirmDisabled?: boolean;
  /** A retryable failure (network / server), shown inline while the dialog stays open. */
  error?: string;
  onConfirm: (scope: ShiftScope) => void | Promise<unknown>;
  onCancel: () => void;
}

/**
 * The scope prompt shared by Drop / Delete / Assign / Edit: a repeating shift
 * asks "This shift / This and future shifts" (real radios); a one-off is a plain
 * confirm. Same ConfirmDialog footer shape as `DeleteEventDialog`.
 */
export function ShiftScopeDialog({
  title,
  message,
  confirmLabel,
  repeating,
  children,
  destructive = false,
  loading = false,
  confirmDisabled = false,
  error = '',
  onConfirm,
  onCancel,
}: ShiftScopeDialogProps): ReactElement {
  const { t } = useTranslation(['shifts', 'common']);
  const [scope, setScope] = useState<ShiftScope>('occurrence');
  return (
    <ConfirmDialog
      offlineKind="change"
      title={title}
      message={
        <div className="flex flex-col gap-4">
          {message ? <p className="m-0 text-base text-ink-2">{message}</p> : null}
          {children}
          {repeating && (
            <RadioGroup
              label={t('shifts:scope.label')}
              value={scope}
              onChange={(value) => setScope(value as ShiftScope)}
              options={[
                { value: 'occurrence', label: t('shifts:scope.occurrence') },
                { value: 'future', label: t('shifts:scope.future') },
              ]}
            />
          )}
          <ShiftInlineError message={error} />
        </div>
      }
      confirmLabel={confirmLabel}
      cancelLabel={t('common:cancel')}
      closeLabel={t('shifts:close')}
      destructive={destructive}
      loading={loading}
      confirmDisabled={confirmDisabled}
      onConfirm={() => onConfirm(repeating ? scope : 'occurrence')}
      onCancel={onCancel}
    />
  );
}
