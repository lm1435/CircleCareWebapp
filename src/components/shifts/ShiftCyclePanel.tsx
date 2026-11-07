import type { ReactElement } from 'react';
import { useTranslation } from 'react-i18next';
import { TextField, Text } from '@/components/ui';
import { formatDateForDisplay, getWeekdayName, orderedWeekdays } from '@/components/calendar/dateMath';
import { buildCyclePreview, parseCycleCount } from './shiftRotation';

export interface ShiftCyclePanelProps {
  /** The typed counts (strings: the field is being edited). */
  daysOn: string;
  daysOff: string;
  onDaysOn: (value: string) => void;
  onDaysOff: (value: string) => void;
  /** Error line under the inputs (counts out of range). */
  error?: string;
  /** Day 1 of the rotation (`YYYY-MM-DD`, the shift date). */
  startDate: string;
  language: string;
  /** "was 7 days on, 7 days off": what the series had before this edit, only when it changed. */
  was?: string;
  /** Start / end clock strings when the shift is exactly 24 h (the back-to-back hint), else null. */
  dayHint: { start: string; end: string } | null;
}

/** Digits only, at most three: the counts are whole numbers 1-999. */
const digits = (value: string): string => value.replace(/\D/g, '').slice(0, 3);

/**
 * "Days on / off" panel of the shift form: the two counts, a summary line, a 6-week
 * preview (on days filled, off days outlined) and, for a 24 h shift, the back-to-back hint.
 */
export function ShiftCyclePanel({
  daysOn,
  daysOff,
  onDaysOn,
  onDaysOff,
  error,
  startDate,
  language,
  was,
  dayHint,
}: ShiftCyclePanelProps): ReactElement {
  const { t } = useTranslation(['shifts', 'calendar']);
  const on = parseCycleCount(daysOn);
  const off = parseCycleCount(daysOff);
  const valid = on !== null && off !== null && !!startDate;
  const weekdays = orderedWeekdays(language);
  const preview = valid ? buildCyclePreview(startDate, on, off, weekdays[0]) : null;

  return (
    <div
      data-testid="shift-cycle-panel"
      // card-shell-ok: the owner-approved moss-bordered options panel of a form (a group of inputs), not a card
      className="flex flex-col gap-4 rounded-lg border-[1.5px] border-moss p-4"
    >
      <div className="grid grid-cols-2 gap-4">
        <TextField
          id="cycle_days_on"
          label={t('shifts:form.daysOn')}
          inputMode="numeric"
          autoComplete="off"
          value={daysOn}
          error={error}
          onChange={(e) => onDaysOn(digits(e.target.value))}
        />
        <TextField
          id="cycle_days_off"
          label={t('shifts:form.daysOff')}
          inputMode="numeric"
          autoComplete="off"
          value={daysOff}
          onChange={(e) => onDaysOff(digits(e.target.value))}
        />
      </div>

      <div aria-live="polite" className="flex flex-col gap-1">
        {valid && (
          <Text variant="body" as="p" data-testid="shift-cycle-summary" className="m-0 font-semibold">
            {t('shifts:repeat.cycle', { on, off })}
          </Text>
        )}
        {valid && was && (
          <Text variant="caption" as="p" data-testid="shift-cycle-was" className="m-0">
            {t('shifts:form.cycleWas', { old: was })}
          </Text>
        )}
      </div>

      {preview && (
        <div className="flex flex-col gap-2">
          {/* Decorative: the summary line above says the same in words. */}
          <div aria-hidden="true" data-testid="shift-cycle-preview" className="grid grid-cols-7 gap-1">
            {weekdays.map((d) => (
              <span key={d} className="text-center text-xs font-semibold text-ink-2">
                {getWeekdayName(d, 'narrow', language)}
              </span>
            ))}
            {Array.from({ length: preview.leading }, (_, i) => (
              <span key={`lead-${i}`} />
            ))}
            {preview.cells.map((cell) => (
              <span
                key={cell.date}
                data-testid="shift-cycle-cell"
                data-on={cell.on ? 'true' : 'false'}
                // card-shell-ok: a calendar day cell of the preview, not a card
                className={`flex min-h-[40px] flex-col items-center justify-center rounded-md border text-xs leading-tight ${
                  cell.on
                    ? 'border-primary-fill bg-primary-fill font-semibold text-on-primary'
                    : 'border-line-strong bg-cream text-ink'
                }`}
              >
                {cell.firstOfMonth !== null
                  ? formatDateForDisplay(cell.date, { month: 'short', day: 'numeric' }, language)
                  : cell.day}
              </span>
            ))}
          </div>
          <p className="m-0 flex flex-wrap gap-x-4 gap-y-1 text-sm text-ink-2">
            <span className="inline-flex items-center gap-1.5">
              <span aria-hidden="true" className="h-3 w-3 rounded-sm border border-primary-fill bg-primary-fill" />
              {t('shifts:form.legendOn')}
            </span>
            <span className="inline-flex items-center gap-1.5">
              {/* card-shell-ok: the legend swatch of an outlined day, not a card */}
              <span aria-hidden="true" className="h-3 w-3 rounded-sm border border-line-strong bg-cream" />
              {t('shifts:form.legendOff')}
            </span>
          </p>
        </div>
      )}

      {dayHint && (
        <Text variant="caption" as="p" data-testid="shift-cycle-hint" className="m-0">
          {t('shifts:form.cycleHint24', dayHint)}
        </Text>
      )}
    </div>
  );
}
