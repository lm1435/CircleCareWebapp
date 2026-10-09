import type { ReactElement } from 'react';
import { useTranslation } from 'react-i18next';
import { Icon, MoreMenu, Sheet, type MoreMenuItem } from '@/components/ui';

/**
 * The History tab's "All medications ▾" row (spec §6.4; mobile
 * `renderFilterRow` + its filter modal): a `Sheet` whose whole surface is one
 * 44-tall control opening a `MoreMenu` of the medications that actually appear
 * in the loaded history.
 *
 * WHY THE VALUE IS A MEDICATION NAME AND NOT AN `event_id`
 * -------------------------------------------------------
 * The obvious wiring — pass the selected medication's id to the confirmations
 * endpoint as `event_id` — is wrong against the deployed backend, and wrong
 * silently. `GET /circles/:id/medications/confirmations` filters with
 * `.eq('event_id', event_id)` (backend/src/routes/medicationConfirmations.ts),
 * and a recurring medication's confirmations are written against the
 * MATERIALIZED CHILD event of each occurrence, not against the series root the
 * roster hands us. Filtering a daily medication by its root id therefore
 * returns at most the single occurrence that happened to live on the root row —
 * an empty history for the medication a caregiver just asked to see.
 *
 * So the filter narrows CLIENT-SIDE by `event.medication_name`, exactly as
 * mobile's `filteredConfirmations` does, over a page of history that is already
 * in memory. The component itself is value-agnostic: swap the option ids for
 * real event ids the day the endpoint can filter a whole series and nothing
 * here changes.
 */

export interface MedicationFilterOption {
  /** Stable identity for the option. Today: the medication name. */
  id: string;
  name: string;
}

export interface MedicationFilterProps {
  options: MedicationFilterOption[];
  /** `null` = every medication. */
  value: string | null;
  onChange: (value: string | null) => void;
}

export function MedicationFilter({
  options,
  value,
  onChange,
}: MedicationFilterProps): ReactElement {
  const { t } = useTranslation('meds');

  const allLabel = t('history.filterAll');
  const selectedLabel = (value && options.find((o) => o.id === value)?.name) || allLabel;

  const items: MoreMenuItem[] = [
    { id: '__all__', label: allLabel, onSelect: () => onChange(null) },
    ...options.map((option) => ({
      id: option.id,
      label: option.name,
      onSelect: () => onChange(option.id),
    })),
  ];

  const selectedName = value ? options.find((o) => o.id === value)?.name : undefined;
  const triggerText = selectedName
    ? t('history.showingMedication', { name: selectedName })
    : allLabel;

  const menu = (
    <Sheet padding="none" className={selectedName ? 'min-w-0 flex-1' : undefined}>
      <MoreMenu
        items={items}
        align="left"
        renderTrigger={(props) => (
          <button
            {...props}
            type="button"
            aria-label={t('history.filterByLabel', { label: selectedLabel })}
            className="flex min-h-[44px] w-full items-center gap-2.5 px-3.5 py-3 text-left"
          >
            <Icon name="options-outline" size="row" className="text-ink-2" />
            <span className="flex-1 truncate text-sm text-ink">{triggerText}</span>
            <Icon name="chevron-down" size="inline" className="text-ink-3" />
          </button>
        )}
      />
    </Sheet>
  );

  if (!selectedName) return menu;

  // Narrowed to one medication (from the menu or by tapping one of its doses):
  // a clear, labelled way back to every medication, 44px like the trigger.
  return (
    <div className="flex items-center gap-2">
      {menu}
      <button
        type="button"
        onClick={() => onChange(null)}
        aria-label={t('history.backToAllHistory')}
        data-testid="history-filter-clear"
        className="grid h-11 w-11 shrink-0 place-items-center rounded-full bg-bg-2 text-ink-2 hover:text-ink focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-clay"
      >
        <Icon name="close-outline" size="row" />
      </button>
    </div>
  );
}
