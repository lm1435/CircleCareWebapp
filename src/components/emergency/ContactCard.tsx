import type { ReactElement } from 'react';
import { useTranslation } from 'react-i18next';
import { Card } from '@/components/ui';
import { CardActions } from './CardActions';
import { PrimaryNameHeading } from './PrimaryNameHeading';
import { FieldList, type Field } from './FieldList';
import { PhoneLink } from './PhoneLink';

export interface ContactCardProps {
  name: string;
  relationship: string;
  phone: string;
  countryCode?: string | null;
  isPrimary?: boolean;
  onEdit?: () => void;
  onDelete?: () => void;
}

/** Read-only emergency contact display. */
export function ContactCard({
  name,
  relationship,
  phone,
  countryCode,
  isPrimary = false,
  onEdit,
  onDelete,
}: ContactCardProps): ReactElement {
  const { t } = useTranslation('emergency');

  const fields: Field[] = [];
  if (relationship) {
    fields.push({ label: t('contacts.relationship'), value: relationship });
  }
  fields.push({
    label: t('contacts.phone'),
    value: (
      <PhoneLink phone={phone} countryCode={countryCode} ariaLabel={t('callAria', { name })} />
    ),
  });

  return (
    <Card padding="lg" className="print-card">
      <div className="mb-3 flex items-start justify-between gap-2">
        <PrimaryNameHeading name={name} isPrimary={isPrimary} />
        {onEdit && onDelete && (
          <CardActions
            onEdit={onEdit}
            onDelete={onDelete}
            name={name}
            editLabel={t('edit.editContactAria', { name })}
            deleteLabel={t('edit.deleteContactAria', { name })}
          />
        )}
      </div>
      <FieldList fields={fields} />
    </Card>
  );
}
