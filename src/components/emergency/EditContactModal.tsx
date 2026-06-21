import { useState, type FormEvent, type ReactElement } from 'react';
import { useTranslation } from 'react-i18next';
import type { EmergencyContact, EmergencyInfo } from '@/api/emergencyInfo';
import {
  toRequestContacts,
  upsertWithPrimaryExclusivity,
  useUpdateEmergencyInfo,
} from '@/hooks/useEmergencyInfo';
import { Button, Modal, TextField, Toggle } from '@/components/ui';

export interface EditContactModalProps {
  circleId: string;
  info: EmergencyInfo | null;
  /** Index of the contact to edit, or undefined to add a new one. */
  index?: number;
  onClose: () => void;
}

const EMPTY_CONTACT: EmergencyContact = { name: '', relationship: '', phone: '' };

/**
 * Add/edit an emergency contact. Contacts are a read-modify-write array with
 * single-primary exclusivity (setting one primary clears the flag on others).
 * Mirrors mobile EditContactScreen.
 */
export function EditContactModal({
  circleId,
  info,
  index,
  onClose,
}: EditContactModalProps): ReactElement {
  const { t } = useTranslation('emergency');
  const update = useUpdateEmergencyInfo(circleId);

  const existing =
    index !== undefined ? (info?.emergency_contacts?.[index] ?? EMPTY_CONTACT) : EMPTY_CONTACT;

  const [name, setName] = useState(existing.name ?? '');
  const [relationship, setRelationship] = useState(existing.relationship ?? '');
  const [phone, setPhone] = useState(existing.phone ?? '');
  const [isPrimary, setIsPrimary] = useState(existing.is_primary ?? false);
  const [error, setError] = useState<string | undefined>(undefined);

  const handleSubmit = (event: FormEvent): void => {
    event.preventDefault();
    if (!name.trim() || !relationship.trim() || !phone.trim()) {
      setError(t('edit.contact.requiredFields'));
      return;
    }

    const contact: EmergencyContact = {
      name: name.trim(),
      relationship: relationship.trim(),
      phone: phone.trim(),
      country_code: existing.country_code ?? undefined,
      is_primary: isPrimary,
    };
    const next = upsertWithPrimaryExclusivity(info?.emergency_contacts ?? [], contact, index);

    update.mutate({ emergency_contacts: toRequestContacts(next) }, { onSuccess: onClose });
  };

  return (
    <Modal
      title={index !== undefined ? t('edit.contact.editTitle') : t('edit.contact.addTitle')}
      onClose={onClose}
      closeLabel={t('edit.close')}
      footer={
        <div className="flex justify-end gap-3">
          <Button variant="ghost" onClick={onClose} disabled={update.isPending}>
            {t('edit.cancel')}
          </Button>
          <Button type="submit" form="edit-contact-form" disabled={update.isPending}>
            {update.isPending ? t('edit.saving') : t('edit.save')}
          </Button>
        </div>
      }
    >
      <form id="edit-contact-form" onSubmit={handleSubmit} className="flex flex-col gap-4">
        <TextField
          id="contact-name"
          label={`${t('edit.contact.name')} *`}
          value={name}
          maxLength={100}
          error={error && !name.trim() ? error : undefined}
          placeholder={t('edit.contact.namePlaceholder')}
          onChange={(e) => {
            setName(e.target.value);
            if (error) setError(undefined);
          }}
        />
        <TextField
          id="contact-relationship"
          label={`${t('edit.contact.relationship')} *`}
          value={relationship}
          maxLength={100}
          error={error && !relationship.trim() ? error : undefined}
          placeholder={t('edit.contact.relationshipPlaceholder')}
          onChange={(e) => {
            setRelationship(e.target.value);
            if (error) setError(undefined);
          }}
        />
        <TextField
          id="contact-phone"
          type="tel"
          label={`${t('edit.contact.phone')} *`}
          value={phone}
          maxLength={20}
          error={error && !phone.trim() ? error : undefined}
          onChange={(e) => {
            setPhone(e.target.value);
            if (error) setError(undefined);
          }}
        />
        <Toggle
          checked={isPrimary}
          onChange={setIsPrimary}
          label={t('edit.contact.primary')}
          hint={t('edit.contact.primaryHint')}
        />
      </form>
    </Modal>
  );
}
