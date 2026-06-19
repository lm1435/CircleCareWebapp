import type { ReactElement } from 'react';
import { useTranslation } from 'react-i18next';
import { Card } from '@/components/ui';
import { FieldList, type Field } from './FieldList';

export interface DirectivesCardProps {
  hasDnr: boolean;
  /** Free-text advance directives notes. */
  directives?: string | null;
}

/** Read-only code status: DNR flag + advance directives text. */
export function DirectivesCard({ hasDnr, directives }: DirectivesCardProps): ReactElement {
  const { t } = useTranslation('emergency');

  const fields: Field[] = [
    {
      label: t('directives.dnrStatus'),
      value: hasDnr ? t('directives.dnrYes') : t('directives.dnrNo'),
    },
  ];
  if (directives) {
    fields.push({
      label: t('directives.details'),
      value: <span className="whitespace-pre-wrap">{directives}</span>,
    });
  }

  return (
    <Card className="print-card">
      <FieldList fields={fields} />
    </Card>
  );
}
