import type { ReactElement } from 'react';
import { useTranslation } from 'react-i18next';
import { Badge, Card, Text } from '@/components/ui';
import type { InsurancePlan } from '@/api/emergencyInfo';
import { CardActions } from './CardActions';
import { FieldList, type Field } from './FieldList';
import { PhoneLink } from './PhoneLink';

export interface InsuranceCardProps {
  plan: InsurancePlan;
  onEdit?: () => void;
  onDelete?: () => void;
}

/** Read-only insurance plan display (policy/group/Rx identifiers). */
export function InsuranceCard({ plan, onEdit, onDelete }: InsuranceCardProps): ReactElement {
  const { t } = useTranslation('emergency');

  const fields: Field[] = [];
  if (plan.policy_number) {
    fields.push({ label: t('insurance.policyNumber'), value: plan.policy_number });
  }
  if (plan.group_number) {
    fields.push({ label: t('insurance.groupNumber'), value: plan.group_number });
  }
  if (plan.rx_bin) {
    fields.push({ label: t('insurance.rxBin'), value: plan.rx_bin });
  }
  if (plan.rx_pcn) {
    fields.push({ label: t('insurance.rxPcn'), value: plan.rx_pcn });
  }
  if (plan.rx_group) {
    fields.push({ label: t('insurance.rxGroup'), value: plan.rx_group });
  }
  if (plan.phone) {
    fields.push({
      label: t('insurance.phone'),
      value: (
        <PhoneLink
          phone={plan.phone}
          countryCode={plan.country_code}
          ariaLabel={t('callAria', { name: plan.carrier })}
        />
      ),
    });
  }

  return (
    <Card padding="lg" className="print-card">
      <div className="mb-3 flex items-start justify-between gap-2">
        <div className="flex flex-wrap items-center gap-2">
          <Text variant="h3" as="h3">
            {plan.carrier}
          </Text>
          {plan.label && <Badge variant="default">{plan.label}</Badge>}
          {plan.is_primary && <Badge variant="error">{t('primary')}</Badge>}
        </div>
        {onEdit && onDelete && (
          <CardActions
            onEdit={onEdit}
            onDelete={onDelete}
            name={plan.carrier}
            editLabel={t('edit.editInsuranceAria', { name: plan.carrier })}
            deleteLabel={t('edit.deleteInsuranceAria', { name: plan.carrier })}
          />
        )}
      </div>
      {fields.length > 0 && <FieldList fields={fields} />}
    </Card>
  );
}
