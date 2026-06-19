import type { ReactElement } from 'react';
import { useTranslation } from 'react-i18next';
import { Card } from '@/components/ui';
import { FieldList, type Field } from './FieldList';

export interface MedicalInfoCardProps {
  bloodType?: string | null;
  medicationAllergies: string[];
  allergies: string[];
  conditions: string[];
}

/**
 * Read-only medical info: blood type, allergies, conditions. Only rows with
 * data render — the page shows the section empty state when nothing is set.
 */
export function MedicalInfoCard({
  bloodType,
  medicationAllergies,
  allergies,
  conditions,
}: MedicalInfoCardProps): ReactElement {
  const { t } = useTranslation('emergency');

  const fields: Field[] = [];
  if (bloodType) {
    fields.push({ label: t('medicalInfo.bloodType'), value: bloodType });
  }
  if (medicationAllergies.length > 0) {
    fields.push({
      label: t('medicalInfo.medicationAllergies'),
      value: medicationAllergies.join(', '),
    });
  }
  if (allergies.length > 0) {
    fields.push({ label: t('medicalInfo.otherAllergies'), value: allergies.join(', ') });
  }
  if (conditions.length > 0) {
    fields.push({ label: t('medicalInfo.conditions'), value: conditions.join(', ') });
  }

  return (
    <Card className="print-card">
      <FieldList fields={fields} />
    </Card>
  );
}
