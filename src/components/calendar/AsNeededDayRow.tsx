import type { ReactElement } from 'react';
import { useTranslation } from 'react-i18next';
import type { AsNeededDayEntry } from './asNeededByDay';

/**
 * One medication's as-needed doses logged on a day: the name and "Given as
 * needed". A quiet row (no status colour, no limit, no count: as-needed meds
 * never show "x of y"); click opens THAT medication's dose history.
 */
export function AsNeededDayRow({
  entry,
  onOpen,
}: {
  entry: AsNeededDayEntry;
  onOpen: (entry: AsNeededDayEntry) => void;
}): ReactElement {
  const { t } = useTranslation('meds');
  const meta = t('asNeeded.calendar.logged');
  return (
    <button
      type="button"
      data-testid="as-needed-day-row"
      aria-label={`${entry.name}, ${meta}. ${t('asNeeded.calendar.openHistory')}`}
      onClick={() => onOpen(entry)}
      className="flex min-h-[44px] w-full flex-col justify-center rounded border border-clay/40 bg-cream p-1.5 text-left hover:bg-bg-2"
    >
      <span className="truncate text-xs font-medium leading-tight text-ink">{entry.name}</span>
      <span className="text-xs font-normal leading-tight text-ink-2">{meta}</span>
    </button>
  );
}

/** The month cell's marker: a small hollow clay ring. Decorative (the cell label speaks it). */
export function AsNeededRing(): ReactElement {
  return (
    <span
      data-testid="as-needed-marker"
      aria-hidden="true"
      className="h-1.5 w-1.5 rounded-full border border-clay"
    />
  );
}
