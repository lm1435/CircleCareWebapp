import type { ReactElement } from 'react';
import { useTranslation } from 'react-i18next';
import { Badge, Card } from '@/components/ui';
import { CardActions } from './CardActions';
import { FieldList, type Field } from './FieldList';
import { PhoneLink } from './PhoneLink';

export interface DoctorCardProps {
  name: string;
  specialty?: string | null;
  phone?: string | null;
  countryCode?: string | null;
  address?: string | null;
  isPrimary?: boolean;
  /** When set (canEdit), renders the Edit action. */
  onEdit?: () => void;
  /** When set (canEdit), renders the Delete action. */
  onDelete?: () => void;
}

/** Read-only doctor display (primary doctor or additional doctor). */
export function DoctorCard({
  name,
  specialty,
  phone,
  countryCode,
  address,
  isPrimary = false,
  onEdit,
  onDelete,
}: DoctorCardProps): ReactElement {
  const { t } = useTranslation('emergency');

  const fields: Field[] = [];
  if (specialty) {
    fields.push({ label: t('doctors.specialty'), value: specialty });
  }
  if (phone) {
    fields.push({
      label: t('doctors.phone'),
      value: (
        <PhoneLink
          phone={phone}
          countryCode={countryCode}
          ariaLabel={t('callAria', { name })}
        />
      ),
    });
  }
  if (address) {
    fields.push({ label: t('doctors.address'), value: address });
  }

  return (
    <Card className="print-card">
      <div className="mb-3 flex flex-wrap items-center gap-2">
        <h3 className="m-0 text-base font-semibold text-ink">{name}</h3>
        {isPrimary && <Badge variant="terracotta">{t('primary')}</Badge>}
      </div>
      {fields.length > 0 && <FieldList fields={fields} />}
      {onEdit && onDelete && (
        <CardActions
          onEdit={onEdit}
          onDelete={onDelete}
          editLabel={t('edit.editDoctorAria', { name })}
          deleteLabel={t('edit.deleteDoctorAria', { name })}
        />
      )}
    </Card>
  );
}
