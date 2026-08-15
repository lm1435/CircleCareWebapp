import { useState, type FormEvent, type ReactElement } from 'react';
import { useTranslation } from 'react-i18next';
import type { EmergencyInfo } from '@/api/emergencyInfo';
import { useUpdateEmergencyInfo } from '@/hooks/useEmergencyInfo';
import {
  CONDITION_TAG_KEYS,
  MED_ALLERGY_TAG_KEYS,
  OTHER_ALLERGY_TAG_KEYS,
} from '@/lib/medicalTags';
import { Button, ChipSelect, Modal, TagInput } from '@/components/ui';

export interface EditMedicalInfoModalProps {
  circleId: string;
  /** Current emergency info snapshot (null when nothing saved yet). */
  info: EmergencyInfo | null;
  onClose: () => void;
}

/**
 * Split a comma-separated text field into a trimmed, non-empty string array.
 * NOTE (stale comment fixed — WB11): this used to say "still used by
 * EditCirclePage — keep exported," but EditCirclePage now carries its OWN
 * local copy of this exact helper (see `pages/EditCirclePage.tsx`) rather
 * than importing this one. No current caller imports this export; it stays
 * `export`ed here only because splitting it out isn't this fix's job.
 */
export function splitCommaList(text: string): string[] {
  return text
    .split(',')
    .map((entry) => entry.trim())
    .filter(Boolean);
}

const BLOOD_TYPES = ['A+', 'A-', 'B+', 'B-', 'AB+', 'AB-', 'O+', 'O-'];

/**
 * Edit the medical-info slice: blood type + three tag arrays (medication
 * allergies / other allergies / conditions) entered via TagInput (Condition
 * Tags — docs/plans/condition-tags.md). Mirrors mobile EditMedicalInfoScreen —
 * arrays round-trip directly (no comma join/split), and the partial PUT sends
 * ALL four medical keys at once.
 */
type EditMedicalInfoModalPropsLoaded = Omit<EditMedicalInfoModalProps, 'info'> & { info: EmergencyInfo };

function EditMedicalInfoModalForm({
  circleId,
  info,
  onClose,
}: EditMedicalInfoModalPropsLoaded): ReactElement {
  const { t } = useTranslation('emergency');
  const update = useUpdateEmergencyInfo(circleId);

  const [bloodType, setBloodType] = useState(info?.blood_type ?? '');
  const [medicationAllergies, setMedicationAllergies] = useState<string[]>(
    info?.medication_allergies ?? []
  );
  const [allergies, setAllergies] = useState<string[]>(info?.allergies ?? []);
  const [conditions, setConditions] = useState<string[]>(info?.medical_conditions ?? []);

  const storedBloodType = bloodType.trim();
  const bloodTypeOptions =
    BLOOD_TYPES.some((bt) => bt.toUpperCase() === storedBloodType.toUpperCase()) || !storedBloodType
      ? BLOOD_TYPES
      : [...BLOOD_TYPES, storedBloodType];

  const handleSubmit = (event: FormEvent): void => {
    event.preventDefault();
    update.mutate(
      {
        // null (not undefined) so clearing a previously-set value persists.
        blood_type: bloodType.trim() || null,
        medication_allergies: medicationAllergies,
        allergies,
        medical_conditions: conditions,
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
        {/* Blood type — single-select chips; clicking the selected chip clears it.
            Legacy free-text values stay visible as an extra chip so they can be
            deselected; new selections are standard types only. */}
        <div className="flex flex-col gap-1.5">
          <span className="text-sm font-medium text-ink-2">{t('edit.medical.bloodType')}</span>
          <ChipSelect
            id="blood_type"
            label={t('edit.medical.bloodType')}
            options={bloodTypeOptions}
            value={storedBloodType || null}
            onChange={(next) => setBloodType(next ?? '')}
          />
        </div>
        <TagInput
          id="medication_allergies"
          label={t('edit.medical.medicationAllergies')}
          values={medicationAllergies}
          onChange={setMedicationAllergies}
          suggestions={MED_ALLERGY_TAG_KEYS.map((key) => t(key))}
          placeholder={t('edit.medical.medicationAllergiesPlaceholder')}
        />
        <TagInput
          id="allergies"
          label={t('edit.medical.otherAllergies')}
          values={allergies}
          onChange={setAllergies}
          suggestions={OTHER_ALLERGY_TAG_KEYS.map((key) => t(key))}
          placeholder={t('edit.medical.otherAllergiesPlaceholder')}
        />
        <TagInput
          id="medical_conditions"
          label={t('edit.medical.conditions')}
          values={conditions}
          onChange={setConditions}
          suggestions={CONDITION_TAG_KEYS.map((key) => t(key))}
          placeholder={t('edit.medical.conditionsPlaceholder')}
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
export function EditMedicalInfoModal(props: EditMedicalInfoModalProps): ReactElement | null {
  if (!props.info) return null;
  return <EditMedicalInfoModalForm {...props} info={props.info} />;
}
