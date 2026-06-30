import {
  useEffect,
  useRef,
  useState,
  type KeyboardEvent as ReactKeyboardEvent,
  type ReactElement,
} from 'react';
import { useTranslation } from 'react-i18next';
import { Button, useToast } from '@/components/ui';
import { useConfirmMedication } from '@/hooks/useMedConfirmation';
import { isPermissionDeniedError, type TodaysMedication } from '@/api/medicationConfirmations';
import { formatEventTimeCompact } from '@/utils/timezone';

// Plan Task 24 — modal with Taken/Skipped options, optional note, submit.
// Focus-trapped, Escape closes, aria-modal (same pattern as AppLayout's
// drawer). The mutation hook handles 402/403 (toast + circle refetch); this
// dialog closes on permission errors and shows an inline error otherwise.

const FOCUSABLE_SELECTOR =
  'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

export interface ConfirmMedDialogProps {
  circleId: string;
  med: TodaysMedication;
  /** Care recipient's IANA timezone — for displaying the scheduled time. */
  careRecipientTimezone: string;
  initialStatus?: 'taken' | 'skipped';
  onClose: () => void;
}

export function ConfirmMedDialog({
  circleId,
  med,
  careRecipientTimezone,
  initialStatus = 'taken',
  onClose,
}: ConfirmMedDialogProps): ReactElement {
  const { t } = useTranslation('meds');
  const { showToast } = useToast();
  const [status, setStatus] = useState<'taken' | 'skipped'>(initialStatus);
  const [note, setNote] = useState('');
  const [submitError, setSubmitError] = useState(false);
  const dialogRef = useRef<HTMLDivElement | null>(null);
  const takenRef = useRef<HTMLButtonElement | null>(null);
  const skippedRef = useRef<HTMLButtonElement | null>(null);
  const mutation = useConfirmMedication(circleId);

  // Roving-tabindex arrow-key navigation for the radio group (WAI-ARIA radio
  // pattern). Only the checked radio is tabbable; arrows move + select.
  const handleRadioKeyDown = (event: ReactKeyboardEvent<HTMLButtonElement>): void => {
    if (!['ArrowDown', 'ArrowRight', 'ArrowUp', 'ArrowLeft'].includes(event.key)) return;
    event.preventDefault();
    const next = status === 'taken' ? 'skipped' : 'taken';
    setStatus(next);
    (next === 'taken' ? takenRef : skippedRef).current?.focus();
  };

  // Focus trap + Escape + body scroll lock; focus restored on close.
  useEffect(() => {
    const previouslyFocused = document.activeElement as HTMLElement | null;
    const dialog = dialogRef.current;
    const getFocusables = (): HTMLElement[] =>
      Array.from(dialog?.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR) ?? []);

    getFocusables()[0]?.focus();

    const onKeyDown = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') {
        event.preventDefault();
        onClose();
        return;
      }
      if (event.key !== 'Tab') return;

      const focusables = getFocusables();
      if (focusables.length === 0) return;
      const first = focusables[0];
      const last = focusables[focusables.length - 1];
      const active = document.activeElement;

      if (event.shiftKey) {
        if (active === first || !dialog?.contains(active)) {
          event.preventDefault();
          last?.focus();
        }
      } else if (active === last || !dialog?.contains(active)) {
        event.preventDefault();
        first?.focus();
      }
    };

    document.addEventListener('keydown', onKeyDown);
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';

    return () => {
      document.removeEventListener('keydown', onKeyDown);
      document.body.style.overflow = previousOverflow;
      previouslyFocused?.focus();
    };
  }, [onClose]);

  const handleSubmit = (): void => {
    if (!med.scheduled_time || mutation.isPending) return;
    setSubmitError(false);

    const trimmedNote = note.trim();
    mutation.mutate(
      {
        event_id: med.id,
        status,
        notes: trimmedNote ? trimmedNote : undefined,
        scheduled_time: med.scheduled_time,
      },
      {
        onSuccess: () => {
          showToast(t('dialog.success'), 'success');
          onClose();
        },
        onError: (error) => {
          if (isPermissionDeniedError(error)) {
            // The mutation hook already showed the permission toast and
            // refreshed circle access flags — just close.
            onClose();
          } else {
            setSubmitError(true);
          }
        },
      }
    );
  };

  const medName = med.medication_name || med.title;
  const statusOptionClass = (selected: boolean): string =>
    `flex-1 rounded-full border px-4 py-2 text-sm transition-colors ${
      selected
        ? 'border-ink bg-ink text-cream'
        : 'border-line bg-cream text-ink-2 hover:border-ink hover:text-ink'
    }`;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <div aria-hidden="true" onClick={onClose} className="absolute inset-0 bg-ink/40" />
      <div
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby="confirm-med-title"
        className="relative w-full max-w-sm rounded-2xl border border-line bg-cream p-5 shadow-xl"
      >
        <h2 id="confirm-med-title" className="serif m-0 text-lg text-ink">
          {t('dialog.title')}
        </h2>
        <p className="mb-4 mt-1 text-sm text-ink-3">
          {medName}
          {med.scheduled_time
            ? ` — ${formatEventTimeCompact(med.scheduled_time, careRecipientTimezone)}`
            : ''}
        </p>

        <div role="radiogroup" aria-label={t('dialog.statusLabel')} className="flex gap-2">
          <button
            ref={takenRef}
            type="button"
            role="radio"
            aria-checked={status === 'taken'}
            tabIndex={status === 'taken' ? 0 : -1}
            onClick={() => setStatus('taken')}
            onKeyDown={handleRadioKeyDown}
            className={statusOptionClass(status === 'taken')}
          >
            {t('dialog.taken')}
          </button>
          <button
            ref={skippedRef}
            type="button"
            role="radio"
            aria-checked={status === 'skipped'}
            tabIndex={status === 'skipped' ? 0 : -1}
            onClick={() => setStatus('skipped')}
            onKeyDown={handleRadioKeyDown}
            className={statusOptionClass(status === 'skipped')}
          >
            {t('dialog.skipped')}
          </button>
        </div>

        <label htmlFor="confirm-med-note" className="mb-1 mt-4 block text-sm text-ink-2">
          {t('dialog.noteLabel')}
        </label>
        <textarea
          id="confirm-med-note"
          value={note}
          onChange={(event) => setNote(event.target.value)}
          placeholder={t('dialog.notePlaceholder')}
          maxLength={1000}
          rows={3}
          className="w-full resize-none rounded-xl border border-line bg-bg p-3 text-sm text-ink placeholder:text-ink-3"
        />

        {submitError && (
          <p role="alert" className="m-0 mt-2 text-sm text-terracotta-deep">
            {t('dialog.error')}
          </p>
        )}

        <div className="mt-4 flex justify-end gap-2">
          <Button variant="ghost" onClick={onClose} className="min-h-11 text-sm">
            {t('dialog.cancel')}
          </Button>
          <Button
            onClick={handleSubmit}
            disabled={mutation.isPending}
            className="min-h-11 text-sm"
          >
            {mutation.isPending ? t('dialog.submitting') : t('dialog.submit')}
          </Button>
        </div>
      </div>
    </div>
  );
}
