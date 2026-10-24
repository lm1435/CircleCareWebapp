import type { ReactElement } from 'react';
import { Link } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { Badge, Card, Icon, Text } from '@/components/ui';
import { CardActions } from './CardActions';
import { FieldList, type Field } from './FieldList';
import { MapsLink } from '@/components/MapsLink';
import { PhoneLink } from './PhoneLink';

export interface DoctorCardProps {
  name: string;
  specialty?: string | null;
  phone?: string | null;
  countryCode?: string | null;
  extension?: string | null;
  address?: string | null;
  isPrimary?: boolean;
  /**
   * "Visits & notes" row (notes by doctor): a link to this doctor's visits page,
   * shown to every member (view-only included). `count` appears only when above 0.
   * Omit for a doctor with no stable id yet.
   */
  visits?: { to: string; count?: number };
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
  extension,
  address,
  isPrimary = false,
  visits,
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
          extension={extension}
          ariaLabel={t('callAria', { name })}
        />
      ),
    });
  }
  if (address) {
    fields.push({ label: t('doctors.address'), value: <MapsLink address={address} /> });
  }

  return (
    <Card padding="lg" className="print-card">
      <div className="mb-3 flex items-start justify-between gap-2">
        <div className="flex flex-wrap items-center gap-2">
          <Text variant="h3" as="h3">
            {name}
          </Text>
          {isPrimary && <Badge variant="error">{t('primary')}</Badge>}
        </div>
        {onEdit && onDelete && (
          <CardActions
            onEdit={onEdit}
            onDelete={onDelete}
            name={name}
            editLabel={t('edit.editDoctorAria', { name })}
            deleteLabel={t('edit.deleteDoctorAria', { name })}
          />
        )}
      </div>
      {fields.length > 0 && <FieldList fields={fields} />}
      {visits && (
        // The card's own row, not a control inside the FieldList: a full-width,
        // 44px+ target that routes to the doctor's visits. Hidden in print (the
        // fridge sheet lists doctors, it does not link anywhere).
        <Link
          to={visits.to}
          state={{ source: 'medical_info' }}
          className={`no-print flex min-h-[44px] items-center justify-between gap-3 border-t border-line-2 pt-3 text-ink no-underline hover:text-ink-2 ${
            fields.length > 0 ? 'mt-3' : ''
          }`}
        >
          <span className="flex items-center gap-2 text-base font-medium">
            <Icon name="document-text-outline" size="row" />
            <span>
              {t('providers.visitsLink')}{' '}
              <span className="sr-only">{t('providers.visitsLinkFor', { name })}</span>
            </span>
          </span>{' '}
          <span className="flex items-center gap-1 text-sm text-ink-2">
            {visits.count && visits.count > 0 ? <span>{visits.count}</span> : null}
            <Icon name="chevron-forward" size="row" />
          </span>
        </Link>
      )}
    </Card>
  );
}
