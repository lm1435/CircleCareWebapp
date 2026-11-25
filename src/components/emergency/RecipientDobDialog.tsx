import { useState, type FormEvent, type ReactElement } from 'react';
import { useTranslation } from 'react-i18next';
import { useQueryClient } from '@tanstack/react-query';
import { Button, DateField, Modal } from '@/components/ui';
import { updateCircleSchema } from '@/api/circles';
import { useUpdateCircle } from '@/hooks/useCircleAdmin';
import { useSubmitGuard } from '@/hooks/useGuardedSubmit';
import { Analytics, type DobAddedSurface } from '@/lib/analytics';
import { queryKeys } from '@/lib/queryKeys';

/**
 * "Add date of birth" (owner 2026-11-22, 1.4.3). Onboarding no longer asks for it, so Emergency info and
 * the care summary offer it here. The SAME field and date handling as Edit circle (EditCirclePage): the
 * native `DateField`, whose value is the literal `YYYY-MM-DD` the person picked, validated by the same
 * `updateCircleSchema` and sent as-is through the same PATCH (`useUpdateCircle`). Never built from a
 * `Date`, so no browser zone can shift it.
 *
 * Save writes, starts a circle detail refetch WITHOUT awaiting it (offline it pauses; the page and an
 * export read the new DOB once it lands), fires `dob_added {surface}`, then `onSaved`. Cancel writes nothing.
 */
export interface RecipientDobDialogProps {
  circleId: string;
  surface: Extract<DobAddedSurface, 'emergency_prompt' | 'export_prompt'>;
  onSaved: () => void;
  onCancel: () => void;
}

export function RecipientDobDialog({
  circleId,
  surface,
  onSaved,
  onCancel,
}: RecipientDobDialogProps): ReactElement {
  const { t } = useTranslation(['emergency', 'circles', 'common']);
  const queryClient = useQueryClient();
  const update = useUpdateCircle(circleId);
  const guard = useSubmitGuard();
  const [dob, setDob] = useState('');
  const [error, setError] = useState<string | undefined>(undefined);

  const submit = async (event?: FormEvent): Promise<void> => {
    event?.preventDefault();
    const parsed = updateCircleSchema.safeParse({ recipient_dob: dob });
    if (!dob || !parsed.success) {
      // Literal keys (the static translation-key audit resolves them), the same messages Edit circle shows.
      const invalidDate = !parsed.success && parsed.error.issues[0]?.message === 'dobInvalidDate';
      setError(invalidDate ? t('circles:validation.dobInvalidDate') : t('circles:validation.dobFormat'));
      return;
    }
    if (!guard.claim()) return;
    try {
      await update.mutateAsync({ recipient_dob: dob });
      try {
        Analytics.dobAdded(surface);
      } catch {
        // Analytics never costs the person the save.
      }
      // Fire, never await: offline the refetch pauses forever, and the PATCH already succeeded.
      void queryClient
        .invalidateQueries({ queryKey: queryKeys.circleDetail(circleId) })
        .catch(() => {});
      onSaved();
    } catch {
      // The hook already toasts the reason; the dialog stays open for a retry.
    } finally {
      guard.release();
    }
  };

  return (
    <Modal
      title={t('emergency:dobPrompt.add')}
      onClose={onCancel}
      closeLabel={t('common:cancel')}
      size="sm"
      footer={
        <div className="flex justify-end gap-3">
          <Button type="button" variant="ghost" onClick={onCancel} disabled={update.isPending}>
            {t('common:cancel')}
          </Button>
          <Button
            type="submit"
            form="recipient-dob-form"
            offlineKind="save"
            loading={update.isPending}
            disabled={update.isPending || !dob}
            data-testid="recipient-dob-save"
          >
            {t('common:save')}
          </Button>
        </div>
      }
    >
      <form id="recipient-dob-form" noValidate onSubmit={(e) => void submit(e)}>
        <DateField
          id="recipient_dob"
          label={t('circles:edit.recipientDob')}
          value={dob}
          error={error}
          hint={t('circles:edit.recipientDobHint')}
          onChange={(e) => {
            setDob(e.target.value);
            setError(undefined);
          }}
        />
      </form>
    </Modal>
  );
}
