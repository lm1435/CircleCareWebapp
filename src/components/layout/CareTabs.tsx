import type { ReactElement } from 'react';
import { useTranslation } from 'react-i18next';
import { SectionTabs } from './SectionTabs';

/**
 * The Care section switcher (spec §5.3; mobile's Care top tab bar). See
 * `SectionTabs` for the shared behavior — `HealthTabs` is the same control
 * over Emergency · Documents.
 *
 * SHORT LABELS, not `nav.*`. Four segments share one `px-5` row, so on a 390px
 * phone each gets ~85px; `nav.meds` ("Medications" / "Medicamentos") needs more
 * than that on its own, and a flex item can't shrink below its longest word, so
 * that one segment stole width from the other three and spilled out of the
 * sliding thumb (which is fixed at 1/n). Mobile hit this first and answered it
 * with a dedicated `careTabs` label set; these `nav.*Short` keys are that set,
 * word for word. They can't just be `nav.*` shortened: the same keys name the
 * `xl` sidebar rows and the Medications masthead eyebrow, which have room and
 * want the long form. The two that happen to be identical to their `nav.*`
 * twin today (tasks, notes) are still read from here, so a future retranslation
 * of a sidebar row can't silently re-break this row.
 */
export function CareTabs(): ReactElement | null {
  const { t } = useTranslation('common');
  return (
    <SectionTabs
      label={t('nav.careShort')}
      options={[
        { value: 'calendar', label: t('nav.calendarShort') },
        { value: 'meds', label: t('nav.medsShort') },
        { value: 'tasks', label: t('nav.tasksShort') },
        { value: 'notes', label: t('nav.notesShort') },
      ]}
    />
  );
}
