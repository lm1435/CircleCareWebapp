import { useState, type FormEvent, type ReactElement } from 'react';
import { useTranslation } from 'react-i18next';
import type { EmergencyInfo } from '@/api/emergencyInfo';
import { useUpdateEmergencyInfo } from '@/hooks/useEmergencyInfo';
import { Button, Modal, TextArea, TextField } from '@/components/ui';

export interface EditMedicalInfoModalProps {
  circleId: string;
  /** Current emergency info snapshot (null when nothing saved yet). */
  info: EmergencyInfo | null;
  onClose: () => void;
}

/** Split a comma-separated text field into a trimmed, non-empty string array. */
export function splitCommaList(text: string): string[] {
  return text
    .split(',')
    .map((entry) => entry.trim())
    .filter(Boolean);
}

/**
 * Edit the medical-info slice: blood type + three comma-split string arrays
 * (medication allergies / other allergies / conditions). Mirrors mobile
 * EditMedicalInfoScreen — the textareas round-trip arrays as comma-joined text,
 * and the partial PUT sends ALL four medical keys at once.
 */
export function EditMedicalInfoModal({
  circleId,
  info,
  onClose,
}: EditMedicalInfoModalProps): ReactElement {
  const { t } = useTranslation('emergency');
  const update = useUpdateEmergencyInfo(circleId);

  const [bloodType, setBloodType] = useState(info?.blood_type ?? '');
  const [medicationAllergiesText, setMedicationAllergiesText] = useState(
    (info?.medication_allergies ?? []).join(', ')
  );
  const [allergiesText, setAllergiesText] = useState((info?.allergies ?? []).join(', '));
  const [conditionsText, setConditionsText] = useState(
    (info?.medical_conditions ?? []).join(', ')
  );

  const handleSubmit = (event: FormEvent): void => {
    event.preventDefault();
    update.mutate(
      {
        blood_type: bloodType.trim() || undefined,
        medication_allergies: splitCommaList(medicationAllergiesText),
        allergies: splitCommaList(allergiesText),
        medical_conditions: splitCommaList(conditionsText),
      },
      { onSuccess: onClose }
    );
  };

  return (
    <Modal
      title={t('edit.medical.title')}
      onClose={onClose}
      closeLabel={t('edit.close')}
      footer={
        <div className="flex justify-end gap-3">
          <Button variant="ghost" onClick={onClose} disabled={update.isPending}>
            {t('edit.cancel')}
          </Button>
          <Button type="submit" form="edit-medical-form" disabled={update.isPending}>
            {update.isPending ? t('edit.saving') : t('edit.save')}
          </Button>
        </div>
      }
    >
      <form id="edit-medical-form" onSubmit={handleSubmit} className="flex flex-col gap-4">
        <TextField
          id="blood_type"
          label={t('edit.medical.bloodType')}
          value={bloodType}
          maxLength={10}
          placeholder={t('edit.medical.bloodTypePlaceholder')}
          onChange={(e) => setBloodType(e.target.value.toUpperCase())}
        />
        <TextArea
          id="medication_allergies"
          label={t('edit.medical.medicationAllergies')}
          value={medicationAllergiesText}
          rows={2}
          hint={t('edit.medical.listHint')}
          onChange={(e) => setMedicationAllergiesText(e.target.value)}
        />
        <TextArea
          id="allergies"
          label={t('edit.medical.otherAllergies')}
          value={allergiesText}
          rows={2}
          hint={t('edit.medical.listHint')}
          onChange={(e) => setAllergiesText(e.target.value)}
        />
        <TextArea
          id="medical_conditions"
          label={t('edit.medical.conditions')}
          value={conditionsText}
          rows={2}
          hint={t('edit.medical.listHint')}
          onChange={(e) => setConditionsText(e.target.value)}
        />
      </form>
    </Modal>
  );
}
