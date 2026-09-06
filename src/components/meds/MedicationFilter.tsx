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

  return (
    <Sheet padding="none">
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
            <span className="flex-1 truncate text-sm text-ink">{selectedLabel}</span>
            <Icon name="chevron-down" size="inline" className="text-ink-3" />
          </button>
        )}
      />
    </Sheet>
  );
}
