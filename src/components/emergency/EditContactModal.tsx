import { useState, type FormEvent, type ReactElement } from 'react';
import { useTranslation } from 'react-i18next';
import type { EmergencyContact, EmergencyInfo } from '@/api/emergencyInfo';
import {
  toRequestContacts,
  upsertWithPrimaryExclusivity,
  useUpdateEmergencyInfo,
} from '@/hooks/useEmergencyInfo';
import { useSubmitGuard } from '@/hooks/useGuardedSubmit';
import { RELATIONSHIP_KEYS } from '@/lib/quickPicks';
import { initialPhoneValue } from '@/lib/phone';
import { Button, ChipSelect, Modal, TextField, Toggle } from '@/components/ui';
import { PhoneField } from './PhoneField';

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
type EditContactModalPropsLoaded = Omit<EditContactModalProps, 'info'> & { info: EmergencyInfo };

function EditContactModalForm({
  circleId,
  info,
  index,
  onClose,
}: EditContactModalPropsLoaded): ReactElement {
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
    index !== undefined ? (info?.emergency_contacts?.[index] ?? EMPTY_CONTACT) : EMPTY_CONTACT;

  const [name, setName] = useState(existing.name ?? '');
  const [relationship, setRelationship] = useState(existing.relationship ?? '');
  // `phone` + `country_code` travel together (see PhoneField).
  const [phoneValue, setPhoneValue] = useState(() =>
    initialPhoneValue(existing.phone, existing.country_code)
  );
  const phone = phoneValue.phone;
  const [isPrimary, setIsPrimary] = useState(existing.is_primary ?? false);
  const [error, setError] = useState<string | undefined>(undefined);

  const handleSubmit = (event: FormEvent): void => {
    event.preventDefault();
    if (!name.trim() || !relationship.trim() || !phone.trim()) {
      setError(t('edit.contact.requiredFields'));
      return;
    }

    // Claimed AFTER the validity gate, so a claim is never taken (and then
    // abandoned) on a submit that was going to bail out anyway.
    if (update.isPending || !submitGuard.claim()) return;

    const contact: EmergencyContact = {
      name: name.trim(),
      relationship: relationship.trim(),
      phone: phone.trim(),
      country_code: phoneValue.countryCode ?? undefined,
      is_primary: isPrimary,
    };
    const next = upsertWithPrimaryExclusivity(info?.emergency_contacts ?? [], contact, index);

    update.mutate(
      { emergency_contacts: toRequestContacts(next) },
      { onSuccess: onClose, onSettled: submitGuard.release }
    );
  };

  return (
    <Modal
      title={index !== undefined ? t('edit.contact.editTitle') : t('edit.contact.addTitle')}
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
          <Button type="submit" form="edit-contact-form" variant="primary" loading={update.isPending}>
            {t('edit.save')}
          </Button>
        </div>
      }
    >
      <form id="edit-contact-form" onSubmit={handleSubmit} className="flex flex-col gap-4">
        <TextField
          id="contact-name"
          label={t('edit.contact.name')}
          required
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
          label={t('edit.contact.relationship')}
          required
          value={relationship}
          maxLength={100}
          error={error && !relationship.trim() ? error : undefined}
          placeholder={t('edit.contact.relationshipPlaceholder')}
          onChange={(e) => {
            setRelationship(e.target.value);
            if (error) setError(undefined);
          }}
        />
        {/* Quick-fill: chips fill the field above; the field stays the source
            of truth (custom values like "Niece" remain possible). Selected =
            field matches the chip case-insensitively (QP2). */}
        <ChipSelect
          id="contact-relationship-suggestions"
          label={t('relationships.label')}
          options={RELATIONSHIP_KEYS.map((key) => t(key))}
          value={relationship}
          // Quick-fill row (text field stays the source of truth) — re-tapping
          // the selected chip must not clear a required field (WA7).
          allowDeselect={false}
          onChange={(next) => {
            setRelationship(next ?? '');
            if (next && error) setError(undefined);
          }}
        />
        <PhoneField
          id="contact-phone"
          label={t('edit.contact.phone')}
          required
          value={phoneValue.phone}
          countryCode={phoneValue.countryCode}
          error={error && !phone.trim() ? error : undefined}
          onChange={(nextPhone, countryCode) => {
            setPhoneValue({ phone: nextPhone, countryCode });
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
export function EditContactModal(props: EditContactModalProps): ReactElement | null {
  if (!props.info) return null;
  return <EditContactModalForm {...props} info={props.info} />;
}
