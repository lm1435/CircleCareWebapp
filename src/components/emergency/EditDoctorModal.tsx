import { useState, type FormEvent, type ReactElement } from 'react';
import { useTranslation } from 'react-i18next';
import type { AdditionalDoctor, EmergencyInfo } from '@/api/emergencyInfo';
import {
  appendItem,
  replaceAtIndex,
  useUpdateEmergencyInfo,
  type UpdateEmergencyInfoRequest,
} from '@/hooks/useEmergencyInfo';
import { Button, Modal, TextArea, TextField } from '@/components/ui';

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
export function EditDoctorModal({
  circleId,
  info,
  target,
  onClose,
}: EditDoctorModalProps): ReactElement {
  const { t } = useTranslation('emergency');
  const update = useUpdateEmergencyInfo(circleId);

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
  const [phone, setPhone] = useState(initial.phone ?? '');
  const [address, setAddress] = useState(initial.address ?? '');
  const [nameError, setNameError] = useState<string | undefined>(undefined);

  const handleSubmit = (event: FormEvent): void => {
    event.preventDefault();
    if (!name.trim()) {
      setNameError(t('edit.doctor.nameRequired'));
      document.getElementById('doctor-name')?.focus();
      return;
    }

    let partial: UpdateEmergencyInfoRequest;
    if (isPrimary) {
      partial = {
        primary_doctor_name: name.trim(),
        primary_doctor_specialty: specialty.trim() || null,
        primary_doctor_phone: phone.trim() || null,
        primary_doctor_address: address.trim() || null,
      };
    } else {
      const doctor: AdditionalDoctor = {
        name: name.trim(),
        specialty: specialty.trim() || null,
        phone: phone.trim() || null,
        address: address.trim() || null,
      };
      const current = info?.additional_doctors ?? [];
      const next =
        editIndex !== undefined
          ? replaceAtIndex(current, editIndex, doctor)
          : appendItem(current, doctor);
      partial = { additional_doctors: next };
    }

    update.mutate(partial, { onSuccess: onClose });
  };

  const title = isPrimary
    ? t('edit.doctor.primaryTitle')
    : editIndex !== undefined
      ? t('edit.doctor.editTitle')
      : t('edit.doctor.addTitle');

  return (
    <Modal
      title={title}
      onClose={onClose}
      closeLabel={t('edit.close')}
      footer={
        <div className="flex justify-end gap-3">
          <Button variant="ghost" onClick={onClose} disabled={update.isPending}>
            {t('edit.cancel')}
          </Button>
          <Button type="submit" form="edit-doctor-form" disabled={update.isPending}>
            {update.isPending ? t('edit.saving') : t('edit.save')}
          </Button>
        </div>
      }
    >
      <form id="edit-doctor-form" onSubmit={handleSubmit} className="flex flex-col gap-4">
        <TextField
          id="doctor-name"
          label={`${t('edit.doctor.name')} *`}
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
        <TextField
          id="doctor-phone"
          type="tel"
          label={t('edit.doctor.phone')}
          value={phone}
          maxLength={20}
          onChange={(e) => setPhone(e.target.value)}
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
