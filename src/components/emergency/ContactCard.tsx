import type { ReactElement } from 'react';
import { useTranslation } from 'react-i18next';
import { Badge, Card } from '@/components/ui';
import { CardActions } from './CardActions';
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
    <Card className="print-card">
      <div className="mb-3 flex flex-wrap items-center gap-2">
        <h3 className="m-0 text-base font-semibold text-ink">{name}</h3>
        {isPrimary && <Badge variant="terracotta">{t('primary')}</Badge>}
      </div>
      <FieldList fields={fields} />
      {onEdit && onDelete && (
        <CardActions
          onEdit={onEdit}
          onDelete={onDelete}
          editLabel={t('edit.editContactAria', { name })}
          deleteLabel={t('edit.deleteContactAria', { name })}
        />
      )}
    </Card>
  );
}
