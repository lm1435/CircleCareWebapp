import { useState, type FormEvent, type ReactElement } from 'react';
import { useTranslation } from 'react-i18next';
import type { AdditionalDoctor, EmergencyInfo } from '@/api/emergencyInfo';
import {
  appendItem,
  replaceAtIndex,
  useUpdateEmergencyInfo,
  type UpdateEmergencyInfoRequest,
} from '@/hooks/useEmergencyInfo';
import { useSubmitGuard } from '@/hooks/useGuardedSubmit';
import { SPECIALTY_KEYS } from '@/lib/quickPicks';
import { initialPhoneValue } from '@/lib/phone';
import { Button, ChipSelect, Modal, TextArea, TextField } from '@/components/ui';
import { PhoneField } from './PhoneField';

export interface EditDoctorModalProps {
  circleId: string;
  info: EmergencyInfo | null;
  /**
   * - `'primary'` → edit the flat primary_doctor_* fields.
   * - a number → edit additional_doctors[index].
   * - `undefined` → add a new additional doctor.
   */
  target: 'primary' | number | undefined;
  onClose: () => void;
}

const EMPTY_DOCTOR: AdditionalDoctor = { name: '' };

/**
 * Add/edit a doctor. The PRIMARY doctor lives in flat primary_doctor_* fields
 * (no array, no primary flag); ADDITIONAL doctors are a read-modify-write array.
 * Mirrors mobile EditDoctorScreen.
 */
type EditDoctorModalPropsLoaded = Omit<EditDoctorModalProps, 'info'> & { info: EmergencyInfo };

function EditDoctorModalForm({
  circleId,
  info,
  target,
  onClose,
}: EditDoctorModalPropsLoaded): ReactElement {
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

  const isPrimary = target === 'primary';
  const editIndex = typeof target === 'number' ? target : undefined;

  const initial: AdditionalDoctor = isPrimary
    ? {
        name: info?.primary_doctor_name ?? '',
        specialty: info?.primary_doctor_specialty ?? '',
        phone: info?.primary_doctor_phone ?? '',
        country_code: info?.primary_doctor_country_code ?? '',
        address: info?.primary_doctor_address ?? '',
      }
    : editIndex !== undefined
      ? (info?.additional_doctors?.[editIndex] ?? EMPTY_DOCTOR)
      : EMPTY_DOCTOR;

  const [name, setName] = useState(initial.name ?? '');
  const [specialty, setSpecialty] = useState(initial.specialty ?? '');
  // `phone` + `country_code` travel together: seeded (and normalized when the
  // country is knowable) from the record, re-emitted as a pair by PhoneField.
  const [phoneValue, setPhoneValue] = useState(() =>
    initialPhoneValue(initial.phone, initial.country_code)
  );
  const [address, setAddress] = useState(initial.address ?? '');
  const [nameError, setNameError] = useState<string | undefined>(undefined);

  const handleSubmit = (event: FormEvent): void => {
    event.preventDefault();
    if (!name.trim()) {
      setNameError(t('edit.doctor.nameRequired'));
      document.getElementById('doctor-name')?.focus();
      return;
    }

    // Claimed AFTER the validity gate, so a claim is never taken (and then
    // abandoned) on a submit that was going to bail out anyway.
    if (update.isPending || !submitGuard.claim()) return;

    const phone = phoneValue.phone.trim();
    const countryCode = phone ? phoneValue.countryCode : null;

    let partial: UpdateEmergencyInfoRequest;
    if (isPrimary) {
      partial = {
        primary_doctor_name: name.trim(),
        primary_doctor_specialty: specialty.trim() || null,
        primary_doctor_phone: phone || null,
        primary_doctor_country_code: countryCode,
        primary_doctor_address: address.trim() || null,
      };
    } else {
      // Every field is named explicitly — this rebuild used to omit
      // `country_code`, so editing a +52 doctor (even a rename) silently
      // turned it into a US number.
      const doctor: AdditionalDoctor = {
        name: name.trim(),
        specialty: specialty.trim() || null,
        phone: phone || null,
        country_code: countryCode,
        address: address.trim() || null,
      };
      const current = info?.additional_doctors ?? [];
      const next =
        editIndex !== undefined
          ? replaceAtIndex(current, editIndex, doctor)
          : appendItem(current, doctor);
      partial = { additional_doctors: next };
    }

    update.mutate(partial, { onSuccess: onClose, onSettled: submitGuard.release });
  };

  const title = isPrimary
    ? t('edit.doctor.primaryTitle')
    : editIndex !== undefined
      ? t('edit.doctor.editTitle')
      : t('edit.doctor.addTitle');

  return (
    <Modal
      title={title}
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
          <Button type="submit" form="edit-doctor-form" variant="primary" loading={update.isPending}>
            {t('edit.save')}
          </Button>
        </div>
      }
    >
      <form id="edit-doctor-form" onSubmit={handleSubmit} className="flex flex-col gap-4">
        <TextField
          id="doctor-name"
          label={t('edit.doctor.name')}
          required
          value={name}
          maxLength={100}
          error={nameError}
          placeholder={t('edit.doctor.namePlaceholder')}
          onChange={(e) => {
            setName(e.target.value);
            if (nameError) setNameError(undefined);
          }}
        />
        <TextField
          id="doctor-specialty"
          label={t('edit.doctor.specialty')}
          value={specialty}
          maxLength={100}
          placeholder={t('edit.doctor.specialtyPlaceholder')}
          onChange={(e) => setSpecialty(e.target.value)}
        />
        {/* Quick-fill: chips fill the specialty field above; the field stays
            the source of truth (custom specialties remain possible). Selected
            = field matches the chip case-insensitively (QP3). */}
        <ChipSelect
          id="doctor-specialty-suggestions"
          label={t('specialties.label')}
          options={SPECIALTY_KEYS.map((key) => t(key))}
          value={specialty}
          // Quick-fill row (text field stays the source of truth) — re-tapping
          // the selected chip must not silently clear the field (WA7).
          allowDeselect={false}
          onChange={(next) => setSpecialty(next ?? '')}
        />
        <PhoneField
          id="doctor-phone"
          label={t('edit.doctor.phone')}
          value={phoneValue.phone}
          countryCode={phoneValue.countryCode}
          onChange={(phone, countryCode) => setPhoneValue({ phone, countryCode })}
        />
        <TextArea
          id="doctor-address"
          label={t('edit.doctor.address')}
          value={address}
          rows={2}
          maxLength={1000}
          placeholder={t('edit.doctor.addressPlaceholder')}
          onChange={(e) => setAddress(e.target.value)}
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
export function EditDoctorModal(props: EditDoctorModalProps): ReactElement | null {
  if (!props.info) return null;
  return <EditDoctorModalForm {...props} info={props.info} />;
}
