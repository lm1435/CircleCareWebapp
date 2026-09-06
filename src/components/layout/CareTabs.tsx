import type { ReactElement } from 'react';
import { useTranslation } from 'react-i18next';
import { SectionTabs } from './SectionTabs';

/**
 * The Care section switcher (spec §5.3; mobile's Care top tab bar). See
 * `SectionTabs` for the shared behavior — `HealthTabs` is the same control
 * over Emergency · Documents.
 */
export function CareTabs(): ReactElement | null {
  const { t } = useTranslation('common');
  return (
    <SectionTabs
      label={t('nav.careShort')}
      options={[
        { value: 'calendar', label: t('nav.calendar') },
        { value: 'meds', label: t('nav.meds') },
        { value: 'tasks', label: t('nav.tasks') },
        { value: 'notes', label: t('nav.notes') },
      ]}
    />
  );
}
