import { useState, type FormEvent, type ReactElement } from 'react';
import { useTranslation } from 'react-i18next';
import type { EmergencyInfo, InsurancePlan } from '@/api/emergencyInfo';
import {
  toRequestPlans,
  upsertWithPrimaryExclusivity,
  useUpdateEmergencyInfo,
} from '@/hooks/useEmergencyInfo';
import { useSubmitGuard } from '@/hooks/useGuardedSubmit';
import { initialPhoneValue } from '@/lib/phone';
import { Button, Modal, TextField, Toggle } from '@/components/ui';
import { PhoneField } from './PhoneField';

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
type EditInsuranceModalPropsLoaded = Omit<EditInsuranceModalProps, 'info'> & { info: EmergencyInfo };

function EditInsuranceModalForm({
  circleId,
  info,
  index,
  onClose,
}: EditInsuranceModalPropsLoaded): ReactElement {
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

  const existing =
    index !== undefined ? (info?.insurance_plans?.[index] ?? EMPTY_PLAN) : EMPTY_PLAN;

  const [label, setLabel] = useState(existing.label ?? '');
  const [carrier, setCarrier] = useState(existing.carrier ?? '');
  const [policyNumber, setPolicyNumber] = useState(existing.policy_number ?? '');
  const [groupNumber, setGroupNumber] = useState(existing.group_number ?? '');
  // `phone` + `country_code` travel together (see PhoneField).
  const [phoneValue, setPhoneValue] = useState(() =>
    initialPhoneValue(existing.phone, existing.country_code)
  );
  const [isPrimary, setIsPrimary] = useState(existing.is_primary ?? false);
  const [error, setError] = useState<string | undefined>(undefined);

  const handleSubmit = (event: FormEvent): void => {
    event.preventDefault();
    if (!carrier.trim()) {
      setError(t('edit.insurance.carrierRequired'));
      document.getElementById('insurance-carrier')?.focus();
      return;
    }

    // Claimed AFTER the validity gate, so a claim is never taken (and then
    // abandoned) on a submit that was going to bail out anyway.
    if (update.isPending || !submitGuard.claim()) return;

    const plan: InsurancePlan = {
      // Preserve any OCR-derived fields from the original plan (web never edits
      // these, but they must survive a read-modify-write).
      ...(index !== undefined ? existing : {}),
      label: label.trim() || undefined,
      carrier: carrier.trim(),
      policy_number: policyNumber.trim() || undefined,
      group_number: groupNumber.trim() || undefined,
      phone: phoneValue.phone.trim() || undefined,
      country_code: (phoneValue.phone.trim() && phoneValue.countryCode) || undefined,
      is_primary: isPrimary,
    };
    const next = upsertWithPrimaryExclusivity(info?.insurance_plans ?? [], plan, index);

    update.mutate(
      { insurance_plans: toRequestPlans(next) },
      { onSuccess: onClose, onSettled: submitGuard.release }
    );
  };

  return (
    <Modal
      title={index !== undefined ? t('edit.insurance.editTitle') : t('edit.insurance.addTitle')}
      // lg, not the md default: the phone row needs a ~17.5rem country column
      // beside the number (see PhoneField).
      size="lg"
      onClose={onClose}
      closeLabel={t('edit.close')}
      footer={
        <div className="flex justify-end gap-3">
          <Button variant="secondary" onClick={onClose} disabled={update.isPending}>
            {t('edit.cancel')}
          </Button>
          <Button type="submit" form="edit-insurance-form" variant="primary" loading={update.isPending}>
            {t('edit.save')}
          </Button>
        </div>
      }
    >
      <form id="edit-insurance-form" onSubmit={handleSubmit} className="flex flex-col gap-4">
        <TextField
          id="insurance-carrier"
          label={t('edit.insurance.carrier')}
          required
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
        <PhoneField
          id="insurance-phone"
          label={t('edit.insurance.phone')}
          value={phoneValue.phone}
          countryCode={phoneValue.countryCode}
          onChange={(phone, countryCode) => setPhoneValue({ phone, countryCode })}
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
export function EditInsuranceModal(props: EditInsuranceModalProps): ReactElement | null {
  if (!props.info) return null;
  return <EditInsuranceModalForm {...props} info={props.info} />;
}
