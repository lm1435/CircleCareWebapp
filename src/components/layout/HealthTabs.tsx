import type { ReactElement } from 'react';
import { useTranslation } from 'react-i18next';
import { SectionTabs } from './SectionTabs';

/**
 * The Health section switcher (spec §5.3) — the CareTabs twin over
 * Emergency · Documents. See `SectionTabs` for the shared behavior and why
 * this reads the route itself and is hidden from `xl` up.
 */
export function HealthTabs(): ReactElement | null {
  const { t } = useTranslation('common');
  return (
    <SectionTabs
      label={t('nav.healthShort')}
      options={[
        { value: 'emergency', label: t('nav.emergency') },
        { value: 'documents', label: t('nav.documents') },
      ]}
    />
  );
}
