import { useState, type FormEvent, type ReactElement } from 'react';
import { useTranslation } from 'react-i18next';
import type { EmergencyInfo } from '@/api/emergencyInfo';
import { useUpdateEmergencyInfo } from '@/hooks/useEmergencyInfo';
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

  const [hasDnr, setHasDnr] = useState(info?.has_dnr ?? false);
  const [notes, setNotes] = useState(info?.advance_directives ?? '');

  const handleSubmit = (event: FormEvent): void => {
    event.preventDefault();
    update.mutate(
      { has_dnr: hasDnr, advance_directives: notes.trim() || undefined },
      { onSuccess: onClose }
    );
  };

  return (
    <Modal
      title={t('edit.directives.title')}
      onClose={onClose}
      closeLabel={t('edit.close')}
      footer={
        <div className="flex justify-end gap-3">
          <Button variant="ghost" onClick={onClose} disabled={update.isPending}>
            {t('edit.cancel')}
          </Button>
          <Button type="submit" form="edit-directives-form" disabled={update.isPending}>
            {update.isPending ? t('edit.saving') : t('edit.save')}
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
