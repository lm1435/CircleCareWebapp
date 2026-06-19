import type { ReactElement } from 'react';
import { useTranslation } from 'react-i18next';
import { Badge, Card } from '@/components/ui';
import type { InsurancePlan } from '@/api/emergencyInfo';
import { FieldList, type Field } from './FieldList';
import { PhoneLink } from './PhoneLink';

export interface InsuranceCardProps {
  plan: InsurancePlan;
}

/** Read-only insurance plan display (policy/group/Rx identifiers). */
export function InsuranceCard({ plan }: InsuranceCardProps): ReactElement {
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
    <Card className="print-card">
      <div className="mb-3 flex flex-wrap items-center gap-2">
        <h3 className="m-0 text-lg font-medium text-ink">{plan.carrier}</h3>
        {plan.label && <Badge variant="neutral">{plan.label}</Badge>}
        {plan.is_primary && <Badge variant="terracotta">{t('primary')}</Badge>}
      </div>
      {fields.length > 0 && <FieldList fields={fields} />}
    </Card>
  );
}
