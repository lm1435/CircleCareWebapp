import { useState, type FormEvent, type ReactElement } from 'react';
import { useTranslation } from 'react-i18next';
import type { EmergencyInfo, InsurancePlan } from '@/api/emergencyInfo';
import {
  toRequestPlans,
  upsertWithPrimaryExclusivity,
  useUpdateEmergencyInfo,
} from '@/hooks/useEmergencyInfo';
import { Button, Modal, TextField, Toggle } from '@/components/ui';

export interface EditInsuranceModalProps {
  circleId: string;
  info: EmergencyInfo | null;
  /** Index of the plan to edit, or undefined to add a new one. */
  index?: number;
  onClose: () => void;
}

const EMPTY_PLAN: InsurancePlan = { carrier: '' };

/**
 * Add/edit an insurance plan. Plans are a read-modify-write array with
 * single-primary exclusivity. Web entry is manual only (no card scan); any
 * existing OCR rx_* fields round-trip untouched. Mirrors mobile
 * EditInsuranceScreen.
 */
export function EditInsuranceModal({
  circleId,
  info,
  index,
  onClose,
}: EditInsuranceModalProps): ReactElement {
  const { t } = useTranslation('emergency');
  const update = useUpdateEmergencyInfo(circleId);

  const existing =
    index !== undefined ? (info?.insurance_plans?.[index] ?? EMPTY_PLAN) : EMPTY_PLAN;

  const [label, setLabel] = useState(existing.label ?? '');
  const [carrier, setCarrier] = useState(existing.carrier ?? '');
  const [policyNumber, setPolicyNumber] = useState(existing.policy_number ?? '');
  const [groupNumber, setGroupNumber] = useState(existing.group_number ?? '');
  const [phone, setPhone] = useState(existing.phone ?? '');
  const [isPrimary, setIsPrimary] = useState(existing.is_primary ?? false);
  const [error, setError] = useState<string | undefined>(undefined);

  const handleSubmit = (event: FormEvent): void => {
    event.preventDefault();
    if (!carrier.trim()) {
      setError(t('edit.insurance.carrierRequired'));
      document.getElementById('insurance-carrier')?.focus();
      return;
    }

    const plan: InsurancePlan = {
      // Preserve any OCR-derived fields from the original plan (web never edits
      // these, but they must survive a read-modify-write).
      ...(index !== undefined ? existing : {}),
      label: label.trim() || undefined,
      carrier: carrier.trim(),
      policy_number: policyNumber.trim() || undefined,
      group_number: groupNumber.trim() || undefined,
      phone: phone.trim() || undefined,
      is_primary: isPrimary,
    };
    const next = upsertWithPrimaryExclusivity(info?.insurance_plans ?? [], plan, index);

    update.mutate({ insurance_plans: toRequestPlans(next) }, { onSuccess: onClose });
  };

  return (
    <Modal
      title={index !== undefined ? t('edit.insurance.editTitle') : t('edit.insurance.addTitle')}
      onClose={onClose}
      closeLabel={t('edit.close')}
      footer={
        <div className="flex justify-end gap-3">
          <Button variant="ghost" onClick={onClose} disabled={update.isPending}>
            {t('edit.cancel')}
          </Button>
          <Button type="submit" form="edit-insurance-form" disabled={update.isPending}>
            {update.isPending ? t('edit.saving') : t('edit.save')}
          </Button>
        </div>
      }
    >
      <form id="edit-insurance-form" onSubmit={handleSubmit} className="flex flex-col gap-4">
        <TextField
          id="insurance-carrier"
          label={`${t('edit.insurance.carrier')} *`}
          value={carrier}
          maxLength={100}
          error={error}
          placeholder={t('edit.insurance.carrierPlaceholder')}
          onChange={(e) => {
            setCarrier(e.target.value);
            if (error) setError(undefined);
          }}
        />
        <TextField
          id="insurance-label"
          label={t('edit.insurance.label')}
          value={label}
          maxLength={100}
          placeholder={t('edit.insurance.labelPlaceholder')}
          onChange={(e) => setLabel(e.target.value)}
        />
        <TextField
          id="insurance-policy"
          label={t('edit.insurance.policyNumber')}
          value={policyNumber}
          maxLength={100}
          onChange={(e) => setPolicyNumber(e.target.value)}
        />
        <TextField
          id="insurance-group"
          label={t('edit.insurance.groupNumber')}
          value={groupNumber}
          maxLength={100}
          onChange={(e) => setGroupNumber(e.target.value)}
        />
        <TextField
          id="insurance-phone"
          type="tel"
          label={t('edit.insurance.phone')}
          value={phone}
          maxLength={20}
          onChange={(e) => setPhone(e.target.value)}
        />
        <Toggle
          checked={isPrimary}
          onChange={setIsPrimary}
          label={t('edit.insurance.primary')}
          hint={t('edit.insurance.primaryHint')}
        />
      </form>
    </Modal>
  );
}
