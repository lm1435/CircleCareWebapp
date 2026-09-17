import { useState, type FormEvent, type ReactElement } from 'react';
import { useTranslation } from 'react-i18next';
import type { EmergencyInfo } from '@/api/emergencyInfo';
import { useUpdateEmergencyInfo } from '@/hooks/useEmergencyInfo';
import { useSubmitGuard } from '@/hooks/useGuardedSubmit';
import { Button, Modal, TextArea, Toggle } from '@/components/ui';

export interface EditDirectivesModalProps {
  circleId: string;
  info: EmergencyInfo | null;
  onClose: () => void;
}

/**
 * Edit code status: DNR flag + advance-directives free text. Mirrors mobile
 * EditDirectivesScreen.
 *
 * NOTE: this section is HIDDEN FOR LAUNCH on mobile. The web mirrors that — the
 * page gates rendering behind `DIRECTIVES_EDIT_ENABLED` (currently false), so
 * this modal is never opened by default. The component is complete and ready to
 * flip on when product decides to surface advance directives.
 */
type EditDirectivesModalPropsLoaded = Omit<EditDirectivesModalProps, 'info'> & { info: EmergencyInfo };

function EditDirectivesModalForm({
  circleId,
  info,
  onClose,
}: EditDirectivesModalPropsLoaded): ReactElement {
  const { t } = useTranslation('emergency');
  const update = useUpdateEmergencyInfo(circleId);
  // THE SYNCHRONOUS DOUBLE-SUBMIT GUARD. `update.isPending` drives `loading` on
  // the footer button, but that is React Query state committed a render AFTER
  // the submit that started the request — and implicit form submission (Enter
  // in a field) never consults the button at all, so two submits in the SAME
  // tick both fire. The payload is recomputed from the same state, so today's
  // second PUT is idempotent; what it costs is a wasted write against a
  // premium-gated, rate-limited route and a second activity-feed entry for one
  // edit. "Idempotent" is a property of this payload, not of the form.
  // `isPending` first, then the ref (`useSubmitGuard`); released in
  // `onSettled`, since `mutate` returns immediately.
  const submitGuard = useSubmitGuard();

  const [hasDnr, setHasDnr] = useState(info?.has_dnr ?? false);
  const [notes, setNotes] = useState(info?.advance_directives ?? '');

  const handleSubmit = (event: FormEvent): void => {
    event.preventDefault();
    if (update.isPending || !submitGuard.claim()) return;
    update.mutate(
      { has_dnr: hasDnr, advance_directives: notes.trim() || undefined },
      { onSuccess: onClose, onSettled: submitGuard.release }
    );
  };

  return (
    <Modal
      title={t('edit.directives.title')}
      onClose={onClose}
      closeLabel={t('edit.close')}
      footer={
        <div className="flex justify-end gap-3">
          <Button variant="secondary" onClick={onClose} disabled={update.isPending}>
            {t('edit.cancel')}
          </Button>
          <Button type="submit" form="edit-directives-form" variant="primary" loading={update.isPending}>
            {t('edit.save')}
          </Button>
        </div>
      }
    >
      <form id="edit-directives-form" onSubmit={handleSubmit} className="flex flex-col gap-4">
        <Toggle checked={hasDnr} onChange={setHasDnr} label={t('edit.directives.dnrLabel')} />
        <TextArea
          id="directives-notes"
          label={t('edit.directives.details')}
          value={notes}
          rows={4}
          maxLength={5000}
          placeholder={t('edit.directives.detailsPlaceholder')}
          onChange={(e) => setNotes(e.target.value)}
        />
      </form>
    </Modal>
  );
}

/**
 * Null guard. Self-defence, not redundancy: this form's save is a
 * read-modify-write over `info`, so an unloaded record would write defaults
 * over real data — the exact failure the mobile emergency editors shipped with
 * (a one-element array replacing the saved list; blank allergies; DNR reset).
 * Today EmergencyInfoPage gates on isLoading/isError so `info` is always
 * present; this keeps that true if the modal is ever opened from somewhere else.
 *
 * It is a WRAPPER rather than an early return inside the form because the form
 * seeds its `useState` from `info` at mount. Returning null in place would keep
 * the component mounted with defaults already captured, so a late-arriving
 * `info` would render a blank form over a real record — trading a bad save for
 * a bad form. Mounting the form only once `info` exists avoids both.
 */
export function EditDirectivesModal(props: EditDirectivesModalProps): ReactElement | null {
  if (!props.info) return null;
  return <EditDirectivesModalForm {...props} info={props.info} />;
}
