import type { ReactElement } from 'react';
import { useTranslation } from 'react-i18next';
import { SectionTabs } from './SectionTabs';

/**
 * The Health section switcher (spec §5.3) — the CareTabs twin over
 * Emergency · Documents. See `SectionTabs` for the shared behavior and why
 * this reads the route itself and is hidden from `xl` up.
 *
 * Short labels for the same reason CareTabs uses them, and this strip needed
 * them even at two segments: `nav.emergency` is "Información de emergencia" in
 * Spanish (~181px), which wrapped to two lines in a 143px cell and made the
 * whole strip 62px tall. Mobile's `healthTabs` set is the source of wording.
 */
export function HealthTabs(): ReactElement | null {
  const { t } = useTranslation('common');
  return (
    <SectionTabs
      label={t('nav.healthShort')}
      options={[
        { value: 'emergency', label: t('nav.emergencyShort') },
        { value: 'documents', label: t('nav.documentsShort') },
      ]}
    />
  );
}
